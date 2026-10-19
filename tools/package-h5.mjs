#!/usr/bin/env node
// ============================================================
// H5 打包 —— TapTap 上传专用
//
// 输入：tools/build-deploy.mjs 的产物 deploy/prototype/**（运行真正需要的文件）
// 输出：dist/pickman-h5.zip，结构严格符合 TapTap H5 上传预检：
//
//   pickman-h5.zip
//   └── game/            ← zip 根目录有且只有一个游戏文件夹
//       ├── index.html   ← 入口在该文件夹第一层
//       ├── src/ vendor/ assets/ design/ …
//
// 相对 deploy 产物额外做的事：
//   1. 剥掉开发物料：*.md、design/machine-parts、design/machine-shell-ref、
//      design/act*-*.png（分镜 storyboard，运行时零引用）
//   2. design/concepts/ 只保留 narrativeAssets.js 实际引用的概念图，
//      并把它们转成 JPG（ffmpeg，源 PNG 5~7.5MB/张 → JPG ~0.3MB/张），
//      同步改写包内 narrativeAssets.js 的 .png 引用为 .jpg
//   3. manifest.json / assets-master.json 保留（KB 级，designOverlay 开发叠加层要 fetch）
//
// 用法：
//   node tools/build-deploy.mjs          # 先出 deploy/prototype
//   node tools/package-h5.mjs            # → dist/pickman-h5.zip
//   node tools/package-h5.mjs --no-convert   # 跳过 PNG→JPG（保留原体积）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(TOOLS, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const SRC = path.resolve(ROOT, String(opt('src', 'deploy/prototype')));
const OUT = path.resolve(ROOT, String(opt('out', 'dist/pickman-h5.zip')));
const GAME_DIR = 'game';                       // zip 内的唯一顶层文件夹
const CONVERT = !argv.includes('--no-convert');

// —— 运行时引用收集：narrativeAssets.js 里两套概念图（seedream 默认 / cursor-photo 备用）——
function collectConceptRefs() {
  const f = path.join(SRC, 'src', 'narrativeAssets.js');
  if (!fs.existsSync(f)) return new Set();
  const text = fs.readFileSync(f, 'utf8');
  const refs = new Set();
  for (const m of text.matchAll(/design\/concepts\/([A-Za-z0-9._-]+\.png)/g)) refs.add(m[1]);
  for (const m of text.matchAll(/\$\{C\}([A-Za-z0-9._-]+\.png)/g)) refs.add(m[1]);
  return refs;
}

// —— 打包过滤：命中即不进包（相对 prototype/ 的 POSIX 路径）——
function isSkipped(rel) {
  if (rel.endsWith('.md')) return true;
  if (rel.startsWith('design/machine-parts/') || rel.startsWith('design/machine-shell-ref/')) return true;
  if (/^design\/act[1-5]-.*\.png$/i.test(rel)) return true;            // 分镜 storyboard
  if (/(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(rel)) return true;
  if (/(^|\/)\.[^/]*$/.test(rel)) return true;                       // 一切点文件（.gitkeep/.probe.png 等开发残留）
  if (/\.(log|tmp|blend\d*)$/i.test(rel)) return true;
  return false;
}

// —— 额外拷贝：devServer 专属路由在 production 不存在，必须随包分发 ——
//   comic-render.js  ← tools/comic-render.mjs【改名 .mjs→.js + 相对导入】
//     （TapTap 运行时两大坑：① 部分 CDN 不给 .mjs 正确 MIME，Chrome 模块脚本强制校验；
//       ② 绝对路径 /comic-render.mjs 在子路径挂载下 404。改名 + '../' 相对导入双杀。）
//   assets/aspect-study/ ← index.html 结尾品牌图（build-deploy 跳过，但运行时被 <img> 引用）
const EXTRA_COPIES = [
  { from: 'tools/comic-render.mjs', to: 'comic-render.js', required: true },
  { from: 'prototype/assets/aspect-study', to: 'assets/aspect-study', dir: true, required: true },
];

// src 里对 comic-render 的 import 重写：'/comic-render.mjs' → '../comic-render.js'
const COMIC_IMPORT_RE = /from\s+'\/comic-render\.mjs'/g;

// —— 引用完整性校验：扫 index.html 与 src/*.js 的本地引用，缺失即报错 ——
function verifyRefs() {
  const missing = [];
  const exists = (p) => fs.existsSync(path.join(SRC, p));
  // EXTRA_COPIES 提供的包内路径（不在 SRC 但会进 zip）
  const extraProvided = new Set();
  for (const ex of EXTRA_COPIES) {
    if (ex.dir) {
      const from = path.join(ROOT, ex.from);
      if (!fs.existsSync(from)) continue;
      const stack = [from];
      while (stack.length) {
        const d = stack.pop();
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const abs = path.join(d, e.name);
          if (e.isDirectory()) { stack.push(abs); continue; }
          extraProvided.add(`${ex.to}/${path.relative(from, abs).split(path.sep).join('/')}`);
        }
      }
    } else extraProvided.add(ex.to);
  }
  const ok = (p) => exists(p) || extraProvided.has(p.replace(/^\.\//, ''));
  // index.html 的 src/href 本地引用
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="(\.[^"]+|\/[^"]*?\.(?:js|mjs|css|png|jpg|svg|webp|json))"/g)) {
    const ref = m[1].split('?')[0];          // 剥掉 ?v= 版本串
    if (ref.startsWith('http') || ref.startsWith('//')) continue;
    if (ref.startsWith('/')) { if (!ok(ref.slice(1))) missing.push('index.html → ' + ref); continue; }
    if (!ok(ref)) missing.push('index.html → ' + ref);
  }
  // src/*.js 的静态 import 与 fetch 相对引用（先应用与打包一致的 comic-render 重写）
  for (const f of fs.readdirSync(path.join(SRC, 'src')).filter(x => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(SRC, 'src', f), 'utf8').replace(COMIC_IMPORT_RE, "from '../comic-render.js'");
    for (const m of text.matchAll(/from\s+'(\.[^']+)'/g)) {
      // 相对 import：按 posix 规则解析（处理 ../），再查 SRC 或 EXTRA_COPIES
      const resolved = path.posix.normalize(path.posix.join('src', m[1]));
      if (!ok(resolved)) missing.push(`src/${f} → ${m[1]}（解析为 ${resolved}）`);
    }
    for (const m of text.matchAll(/from\s+'(\/[^']+)'/g)) {
      // 绝对路径 import：挂载路径不可控，一律按缺失处理（移植性硬规则）
      missing.push(`src/${f} → ${m[1]}（绝对路径 import，运行时挂载路径不可控，必须改相对）`);
    }
  }
  return missing;
}

// —— PNG → JPG（ffmpeg）；返回新字节，失败返回 null 保留原文件 ——
function pngToJpg(abs) {
  const tmp = path.join(ROOT, 'dist', `.h5tmp-${path.basename(abs)}.jpg`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  try {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', abs, '-c:v', 'mjpeg', '-q:v', '4', tmp], { stdio: 'pipe' });
    const buf = fs.readFileSync(tmp);
    return buf.length < fs.statSync(abs).size ? buf : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// —— 最小 ZIP 写入器（deflate，UTF-8 文件名，正斜杠路径）——
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function dosDateTime(d) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}
class ZipWriter {
  constructor(file) { this.chunks = []; this.entries = []; this.file = file; this.offset = 0; }
  add(name, data, mtime) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const { time, date } = dosDateTime(mtime || new Date());
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    this.chunks.push(lh, nameBuf, comp);
    this.entries.push({ nameBuf, crc, comp, size: data.length, time, date, offset: this.offset });
    this.offset += lh.length + nameBuf.length + comp.length;
  }
  end() {
    const cdStart = this.offset;
    const cd = [];
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(8, 10); c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.comp.length, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32);
      c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(e.offset, 42);
      cd.push(c, e.nameBuf);
    }
    const cdBuf = Buffer.concat(cd);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(cdStart, 16); eocd.writeUInt16LE(0, 20);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, Buffer.concat([...this.chunks, cdBuf, eocd]));
  }
}

// —— 主流程 ——
if (!fs.existsSync(SRC)) {
  console.error(`[h5] 源目录不存在：${path.relative(ROOT, SRC)}，先跑 node tools/build-deploy.mjs`);
  process.exit(1);
}
const conceptRefs = collectConceptRefs();
console.log(`[h5] 源 ${path.relative(ROOT, SRC)}/ → 出 ${path.relative(ROOT, OUT)}`);
console.log(`[h5] narrativeAssets.js 引用概念图 ${conceptRefs.size} 张`);

const zip = new ZipWriter(OUT);
let nFiles = 0, nSkipped = 0, nConverted = 0, nRewritten = 0, rawBytes = 0, zipBytes = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(SRC, abs).split(path.sep).join('/');
    if (entry.isDirectory()) { walk(abs); continue; }
    if (isSkipped(rel)) { nSkipped++; continue; }

    let zipRel = rel, data = fs.readFileSync(abs);
    const mtime = fs.statSync(abs).mtime;

    if (rel === 'src/narrativeAssets.js') {
      // 概念图引用 -16x9.png → -16x9.jpg（ui-ration-wall-scrap*.png 不匹配，保持原样）
      data = Buffer.from(data.toString('utf8').replace(/-16x9\.png/g, '-16x9.jpg'), 'utf8');
    } else if (rel.startsWith('src/') && rel.endsWith('.js') && data.toString('utf8').includes('/comic-render.mjs')) {
      // comic-render import 重写：'/comic-render.mjs' → '../comic-render.js'（相对 + .js，见 EXTRA_COPIES 注释）
      data = Buffer.from(data.toString('utf8').replace(COMIC_IMPORT_RE, "from '../comic-render.js'"), 'utf8');
      nRewritten++;
    } else if (CONVERT && rel.startsWith('design/concepts/') && rel.endsWith('-16x9.png')) {
      if (!conceptRefs.has(path.basename(rel))) { nSkipped++; continue; }   // 未引用的概念图不进包
      const jpg = pngToJpg(abs);
      if (jpg) { data = jpg; zipRel = rel.replace(/\.png$/, '.jpg'); nConverted++; }
    } else if (rel.startsWith('design/concepts/') && !conceptRefs.has(path.basename(rel))) {
      nSkipped++; continue;                                                  // 未引用的概念图不进包
    }

    zip.add(`${GAME_DIR}/${zipRel}`, data, mtime);
    rawBytes += data.length;
    nFiles++;
  }
}
walk(SRC);

// —— 额外拷贝（devServer 专属路由 / 结尾品牌图）——
for (const ex of EXTRA_COPIES) {
  const from = path.join(ROOT, ex.from);
  if (!fs.existsSync(from)) {
    if (ex.required) { console.error(`[h5] ❌ 必需文件缺失：${ex.from}`); process.exit(1); }
    continue;
  }
  if (ex.dir) {
    const stack = [from];
    while (stack.length) {
      const d = stack.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) { stack.push(abs); continue; }
        const rel = path.relative(from, abs).split(path.sep).join('/');
        zip.add(`${GAME_DIR}/${ex.to}/${rel}`, fs.readFileSync(abs), fs.statSync(abs).mtime);
        rawBytes += fs.statSync(abs).size;
        nFiles++;
      }
    }
  } else {
    zip.add(`${GAME_DIR}/${ex.to}`, fs.readFileSync(from), fs.statSync(from).mtime);
    rawBytes += fs.statSync(from).size;
    nFiles++;
  }
  console.log(`[h5] + ${ex.from} → ${GAME_DIR}/${ex.to}`);
}

zip.end();

// —— 引用完整性校验（缺失即失败，防止再出现 import 404 黑屏）——
const missingRefs = verifyRefs();
if (missingRefs.length) {
  console.error(`[h5] ❌ 引用缺失 ${missingRefs.length} 处：`);
  missingRefs.slice(0, 10).forEach(r => console.error('   ✗ ' + r));
  process.exit(1);
}
console.log('[h5] ✅ 引用完整性校验通过（index.html + src 静态引用全部有文件）');

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`[h5] ✅ ${nFiles} 个文件入包（概念图转 JPG ${nConverted} 张，comic import 重写 ${nRewritten} 处，剥掉 ${nSkipped} 项）`);
console.log(`[h5] 包内原始体积 ${mb(rawBytes)} → zip ${mb(fs.statSync(OUT).size)}`);
console.log(`[h5] 结构：${GAME_DIR}/ 为 zip 内唯一顶层目录，index.html 在其第一层`);

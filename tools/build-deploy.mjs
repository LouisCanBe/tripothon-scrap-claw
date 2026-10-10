#!/usr/bin/env node
// ============================================================
// A4 · 部署打包 —— 见 PERF-性能优化.md
//
// 把 prototype/ 里「运行真正需要的」拷成 deploy/，剔除死文件 / 源文件 / 非默认套。
// README 的 Netlify Drop / itch.io 流程是「拖 prototype/ 文件夹」——那样会把
// 712MB 的 .blend、archive、旧奖品套、未引用的生成物一起传上去。
//
// 用法：
//   node tools/build-deploy.mjs                  # → deploy/prototype/**
//   node tools/build-deploy.mjs --with-server    # 额外带 tools/ + package.json（自包含，含 SSE 副屏）
//   node tools/build-deploy.mjs --out dist       # 自定义输出目录
//   node tools/build-deploy.mjs --no-verify      # 跳过 GLB 引用完整性检查
//
// 打包时会顺手把 index.html 等里的 __ASSET_V__ 替换成版本串（git 短 hash），
// 让 three.module.js / main.js 走 immutable 强缓存（配合 devServer.mjs 的 A3）。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.resolve(TOOLS, '..');
const SRC = path.join(ROOT, 'prototype');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : !def;
};
const OUT = path.resolve(ROOT, String(opt('out', 'deploy')));
const DEST = path.join(OUT, 'prototype');   // 保持 prototype/ 这一层，devServer 的 ../prototype 才找得到
const WITH_SERVER = argv.includes('--with-server');
const VERIFY = !argv.includes('--no-verify');

// —— 剔除规则：命中即不拷贝。相对 prototype/ 的 POSIX 路径 ——
const SKIP_DIRS = [
  'assets/generated',          // 50MB，代码零引用（含 40MB imageToModel-*.glb）
  'assets/prizes',             // legacy 套
  'assets/prizes-good',        // 非默认套（默认 good-p2）
  'assets/machine/archive',    // Blender 中间产物 / 预览
  'assets/machine/backup',
  'assets/aspect-study',       // 画幅研究素材
  'assets/worlds/.tmp',
];
const SKIP_GLOBS = [
  /\.blend\d*$/i,              // .blend / .blend1 源文件
  /^assets\/machine\/machine_.*\.glb$/i,   // 旧整机装配
  /^assets\/worlds\/reveal-draft-/i,       // 测试街角世界
  /\.zip$/i,                   // 素材压缩包（如 pink claw machine 3d model.zip）
  /\.log$/i,
  /(^|\/)(\.DS_Store|Thumbs\.db)$/i,
  /\.tmp/i,
];

function toPosix(p) { return p.split(path.sep).join('/'); }
function relOf(abs) { return toPosix(path.relative(SRC, abs)); }
function isSkipped(abs, isDir) {
  const rel = relOf(abs);
  if (isDir) {
    return SKIP_DIRS.some(d => rel === d || rel.startsWith(`${d}/`));
  }
  const base = path.basename(rel);
  if (base === '.DS_Store' || base === 'Thumbs.db') return true;
  if (/\.blend\d*$/i.test(base)) return true;
  return SKIP_GLOBS.some(re => re.test(rel)) || SKIP_DIRS.some(d => rel.startsWith(`${d}/`));
}

const kept = [];
const skipped = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const isDir = entry.isDirectory();
    if (isSkipped(abs, isDir)) {
      skipped.push({ rel: relOf(abs), dir: isDir });
      continue;
    }
    if (isDir) walk(abs);
    else kept.push(abs);
  }
}

// —— 版本串：git 短 hash，取不到用时间戳 ——
function assetVersion() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return String(Date.now());
  }
}

function copyWithVersionRewrite(srcAbs, destAbs) {
  const ext = path.extname(srcAbs).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    const html = fs.readFileSync(srcAbs, 'utf8');
    fs.writeFileSync(destAbs, html.split('__ASSET_V__').join(VERSION));
    return;
  }
  fs.copyFileSync(srcAbs, destAbs);
}

// —— 完整性检查 ——
// 分两级：
//   必在（error）：实际生效的那套 —— CONFIG.pool.glbSet 指定的奖品套、
//                  config.js / revealWorlds.js 里直接点名的资产、装饰套。
//   备用（info ）：兜底引用 —— assets.manifest-good / legacy / machine_*.glb。
//                  这些只在主套缺失时才走（glbManifest 的 order 逻辑、
//                  machineShellTripo 的 placed/shell.glb 优先），
//                  主套在包里，它们永远用不到，所以不算缺失。
const MUST_MANIFESTS = ['assets.manifest-good-p2.js', 'assets.manifest-decor.js'];
const FALLBACK_MANIFESTS = [
  'assets.manifest-good.js',
  'assets.manifest.js',
  // machine 分件只在「摆好的外壳 placed/shell.glb 加载失败」时才走
  // （machineShellTripo.js 里 placedShell 成功就提前 return）
  'assets.manifest-machine.js',
];

function scanRefs(file, out) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  // 允许前导 ./ 或 /，并剥掉 ?v= 查询串
  for (const m of text.matchAll(/['"]\.{0,2}\/(assets\/[^'"?]+)/g)) {
    out.add(m[1]);
  }
}

function verifyBundle(outDir) {
  const must = new Set();
  const fallback = new Set();

  scanRefs(path.join(outDir, 'src', 'config.js'), must);
  scanRefs(path.join(outDir, 'src', 'revealWorlds.js'), must);
  for (const f of fs.readdirSync(path.join(outDir, 'src')).filter(x => /^assets\.manifest.*\.js$/.test(x))) {
    const target = MUST_MANIFESTS.includes(f) ? must : (FALLBACK_MANIFESTS.includes(f) ? fallback : must);
    scanRefs(path.join(outDir, 'src', f), target);
  }

  const missingMust = [...must].filter(u => !fs.existsSync(path.join(outDir, u)));
  const missingFallback = [...fallback].filter(u => !fs.existsSync(path.join(outDir, u)));

  console.log(`\n[verify] 必在引用 ${must.size} 条：${missingMust.length ? '❌ 缺失 ' + missingMust.length : '✅ 全部找到'}`);
  missingMust.slice(0, 20).forEach(u => console.warn('   ✗ ' + u));
  if (missingMust.length > 20) console.warn(`   …另 ${missingMust.length - 20} 条`);
  if (missingFallback.length) {
    console.log(`[verify] 备用引用（主套在包里，不会走到）${missingFallback.length} 条未随包，属预期：`);
    const byDir = {};
    for (const u of missingFallback) {
      const d = u.split('/').slice(0, 2).join('/');
      byDir[d] = (byDir[d] || 0) + 1;
    }
    for (const [d, n] of Object.entries(byDir)) console.log(`   · ${d} × ${n}`);
  }
  return missingMust.length === 0;
}

// —— 主流程 ——
const VERSION = assetVersion();
console.log(`[deploy] 版本串 __ASSET_V__ → ${VERSION}`);
console.log(`[deploy] 源 ${toPosix(path.relative(ROOT, SRC))}/ → 出 ${toPosix(path.relative(ROOT, OUT))}/`);

fs.rmSync(OUT, { recursive: true, force: true });
walk(SRC);

for (const abs of kept) {
  const dest = path.join(DEST, relOf(abs));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyWithVersionRewrite(abs, dest);
}

if (WITH_SERVER) {
  // devServer.mjs 用 dirname(__file)/../prototype 定位，必须保持这个相对关系
  const serverFiles = [
    'tools/devServer.mjs',
    'tools/collectDisplayHub.mjs',
    'tools/http-util.mjs',
    'tools/frameStream.mjs',
    'tools/comic-render.mjs',
    'tools/prize-lib.mjs',
    'package.json',
  ];
  let copied = 0;
  for (const rel of serverFiles) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) { console.warn(`[deploy] --with-server 缺 ${rel}（跳过）`); continue; }
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied += 1;
  }
  console.log(`[deploy] --with-server：带上 ${copied} 个服务文件（cd deploy && node tools/devServer.mjs）`);
}

// —— 报表 ——
const outSize = (() => {
  const count = (dir) => {
    let s = 0, c = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = count(p); s += r.s; c += r.c; }
      else { s += fs.statSync(p).size; c += 1; }
    }
    return { s, c };
  };
  const r = count(DEST);
  return { sum: r.s, n: r.c };
})();

const skipSize = (() => {
  let s = 0;
  for (const { rel } of skipped) {
    const abs = path.join(SRC, rel);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) {
      const c = (d) => fs.readdirSync(d, { withFileTypes: true })
        .reduce((acc, e) => acc + (e.isDirectory() ? c(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
      s += c(abs);
    } else s += fs.statSync(abs).size;
  }
  return s;
})();

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`\n[deploy] ✅ 拷贝 ${kept.length} 个文件，输出共 ${outSize.n} 个文件 / ${mb(outSize.sum)}`);
console.log(`[deploy] ⤵ 剔除 ${skipped.length} 项，省下 ${mb(skipSize)}`);
console.log(`[deploy] 剔除明细（按体积前 12）：`);
const big = skipped
  .map(({ rel, dir }) => {
    const abs = path.join(SRC, rel);
    if (!fs.existsSync(abs)) return { rel, dir, size: 0 };
    const size = fs.statSync(abs).isDirectory()
      ? (function c(d) { return fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? c(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0); })(abs)
      : fs.statSync(abs).size;
    return { rel, dir, size };
  })
  .filter(x => x.size > 0)
  .sort((a, b) => b.size - a.size)
  .slice(0, 12);
for (const { rel, dir, size } of big) console.log(`   ${mb(size).padStart(10)}  ${rel}${dir ? '/' : ''}`);

if (VERIFY) {
  const ok = verifyBundle(DEST);
  if (!ok) {
    console.warn('\n[deploy] ⚠️ 有引用缺失，仍已输出，但发布前请确认是否误删。');
  }
}
console.log(`\n[deploy] 静态托管：发布目录 = ${toPosix(path.relative(ROOT, DEST))}`);
if (WITH_SERVER) {
  console.log(`[deploy] 自包含跑：cd ${toPosix(path.relative(ROOT, OUT))} && set PORT=8000 && node tools/devServer.mjs`);
}

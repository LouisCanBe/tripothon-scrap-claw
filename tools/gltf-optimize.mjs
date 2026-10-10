#!/usr/bin/env node
// ============================================================
// A1 / A5 · GLB 瘦身 —— 见 PERF-性能优化.md
//
// 首屏闸门 ≈170MB，其中 claw_parts.glb 37MB + placed/shell.glb 16MB 是纯几何未压缩，
// decor-low 20 件 52MB、prizes-good-p2 33 件 75MB 多半重在贴图。
//
// 三步，按「零运行时风险 → 高收益」排列：
//   1) weld + prune        —— 纯 JS，无额外依赖，永远安全
//   2) resize 贴图          —— 需要 sharp（npm i -D sharp），没有就跳过并提示
//   3) 几何压缩             —— codec 二选一：
//        meshopt（默认） 体积比 Draco 更小、解码快 1~2 个数量级（基本是位拆包）。
//                        需要 gltfpack（meshoptimizer 项目的 glTF 工具，MIT 单文件）。
//                        游戏侧解码器已接：src/glbDecoders.js + vendor/addons/libs/meshopt_decoder.module.js
//        draco          需要 draco3dgltf + gltf-transform 的 draco()。
//                        体积稍大、解码明显更慢 —— 免费实例（0.1 核）和老手机上会吃亏。
//                        游戏侧解码器已接：vendor/addons/libs/draco/
//
// **为什么默认 meshopt 而不是 Draco**：
// 省下载时间是其一，但解码同样吃 CPU。Draco 用熵解码，meshopt 基本是位拆包，
// 快一到两个数量级。发布机是 Render 免费实例（0.1 核），用户端还可能是老手机 ——
// 用 Draco 会把省下来的下载时间又赔回去一部分在解码上。
//
// 依赖：
//   npm i -D gltfpack                    # meshopt 路线（推荐，0.3MB）
//   npm i -D @gltf-transform/core @gltf-transform/extensions \
//            @gltf-transform/functions draco3dgltf sharp   # 仅 --dry / --codec draco 需要
//
// 用法：
//   node tools/gltf-optimize.mjs --dry            # 只看体检报告，不动文件
//   node tools/gltf-optimize.mjs                  # weld+prune+resize+meshopt（默认）
//   node tools/gltf-optimize.mjs --codec draco    # 改用 Draco
//   node tools/gltf-optimize.mjs --codec none     # 只 weld+prune+resize，不压几何
//   node tools/gltf-optimize.mjs --only claw      # claw | shell | decor | prizes
//   node tools/gltf-optimize.mjs --tex 2048       # 贴图长边上限（默认 1024）
//   node tools/gltf-optimize.mjs --min-size 1500  # 只处理大于 N KB 的（默认 1500）
//   node tools/gltf-optimize.mjs --no-backup      # 不做 .orig 备份（默认备份）
//
// 安全：默认先把原文件复制成 <name>.glb.orig，出问题直接改回来。
// 这些 GLB 都在 git 里，`git checkout -- <path>` 也能恢复。
//
// ⚠️ ** prizes 是首屏最大项**（实测占总加载时长 47%，见 PERF-性能优化.md 第五节），
//    所以默认就带上 prizes，且 `--only prizes` 应该最先跑。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTOTYPE = path.join(ROOT, 'prototype');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const DRY = argv.includes('--dry');
const CODEC = String(opt('codec', 'meshopt')).toLowerCase();   // meshopt | draco | none
const USE_DRACO = CODEC === 'draco';
const USE_MESHOPT = CODEC === 'meshopt';
const NO_BACKUP = argv.includes('--no-backup');
const TEX = parseInt(String(opt('tex', '1024')), 10);
const MIN_SIZE = parseFloat(String(opt('min-size', '1500'))) * 1024;
const ONLY = String(opt('only', ''));

if (!['meshopt', 'draco', 'none'].includes(CODEC)) {
  console.error(`[gltf] --codec 只认 meshopt | draco | none，收到的是 "${CODEC}"`);
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// —— 目标清单：键名供 --only 用 ——
const GROUPS = {
  claw:   ['assets/machine/claw_parts.glb'],
  shell:  ['assets/machine/placed/shell.glb'],
  decor:  listDir('assets/decor-low'),
  prizes: listDir('assets/prizes-good-p2'),
};

function listDir(rel) {
  const abs = path.join(PROTOTYPE, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter(f => /\.glb$/i.test(f)).map(f => `${rel}/${f}`);
}

function targets() {
  let rels;
  if (ONLY) {
    // 先按组名（claw/shell/decor/prizes）匹配；不中再按单件文件名（claw_parts 等）
    if (GROUPS[ONLY]) {
      rels = GROUPS[ONLY];
    } else {
      const base = ONLY.replace(/\.glb$/i, '');
      rels = Object.values(GROUPS).flat().filter(r => path.basename(r, '.glb') === base);
    }
  } else {
    rels = Object.values(GROUPS).flat();
  }
  return rels
    .filter(rel => !/\.orig$/i.test(rel))
    .map(rel => ({ rel, abs: path.join(PROTOTYPE, rel) }))
    .filter(t => fs.existsSync(t.abs) && fs.statSync(t.abs).isFile())
    // --only 显式点名时不受体积阈值限制（用户就是要处理这一件/这一组）
    .filter(t => Boolean(ONLY) || fs.statSync(t.abs).size >= MIN_SIZE);
}

/** 体检：拆出几何 / 贴图各占多少，好判断该压哪一块。 */
/** 压坏了就把文件还原回 .orig，不让半成品留在原地 */
function restoreBackup(abs) {
  if (fs.existsSync(`${abs}.orig`)) {
    fs.copyFileSync(`${abs}.orig`, abs);
    return true;
  }
  return false;
}

/**
 * meshopt：调 gltfpack（meshoptimizer 项目的官方 glTF 工具，MIT，单二进制）。
 * 用 npx 拉，不必装进项目；网上有缓存时首次约 10~30s。
 *
 *   -cc              压缩几何为 EXT_meshopt_compression
 *   -tc / -tq        纹理量化 + 质量（大幅降 VRAM 与下载）
 *   -kn              保留原始法线（描边/Toon 需要精确法线，别用量化法线）
 *   -nm              简化到 min三角形（这里设 0 = 不简化，只压缩）
 *   -si lev          顶点层级简化（不影响三角数，只影响 cache 命中）
 *
 * 顶点/纹理量化是这个脚本降体积的主力，但会损失精度 —— 见 PERF-性能优化.md 的验收判据。
 */
/**
 * meshopt 几何压缩：调 gltfpack（meshoptimizer 官方工具，MIT）。
 *
 * **不走子进程**。npm 上的 gltfpack 是纯 WASM 实现
 * （`node_modules/gltfpack/library.js` + `library.wasm`），直接 import `pack()`。
 *
 * 为什么不 spawn：Windows 上 .cmd 在 `shell:false` 下报 EINVAL（CVE 2024 后
 * Node 禁止直接 spawn .cmd）；`shell:true` 则把参数拼成字符串，本项目路径
 * 带空格（"2026.9.6 TripoThon"）会被 cmd.exe 二次切分，报
 * "'G:\dajavu\Events\2026.9.6' 不是内部或外部命令"。走 WASM 两类坑一起消失。
 *
 * ⚠️ **npm 版 gltfpack 编译时没带 WebP / BasisU**（官方明说 node 构建缺少
 * 平台特性），所以纹理压缩（-tw/-tc）不可用，贴图降尺寸在 -tl 上也需要
 * 纹理压缩协同 —— 这也是贴图走 sharp 单独处理的原因。见 shrinkTextures()。
 *
 *   -cc   meshopt 几何压缩（EXT_meshopt_compression）
 *   -si R 简化比例（默认 1 = 不简化）
 *   -vp N 顶点位置量化位数（默认 14）
 *   -vn N 法线量化位数（默认 8）
 */
async function compressGeometryMeshopt(abs) {
  const args = ['-i', abs, '-o', abs, '-cc', '-si', '1.0', '-vp', '14', '-vn', '8'];

  let pack;
  try {
    ({ pack } = await import('gltfpack/library.js'));
  } catch (e) {
    return { ok: false, err: `没装 gltfpack（${e.message}）。跑 npm i -D gltfpack 后再试。` };
  }
  const iface = {
    read: (p) => fs.readFileSync(p),
    write: (p, data) => fs.writeFileSync(p, data),
  };
  try {
    await pack(args, iface);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e?.message || e).slice(0, 300) };
  }
}

/**
 * 贴图降尺寸：用 sharp 把 GLB/GLTF 内嵌贴图压到长边 <= maxDim，写回 GLB。
 *
 * 为什么不用 gltfpack 的 -tl：npm 版 gltfpack 没编 WebP/BasisU，而 -tl
 * 只在有纹理压缩链路时才生效（不带 -tw/-tc 会直接报
 * "Texture processing is only supported when texture compression is enabled"）。
 *
 * 做法：读 GLB → 解析 JSON chunk 找 images（bufferView）→ sharp 缩放 →
 * 覆写对应 bufferView。GLB 的 buffer 布局会变，所以直接把新 buffer 重组写回。
 */
async function shrinkTextures(abs, maxDim) {
  const sharp = (await import('sharp')).default;
  const raw = fs.readFileSync(abs);

  // —— 解析 GLB 头 ——
  if (raw.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB（magic 不符）');
  const jsonLen = raw.readUInt32LE(12);
  const json = JSON.parse(raw.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;

  const images = json.images ?? [];
  if (!images.length) return { ok: true, n: 0 };

  // 收集要处理的 bufferView（GLB 内嵌贴图走 bufferView）
  const jobs = [];
  for (const img of images) {
    if (img.uri || img.bufferView == null) continue;   // 外链或非内嵌跳过
    const bv = json.bufferViews[img.bufferView];
    jobs.push({ img, bv });
  }
  if (!jobs.length) return { ok: true, n: 0 };

  // 逐个缩放；新的字节放回原 bufferView 位置，长度变化时做碎片整理
  const pieces = [];   // {byteOffset, byteLength} 重排后的 bin 块
  let changed = 0;
  let bin = raw.subarray(binStart);

  // 简化策略：把整块 binary chunk 当 buffer（GLB 常见单 buffer）
  // 多 buffer 的 glTF 少见，遇到就跳过并提示
  if (json.buffers?.length > 1) return { ok: false, err: '多 buffer GLB 不支持' };

  // 逐个处理；新的字节覆写回原 bufferView 位置
  const sorted = [...jobs].sort((a, b) => b.bv.byteOffset - a.bv.byteOffset);
  for (const { img, bv } of sorted) {
    const oldBytes = raw.subarray(binStart + bv.byteOffset, binStart + bv.byteOffset + bv.byteLength);
    let pipeline = sharp(oldBytes, { failOn: 'error' });
    let newMime = img.mimeType;

    // 关键：PNG 若不改编码，sharp 只会做无损重排，**一点都压不动**
    // （实测 400~500KB 的 baseColor PNG 原样保留，占了单件体积一半）。
    // 本作贴图全是食物/道具的漫反射贴图，无 alpha 需求 → 统一转 JPEG。
    // alpha 需求存在的（极少）保留 PNG，只降尺寸。
    const hasAlpha = /png|webp/i.test(img.mimeType || '') && await hasAlphaChannel(oldBytes);
    if (hasAlpha) {
      pipeline = pipeline.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
    } else {
      pipeline = pipeline
        .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true });
      newMime = 'image/jpeg';
    }

    const out = await pipeline.toBuffer();
    img.mimeType = newMime;
    if (out.length === bv.byteLength) {
      out.copy(raw, binStart + bv.byteOffset);   // 等长，原地覆写
    } else {
      // 长度变了：拼接新 binary，并修正后续 bufferView / accessor 偏移
      bin = Buffer.concat([
        bin.subarray(0, bv.byteOffset),
        out,
        bin.subarray(bv.byteOffset + bv.byteLength),
      ]);
      const delta = out.length - bv.byteLength;
      bv.byteLength = out.length;
      for (const other of json.bufferViews) {
        if (other !== bv && other.byteOffset > bv.byteOffset) other.byteOffset += delta;
      }
      for (const acc of json.accessors ?? []) {
        if (acc.byteOffset != null) acc.byteOffset += delta;
      }
    }
    changed += 1;
  }

  // buffer.byteLength 跟随实际 binary
  json.buffers[0].byteLength = bin.length;

  // —— 重新打包 GLB ——
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4;      // magic 'glTF'
  out.writeUInt32LE(2, o); o += 4;               // version
  out.writeUInt32LE(total, o); o += 4;           // length
  out.writeUInt32LE(jsonBuf.length + jsonPad, o); o += 4;
  out.write('JSON', o, 'utf8'); o += 4;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  o += jsonPad;
  out.writeUInt32LE(bin.length + binPad, o); o += 4;
  out.write('BIN\0', o, 'utf8'); o += 4;
  bin.copy(out, o); o += bin.length;

  fs.writeFileSync(abs, out);
  return { ok: true, n: changed };
}

/**
 * 判断贴图是否带 alpha 通道（有 alpha 的转 JPEG 会出黑底，不能转）。
 */
async function hasAlphaChannel(bytes) {
  try {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    if (info.channels >= 4) {
      for (let i = 3; i < data.length; i += info.channels) {
        if (data[i] < 250) return true;
      }
    }
    return false;
  } catch {
    return true;   // 探测失败就当有 alpha，保守不转
  }
}

/** 卸掉死代码 run()（meshopt 与 sharp 都走进程内 API，不再 spawn） */
function runDeprecated() {}


async function inspect(doc) {
  const root = doc.getRoot();
  let texBytes = 0;
  for (const tex of root.listTextures()) {
    const img = tex.getImage();
    if (img) texBytes += img.byteLength;
  }
  const meshes = root.listMeshes();
  let verts = 0, tris = 0;
  for (const m of meshes) {
    for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      if (pos) { verts += pos.getCount(); tris += pos.getCount() / 3; }
    }
  }
  return { texMB: texBytes / 1024 / 1024, meshes: meshes.length, verts, tris };
}

async function main() {
  const files = targets();
  if (!files.length) {
    console.log('[gltf] 没有命中任何文件（检查 --only / --min-size）');
    return;
  }

  // 依赖分级：
  //   --dry 或 --codec draco  → @gltf-transform 必需（体检报告 / draco() 都要）
  //   --codec meshopt         → 完全不需要，gltfpack 一条命令全干完；
  //                             这里只为顺带打印「mesh/顶点/贴图」体检信息试试加载
  let io = null, ext = null, funcs = null, ioInst = null;
  try {
    io = (await import('@gltf-transform/core')).NodeIO;
    ext = await import('@gltf-transform/extensions');
    funcs = await import('@gltf-transform/functions');
    ioInst = new io();
    // NodeIO 不会自动发现扩展 —— 显式注册，读（重复压缩）和写（输出）都需要
    if (ext.KHRDracoMeshCompression) ioInst.registerExtensions([ext.KHRDracoMeshCompression]);
  } catch (e) {
    if (DRY || USE_DRACO) {
      console.error('[gltf] 缺少依赖。先装：');
      console.error('  npm i -D @gltf-transform/core @gltf-transform/extensions \\');
      console.error('           @gltf-transform/functions draco3dgltf sharp');
      console.error(`\n原始错误：${e.message}`);
      process.exit(1);
    }
    console.log('[gltf] 没装 @gltf-transform —— meshopt 路径不受影响，只少一份体检报告。');
  }

  const inspectOrNull = async (file) => {
    if (!ioInst) return null;
    try { return await inspect(await ioInst.read(file)); } catch { return null; }
  };

  const sharpOk = await (async () => {
    try { await import('sharp'); return true; } catch { return false; }
  })();

  console.log(`[gltf] ${DRY ? '体检（--dry，不写文件）' : '优化'} ${files.length} 个文件`);
  console.log(`[gltf] 贴图上限 ${TEX}px · codec=${CODEC} · sharp ${sharpOk ? '有' : '无（跳过贴图降尺寸）'}`);
  if (USE_MESHOPT) {
    console.log('[gltf] meshopt：走 gltfpack；游戏侧解码器已接 src/glbDecoders.js');
  }
  if (USE_DRACO) console.log('[gltf] draco：走 @gltf-transform 的 draco()；解码器已接 vendor/addons/libs/draco/');
  if (sharpOk && TEX > 0) {
    console.log('[gltf] ⚠️ resize 会让贴图变模糊——机壳(满屏背景)与败露态(霉斑/锈迹)建议单独提到 2048 再看');
  }

  let totalBefore = 0, totalAfter = 0;
  const rows = [];

  for (const { rel, abs } of files) {
    const before = fs.statSync(abs).size;
    totalBefore += before;
    let after = before;
    let note = '';

    if (DRY) {
      if (!ioInst) { rows.push({ rel, before, after, before, note: '（未装 @gltf-transform，无体检报告）' }); continue; }
      try {
        const doc = await ioInst.read(abs);
        const info = await inspect(doc);
        note = `${info.meshes} mesh / ${info.verts} 顶点 / ${info.tris.toFixed(0)} 三角 / 贴图 ${info.texMB.toFixed(1)}MB`;
      } catch (e) {
        note = `读取失败：${e.message}`;
      }
      rows.push({ rel, before, after, note });
      continue;
    }

    // 备份
    if (!NO_BACKUP && !fs.existsSync(`${abs}.orig`)) fs.copyFileSync(abs, `${abs}.orig`);

    try {
      if (USE_MESHOPT) {
        // —— meshopt：gltfpack(WASM) 压几何 + sharp 降贴图 ——
        // 顺序有讲究：先 sharp 缩贴图（体积大头在贴图），再 meshopt 压几何。
        // 反过来的话 meshopt 是在缩前的大 buffer 上干活，白费功。
        const info = await inspectOrNull(abs);
        let steps = [];
        if (sharpOk && TEX > 0) {
          const r = await shrinkTextures(abs, TEX).catch((e) => ({ ok: false, err: e.message }));
          if (r?.ok) steps.push(`贴图-${r.n}张`);
          else if (r) steps.push(`贴图失败(${String(r.err).slice(0, 40)})`);
        }
        const res = await compressGeometryMeshopt(abs);
        if (res.ok) steps.push('几何-meshopt');
        else { note = `❌ meshopt 失败：${res.err}`; restoreBackup(abs); after = before; }
        if (!note) {
          after = fs.statSync(abs).size;
          note = [info ? `${info.meshes} mesh / 贴图 ${info.texMB.toFixed(1)}MB` : '', ...steps]
            .filter(Boolean).join(' · ');
        }
      } else {
        // —— draco / none：走 gltf-transform ——
        const doc = await ioInst.read(abs);
        const info = await inspect(doc);

        // 1) 几何去重 + 清无用（纯 JS，零风险）
        await doc.transform(funcs.weld(), funcs.prune());

        // 2) 贴图降尺寸（需要 sharp）
        if (sharpOk && TEX > 0) {
          try {
            await doc.transform(funcs.resize({ size: [TEX, TEX] }));
          } catch (e) {
            note += `resize失败(${e.message}) `;
          }
        }

        // 3) Draco 几何压缩
        if (USE_DRACO) {
          await doc.transform(
            ext.draco({
              method: 'edgebreaker',
              encodeSpeed: 5,
              decodeSpeed: 5,
              quantizePositionBits: 14,
              quantizeNormalBits: 10,
              quantizeTexcoordBits: 12,
              quantizeColorBits: 8,
              quantizeGenericBits: 12,
            })
          );
        }

        await ioInst.write(abs, doc);
        after = fs.statSync(abs).size;
        note += `${info.meshes} mesh / ${info.verts} 顶点 / 贴图 ${info.texMB.toFixed(1)}MB`;
      }
    } catch (e) {
      note = `❌ ${e.message}`;
      restoreBackup(abs);
      after = before;
    }
    totalAfter += after;
    rows.push({ rel, before, after, note });
  }

  // —— 报表 ——
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('文件', 46) + pad('原', 10) + pad('现', 10) + '变化');
  for (const r of rows) {
    const pct = r.before ? ((r.after - r.before) / r.before * 100) : 0;
    console.log(
      pad(r.rel.replace('assets/', ''), 46) +
      pad(kb(r.before), 10) +
      pad(DRY ? '-' : kb(r.after), 10) +
      `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
    );
    if (r.note) console.log('    ↳ ' + r.note);
  }
  const saved = totalBefore - totalAfter;
  console.log(`\n[gltf] 合计 ${kb(totalBefore)} → ${DRY ? '?' : kb(totalAfter)}` +
    (DRY ? '' : `，省 ${kb(saved)}（${(saved / totalBefore * 100).toFixed(0)}%）`));
  if (!DRY) console.log('[gltf] 原文件已备份为 .orig；恢复：改名回来，或 git checkout -- <path>');
}

await main();

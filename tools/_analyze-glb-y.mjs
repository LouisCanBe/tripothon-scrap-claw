// 临时：分析 collider GLB 的 Y 分布，定位"低于地板的离散三角"
// 用法：node tools/_analyze-glb-y.mjs <collider.glb>
//
// ⚠️ 本工具读的是 GLB **本地坐标**（Marble 导出时的空间，Y-down 朝下为正）。
// 但游戏运行时做了 frame.rotation.x = π 翻转，且 collider 还可能被 position.y 偏移。
// 所以本地 Y ≠ 世界 Y！本地 min/max.y 和调试台高度标尺读数不一样。
//
// 正确的 Y 值测法（两个选一个）：
//   a. 打开 /marble/reveal/ 调试台，看左上角几何摘要（collider 底/顶 = 世界坐标）
//   b. 看高度标尺（标的是世界坐标 y）
//
// 粘进 revealWorlds.js 的值用世界坐标，不是本地坐标！
// ============================================================
import fs from 'node:fs';
import path from 'node:path';

function readGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB');
  let off = 12, json = null; const buffers = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) buffers.push(data);
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return { json, buffers };
}

function readIdx(json, buffers, acc) {
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const src = buffers[bv.buffer];
  const out = new Uint32Array(acc.count);
  const comp = acc.componentType;
  const stride = bv.byteStride ?? (comp === 5123 ? 2 : comp === 5121 ? 1 : 4);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    out[i] = comp === 5123 ? src.readUInt16LE(o) : comp === 5121 ? src.readUInt8(o) : src.readUInt32LE(o);
  }
  return out;
}

const file = process.argv[2];
const { json, buffers } = readGLB(path.resolve(file));
console.log(`=== ${path.basename(file)} ===`);
console.log(`mesh ${(json.meshes ?? []).length} · accessor ${(json.accessors ?? []).length} · node ${json.nodes.length}`);

// 每个 accessor 的 POSITION 都带 min/max（glTF 规范要求），先看有没有异常
(json.accessors ?? []).forEach((a, i) => {
  if (a.type !== 'VEC3' || a.min == null) return;
  const isPos = (json.meshes ?? []).some(m => (m.primitives ?? []).some(p => p.attributes?.POSITION === i));
  if (!isPos) return;
  console.log(`  POSITION accessor[${i}] count=${a.count} min=[${a.min.map(v => v.toFixed(3)).join(',')}] max=[${a.max.map(v => v.toFixed(3)).join(',')}]`);
});

// 收集所有三角形的 y 范围
const tris = [];
(json.meshes ?? []).forEach((m, mi) => {
  (m.primitives ?? []).forEach((p, pi) => {
    if (p.attributes?.POSITION == null) return;
    const acc = json.accessors[p.attributes.POSITION];
    const bv = json.bufferViews[acc.bufferView];
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const src = buffers[bv.buffer];
    const stride = bv.byteStride ?? 12;
    const pos = new Float32Array(acc.count * 3);
    for (let i = 0; i < acc.count; i++) {
      const o = base + i * stride;
      pos[i * 3] = src.readFloatLE(o); pos[i * 3 + 1] = src.readFloatLE(o + 4); pos[i * 3 + 2] = src.readFloatLE(o + 8);
    }
    const idx = p.indices != null ? readIdx(json, buffers, json.accessors[p.indices]) : null;
    const n = idx ? idx.length : acc.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = (idx ? idx[t] : t) * 3, b = (idx ? idx[t + 1] : t + 1) * 3, c = (idx ? idx[t + 2] : t + 2) * 3;
      tris.push({ mesh: mi, prim: pi, ys: [pos[a + 1], pos[b + 1], pos[c + 1]], xs: [pos[a], pos[b], pos[c]], zs: [pos[a + 2], pos[b + 2], pos[c + 2]] });
    }
  });
});

console.log(`\n三角形总数 ${tris.length}`);

// Y 直方图（0.1m 一档）
const bins = new Map();
for (const t of tris) for (const y of t.ys) {
  const k = Math.round(y * 10) / 10;
  bins.set(k, (bins.get(k) ?? 0) + 1);
}
const keys = [...bins.keys()].sort((a, b) => a - b);
console.log('\nY 顶点直方图（0.1m 一档，只列非零）:');
let line = '';
for (const k of keys) {
  line += `${k >= 0 ? ' ' : ''}${k.toFixed(1)}:${String(bins.get(k)).padStart(5)}  `;
  if (line.length > 100) { console.log('  ' + line); line = ''; }
}
if (line) console.log('  ' + line);

// 找出"主体地板"：顶点数最多的那个 y 值
let peakY = null, peakN = 0;
for (const [k, n] of bins) if (n > peakN) { peakN = n; peakY = k; }
console.log(`\n顶点最密集的 y = ${peakY.toFixed(2)}（${peakN} 个顶点）`);

// 注意：Marble collider 是**完整封闭碰撞体**（墙+地+天花），不是只有地面。
// 所以"地板"不是顶点最密集的那一层 —— 密集层通常是天花板或墙面。
// 真正的判据：找出 y 方向的"空隙"（gap）。地板是最高那道连续带的底边。
const sortedY = [...new Set(tris.flatMap(t => t.ys.map(v => Math.round(v * 20) / 20)))].sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < sortedY.length; i++) {
  const g = sortedY[i] - sortedY[i - 1];
  if (g > 0.08) gaps.push({ from: sortedY[i - 1], to: sortedY[i], gap: g });
}
console.log('\nY 方向的空隙（>0.08m）:');
for (const g of gaps) console.log(`  ${g.from.toFixed(2)} → ${g.to.toFixed(2)}   空 ${g.gap.toFixed(2)}m`);

// 按"三角中心高度"分段，看哪一段是墙
console.log('\n按三角中心高度分段（0.1m 一段）:');
const seg = new Map();
for (const t of tris) {
  const y = (Math.min(...t.ys) + Math.max(...t.ys)) / 2;
  const k = Math.round(y / 0.1) * 0.1;
  seg.set(k, (seg.get(k) ?? 0) + 1);
}
const segKeys = [...seg.keys()].sort((a, b) => a - b);
const segMax = Math.max(...seg.values());
for (const k of segKeys) {
  const n = seg.get(k);
  const bar = '#'.repeat(Math.min(56, Math.round(n / segMax * 56)));
  console.log(`  ${k.toFixed(1).padStart(6)}  ${String(n).padStart(6)}  ${bar}`);
}

const rng = (a) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return `${lo.toFixed(2)}~${hi.toFixed(2)}`;
};
console.log('\n各高度层的顶视占地面（用于选 wallY0/wallY1）:');
for (const [lo, hi] of [[-1.4, -1.0], [-1.0, -0.5], [-0.5, 0.0], [0.0, 0.4], [0.4, 0.61], [-1.4, 0.61]]) {
  const sel = tris.filter(t => Math.max(...t.ys) >= lo && Math.min(...t.ys) <= hi);
  if (!sel.length) { console.log(`  y∈[${lo.toFixed(2)}, ${hi.toFixed(2)}]  无三角`); continue; }
  const xs = sel.flatMap(t => t.xs), zs = sel.flatMap(t => t.zs);
  console.log(`  y∈[${lo.toFixed(2).padStart(5)}, ${hi.toFixed(2).padStart(5)}]  ${String(sel.length).padStart(6)} 三角  X ${rng(xs)}  Z ${rng(zs)}`);
}

// ── 总结（要写进 revealWorlds.js 的世界坐标 Y 值请看调试台高度标尺）────────
console.log('\n══════════════════════════════════════════════════════════');
console.log('  ⚠ 以下本地坐标 Y ≠ 游戏世界坐标 Y（差了 rotation.x=π 翻转）');
console.log('  世界坐标 Y 请开 /marble/reveal/ 调试台 → 左上角几何摘要 / 高度标尺');
console.log('══════════════════════════════════════════════════════════');
console.log(`  本地 GLB  Y 范围：${rngY(tris, 'min').toFixed(3)} ~ ${rngY(tris, 'max').toFixed(3)}（本地，仅供参考）`);
console.log(`  本地层高：${(rngY(tris, 'max') - rngY(tris, 'min')).toFixed(3)}m`);
console.log('  ');
console.log('  // revealWorlds.js 需要的值（从调试台高度标尺读，不要从本工具抄）：');
console.log('  //   colliderYOffset: 0,         // collider 相对 SPZ 微调（米）');
console.log('  //   eyeHeight: 待测,              // 从 collider 底（调试台读数）起算');
console.log('  //   wallY0: 待测, wallY1: 待测   // 墙带底/顶相对 collider 底（米）');
console.log('  ');
console.log('  // 三角密度最高的层（本地坐标）：');
console.log(`  //   ${peakY.toFixed(3)}m  →  ${peakN} 个顶点（可能是天花板，不是地板！）`);

function rngY(tris, which) {
  let v = which === 'min' ? Infinity : -Infinity;
  for (const t of tris) {
    const yv = which === 'min' ? Math.min(...t.ys) : Math.max(...t.ys);
    if (which === 'min' && yv < v) v = yv;
    if (which === 'max' && yv > v) v = yv;
  }
  return v;
}

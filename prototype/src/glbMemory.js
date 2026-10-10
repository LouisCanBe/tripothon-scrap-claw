// ============================================================
// GLB 内存安全 —— 见 PERF-性能优化.md（A 档 · 内存侧）
//
// 结论先行：**three.js 的 GLB 解析没有"我方能释放的 ArrayBuffer"**。
// r170 的 GLTFLoader 走 body.slice() + 每个 bufferView 再 slice()，
// TypedArray 是 bufferView 的视图；gltf 结果里并不保留原始 ArrayBuffer。
// 所以 JS 堆的大头是「解码后的几何属性」≈ GLB 文件体积量级 —— 这正是
// 面板上 300~400MB 的来路（奖品 ~56MB + 装饰 ~52MB + 爪 37MB + 壳 16MB）。
// 想降它，靠的是 A1/A5（把文件变小）+ 贴图降分辨率（降 VRAM），不是手动释放。
//
// 本模块做三件**确实有效**的事：
//
//   1) disposeObject()   —— 换态时旧模型只 remove 不 dispose，GPU 资源要等 GC 才还。
//                          换成显式释放，切换两态不再累积。
//   2) 桌面并发限流      —— 桌面端原本 28 个奖品 GLB 全并行解析，每个 parse 期间
//                          body + 全部 bufferView 副本同时在世，峰值会叠加。
//                          触屏早已限流（mobile.glbConcurrency=3），桌面补上。
//   3) 预载改 fetch      —— preloadVariantVisuals 原来用 loadAsync 预热，
//                          但 THREE.Cache 默认关闭 → 解析完即弃，既没缓存又白解析。
//                          改成只取 ArrayBuffer 丢引用：把文件塞进浏览器 HTTP 缓存
//                          （线上 GLB 是 immutable，能命中），不产生常驻解析结果。
// ============================================================

const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'specularMap', 'clearcoatMap',
  'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap',
];

/**
 * 释放一棵子树占用的 GPU 资源（geometry / material / texture）。
 *
 * ⚠️ 只在「这颗子树确实不再被引用」时调用。
 * `Object3D.clone(true)` 是**共享** geometry/material 的（不复制数据），
 * 所以被 clone 出来的那份还在用时，dispose 原件会把它一起打坏。
 * 调用前请确认 next 不是当前 mesh 的 clone —— prizePool 的 swapItemAppearance
 * 正是用 `url` 是否为真来区分的（有 url = 新加载独享，无 url = clone 共享）。
 */
export function disposeObject(root) {
  if (!root) return 0;
  const geos = new Set();
  const mats = new Set();
  const texs = new Set();
  root.traverse((o) => {
    if (!o?.isMesh) return;
    if (o.geometry) geos.add(o.geometry);
    const m = o.material;
    for (const mm of (Array.isArray(m) ? m : [m])) {
      if (!mm) continue;
      mats.add(mm);
      for (const slot of TEXTURE_SLOTS) {
        const t = mm[slot];
        if (t && t.isTexture) texs.add(t);
      }
    }
  });
  // 顺序：贴图 → 材质 → 几何。材质 dispose 不会自动释放贴图的 GPU 纹理。
  for (const t of texs) t.dispose();
  for (const m of mats) m.dispose();
  for (const g of geos) g.dispose();
  return texs.size + mats.size + geos.size;
}

/**
 * 把一批 URL 预热进浏览器 HTTP 缓存，不解析、不常驻。
 *
 * 线上 GLB 的响应头是 `public, max-age=31536000, immutable`（devServer 的 LONG_CACHE），
 * 所以这里取过一次之后，终幕全黑换货时再 loadAsync(url) 就能命中浏览器缓存，
 * 只剩解析时间 —— 黑屏不会被网络拖长。本地 dev 下 GLB 是 no-store，预热无效（也不会更慢）。
 *
 * 失败静默：预热本来只是优化，不该把游戏挡下。
 */
export async function preloadIntoHttpCache(urls, { timeoutMs = 15000 } = {}) {
  const list = [...new Set((urls ?? []).filter(Boolean))];
  if (!list.length) return 0;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let ok = 0;
  await Promise.all(list.map(async (u) => {
    try {
      const res = await fetch(u, { signal: ctl.signal, cache: 'reload' });
      if (!res.ok) return;
      // 必须把 body 读完才会真正进 HTTP 缓存；读完立刻丢引用，不常驻
      await res.arrayBuffer();
      ok += 1;
    } catch { /* 预热失败无所谓 */ }
  }));
  clearTimeout(timer);
  return ok;
}

// 奖品 GLB 路径：?models=legacy | good | good-p2（默认 good-p2 → good → legacy）
//
// 【两态外观】奖池每件物资有 manifest（显形/好）与 rot（败露/坏）两态。
//   显形态 = 本文件原来的那套模型；
//   败露态 = prizePool 表里 variants.rot.to 指的另一个 GLB（任务三件套：
//            bread→moldy、can→rustcan、veg→rot），
//            没写 to 的物品落回原模型 + 材质覆盖（见 prizePool 的 applyMaterialPreset）。
import { CONFIG } from './config.js';
import { GLB_MANIFEST } from './assets.manifest.js';
import { GLB_MANIFEST_GOOD } from './assets.manifest-good.js';
import { GLB_MANIFEST_GOOD_P2 } from './assets.manifest-good-p2.js';

const SETS = {
  legacy: GLB_MANIFEST,
  good: GLB_MANIFEST_GOOD,
  'good-p2': GLB_MANIFEST_GOOD_P2,
};

export function resolvePrizeGlbSet() {
  try {
    const q = new URLSearchParams(location.search).get('models');
    if (q && SETS[q] !== undefined) return q === 'default' ? 'legacy' : q;
  } catch { /* SSR / 测试 */ }
  const cfg = CONFIG.pool?.glbSet;
  if (cfg && SETS[cfg] !== undefined) return cfg;
  return 'good-p2';
}

export function getGlbManifest() {
  const want = resolvePrizeGlbSet();
  const order = want === 'good-p2'
    ? ['good-p2', 'good', 'legacy']
    : want === 'good'
      ? ['good', 'good-p2', 'legacy']
      : ['legacy', 'good-p2', 'good'];
  for (const key of order) {
    const m = SETS[key];
    if (m && Object.keys(m).length > 0) return m;
  }
  return GLB_MANIFEST;
}

export function prizeGlbUrl(id) {
  return getGlbManifest()[id] ?? null;
}

/**
 * 该物品应显示的模型路径。
 *
 * 两种调用口径，别混：
 *   prizeGlbUrlFor(item)               → "此刻它装着哪个模型"（item.visualUrl，含两态）
 *   prizeGlbUrlFor(item, 'manifest')   → "他以为它是什么样子"（副屏/显示页永远用这个）
 */
export function prizeGlbUrlFor(item, appearance = null) {
  if (!item) return null;
  if (appearance) {
    const v = appearance === 'rot' ? item.variants?.rot : item.variants?.manifest;
    const glbKey = v?.glb ?? item.id;
    return getGlbManifest()[v?.to ?? glbKey] ?? getGlbManifest()[glbKey] ?? null;
  }
  if (item.visualUrl) return item.visualUrl;
  const key = item.variants?.manifest?.glb ?? item.id;
  return getGlbManifest()[key] ?? prizeGlbUrl(item.id);
}

// 奖品 GLB 路径：?models=legacy | good | good-p2（默认 good-p2 → good → legacy）
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

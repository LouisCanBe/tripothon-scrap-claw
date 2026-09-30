// 奖品 GLB 路径：默认套 / 好版套（?models=legacy | ?models=good）
import { CONFIG } from './config.js';
import { GLB_MANIFEST } from './assets.manifest.js';
import { GLB_MANIFEST_GOOD } from './assets.manifest-good.js';

export function resolvePrizeGlbSet() {
  try {
    const q = new URLSearchParams(location.search).get('models');
    if (q === 'good' || q === 'legacy' || q === 'default') return q === 'default' ? 'legacy' : q;
  } catch { /* SSR / 测试 */ }
  const cfg = CONFIG.pool?.glbSet;
  if (cfg === 'good' || cfg === 'legacy') return cfg;
  return 'good';
}

export function getGlbManifest() {
  if (resolvePrizeGlbSet() === 'good' && Object.keys(GLB_MANIFEST_GOOD).length > 0) {
    return GLB_MANIFEST_GOOD;
  }
  return GLB_MANIFEST;
}

export function prizeGlbUrl(id) {
  return getGlbManifest()[id] ?? null;
}

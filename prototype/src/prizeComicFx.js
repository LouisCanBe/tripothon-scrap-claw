// 奖池漫画渲染：复用 Hub Tripo 预览的 tools/comic-render.mjs
import { CONFIG } from './config.js';
import { applyComicStyle } from '/comic-render.mjs'; // decor 组同样走 toon+描边

export function applyPrizeComicFx(items, enabled) {
  const cfg = CONFIG.pool.comicFx;
  const opts = {
    outline: cfg.outline ?? 0.028,
    outlineColor: cfg.outlineColor ?? 0x141210,
  };
  for (const it of items) {
    if (it.mesh) applyComicStyle(it.mesh, enabled, opts);
  }
}

export function syncComicLighting({ renderer, key, scene }, enabled) {
  const cfg = CONFIG.pool.comicFx;
  if (enabled) {
    renderer.toneMappingExposure = cfg.exposure ?? 1.15;
    key.intensity = cfg.keyIntensity ?? 1.35;
    if ('environmentIntensity' in scene) scene.environmentIntensity = cfg.envIntensity ?? 0.12;
  } else if (!CONFIG.claw.comicFx?.enabled) {
    renderer.toneMappingExposure = CONFIG.render.exposure;
    key.intensity = CONFIG.lights?.key?.intensity ?? 1.1;
    if ('environmentIntensity' in scene) scene.environmentIntensity = CONFIG.render.envIntensity;
  }
}

/** @param {THREE.Object3D | null} decorRoot poolDecor 组 */
export function refreshPrizeComicFx(items, ctx, decorRoot = null) {
  const on = !!CONFIG.pool.comicFx.enabled;
  applyPrizeComicFx(items, on);
  if (decorRoot) applyComicStyle(decorRoot, on, {
    outline: CONFIG.pool.comicFx.outline ?? 0.028,
    outlineColor: CONFIG.pool.comicFx.outlineColor ?? 0x141210,
  });
  syncComicLighting(ctx, on);
}

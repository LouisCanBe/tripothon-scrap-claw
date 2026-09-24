// H 面板奖池调试项：写入 localStorage，刷新后仍生效（不写回 config.js）
import { CONFIG } from './config.js';
import { clampItemToPoolBounds } from './prizePool.js';

const KEY = 'tripo.poolDev';

export function loadPoolDevOverrides() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (typeof o.visualScale === 'number') CONFIG.pool.visualScale = o.visualScale;
    if (typeof o.glbExtraRotX === 'number') CONFIG.pool.glbExtraRotX = o.glbExtraRotX;
    if (o.comicFx && typeof o.comicFx === 'object') Object.assign(CONFIG.pool.comicFx, o.comicFx);
    if (o.clawComicFx && typeof o.clawComicFx === 'object') Object.assign(CONFIG.claw.comicFx, o.clawComicFx);
  } catch { /* ignore */ }
}

export function savePoolDevOverrides() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      visualScale: CONFIG.pool.visualScale,
      glbExtraRotX: CONFIG.pool.glbExtraRotX,
      comicFx: { ...CONFIG.pool.comicFx },
      clawComicFx: { ...CONFIG.claw.comicFx },
    }));
  } catch { /* ignore */ }
}

/** 调 visualScale 时当场缩放奖池（不必 F5） */
export function retunePoolVisualScale(items, newScale) {
  for (const it of items) {
    if (!it.mesh || it.state === 'collected') continue;
    const prev = it._appliedVisualScale ?? newScale;
    if (Math.abs(prev - newScale) < 1e-6) continue;
    const r = newScale / prev;
    it.mesh.scale.multiplyScalar(r);
    it.restY *= r;
    if (it.state === 'idle') it.mesh.position.y = it.restY;
    it._appliedVisualScale = newScale;
    clampItemToPoolBounds(it);
  }
}

export function markItemVisualScale(item) {
  item._appliedVisualScale = CONFIG.pool.visualScale ?? 1;
}

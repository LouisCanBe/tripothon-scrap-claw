// 爪子漫画：与奖池同一套 applyComicStyle，只限定在悬挂爪体（非横梁/吊缆）
import { CONFIG } from './config.js';
import { applyComicStyle } from '/comic-render.mjs';

/** @param {import('./clawMachine.js').ClawMachine} claw */
export function applyClawComicFx(claw, enabled) {
  const cfg = CONFIG.claw.comicFx;
  const root = claw?.comicVisualRoot;
  if (!root) return;
  // 清掉曾涂在整副 rig 上的残留
  if (claw.rig && claw.rig !== root) applyComicStyle(claw.rig, false);

  const opts = {
    outline: cfg.useOutline === false ? 0 : (cfg.outline ?? 0.022),
    outlineColor: cfg.outlineColor ?? 0x141210,
    skipOutline: cfg.useOutline === false,
  };
  applyComicStyle(root, enabled, opts);
}

export function refreshClawComicFx(claw) {
  applyClawComicFx(claw, !!CONFIG.claw.comicFx.enabled);
}

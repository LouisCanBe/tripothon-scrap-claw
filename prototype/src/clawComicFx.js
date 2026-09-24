import { CONFIG } from './config.js';
import { applyComicStyle } from '/comic-render.mjs';

/** @param {import('./clawMachine.js').ClawMachine} claw */
export function applyClawComicFx(claw, enabled) {
  const cfg = CONFIG.claw.comicFx;
  const root = claw?.rigRoot;
  if (!root) return;
  applyComicStyle(root, enabled, {
    outline: cfg.outline ?? 0.028,
    outlineColor: cfg.outlineColor ?? 0x141210,
  });
}

export function refreshClawComicFx(claw) {
  applyClawComicFx(claw, !!CONFIG.claw.comicFx.enabled);
}

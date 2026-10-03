// 概念图 → 游戏路径（与 review-order.json / review-order-cursor.json 对齐）
import { CONFIG } from './config.js';

const C = 'design/concepts/';

const SETS = {
  seedream: {
    ambient: `${C}scrapyard-thickpaint-seedream50pro-16x9.png`,
    act1: `${C}cabinet-clean-memory-fisheye-seedream50pro-16x9.png`,
    act2: `${C}cabinet-rust-teaching-fisheye-seedream50pro-16x9.png`,
    act3: `${C}cabinet-scrap-quota-fisheye-seedream50pro-16x9.png`,
    flashback: `${C}cabinet-warm-flashback-polaroid-seedream50pro-16x9.png`,
    rationWall: 'design/ui-ration-wall-scrap.png',
    synthesis: `${C}last-meal-memory-table-seedream50pro-16x9.png`,
    glitch: `${C}glitch-frame-tear-seedream50pro-16x9.png`,
    revealBeat: `${C}reveal-truth-hand-can-seedream50pro-16x9.png`,
    revealPano: `${C}reveal-ruins-wide-scrapyard-seedream50pro-16x9.png`,
    truthTable: `${C}last-meal-truth-table-seedream50pro-16x9.png`,
  },
  cursor: {
    ambient: `${C}scrapyard-env-cursor-photo-16x9.png`,
    act1: `${C}cabinet-clean-memory-fisheye-cursor-photo-16x9.png`,
    act2: `${C}cabinet-rust-teaching-fisheye-cursor-photo-16x9.png`,
    act3: `${C}cabinet-scrap-quota-fisheye-cursor-photo-16x9.png`,
    flashback: `${C}cabinet-warm-flashback-polaroid-cursor-photo-16x9.png`,
    rationWall: 'design/ui-ration-wall-scrap-cursor-photo.png',
    synthesis: `${C}last-meal-memory-table-cursor-photo-16x9.png`,
    glitch: `${C}glitch-frame-tear-cursor-photo-16x9.png`,
    revealBeat: 'assets/images/reveal-truth-hand-can.png',
    revealPano: 'assets/worlds/reveal-draft-pano.png',
    truthTable: `${C}last-meal-truth-table-cursor-photo-16x9.png`,
  },
};

/** @returns {'seedream'|'cursor'} */
export function resolveNarrativeSet() {
  const q = new URLSearchParams(location.search).get('art');
  if (q === 'cursor' || q === 'seedream') return q;
  const cfg = CONFIG.narrativeSet;
  return cfg === 'cursor' ? 'cursor' : 'seedream';
}

export function getNarrative() {
  return SETS[resolveNarrativeSet()];
}

/** @deprecated 用 getNarrative()；保留给调试台 */
export const NARRATIVE = SETS.seedream;

/** @param {string} key @returns {string|undefined} */
export function narrativeSrc(key) {
  if (!key) return undefined;
  const map = getNarrative();
  return map[key] ?? (key.includes('/') ? key : undefined);
}

export function applyNarrativeToConfig() {
  const n = getNarrative();
  if (n.revealPano) CONFIG.reveal.pano = n.revealPano;
}

export function preloadNarrativeImages() {
  const seen = new Set();
  for (const src of Object.values(getNarrative())) {
    if (seen.has(src)) continue;
    seen.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
}

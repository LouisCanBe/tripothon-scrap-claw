// Seedream 概念图 → 游戏运行时路径（审阅同源，仍放在 design/ 下便于迭代）
const C = 'design/concepts/';

export const NARRATIVE = {
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
};

/** @param {string} key @returns {string|undefined} */
export function narrativeSrc(key) {
  if (!key) return undefined;
  return NARRATIVE[key] ?? (key.includes('/') ? key : undefined);
}

export function preloadNarrativeImages() {
  const seen = new Set();
  for (const src of Object.values(NARRATIVE)) {
    if (seen.has(src)) continue;
    seen.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  }
}

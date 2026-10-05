// 概念图 → 游戏路径（与 review-order.json / review-order-cursor.json 对齐）
//
// 【过场图接入点】清单与 prompt 见 过场图规划.md。
// 键名 → 文件一一对应，图还没出的时候**先挂在下面带 TODO 的临时图上**，
// 出图后只改这一处路径，剧本（acts.js）不用动。
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
    truthTable: `${C}last-meal-truth-table-seedream50pro-16x9.png`,

    // —— 过场图（12 张）——
    titleCard:      `${C}scrapyard-thickpaint-seedream50pro-16x9.png`,               // TODO 待出：黑底 + 只亮一块玻璃
    act1Open:       `${C}cabinet-clean-memory-fisheye-seedream50pro-16x9.png`,       // TODO 待出：玻璃反光里的人影
    act1Close:      `${C}cabinet-rust-teaching-fisheye-seedream50pro-16x9.png`,      // TODO 待出：同机位，灰从顶盖漫下
    flashbackSister:`${C}cabinet-warm-flashback-polaroid-seedream50pro-16x9.png`,    // 已有：拍立得（第二幕闪回）
    act2Close:      `${C}reveal-truth-hand-can-seedream50pro-16x9.png`,              // TODO 待出：脏手摊开，掌心面包
    rationNotice:   'design/ui-ration-wall-scrap.png',                               // 已有：配给单
    act3Dark:       `${C}cabinet-scrap-quota-fisheye-seedream50pro-16x9.png`,        // TODO 待出：同机位，柜内腐败
    act3LightLie:   `${C}silhouette-pairs-bread-can-veg-seedream50pro-16x9.png`,     // TODO 待出：过曝里三件"新鲜"的
    menuCard:       'design/ui-ration-wall-scrap.png',                               // TODO 待出：配给单背面手写菜单
    act4Meal:       `${C}last-meal-memory-table-seedream50pro-16x9.png`,             // 已有：记忆餐桌
    truthSweep:     `${C}props-reality-junk-lineup-seedream50pro-16x9.png`,          // TODO 待出：俯拍扫过腐败模型
    truthMachineLit:`${C}reveal-ruins-wide-scrapyard-seedream50pro-16x9.png`,        // TODO 待出：废墟深处还亮的机器
  },
  cursor: {
    ambient: 'design/backdrops/backdrop-act5-ruins.jpg',
    act1: 'design/backdrops/backdrop-act1-anchor.jpg',
    act2: 'design/backdrops/backdrop-act2-aged.jpg',
    act3: 'design/backdrops/backdrop-act3-quota.jpg',
    flashback: `${C}cabinet-warm-flashback-polaroid-cursor-photo-16x9.png`,
    rationWall: 'design/ui-ration-wall-scrap-cursor-photo.png',
    synthesis: 'design/backdrops/backdrop-act4-memory.jpg',
    glitch: `${C}glitch-frame-tear-cursor-photo-16x9.png`,
    revealBeat: 'assets/images/reveal-truth-hand-can.png',
    truthTable: `${C}last-meal-truth-table-cursor-photo-16x9.png`,

    titleCard:      `${C}scrapyard-env-cursor-photo-16x9.png`,
    act1Open:       `${C}cabinet-clean-memory-fisheye-cursor-photo-16x9.png`,
    act1Close:      `${C}cabinet-rust-teaching-fisheye-cursor-photo-16x9.png`,
    flashbackSister:`${C}cabinet-warm-flashback-polaroid-cursor-photo-16x9.png`,
    act2Close:      'assets/images/reveal-truth-hand-can.png',
    rationNotice:   'design/ui-ration-wall-scrap-cursor-photo.png',
    act3Dark:       `${C}cabinet-scrap-quota-fisheye-cursor-photo-16x9.png`,
    act3LightLie:   `${C}silhouette-pairs-bread-can-veg-cursor-photo-16x9.png`,
    menuCard:       'design/ui-ration-wall-scrap-cursor-photo.png',
    act4Meal:       `${C}last-meal-memory-table-cursor-photo-16x9.png`,
    truthSweep:     `${C}props-reality-junk-lineup-cursor-photo-16x9.png`,
    truthMachineLit:`${C}reveal-ruins-wide-scrapyard-cursor-photo-16x9.png`,
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

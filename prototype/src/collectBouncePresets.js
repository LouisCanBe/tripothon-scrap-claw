// 副屏出货：按「材质/弹力」预设覆盖 entrance 物理参数（回弹力度、下落重量感等）
import { CONFIG } from './config.js';

/** 可在 PRIZE_TABLE.bounceMaterial 或 config 映射里使用的预设 id */
export const BOUNCE_MATERIALS = [
  'soft',     // 面包、蔬果
  'rubber',   // 弹性包装
  'plastic',  // 默认中性
  'metal',    // 罐头、锡箔
  'glass',    // 瓶罐玻璃
  'ceramic',  // 粗陶、砖
  'cloth',    // 布团
  'stone',    // 石块、骨（偏沉、少弹）
];

/**
 * 解析材质 id（优先级：条目字段 > config 按 id > 按 category > 默认）
 * @param {{ id?: string, category?: string, bounceMaterial?: string } | null} prize
 */
export function resolveBounceMaterial(prize) {
  const cd = CONFIG.collectDisplay ?? {};
  if (!prize) return cd.defaultBounceMaterial ?? 'plastic';
  if (prize.bounceMaterial) return prize.bounceMaterial;
  const byId = cd.itemBounceMaterial?.[prize.id];
  if (byId) return byId;
  const byCat = cd.categoryBounceMaterial?.[prize.category];
  if (byCat) return byCat;
  return cd.defaultBounceMaterial ?? 'plastic';
}

/** 合并全局 entrance 与材质预设 → 供 collectDisplayEntrance 使用 */
export function resolveEntranceConfigForPrize(prize) {
  const base = { ...(CONFIG.collectDisplay?.entrance ?? {}) };
  const material = resolveBounceMaterial(prize);
  const presets = CONFIG.collectDisplay?.bouncePresets ?? {};
  const patch = presets[material] ?? presets.plastic ?? {};
  return { ...base, ...patch, bounceMaterial: material };
}

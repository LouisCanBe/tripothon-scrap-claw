// ============================================================
// 呈现 / TA：概念底图与 3D 视口的统一镜头语言（非玩法逻辑）
// —— 幕情绪、margin 暗角、颗粒、底图 Ken Burns、视口内渐变遮罩
// ============================================================
import { CONFIG } from './config.js';
import { getViewportEdge, syncViewportEdgeToDom } from './frameEdge.js';

let _actId = 1;

export function getPresentActId() {
  return _actId;
}

export function initPresent() {
  const g = document.getElementById('presentGrain');
  const p = CONFIG.present ?? {};
  if (g) g.style.opacity = String(p.grainOpacity ?? 0.05);
  syncViewportEdgeToDom();
  applyActPostLens(1);
}

/**
 * @param {import('./acts.js').ACTS[number]} act
 * @param {HTMLImageElement | null} [layer] 当前叙事底图层（双层交叉淡入时用）
 */
export function applyPresentAct(act, layer = null) {
  const id = act?.id ?? 1;
  _actId = id;
  const p = CONFIG.present ?? {};
  const mood = p.acts?.[id] ?? p.acts?.default ?? {};
  const targets = layer
    ? [layer]
    : [...document.querySelectorAll('#narrativeBg .narrative-layer.is-active')];
  for (const img of targets) {
    if (!img) continue;
    img.style.filter = mood.imgFilter ?? '';
    img.classList.toggle('ken-burns', !!p.narrativeKenBurns && mood.kenBurns !== false);
  }
  const shade = document.getElementById('narrativeViewportShade');
  if (shade) {
    const key = mood.shade ?? 'default';
    const square = getViewportEdge() === 'square';
    const grad = square
      ? (p.shadeGradientsSquare?.[key] ?? p.shadeGradientsSquare?.default ?? 'transparent')
      : (p.shadeGradients?.[key] ?? p.shadeGradients?.default);
    if (grad) shade.style.background = grad;
  }
  const root = document.getElementById('narrativeBg');
  if (root) {
    root.dataset.mood = mood.moodClass ?? `act-${id}`;
  }
  applyActPostLens(id);
}

/** 按幕写入 CONFIG.post.k1/k2（三幕起用 postLensGameplay 0.65/0.45） */
export function applyActPostLens(actId) {
  const p = CONFIG.present ?? {};
  const extra = p.actPost?.[actId] ?? {};
  const post = CONFIG.post;
  const g = CONFIG.postLensGameplay ?? { k1: 0.65, k2: 0.45 };
  if (!post) return;
  post.k1 = extra.k1 ?? g.k1;
  post.k2 = extra.k2 ?? g.k2;
}

export function presentPostCoeffs() {
  const p = CONFIG.present ?? {};
  const base = p.post ?? {};
  const extra = p.actPost?.[_actId] ?? {};
  return {
    warmth: (base.warmth ?? 0) + (extra.warmth ?? 0),
    chroma: (base.chroma ?? 0.3) + (extra.chroma ?? 0),
    sat: (base.saturation ?? 1) * (extra.satMul ?? 1),
  };
}

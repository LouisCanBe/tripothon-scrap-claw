// 视口内缘两档：fisheye（椭圆暗角 + 外扩羽化压锯齿）/ square（纯直角裁切）
import { CONFIG } from './config.js';

/** @returns {'fisheye' | 'square'} */
export function getViewportEdge() {
  const f = CONFIG.frame ?? {};
  const v = f.viewportEdge;
  if (v === 'square' || v === 'fisheye') return v;
  if (f.edgeVignette === false) return 'square';
  return 'fisheye';
}

export function resolveViewportEdgeFromQuery() {
  try {
    const q = new URLSearchParams(location.search).get('frameEdge');
    if (q === 'fisheye' || q === 'square') CONFIG.frame.viewportEdge = q;
  } catch { /* noop */ }
}

export function viewportFeatherPx() {
  if (getViewportEdge() === 'square') return 0;
  return CONFIG.frame.viewportFeatherPx ?? 14;
}

/** 后处理径向暗角：方框模式弱化，避免叠双层弧感 */
export function postVignetteForViewportEdge() {
  const p = CONFIG.post ?? {};
  if (getViewportEdge() === 'square') return p.vignetteSquare ?? 0;
  return p.vignette ?? 0.55;
}

/** 桶形畸变 + 边缘色散：square 时关（否则画面边缘仍是弧的） */
export function viewportEdgeLensScale() {
  return getViewportEdge() === 'square' ? 0 : 1;
}

function fisheyeVigStops(inner01, strength) {
  const i = Math.max(0, Math.min(0.5, inner01)) * 100;
  const s = Math.max(0, strength);
  const a = (v) => Math.min(1, v * s);
  return [
    `transparent 0%`,
    `transparent ${i}%`,
    `rgba(0,0,0,${a(0.1).toFixed(3)}) ${i + 14}%`,
    `rgba(0,0,0,${a(0.28).toFixed(3)}) ${i + 28}%`,
    `rgba(0,0,0,${a(0.48).toFixed(3)}) ${i + 42}%`,
    `rgba(0,0,0,${a(0.68).toFixed(3)}) ${i + 54}%`,
    `rgba(0,0,0,${a(0.86).toFixed(3)}) ${i + 64}%`,
    `rgba(0,0,0,${a(0.94).toFixed(3)}) 100%`,
  ].join(', ');
}

/** 写入 #frameBorder（须在 edge-fisheye 类挂上之后调用） */
export function applyFisheyeEdgeToBorder() {
  const border = document.getElementById('frameBorder');
  if (!border) return;
  if (!border.classList.contains('edge-fisheye') || border.style.display === 'none') {
    border.style.removeProperty('background');
    return;
  }
  const f = CONFIG.frame ?? {};
  const x = ((f.fisheyeVigEllipseX ?? 1.58) * 100).toFixed(1);
  const y = ((f.fisheyeVigEllipseY ?? 1.42) * 100).toFixed(1);
  const inner = f.fisheyeVigInner ?? 0.2;
  const strength = f.fisheyeVigOpacity ?? 1;
  const stops = fisheyeVigStops(inner, strength);
  border.style.opacity = '1';
  border.style.background =
    `radial-gradient(ellipse ${x}% ${y}% at 50% 50%, ${stops})`;
}

/** @deprecated 用 applyFisheyeEdgeToBorder；保留给 GUI / 启动 */
export function applyFisheyeEdgeCssVars() {
  applyFisheyeEdgeToBorder();
}

/** DOM / 全屏椭圆暗角与 html 标记（切换后处理与 CSS 用） */
export function syncViewportEdgeToDom() {
  const edge = getViewportEdge();
  const root = document.documentElement;
  root.dataset.viewportEdge = edge;
  root.classList.toggle('viewport-edge-square', edge === 'square');
  root.classList.toggle('viewport-edge-fisheye', edge === 'fisheye');

  const marginVig = document.getElementById('presentMarginVig');
  if (marginVig) {
    if (edge === 'square') {
      marginVig.style.opacity = '0';
    } else {
      const p = CONFIG.present ?? {};
      const o = (p.backdropInViewport && p.backdropAsSceneBackground)
        ? 0
        : (p.marginVignette ?? 0.5);
      marginVig.style.opacity = String(o);
    }
  }
}

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

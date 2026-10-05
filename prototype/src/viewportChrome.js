// 视口内叠层：底部操作提示 + 视角点；闲置变淡，鼠标在视口内恢复
import { CONFIG } from './config.js';
import { getViewportEdge } from './frameEdge.js';

function inViewport(x, y, r) {
  if (!r) return false;
  if (r.shape === 'circle' && r.radius > 0) {
    const dx = x - r.cx;
    const dy = y - r.cy;
    return dx * dx + dy * dy <= r.radius * r.radius;
  }
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 与 post.js 同一套桶形：屏幕像素在鱼眼里是否还取样得到画面 */
function lensInside(cssX, cssY, frame) {
  const W = innerWidth;
  const H = innerHeight;
  const lens = getViewportEdge() === 'square' ? 0 : 1;
  const k1 = (CONFIG.post?.k1 ?? 0) * lens;
  const k2 = (CONFIG.post?.k2 ?? 0) * lens;
  const aspect = W / Math.max(1, H);
  const cx = (frame.x + frame.w / 2) / W;
  const cy = 1 - (frame.y + frame.h / 2) / H;
  const vx = cssX / W;
  const vy = 1 - cssY / H;
  let ux = (vx - cx) * aspect;
  let uy = vy - cy;
  const r2 = ux * ux + uy * uy;
  const s = 1 + k1 * r2 + k2 * r2 * r2;
  ux *= s;
  uy *= s;
  const sux = ux / aspect + cx;
  const suy = uy + cy;
  const eps = 0.012;
  return sux >= eps && sux <= 1 - eps && suy >= eps && suy <= 1 - eps;
}

/** 某一竖线上，鱼眼还看得见的最上 / 最下（CSS y，上小下大） */
function lensVerticalSpan(cssX, frame) {
  const topEdge = frame.y;
  const botEdge = frame.y + frame.h;
  const mid = (topEdge + botEdge) / 2;
  if (!lensInside(cssX, mid, frame)) return null;
  let a = topEdge;
  let b = mid;
  if (!lensInside(cssX, a, frame)) {
    for (let i = 0; i < 18; i++) {
      const m = (a + b) / 2;
      if (lensInside(cssX, m, frame)) b = m;
      else a = m;
    }
  } else b = a;
  const top = b;
  a = mid;
  b = botEdge;
  if (!lensInside(cssX, b, frame)) {
    for (let i = 0; i < 18; i++) {
      const m = (a + b) / 2;
      if (lensInside(cssX, m, frame)) a = m;
      else b = m;
    }
  } else a = b;
  return { top, bottom: a };
}

function placeInFrame(detail) {
  const hud = document.getElementById('hud');
  const pair = document.getElementById('collectPairPanel');
  if (!detail) return;
  const gap = 12;
  if (detail.shape === 'circle' && detail.radius > 0) {
    const insetX = detail.radius * 0.24;
    const insetY = detail.radius * 0.30;
    const left = detail.cx - detail.radius + insetX;
    const top = detail.cy - detail.radius + insetY;
    const right = window.innerWidth - (detail.cx + detail.radius - insetX);
    const bottom = window.innerHeight - (detail.cy + detail.radius - insetY);
    if (hud) Object.assign(hud.style, { left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    if (pair) Object.assign(pair.style, { top: 'auto', bottom: `${bottom}px`, right: `${right}px`, left: 'auto' });
    return;
  }
  const hudW = hud?.offsetWidth || 190;
  const pairW = pair?.offsetWidth || 210;
  const leftX = detail.x + 16;
  const rightX = detail.x + detail.w - 16;
  const spanL = lensVerticalSpan(leftX, detail);
  const spanHudR = lensVerticalSpan(leftX + hudW, detail);
  const spanR = lensVerticalSpan(rightX, detail);
  const spanPairL = lensVerticalSpan(rightX - pairW, detail);
  const top = Math.max(spanL?.top ?? detail.y, spanHudR?.top ?? detail.y) + gap;
  const lensBot = Math.min(spanR?.bottom ?? (detail.y + detail.h), spanPairL?.bottom ?? (detail.y + detail.h));
  const bottom = window.innerHeight - (lensBot - gap);
  if (hud) Object.assign(hud.style, { left: `${leftX}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
  if (pair) Object.assign(pair.style, { top: 'auto', bottom: `${bottom}px`, right: `${window.innerWidth - rightX}px`, left: 'auto' });
}

export function initViewportChrome() {
  const root = document.getElementById('viewportChrome');
  if (!root) return;
  const hud = document.getElementById('hud');
  const pair = document.getElementById('collectPairPanel');

  const f = CONFIG.frame ?? {};
  const delay = f.chromeIdleMs ?? 5200;
  const dim = f.chromeDimOpacity ?? 0.22;
  root.style.setProperty('--chrome-dim', String(dim));
  document.documentElement.style.setProperty('--chrome-dim', String(dim));

  let rect = null;
  let idleTimer = 0;

  const sync = (detail) => {
    if (!detail || detail.mode === 'wide') {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    rect = detail;
    placeInFrame(detail);
    if (detail.shape === 'circle' && detail.radius > 0) {
      const d = detail.radius * 2;
      Object.assign(root.style, {
        left: `${detail.cx - detail.radius}px`,
        top: `${detail.cy - detail.radius}px`,
        width: `${d}px`,
        height: `${d}px`,
        borderRadius: '50%',
      });
    } else {
      Object.assign(root.style, {
        left: `${detail.x}px`,
        top: `${detail.y}px`,
        width: `${detail.w}px`,
        height: `${detail.h}px`,
        borderRadius: '',
      });
    }
  };

  const wake = () => {
    root.classList.remove('dimmed');
    hud?.classList.remove('dimmed');
    pair?.classList.remove('dimmed');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!rect) return;
      if (pair?.classList.contains('open')) { wake(); return; }
      root.classList.add('dimmed');
      hud?.classList.add('dimmed');
      pair?.classList.add('dimmed');
    }, delay);
  };

  pair?.addEventListener('pointerdown', wake);
  window.addEventListener('framemask:apply', (e) => sync(e.detail));
  window.addEventListener('present:lens', () => { if (rect) placeInFrame(rect); });
  window.addEventListener('mousemove', (e) => {
    if (rect && inViewport(e.clientX, e.clientY, rect)) wake();
  });
  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t && rect && inViewport(t.clientX, t.clientY, rect)) wake();
  }, { passive: true });

  wake();
}

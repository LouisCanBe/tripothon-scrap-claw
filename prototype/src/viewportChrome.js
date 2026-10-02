// 视口内叠层：底部操作提示 + 视角点；闲置变淡，鼠标在视口内恢复
import { CONFIG } from './config.js';

function inViewport(x, y, r) {
  if (!r) return false;
  if (r.shape === 'circle' && r.radius > 0) {
    const dx = x - r.cx;
    const dy = y - r.cy;
    return dx * dx + dy * dy <= r.radius * r.radius;
  }
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function initViewportChrome() {
  const root = document.getElementById('viewportChrome');
  if (!root) return;

  const f = CONFIG.frame ?? {};
  const delay = f.chromeIdleMs ?? 5200;
  const dim = f.chromeDimOpacity ?? 0.22;
  root.style.setProperty('--chrome-dim', String(dim));

  let rect = null;
  let idleTimer = 0;

  const sync = (detail) => {
    if (!detail || detail.mode === 'wide') {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    rect = detail;
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
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (rect) root.classList.add('dimmed');
    }, delay);
  };

  window.addEventListener('framemask:apply', (e) => sync(e.detail));
  window.addEventListener('mousemove', (e) => {
    if (rect && inViewport(e.clientX, e.clientY, rect)) wake();
  });
  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (t && rect && inViewport(t.clientX, t.clientY, rect)) wake();
  }, { passive: true });

  wake();
}

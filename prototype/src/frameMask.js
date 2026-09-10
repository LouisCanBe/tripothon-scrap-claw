// ============================================================
// 画幅遮罩：CSS clip-path 方案（outline 定的技术路线）
// 渲染器始终全窗口，遮罩控制可见区域 —— 1:1 → 16:9 展开零渲染成本。
//
// 提供两种终幕转场：
//   toggle(true)  —— 完整版：clip-path 平滑过渡（后续叠加 glitch shader）
//   hardCut()     —— 降级版：黑屏闪 + 无动画切换（终幕做不完时保底）
// 切换时派发 'framechange' 事件，main.js 里同步做鱼眼消退。
// ============================================================
import { CONFIG } from './config.js';

export class FrameMask {
  constructor() {
    this.stage = document.getElementById('stage');
    this.border = document.getElementById('frameBorder');
    this.flash = document.getElementById('flash');
    this.mode = 'square';
    window.addEventListener('resize', () => this.apply(false));
    this.apply(false);
  }

  #rect() {
    const w = innerWidth, h = innerHeight, f = CONFIG.frame;
    if (this.mode === 'square') {
      const s = Math.min(w, h) * f.squareFill;
      return { x: (w - s) / 2, y: (h - s) / 2, w: s, h: s };
    }
    const ww = w * f.wideFill;
    const hh = Math.min(ww * 9 / 16, h * 0.92);
    return { x: (w - ww) / 2, y: (h - hh) / 2, w: ww, h: hh };
  }

  apply(animate = true) {
    const w = innerWidth, h = innerHeight, r = this.#rect();
    for (const el of [this.stage, this.border]) el.classList.toggle('no-anim', !animate);
    this.stage.style.clipPath = `inset(${r.y}px ${w - r.x - r.w}px ${h - r.y - r.h}px ${r.x}px)`;
    Object.assign(this.border.style, {
      left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px',
    });
    if (!animate) {
      void this.stage.offsetWidth; // 强制 reflow，让 no-anim 立即生效
      for (const el of [this.stage, this.border]) el.classList.remove('no-anim');
    }
  }

  set(mode, animate = true) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.apply(animate);
    window.dispatchEvent(new CustomEvent('framechange', { detail: mode }));
  }

  toWide(animate = true)  { this.set('wide', animate); }
  toSquare(animate = true){ this.set('square', animate); }
  toggle(animate = true)  { this.set(this.mode === 'square' ? 'wide' : 'square', animate); }

  // 降级版转场：黑闪 → 瞬间切换 → 淡出
  hardCut() {
    const f = this.flash;
    f.style.transition = 'none';
    f.style.opacity = '1';
    setTimeout(() => this.toggle(false), 90);
    setTimeout(() => {
      f.style.transition = 'opacity .3s';
      f.style.opacity = '0';
    }, 200);
  }
}

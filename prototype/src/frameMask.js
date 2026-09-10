// ============================================================
// 画幅遮罩：CSS clip-path 方案（outline 定的技术路线）
// 渲染器始终全窗口，遮罩控制可见区域 —— 画幅变化零渲染成本。
//
// 三个布局位（流程编排用）：
//   right  —— 一幕：左 40% 文案区，右 60% 视窗
//   center —— 二/三/四幕：居中，屏宽 50~60%
//   wide   —— 终幕：16:9 全屏
// pulse()  白闪/黑闪；hardCut()  终幕降级方案（黑闪 + 无动画切换）
// ============================================================
import { CONFIG } from './config.js';

export class FrameMask {
  constructor() {
    this.stage = document.getElementById('stage');
    this.border = document.getElementById('frameBorder');
    this.flash = document.getElementById('flash');
    this.mode = 'center';
    this.viewMode = 'near';   // 取景：near=只取画幅区域（凑近）/ far=全窗取景画幅裁切（站远，首版构图）
    window.addEventListener('resize', () => this.apply(false));
    this.apply(false);
  }

  setViewMode(m) { if (m === 'near' || m === 'far') this.viewMode = m; }
  toggleViewMode() { this.setViewMode(this.viewMode === 'near' ? 'far' : 'near'); }

  #rect() {
    const w = innerWidth, h = innerHeight, f = CONFIG.frame;
    if (this.mode === 'right') {
      const s = Math.min(h * 0.82, w * 0.58);
      return { x: w * 0.97 - s, y: (h - s) / 2, w: s, h: s };
    }
    if (this.mode === 'wide') {
      const ww = w * f.wideFill;
      const hh = Math.min(ww * 9 / 16, h * 0.92);
      return { x: (w - ww) / 2, y: (h - hh) / 2, w: ww, h: hh };
    }
    const s = Math.min(w * 0.56, h * 0.88);   // center：屏宽 50~60%（outline 二幕规范）
    return { x: (w - s) / 2, y: (h - s) / 2, w: s, h: s };
  }

  // 当前布局的目标矩形（px）—— 相机 setViewOffset / 鱼眼中心对齐用
  getRect() { return this.#rect(); }

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

  setLayout(mode, animate = true) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.apply(animate);
    window.dispatchEvent(new CustomEvent('framechange', { detail: mode }));
  }

  // 兼容旧调用
  toWide(animate = true)  { this.setLayout('wide', animate); }
  toSquare(animate = true){ this.setLayout('center', animate); }
  toggle(animate = true)  { this.setLayout(this.mode === 'wide' ? 'center' : 'wide', animate); }

  // 白闪/黑闪脉冲（三幕集齐、故障段用）
  pulse(color = '#fff', hold = 140) {
    const f = this.flash;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = '1';
    setTimeout(() => {
      f.style.transition = 'opacity .5s';
      f.style.opacity = '0';
    }, hold);
  }

  // 降级版终幕转场：黑闪 → 无动画切 16:9 → 淡出
  hardCut() {
    const f = this.flash;
    f.style.transition = 'none';
    f.style.background = '#000';
    f.style.opacity = '1';
    setTimeout(() => this.setLayout('wide', false), 90);
    setTimeout(() => {
      f.style.transition = 'opacity .3s';
      f.style.opacity = '0';
    }, 200);
  }
}

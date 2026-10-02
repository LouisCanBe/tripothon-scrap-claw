// ============================================================
// 画幅遮罩：CSS clip-path 方案（outline 定的技术路线）
// 渲染器始终全窗口，遮罩控制可见区域 —— 画幅变化零渲染成本。
//
// 三个布局位（流程编排用）：
//   right  —— 一幕：左 40% 文案区，右 60% 视窗
//   center —— 二/三/四幕：居中，屏宽 50~60%
//   wide   —— 终幕：16:9 全屏
//
// —— 操作视口「描边 + 内遮罩」契约（勿拆到两处算坐标）——
//   #stage clip-path     → 精确矩形 r（玩法可见区）
//   #frameBorder         → (r − pad) 外扩 pad，与 #narrativeViewportShade 同 fx,fy,fw,fh
//   #narrativeViewportShade → 仅 narrativeBg 控制 hidden；位置只在 apply() 里写
//   参数：config.frame.borderWidth / borderColor / viewportCoverPad
//   首屏：main 调 bootstrapLayout(起始幕 layout)，避免上货后 center→right 拖影
//
// pulse()  任务反馈闪（默认弱闪，见 config.frame.questPulseColor）
// hardCut()  终幕降级：黑闪 + 无动画切 16:9
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
  }

  /** 上货/首帧前按起始幕摆好视口，避免 center→right 带动画拖影 */
  bootstrapLayout(mode) {
    this.mode = mode;
    this.apply(false);
  }

  setViewMode(m) { if (m === 'near' || m === 'far') this.viewMode = m; }
  toggleViewMode() { this.setViewMode(this.viewMode === 'near' ? 'far' : 'near'); }

  #rect() {
    const w = innerWidth, h = innerHeight, f = CONFIG.frame;
    const vh = h;
    if (this.mode === 'right') {
      const margin = w * (f.rightMargin ?? 0.03);
      const vw = Math.min(vh, w * (f.rightWidthFrac ?? 0.58));
      return { x: w - margin - vw, y: 0, w: vw, h: vh };
    }
    if (this.mode === 'wide') {
      const ww = w * f.wideFill;
      const hh = Math.min(ww * 9 / 16, h * 0.98);
      return { x: (w - ww) / 2, y: (h - hh) / 2, w: ww, h: hh };
    }
    const vw = Math.min(vh, w * (f.centerWidthFrac ?? 0.56));
    return { x: (w - vw) / 2, y: 0, w: vw, h: vh };
  }

  // 当前布局的目标矩形（px）—— 相机 setViewOffset / 鱼眼中心对齐用
  getRect() { return this.#rect(); }

  apply(animate = true) {
    const w = innerWidth, h = innerHeight, r = this.#rect();
    const shade = document.getElementById('narrativeViewportShade');
    const chrome = document.getElementById('viewportChrome');
    for (const el of [this.stage, this.border, shade, chrome].filter(Boolean)) {
      el.classList.toggle('no-anim', !animate);
    }
    this.stage.style.clipPath = `inset(${r.y}px ${w - r.x - r.w}px ${h - r.y - r.h}px ${r.x}px)`;
    const pad = CONFIG.frame.viewportCoverPad ?? 0;
    const fx = r.x - pad;
    const fy = r.y - pad;
    const fw = r.w + pad * 2;
    const fh = r.h + pad * 2;
    if (this.border) {
      const f = CONFIG.frame;
      const vignette = f.edgeVignette !== false;
      const legacyBorder = f.photoBorder === true && !vignette;
      const show = vignette || legacyBorder;
      this.border.style.display = show ? 'block' : 'none';
      this.border.classList.toggle('edge-vignette', vignette);
      this.border.classList.toggle('photo-border', legacyBorder);
      if (show) {
        Object.assign(this.border.style, {
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.w}px`,
          height: `${r.h}px`,
        });
        if (legacyBorder) {
          const bw = f.borderWidth ?? 4;
          const bc = f.borderColor ?? 'rgba(236,232,220,0.94)';
          this.border.style.boxSizing = 'border-box';
          this.border.style.border = `${bw}px solid ${bc}`;
          this.border.style.boxShadow = 'none';
          this.border.style.background = 'transparent';
        } else {
          this.border.style.border = 'none';
          this.border.style.background = 'transparent';
        }
      }
    }
    if (shade) {
      Object.assign(shade.style, {
        left: fx + 'px', top: fy + 'px', width: fw + 'px', height: fh + 'px',
      });
    }
    if (!animate) {
      void this.stage.offsetWidth; // 强制 reflow，让 no-anim 立即生效
      for (const el of [this.stage, this.border, shade, chrome].filter(Boolean)) {
        el.classList.remove('no-anim');
      }
    }
    window.dispatchEvent(new CustomEvent('framemask:apply', {
      detail: { x: r.x, y: r.y, w: r.w, h: r.h, mode: this.mode },
    }));
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

  // 弱闪脉冲（任务反馈；避免全屏刺眼白）
  pulse(color = CONFIG.frame.questPulseColor ?? 'rgba(220,216,200,0.32)', hold = 140) {
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

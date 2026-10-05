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
import { getViewportEdge, viewportFeatherPx, syncViewportEdgeToDom, applyFisheyeEdgeToBorder } from './frameEdge.js';

export class FrameMask {
  constructor() {
    this.stage = document.getElementById('stage');
    this.border = document.getElementById('frameBorder');
    this.flash = document.getElementById('flash');
    this.mode = 'center';
    this.viewMode = 'near';   // 取景：near=只取画幅区域（凑近）/ far=全窗取景画幅裁切（站远，首版构图）
    this.viewportShape = 'rect';  // rect | circle（由 acts.viewportShape + 导演切幕）
    /** @type {number|null} 宽银幕宽高比；null = 16:9 */
    this.wideAspect = null;
    /** @type {number|null} 覆盖 config.frame.wideFill（终幕 2.39 常用 1） */
    this.wideWidthFrac = null;
    this._morphFromRect = null;
    this._morphToMode = 'wide';
    this._layoutMorph = 0;
    window.addEventListener('resize', () => this.apply(false));
  }

  /** @param {'rect'|'circle'|undefined} shape */
  setViewportShape(shape) {
    const s = shape === 'circle' ? 'circle' : 'rect';
    if (this.viewportShape === s) return;
    this.viewportShape = s;
    this.apply(true);
  }

  /** 导演切幕：形状 + 布局一次写入，保证 2↔3 幕 clip-path 渐变只触发一次 */
  syncFromAct(act, animate = true) {
    const shape = act?.viewportShape === 'circle' ? 'circle' : 'rect';
    const layout = act?.layout ?? 'center';
    const changed = this.viewportShape !== shape || this.mode !== layout;
    const layoutChanged = this.mode !== layout;
    this.viewportShape = shape;
    this.mode = layout;
    if (changed) {
      this.apply(animate);
      if (layoutChanged) {
        window.dispatchEvent(new CustomEvent('framechange', { detail: layout }));
      }
    }
  }

  /**
   * 第一幕开场：圆从中心一小点张开到定稿大小。
   * 先无动画钉在小圆上，下一帧再放开过渡。
   */
  growCircle(dur = 3.4) {
    if (this.viewportShape !== 'circle' || this.mode === 'wide') {
      this.apply(true);
      return;
    }
    const saved = CONFIG.frame.circleScale;
    const ease = 'cubic-bezier(.45,0,.2,1)';
    const prop = `clip-path ${dur}s ${ease}, left ${dur}s ${ease}, top ${dur}s ${ease}, width ${dur}s ${ease}, height ${dur}s ${ease}, border-radius ${dur}s ${ease}`;
    const els = [this.stage, this.border, document.getElementById('narrativeViewportShade'), document.getElementById('viewportChrome')].filter(Boolean);
    CONFIG.frame.circleScale = 0.07;
    this.apply(false);
    requestAnimationFrame(() => {
      for (const el of els) el.style.transition = prop;
      CONFIG.frame.circleScale = saved ?? 0.94;
      this.apply(true);
      setTimeout(() => {
        for (const el of els) el.style.transition = '';
      }, dur * 1000 + 40);
    });
  }

  /** 上货/首帧前按起始幕摆好视口，避免 center→right 带动画拖影 */
  bootstrapLayout(mode) {
    this.mode = mode;
    this.apply(false);
  }

  /** 首屏：布局 + 圆形/矩形视口与当前幕一致 */
  bootstrapFromAct(act) {
    this.viewportShape = act?.viewportShape === 'circle' ? 'circle' : 'rect';
    this.mode = act?.layout ?? 'center';
    this.apply(false);
  }

  setViewMode(m) { if (m === 'near' || m === 'far') this.viewMode = m; }
  toggleViewMode() { this.setViewMode(this.viewMode === 'near' ? 'far' : 'near'); }

  #lerpRect(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      w: a.w + (b.w - a.w) * t,
      h: a.h + (b.h - a.h) * t,
    };
  }

  #rectForMode(mode) {
    const w = innerWidth, h = innerHeight, f = CONFIG.frame;
    const vh = h;
    if (mode === 'right') {
      const margin = w * (f.rightMargin ?? 0.03);
      const vw = Math.min(vh, w * (f.rightWidthFrac ?? 0.58));
      return { x: w - margin - vw, y: 0, w: vw, h: vh };
    }
    if (mode === 'wide') {
      const aspect = this.wideAspect ?? (16 / 9);
      const fill = this.wideWidthFrac ?? f.wideFill;
      const ww = w * fill;
      let hh = ww / aspect;
      if (aspect >= 16 / 9 - 0.01) hh = Math.min(hh, h * 0.98);
      else hh = Math.min(hh, h);
      return { x: (w - ww) / 2, y: (h - hh) / 2, w: ww, h: hh };
    }
    const vw = Math.min(vh, w * (f.centerWidthFrac ?? 0.56));
    return { x: (w - vw) / 2, y: 0, w: vw, h: vh };
  }

  #rect() {
    if (this._layoutMorph > 0 && this._morphFromRect) {
      const to = this.#rectForMode(this._morphToMode);
      const t = Math.min(1, Math.max(0, this._layoutMorph));
      return this.#lerpRect(this._morphFromRect, to, t);
    }
    return this.#rectForMode(this.mode);
  }

  beginLayoutMorph(toMode = 'wide') {
    this._morphFromRect = { ...this.#rectForMode(this.mode) };
    this._morphToMode = toMode;
    this._layoutMorph = 0;
    for (const el of [this.stage, this.border, document.getElementById('narrativeViewportShade'), document.getElementById('viewportChrome')].filter(Boolean)) {
      el.classList.add('no-anim');
    }
  }

  setLayoutMorphProgress(t) {
    this._layoutMorph = Math.min(1, Math.max(0, t));
    this.apply(false);
  }

  finishLayoutMorph() {
    const target = this._morphToMode || 'wide';
    this.mode = target;
    this._layoutMorph = 0;
    this._morphFromRect = null;
    this.apply(true);
    window.dispatchEvent(new CustomEvent('framechange', { detail: target }));
  }

  /** 终幕 Marble 环视：2.39:1 宽银幕，以窗宽为基准上下留黑 */
  enterCinemaViewport({ aspect, widthFrac } = {}) {
    const r = CONFIG.reveal ?? {};
    this.wideAspect = aspect ?? r.cinemaAspect ?? 2.39;
    this.wideWidthFrac = widthFrac ?? r.cinemaWidthFrac ?? 1;
    if (this.mode !== 'wide') this.mode = 'wide';
    this.apply(true);
    window.dispatchEvent(new CustomEvent('framechange', { detail: 'wide' }));
  }

  resetWideViewport() {
    this.wideAspect = null;
    this.wideWidthFrac = null;
  }

  /** 溶解阶段：16:9 → 宽银幕，上下压出黑边（t 0~1） */
  setCinemaLetterboxProgress(t) {
    const r = CONFIG.reveal ?? {};
    const f = CONFIG.frame;
    const k = Math.min(1, Math.max(0, t));
    const a0 = 16 / 9;
    const a1 = r.cinemaAspect ?? 2.39;
    const fill0 = f.wideFill ?? 0.94;
    const fill1 = r.cinemaWidthFrac ?? 1;
    this.mode = 'wide';
    this.wideAspect = a0 + (a1 - a0) * k;
    this.wideWidthFrac = fill0 + (fill1 - fill0) * k;
    this._layoutMorph = 0;
    this._morphFromRect = null;
    this.apply(false);
  }

  // 当前布局的目标矩形（px）—— 相机 setViewOffset / 鱼眼中心对齐用
  getRect() { return this.#rect(); }

  /** 圆形 = 内接圆外接正方形的 inset+round；矩形 = round 0。便于 CSS 过渡 2↔3 幕 */
  #clipState(r, w, h) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const top0 = r.y;
    const right0 = w - r.x - r.w;
    const bottom0 = h - r.y - r.h;
    const left0 = r.x;
    if (this.viewportShape === 'circle' && this.mode !== 'wide') {
      const scale = CONFIG.frame.circleScale ?? 0.94;
      const radius = (Math.min(r.w, r.h) / 2) * scale;
      const d = radius * 2;
      const left = cx - radius;
      const top = cy - radius;
      return {
        top, right: w - left - d, bottom: h - top - d, left,
        round: radius,
        cx, cy, radius,
        shape: 'circle',
      };
    }
    return {
      top: top0, right: right0, bottom: bottom0, left: left0,
      round: 0,
      cx, cy, radius: 0,
      shape: 'rect',
    };
  }

  #applyClipPath(r, w, h) {
    const c = this.#clipState(r, w, h);
    // 始终带 round，便于 2↔3 幕 inset 与圆角同步 CSS 过渡
    this.stage.style.clipPath =
      `inset(${c.top}px ${c.right}px ${c.bottom}px ${c.left}px round ${c.round}px)`;
    return c;
  }

  apply(animate = true) {
    syncViewportEdgeToDom();
    const w = innerWidth, h = innerHeight, r = this.#rect();
    const clip = this.#applyClipPath(r, w, h);
    const circular = clip.round > 0.5;
    document.documentElement.classList.toggle('viewport-shape-circle', circular);
    const shade = document.getElementById('narrativeViewportShade');
    const chrome = document.getElementById('viewportChrome');
    for (const el of [this.stage, this.border, shade, chrome].filter(Boolean)) {
      el.classList.toggle('no-anim', !animate);
    }
    const pad = CONFIG.frame.viewportCoverPad ?? 0;
    let fx = r.x - pad;
    let fy = r.y - pad;
    let fw = r.w + pad * 2;
    let fh = r.h + pad * 2;
    if (circular) {
      const d = clip.radius * 2;
      fx = clip.cx - clip.radius - pad;
      fy = clip.cy - clip.radius - pad;
      fw = fh = d + pad * 2;
    }
    if (this.border) {
      const f = CONFIG.frame;
      const edge = getViewportEdge();
      const legacyBorder = f.photoBorder === true && edge !== 'fisheye';
      const show = edge === 'fisheye' || legacyBorder;
      this.border.style.display = show ? 'block' : 'none';
      this.border.classList.toggle('edge-fisheye', edge === 'fisheye');
      this.border.classList.toggle('edge-square', edge === 'square');
      this.border.classList.toggle('edge-vignette', false);
      this.border.classList.toggle('photo-border', legacyBorder);
      this.border.classList.toggle('edge-circle', circular);
      const feather = viewportFeatherPx();
      if (show) {
        let bx; let by; let bw; let bh;
        if (circular) {
          const { cx, cy, radius } = clip;
          const padF = edge === 'fisheye' ? feather : 0;
          const d = (radius + padF) * 2;
          bx = cx - radius - padF;
          by = cy - radius - padF;
          bw = bh = d;
        } else {
          bx = edge === 'fisheye' ? r.x - feather : r.x;
          by = edge === 'fisheye' ? r.y - feather : r.y;
          bw = edge === 'fisheye' ? r.w + feather * 2 : r.w;
          bh = edge === 'fisheye' ? r.h + feather * 2 : r.h;
        }
        Object.assign(this.border.style, {
          left: `${bx}px`,
          top: `${by}px`,
          width: `${bw}px`,
          height: `${bh}px`,
          borderRadius: circular ? '50%' : '0',
          '--edge-feather': `${feather}px`,
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
        borderRadius: circular ? '50%' : '0',
      });
    }
    if (!animate) {
      void this.stage.offsetWidth; // 强制 reflow，让 no-anim 立即生效
      for (const el of [this.stage, this.border, shade, chrome].filter(Boolean)) {
        el.classList.remove('no-anim');
      }
    }
    applyFisheyeEdgeToBorder();

    window.dispatchEvent(new CustomEvent('framemask:apply', {
      detail: {
        x: r.x, y: r.y, w: r.w, h: r.h, mode: this.mode,
        shape: clip.shape,
        cx: clip.cx, cy: clip.cy, radius: clip.radius,
      },
    }));
  }

  setLayout(mode, animate = true) {
    if (this.mode === mode && this._layoutMorph <= 0) return;
    this._layoutMorph = 0;
    this._morphFromRect = null;
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

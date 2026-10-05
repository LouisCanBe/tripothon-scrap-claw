import { CONFIG } from './config.js';
import { playPaper } from './gameAudio.js';
import { getNarrative, narrativeSrc } from './narrativeAssets.js';
import { applyPresentAct } from './present.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 左右字上的咖啡渍：大团浅斑压在卡片边角（与相框同用 % 椭圆，直接写 background-image）。 */
export function randomizePanelStains(el) {
  if (!el) return;
  const j = (a, b) => a + Math.random() * (b - a);
  const blob = (x, y, w, h, a) =>
    `radial-gradient(ellipse ${w.toFixed(0)}% ${h.toFixed(0)}% at ${x.toFixed(1)}% ${y.toFixed(1)}%, rgba(92,68,38,${a.toFixed(2)}), transparent 72%)`;
  const layers = [
    blob(j(2, 10), j(2, 12), j(50, 64), j(38, 52), j(0.16, 0.24)),
    blob(j(88, 98), j(84, 96), j(52, 66), j(40, 54), j(0.14, 0.22)),
    blob(j(72, 92), j(4, 14), j(32, 44), j(22, 34), j(0.08, 0.14)),
  ];
  el.style.backgroundImage = layers.join(', ');
}

/** 相纸污渍：五团色斑 + 灰点/亮点。 */
export function randomizePaperStains(el) {
  if (!el) return;
  const R = (a, b) => Math.round(a + Math.random() * (b - a));
  for (let i = 0; i < 5; i++) {
    el.style.setProperty(`--st${i}x`, `${R(-10, 10)}px`);
    el.style.setProperty(`--st${i}y`, `${R(-8, 8)}px`);
  }
  const dots = (count, rgb) => Array.from({ length: count }, () => {
    const x = R(3, 97);
    const y = R(3, 97);
    const a = (0.18 + Math.random() * 0.35).toFixed(2);
    return `radial-gradient(circle at ${x}% ${y}%, ${rgb}${a}) 0 0.9px, transparent 1.2px)`;
  }).join(', ');
  el.style.setProperty('--speck-a', dots(3, 'rgba(92,72,44,'));
  el.style.setProperty('--speck-b', dots(2, 'rgba(255,250,232,'));
}

function transitionCfg() {
  return CONFIG.present?.transition ?? {};
}

/** 记忆幕里"拿出一张照片"的观感参数（要调相框，改这里） */
export const PHOTO_FRAME = {
  fillX: 0.72,    // 相框占画幅宽的比例
  fillY: 0.7,     // 占画幅高的比例
  maxW: 560,      // 上限，避免大屏糊成一块
  anchorY: 0.54,  // 在画幅内的垂直重心（0.5 正中标，>0.5 偏下）
  squash: 0.62,   // 图片还没 load 时先按画框估一版，避免尺寸跳
};

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(`narrative preload: ${url}`));
    im.src = url;
  });
}

export class NarrativeBg {
  constructor() {
    this.root = document.getElementById('narrativeBg');
    this.layers = [
      document.getElementById('narrativeBgImgA'),
      document.getElementById('narrativeBgImgB'),
    ];
    this.dip = document.getElementById('narrativeDip');
    this.shade = document.getElementById('narrativeViewportShade');
    this.inter = document.getElementById('narrativeInterstitial');
    this.interImg = document.getElementById('narrativeInterstitialImg');
    // 相框式过场图（记忆幕）：位置随时跟画幅矩形走
    this.photo = document.getElementById('narrativePhoto');
    this.photoImg = document.getElementById('narrativePhotoImg');
    this.photoCap = document.getElementById('narrativePhotoCaption');
    this._photoGen = 0;
    this._photoAspect = 16 / 9;
    this.photoImg?.addEventListener('load', () => {
      const im = this.photoImg;
      if (im.naturalWidth && im.naturalHeight) {
        this._photoAspect = im.naturalWidth / im.naturalHeight;
        this._placePhotoFrame();
      }
    });
    this._active = 0;
    this._cur = '';
    this._viewport = null;
    this._interGen = 0;
    this._backdropGen = 0;
    window.addEventListener('framemask:apply', (e) => this.syncViewport(e.detail));
    this.hideInterstitial();
    this.hideFrame();
  }

  _activeLayer() {
    return this.layers[this._active];
  }

  _inactiveLayer() {
    return this.layers[1 - this._active];
  }

  async _runDip(peak, msIn, msOut) {
    const el = this.dip;
    if (!el || peak <= 0) return;
    el.style.transition = `opacity ${msIn}ms ease`;
    el.style.opacity = String(peak);
    await sleep(msIn);
    el.style.transition = `opacity ${msOut}ms ease`;
    el.style.opacity = '0';
    await sleep(msOut);
  }

  hideInterstitial() {
    this._interGen += 1;
    const el = this.inter;
    const img = this.interImg;
    if (!el) return;
    el.hidden = true;
    el.style.opacity = '0';
    el.classList.remove('cinematic');
    el.style.removeProperty('transition');
    if (img) {
      img.style.transform = '';
      img.style.opacity = '';
      img.removeAttribute('src');
    }
  }

  // ---------------- 相框式过场图（记忆幕） ----------------
  // 观感：从画幅下方"拿出一张照片"，落在方框里偏下的位置，纸边、微斜、有投影。
  // 硬切没有了：照片是在方框内出现的，画幅从 1:1 拉到 16:9 时它跟着画幅一起放大。

  /** 按当前画幅矩形算相框的位置与尺寸（画幅变 → 调用它） */
  _placePhotoFrame() {
    const el = this.photo;
    if (!el || el.hidden) return;
    const d = this._viewport;
    if (!d) return;
    const { fillX, fillY, maxW, anchorY, squash } = PHOTO_FRAME;
    const wMax = Math.min(d.w * fillX, maxW);
    const hMax = d.h * fillY;
    // 先按画框定一版（图片还没 load 时也不会跳），加载完再按真实比例收敛
    let w = wMax;
    let h = w / this._photoAspect;
    if (h > hMax) { h = hMax; w = h * this._photoAspect; }
    if (!this.photoImg?.naturalWidth) { w = wMax * 0.86; h = Math.min(hMax * squash, w / this._photoAspect); }
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h * clamp01(anchorY);
    Object.assign(el.style, {
      left: `${Math.round(cx - w / 2)}px`,
      top: `${Math.round(cy - h / 2)}px`,
      width: `${Math.round(w)}px`,
      height: `${Math.round(h)}px`,
    });
  }

  /** 把相框收起来（不改 _photoGen，供 hideFrame 与内部复用） */
  _collapseFrame() {
    const el = this.photo;
    if (!el) return;
    el.hidden = true;
    el.dataset.state = '';
    el.style.opacity = '';
    if (this.photoImg) this.photoImg.removeAttribute('src');
    if (this.photoCap) this.photoCap.textContent = '';
  }

  #armPhotoClickDismiss() {
    const el = this.photo;
    if (!el) return;
    this.#clearPhotoClickDismiss();
    el.classList.add('await-dismiss');
    this._photoClick = () => {
      this.#clearPhotoClickDismiss();
      this.hideFrame({ animate: true });
    };
    el.addEventListener('pointerdown', this._photoClick);
  }

  #clearPhotoClickDismiss() {
    const el = this.photo;
    if (el && this._photoClick) el.removeEventListener('pointerdown', this._photoClick);
    this._photoClick = null;
    el?.classList.remove('await-dismiss');
  }

  hideFrame({ animate = false } = {}) {
    this.#clearPhotoClickDismiss();
    this._photoGen += 1;
    const el = this.photo;
    if (!el) return;
    if (!animate || el.hidden) { this._collapseFrame(); return; }
    // 收场也交给 animation（out），别用内联 opacity —— 动画的 fill 会盖住它
    el.dataset.state = 'out';
    setTimeout(() => { if (el.dataset.state === 'out') this._collapseFrame(); }, 520);
  }

  /**
   * 相框式过场图。截图放在方框画幅里，像从记忆里抽出来的一张旧照片。
   * @param {string} keyOrUrl
   * @param {number} dur 秒
   * @param {{ caption?: string, hold?: number, fadeIn?: number, fadeOut?: number }} [step]
   */
  /** 每次出场重新掷一遍相纸的污渍位置 —— 不要每张照片都长在同一个地方 */
  _randomizePaper() {
    randomizePaperStains(document.getElementById('narrativePhotoCard'));
  }

  async showFrame(keyOrUrl, dur = 3, step = {}) {
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    const el = this.photo;
    if (!el || !this.photoImg || !url) { await sleep(dur * 1000); return; }
    const ok = await preloadImage(url).then(() => true).catch(() => false);
    if (!ok) { await sleep(dur * 1000); return; }

    const gen = ++this._photoGen;
    const fadeOut = step.fadeOut ?? 0.55;

    this.photoImg.src = url;
    if (this.photoCap) this.photoCap.textContent = step.caption ?? '';
    this._randomizePaper();
    this._placePhotoFrame();
    el.hidden = false;
    el.style.opacity = '';
    // 先落位（无动画），再下一帧换成 'in' 让 animation 从下缘推上来
    el.dataset.state = '';
    await sleep(20);
    if (gen !== this._photoGen) return;
    el.dataset.state = 'in';
    playPaper();

    if (step.hold) {
      await sleep(860);
      if (step.dismiss === 'click') this.#armPhotoClickDismiss();
      return;
    }
    if (step.dismiss === 'click') {
      el.classList.add('await-dismiss');
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          el.removeEventListener('pointerdown', finish);
          resolve();
        };
        const waitMs = step.dismissAfter;
        const timer = waitMs > 0 ? setTimeout(finish, waitMs * 1000) : 0;
        el.addEventListener('pointerdown', finish);
      });
      el.classList.remove('await-dismiss');
    } else {
      await sleep(dur * 1000);
    }
    if (gen !== this._photoGen) return;

    el.dataset.state = 'out';
    await sleep(Math.max(0.46, fadeOut) * 1000);
    if (gen !== this._photoGen) return;
    this._collapseFrame();
  }

  syncViewport(detail) {
    this._viewport = detail;
    this._placePhotoFrame();
    const root = this.root;
    const el = this.shade;
    const p = CONFIG.present ?? {};
    const sceneBg = p.backdropAsSceneBackground === true;
    const inViewport = p.backdropInViewport !== false;

    if (root && detail && inViewport && !sceneBg) {
      const pad = CONFIG.frame.viewportCoverPad ?? 0;
      const fx = detail.x - pad;
      const fy = detail.y - pad;
      const fw = detail.w + pad * 2;
      const fh = detail.h + pad * 2;
      Object.assign(root.style, {
        left: `${fx}px`,
        top: `${fy}px`,
        width: `${fw}px`,
        height: `${fh}px`,
        right: 'auto',
        bottom: 'auto',
      });
      root.classList.add('in-viewport');
    } else if (root) {
      root.style.left = root.style.top = root.style.width = root.style.height = '';
      root.classList.remove('in-viewport');
    }

    if (!el) return;
    const on = root?.classList.contains('on');
    if (!on || !detail || sceneBg) {
      el.hidden = true;
      return;
    }
    const pad = CONFIG.frame.viewportCoverPad ?? 0;
    const fx = detail.x - pad;
    const fy = detail.y - pad;
    const fw = detail.w + pad * 2;
    const fh = detail.h + pad * 2;
    Object.assign(el.style, {
      left: `${fx}px`,
      top: `${fy}px`,
      width: `${fw}px`,
      height: `${fh}px`,
    });
    el.hidden = false;
  }

  _emitSceneBackground(url, immediate, act = null, fadeMs = null) {
    const p = CONFIG.present ?? {};
    if (!p.backdropAsSceneBackground || !url) return;
    const tc = transitionCfg();
    window.dispatchEvent(new CustomEvent('narrative:scene-bg', {
      detail: {
        url,
        immediate,
        actId: act?.id ?? null,
        fadeMs: fadeMs ?? tc.backdropMs ?? 1100,
      },
    }));
  }

  showAmbient() {
    applyPresentAct({ id: 1 }, this._activeLayer());
    this.setBackdrop('ambient', { immediate: true });
  }

  /** 只藏 HTML 叙事层，不动 three scene.background（定格娃娃机后再切全景） */
  hideDomOnly() {
    this.hideInterstitial();
    this.hideFrame();
    if (this.root) this.root.classList.remove('on', 'in-viewport');
    document.documentElement.classList.remove('narrative-backdrop');
  }

  clearSceneBackdrop() {
    this._backdropGen += 1;
    document.documentElement.classList.remove('narrative-scene-bg');
    window.dispatchEvent(new CustomEvent('narrative:scene-bg', {
      detail: { url: null, immediate: true },
    }));
  }

  hideForReveal() {
    this.hideDomOnly();
    this.clearSceneBackdrop();
  }

  /**
   * @param {import('./acts.js').ACTS[number]} act
   * @param {{ immediate?: boolean }} opts
   */
  async applyAct(act, { immediate = false, skipBackdrop = false } = {}) {
    this.hideInterstitial();
    this.hideFrame();
    if (!act) return;
    const hud = document.getElementById('hud');
    if (hud) {
      if (act?.hudDecor === 'rationWall') {
        const u = narrativeSrc('rationWall');
        hud.classList.add('hud-ration-decor');
        if (u) hud.style.setProperty('--hud-decor-url', `url("${u}")`);
      } else {
        hud.classList.remove('hud-ration-decor');
        hud.style.removeProperty('--hud-decor-url');
      }
    }
    applyPresentAct(act, this._activeLayer());
    if (act.backdrop && !skipBackdrop) {
      await this.setBackdrop(act.backdrop, { immediate, dip: !immediate, act });
    }
    applyPresentAct(act, this._activeLayer());
  }

  async setBackdrop(keyOrUrl, { immediate = false, dip = false, act = null } = {}) {
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    if (!this.root || !url) return;
    if (url === this._cur && this.root.classList.contains('on')) return;

    const gen = ++this._backdropGen;
    const tc = transitionCfg();
    const ms = tc.backdropMs ?? 1100;
    const dipPeak = tc.backdropDip ?? 0.48;

    if (immediate || !this.root.classList.contains('on')) {
      const layer = this._activeLayer();
      try { await preloadImage(url); } catch { /* still try */ }
      if (gen !== this._backdropGen) return;
      layer.src = url;
      layer.classList.add('is-active');
      layer.style.opacity = '1';
      layer.style.transition = 'none';
      this._inactiveLayer().classList.remove('is-active');
      this._inactiveLayer().style.opacity = '0';
      this._cur = url;
      this.root.classList.add('on');
      document.documentElement.classList.add('narrative-backdrop');
      if (this._viewport) this.syncViewport(this._viewport);
      this._emitSceneBackground(url, true, act, 0);
      return;
    }

    const outEl = this._activeLayer();
    const inEl = this._inactiveLayer();
    try { await preloadImage(url); } catch { /* continue */ }
    if (gen !== this._backdropGen) return;

    inEl.src = url;
    if (act) applyPresentAct(act, inEl);
    inEl.style.transition = `opacity ${ms}ms ease`;
    outEl.style.transition = `opacity ${ms}ms ease`;
    inEl.style.opacity = '0';
    inEl.classList.add('is-active');

    const dipMs = Math.round(ms * 0.42);
    const dipTask = dip
      ? this._runDip(dipPeak, dipMs, dipMs)
      : Promise.resolve();

    await sleep(20);
    if (gen !== this._backdropGen) return;
    inEl.style.opacity = '1';
    outEl.style.opacity = '0';
    this._emitSceneBackground(url, false, act, ms);

    await Promise.all([sleep(ms), dipTask]);
    if (gen !== this._backdropGen) return;

    this._active = 1 - this._active;
    this._cur = url;
    outEl.classList.remove('is-active');
    outEl.style.opacity = '0';
    outEl.removeAttribute('src');
    this.root.classList.add('on');
    document.documentElement.classList.add('narrative-backdrop');
    if (this._viewport) this.syncViewport(this._viewport);
  }

  async showInterstitial(keyOrUrl, dur = 2.5, step = {}) {
    // 记忆幕默认走相框式（方框内"拿出一张照片"，不硬切全屏）；
    // 终幕的真相图走满屏 —— 那一下本来就该是"掀开画幅"。
    const mode = step.mode ?? transitionCfg().interstitialMode ?? 'photo';
    if (mode === 'photo') return this.showFrame(keyOrUrl, dur, step);
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    const tc = transitionCfg();
    const fadeIn = step.fadeIn ?? tc.interstitialFadeIn ?? 0.7;
    const fadeOut = step.fadeOut ?? tc.interstitialFadeOut ?? 0.85;
    const dipOn = step.dip !== false;
    const dipBefore = step.dipBefore ?? dipOn;
    const dipAfter = step.dipAfter ?? tc.interstitialDipAfter ?? false;

    if (!this.inter || !this.interImg || !url) {
      await sleep(dur * 1000);
      return;
    }
    const gen = ++this._interGen;

    if (dipBefore) {
      await this._runDip(tc.interstitialDip ?? 0.55, fadeIn * 1000 * 0.55, fadeIn * 1000 * 0.35);
      if (gen !== this._interGen) return;
    }

    // 图还没出（规划里的 TODO 键先挂在别的图上，或临时路径写错）时，宁可不出图也不要糊一张裂图。
    const ok = await preloadImage(url).then(() => true).catch(() => false);
    if (gen !== this._interGen) return;
    if (!ok) { await sleep(dur * 1000); return; }

    this.interImg.src = url;
    this.inter.hidden = false;
    this.inter.classList.add('cinematic');
    this.inter.style.transition = 'none';
    this.inter.style.opacity = '1';
    this.interImg.style.transition = `opacity ${fadeIn}s ease, transform ${fadeIn}s ease`;
    this.interImg.style.opacity = '0';
    this.interImg.style.transform = 'scale(1.04)';

    await sleep(24);
    if (gen !== this._interGen) return;
    this.interImg.style.opacity = '1';
    this.interImg.style.transform = 'scale(1)';

    await sleep(dur * 1000);
    if (gen !== this._interGen) return;

    this.interImg.style.opacity = '0';
    this.interImg.style.transform = 'scale(0.98)';
    this.inter.style.transition = `opacity ${fadeOut}s ease`;
    this.inter.style.opacity = '0';
    await sleep(fadeOut * 1000);
    if (gen !== this._interGen) return;

    if (dipAfter) {
      await this._runDip(tc.interstitialDip ?? 0.4, fadeOut * 500, fadeOut * 700);
    }
    if (gen !== this._interGen) return;
    this.hideInterstitial();
  }

  async pulseGlitchOverlay(keyOrUrl = 'glitch', ms = 2200) {
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    if (!this.inter || !this.interImg || !url) return;
    const gen = ++this._interGen;
    const fade = 0.35;
    this.interImg.src = url;
    this.inter.hidden = false;
    this.inter.classList.remove('cinematic');
    this.inter.style.transition = `opacity ${fade}s ease`;
    this.inter.style.opacity = '0';
    await sleep(30);
    if (gen !== this._interGen) return;
    this.inter.style.opacity = '0.88';
    await sleep(ms);
    if (gen !== this._interGen) return;
    this.inter.style.opacity = '0';
    await sleep(fade * 1000);
    if (gen !== this._interGen) return;
    this.hideInterstitial();
  }

  setRevealBeatImage(keyOrUrl = 'revealBeat') {
    const url = narrativeSrc(keyOrUrl);
    const el = document.querySelector('#revealBeat .reveal-beat-visual img');
    if (el && url) el.src = url;
  }
}

export { getNarrative };

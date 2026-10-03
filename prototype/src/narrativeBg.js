import { CONFIG } from './config.js';
import { getNarrative, narrativeSrc } from './narrativeAssets.js';
import { applyPresentAct } from './present.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function transitionCfg() {
  return CONFIG.present?.transition ?? {};
}

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
    this._active = 0;
    this._cur = '';
    this._viewport = null;
    this._interGen = 0;
    this._backdropGen = 0;
    window.addEventListener('framemask:apply', (e) => this.syncViewport(e.detail));
    this.hideInterstitial();
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

  syncViewport(detail) {
    this._viewport = detail;
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

  _emitSceneBackground(url, immediate, act = null) {
    const p = CONFIG.present ?? {};
    if (!p.backdropAsSceneBackground || !url) return;
    document.documentElement.classList.add('narrative-scene-bg');
    window.dispatchEvent(new CustomEvent('narrative:scene-bg', {
      detail: { url, immediate, actId: act?.id ?? null },
    }));
  }

  showAmbient() {
    applyPresentAct({ id: 1 }, this._activeLayer());
    this.setBackdrop('ambient', { immediate: true });
  }

  /** 只藏 HTML 叙事层，不动 three scene.background（定格娃娃机后再切全景） */
  hideDomOnly() {
    this.hideInterstitial();
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
  async applyAct(act, { immediate = false } = {}) {
    this.hideInterstitial();
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
    if (act.backdrop) {
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
      this._emitSceneBackground(url, true, act);
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
    this._emitSceneBackground(url, false, act);

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
    if (!dip) this._emitSceneBackground(url, false, act);
  }

  async showInterstitial(keyOrUrl, dur = 2.5, step = {}) {
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

    try { await preloadImage(url); } catch { /* ignore */ }
    if (gen !== this._interGen) return;

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

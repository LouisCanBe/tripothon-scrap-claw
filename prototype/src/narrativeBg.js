import { narrativeSrc, NARRATIVE } from './narrativeAssets.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class NarrativeBg {
  constructor() {
    this.root = document.getElementById('narrativeBg');
    this.img = document.getElementById('narrativeBgImg');
    this.shade = document.getElementById('narrativeViewportShade');
    this.inter = document.getElementById('narrativeInterstitial');
    this.interImg = document.getElementById('narrativeInterstitialImg');
    this._cur = '';
    this._viewport = null;
    this._interGen = 0;
    window.addEventListener('framemask:apply', (e) => this.syncViewport(e.detail));
    this.hideInterstitial();
  }

  hideInterstitial() {
    this._interGen += 1;
    const el = this.inter;
    const img = this.interImg;
    if (!el) return;
    el.hidden = true;
    el.style.opacity = '0';
    el.style.removeProperty('transition');
    if (img) img.removeAttribute('src');
  }

  /** 位置由 frameMask.apply 与 clip / 描边同矩形；这里只控制显隐 */
  syncViewport(detail) {
    this._viewport = detail;
    const el = this.shade;
    if (!el) return;
    const on = this.root?.classList.contains('on');
    el.hidden = !on || !detail || detail.mode === 'wide';
  }

  /** 片头 / 重开：拾荒大场景 */
  showAmbient() {
    this.setBackdrop('ambient', { immediate: true });
  }

  /** @param {import('./acts.js').ACTS[number]} act */
  applyAct(act) {
    this.hideInterstitial();
    if (act?.backdrop) this.setBackdrop(act.backdrop);
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
  }

  setBackdrop(keyOrUrl, { immediate = false } = {}) {
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    if (!this.root || !this.img || !url) return;
    if (url === this._cur && this.root.classList.contains('on')) return;
    this._cur = url;
    const swap = () => {
      this.img.src = url;
      this.root.classList.add('on');
      document.documentElement.classList.add('narrative-backdrop');
      if (this._viewport) this.syncViewport(this._viewport);
    };
    if (immediate || !this.root.classList.contains('on')) {
      swap();
      return;
    }
    this.root.classList.remove('on');
    setTimeout(swap, 380);
  }

  async showInterstitial(keyOrUrl, dur = 2.5, { fade = 0.55 } = {}) {
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    if (!this.inter || !this.interImg || !url) {
      await sleep(dur * 1000);
      return;
    }
    const gen = ++this._interGen;
    this.interImg.src = url;
    this.inter.hidden = false;
    this.inter.style.transition = `opacity ${fade}s ease`;
    this.inter.style.opacity = '0';
    await sleep(30);
    if (gen !== this._interGen) return;
    this.inter.style.opacity = '1';
    await sleep(dur * 1000);
    if (gen !== this._interGen) return;
    this.inter.style.opacity = '0';
    await sleep(fade * 1000);
    if (gen !== this._interGen) return;
    this.hideInterstitial();
  }

  /** 终幕故障：短暂铺满撕裂概念图（与程序 glitch 叠用） */
  async pulseGlitchOverlay(keyOrUrl = 'glitch', ms = 2200) {
    const url = narrativeSrc(keyOrUrl) ?? keyOrUrl;
    if (!this.inter || !this.interImg || !url) return;
    const gen = ++this._interGen;
    this.interImg.src = url;
    this.inter.hidden = false;
    this.inter.style.transition = 'opacity .12s ease';
    this.inter.style.opacity = '0.92';
    await sleep(ms);
    if (gen !== this._interGen) return;
    this.inter.style.opacity = '0';
    await sleep(280);
    if (gen !== this._interGen) return;
    this.hideInterstitial();
  }

  setRevealBeatImage(keyOrUrl = 'revealBeat') {
    const url = narrativeSrc(keyOrUrl);
    const el = document.querySelector('#revealBeat .reveal-beat-visual img');
    if (el && url) el.src = url;
  }
}

export { NARRATIVE };

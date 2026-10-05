// ============================================================
// 幕导演：四幕 + 终幕的流程编排（分幕数据在 acts.js）
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ACTS } from './acts.js';
import {
  playGlitchTick,
  playRevealDrone,
  playMusicBoxStinger,
  unlockAudio,
  startGlitchBed,
  setGlitchBedMorph,
  playGlitchBlackout,
  endGlitchAudio,
} from './gameAudio.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

export class Director {
  constructor({ mask, claw, rig, lights, hooks = {}, clawDefaults = null }) {
    this.mask = mask;
    this.claw = claw;
    this.rig = rig;
    this.lights = lights;
    this.hooks = hooks;
    this.narrativeBg = hooks.narrativeBg ?? null;
    this._clawDefaults = clawDefaults;

    this.idx = -1;
    this._runGen = 0;
    this.happened = new Set();
    this._waiter = null;
    this._skip = false;
    this._questDone = new Map();
    this._startActIndex = 0;
    this._ended = false;
    this._scanActive = false;   // 俯拍扫视角期间，锁住用户视角输入
    this._appearance = null;    // 奖池当前显示态（manifest | rot），换货去重用

    this.elMsg = document.getElementById('msg');
    this.elHint = document.getElementById('hint');
    this.elHud = document.getElementById('hud');
    this.elLabel = document.getElementById('actLabel');
    this.elStage = document.getElementById('stage');
    this.elFlash = document.getElementById('flash');
    this.elPanel = { left: document.getElementById('panelLeft'), right: document.getElementById('panelRight') };
    this.elQuestProg = document.getElementById('questProgress');
    this.elRevealBeat = document.getElementById('revealBeat');
    this.elGlobalGrabStat = document.getElementById('globalGrabStat');
    this.elReplay = document.getElementById('replayCue');
    this._replayTimer = 0;
    this.elReplay?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.#hideReplayCue();
      this.restart();
    });
  }

  get act() { return ACTS[this.idx]; }
  allow(what) { return this.act?.control?.[what] !== false; }
  /** 俯拍扫视角 / 终幕演出期间：用户输入一律不生效 */
  get interactive() { return !this._scanActive; }

  setStartActIndex(i) {
    this._startActIndex = Math.max(0, Math.min(i, ACTS.length - 1));
  }

  notify(event, payload) {
    this.happened.add(event);
    if (this._waiter?.event === event) { this._waiter.resolve(); this._waiter = null; }

    if (event === 'collect' && payload) {
      if (this.act?.id === 2 && !this.happened.has('firstCollect')) this.notify('firstCollect');

      const q = this.act?.quest;
      const copy = this.act?.questCopy;
      const slot = this.#questSlot(payload.id);
      if (this.act?.id === 3 && q) {
        const need = Math.max(1, this.act.questCount ?? 1);
        const got = this._questDone.get(slot) ?? 0;
        if (slot && got < need) {
          this._questDone.set(slot, got + 1);
          if (got + 1 >= need) document.getElementById('q-' + slot)?.classList.add('done');
          this.#syncQuestHud();
          const line = copy?.right?.[slot];
          if (line) this.msg(line);
          if (q.every(id => (this._questDone.get(id) ?? 0) >= need)) {
            this.mask.pulse(undefined, 160);
            setTimeout(() => this.notify('questComplete'), 700);
          }
        } else if (slot) {
          if (copy?.dup) this.msg(copy.dup);
        } else {
          const line = copy?.wrongJunk ?? copy?.wrong ?? '……配额不认这个。';
          this.msg(line);
          this.#panel('right', line);
          setTimeout(() => this.#panel('right', ''), 2200);
        }
      } else if (q?.includes(payload.id) && !this._questDone.has(payload.id)) {
        this._questDone.set(payload.id, 1);
        document.getElementById('q-' + payload.id)?.classList.add('done');
        if (q.every(id => this._questDone.has(id))) {
          this.mask.pulse(undefined, 160);
          setTimeout(() => this.notify('questComplete'), 700);
        }
      }

      if (this.act?.tuning?.decayPerGrab)
        CONFIG.claw.gripStrength = Math.max(0.55, CONFIG.claw.gripStrength - this.act.tuning.decayPerGrab);
      if (slot) this._failStreak = 0;
    }
    if (event === 'grabFail') {
      const pity = this.act?.pity;
      if (pity) {
        this._failStreak = (this._failStreak ?? 0) + 1;
        if (this._failStreak >= (pity.streak ?? 2)) {
          CONFIG.claw.gripStrength = Math.min(1, CONFIG.claw.gripStrength + (pity.gripStep ?? 0.08));
          CONFIG.claw.baseSlipProb = Math.max(0, CONFIG.claw.baseSlipProb - (pity.slipStep ?? 0.06));
        }
      }
    }
    if (event === 'view' && payload) {
      if (payload !== 'front') this.notify('firstView');
      this._viewsSeen ??= new Set(['front']);
      this._viewsSeen.add(payload);
      if (['left', 'front', 'right'].every(v => this._viewsSeen.has(v))) this.notify('allViews');
    }
  }

  shouldSkipCollectLine() {
    return this.act?.id === 3;
  }

  skip() {
    this._skip = true;
    if (this._waiter) { this._waiter.resolve(); this._waiter = null; }
  }

  start() {
    this.#enter(this._startActIndex);
  }

  async restart() {
    unlockAudio();
    this._runGen += 1;
    this._skip = true;
    if (this._waiter) { this._waiter.resolve(); this._waiter = null; }
    this._scanActive = false;
    this._appearance = null;   // 重开：下一幕的 appearance 一定要重新应用一次
    // 如果是在故障段的全黑里按的重开，#glitch 的收尾（淡出黑场）已经被 gen 守卫跳过，
    // 这里必须自己把黑幕撤掉，否则重开后会一直黑到第三幕。
    this.elFlash.style.transition = '';
    this.elFlash.style.opacity = '0';
    this.hooks.onPoolScanCancel?.();
    await this.hooks.onRestart?.();
    this._ended = false;
    this.#enter(this._startActIndex);
  }

  // ---------------- 内部 ----------------

  /** 奖品 id → 配额格。先查 questAlias（败露态 id 指向它对应的那格），再走 questAccepts */
  #questSlot(id) {
    const q = this.act?.quest;
    if (!q || !id) return null;
    const alias = this.act.questAlias;
    if (alias?.[id]) return alias[id];
    const accepts = this.act.questAccepts;
    if (accepts) {
      for (const slot of q) if (accepts[slot]?.includes(id)) return slot;
      return null;
    }
    return q.includes(id) ? id : null;
  }

  #syncQuestHud() {
    if (!this.elQuestProg) return;
    const q = this.act?.quest;
    const need = Math.max(1, this.act?.questCount ?? 1);
    let done = 0;
    for (const id of q ?? []) done += Math.min(need, this._questDone.get(id) ?? 0);
    this.elQuestProg.textContent = q ? String(done) : '0';
  }

  async #enter(i) {
    const gen = ++this._runGen;
    this.idx = i;
    const act = this.act;
    if (!act) return;
    this._skip = false;
    this.#hideReplayCue();
    this.happened = new Set();
    this._questDone = new Map();   // 配额格 → 已抓数量（questCount > 1 时是计数不是布尔）
    this._viewsSeen = null;
    this.#syncQuestHud();

    this.mask.syncFromAct(act, i > 0);
    if (act.framing) this.mask.setViewMode(act.framing);
    this.rig?.setZoom(act.zoom ?? 1);
    this.rig?.applyUserZoomPolicy(act.id ?? 1);
    this.claw.controlEnabled = !!(act.control.move || act.control.drop);
    clearTimeout(this._pityTimer);
    this._failStreak = 0;
    CONFIG.claw.forceGrip = false;
    if (act.pity?.forceAfterSeconds) {
      this._pityTimer = setTimeout(() => {
        if (gen === this._runGen) CONFIG.claw.forceGrip = true;
      }, act.pity.forceAfterSeconds * 1000);
    }
    if (act.tuning) {
      const { decayPerGrab, ...params } = act.tuning;
      Object.assign(CONFIG.claw, params);
    } else if (this._clawDefaults) {
      Object.assign(CONFIG.claw, this._clawDefaults);
    }

    this.hooks.onActEnter?.(act, i);
    const bgTask = this.narrativeBg?.applyAct(act, {
      immediate: i === 0,
      skipBackdrop: act.backdropAfter === 'glitch',
    }) ?? Promise.resolve();

    this.elHud.style.display = act.quest ? 'block' : 'none';
    if (this.elGlobalGrabStat) this.elGlobalGrabStat.hidden = true;
    if (act.quest) for (const id of act.quest) document.getElementById('q-' + id)?.classList.remove('done');

    // 两态：进幕切奖池的显示态（'manifest' 他以为的 / 'rot' 真实的）。
    // 终幕那次 rot 切换不在这里做 —— 它被 #glitch 抢在全黑里执行（见 #glitch 的换货段）。
    if (act.appearance && act.appearance !== this._appearance) {
      await this.hooks.onPoolAppearance?.(act.appearance, act);
      if (gen !== this._runGen) return;
      this._appearance = act.appearance;
    }
    if (act.restockPool) {
      await this.hooks.onRestockPool?.(act);
      if (gen !== this._runGen) return;
    }

    this.elHint.style.opacity = act.hint === null ? '0' : '1';
    if (act.hint) this.elHint.textContent = act.hint;

    if (act.label) {
      this.elLabel.textContent = act.label;
      this.elLabel.classList.add('show');
      setTimeout(() => this.elLabel.classList.remove('show'), 2600);
    }

    this.#panel('left', ''); this.#panel('right', '');

    await bgTask;
    await sleep(280);
    if (gen !== this._runGen) return;
    await this.#run(act, gen);
    if (gen !== this._runGen) return;
    if (ACTS[this.idx + 1]) this.#enter(this.idx + 1);
    else this._ended = true;
  }

  async #run(act, gen) {
    for (const step of act.script) {
      if (this._skip || gen !== this._runGen) return;
      switch (step.type) {
        case 'sub':   await this.#sub(step); break;
        case 'panel':
          this.#panel(step.side, step.text);
          if (step.continue && step.text) await this.#untilContinue(step, gen);
          else if (step.dur) await sleep(step.dur * 1000);
          if (step.hideAfter) this.#panel(step.side, '');
          break;
        case 'hint':  this.elHint.textContent = step.text; break;
        case 'pause': await sleep((step.dur ?? 1) * 1000); break;
        case 'wait':  await this.#waitFor(step.event); break;
        case 'synthesis': await this.#synthesis(act); break;
        case 'interstitial':
          await this.narrativeBg?.showInterstitial(step.image, step.dur ?? 2.5, step);
          break;
        case 'glitch': await this.#glitch(step); break;
        case 'poolScan': await this.#poolScan(step); break;
        case 'restore':
          this._scanActive = false;
          this.hooks.onPoolScanCancel?.();
          break;
        case 'fadeGhost': await this.hooks.onFadeGhost?.(step); break;
        case 'revealBeat': await this.#revealBeat(step); break;
        case 'fadeMachine':
          // dur 秒。dir 缺省消失；dir:'in' 从看不见出现。根节点由钩子决定，换 GLB 不用改剧本。
          await this.hooks.onFadeMemoryMachine?.(step);
          break;
        case 'reveal':
          if (this.hooks.onRevealTransition) await this.hooks.onRevealTransition();
          else await this.hooks.onReveal?.();
          break;
        case 'stinger': this.#stinger(step.text); break;
      }
    }
  }

  #waitFor(event) {
    if (this.happened.has(event)) return Promise.resolve();
    return new Promise(resolve => (this._waiter = { event, resolve }));
  }

  msg(text) {
    this.elMsg.classList.remove('stinger');
    clearTimeout(this._msgTimer);
    clearInterval(this._typeTimer);
    this.elMsg.style.opacity = '1';
    const chars = [...text];
    if (chars.length > 6) {
      let i = 0;
      this.elMsg.textContent = '';
      this._typeTimer = setInterval(() => {
        this.elMsg.textContent = chars.slice(0, ++i).join('');
        if (i >= chars.length) clearInterval(this._typeTimer);
      }, 34);
    } else {
      this.elMsg.textContent = text;
    }
    this._msgTimer = setTimeout(() => (this.elMsg.style.opacity = '0'), 2400);
  }

  async #sub({ text, dur = 3 }) {
    this.msg(text);
    await sleep(dur * 1000);
    this.elMsg.style.opacity = '0';
    await sleep(400);
  }

  #panel(side, text) {
    const el = this.elPanel[side];
    if (!el) return;
    el.classList.remove('await-continue');
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text;
    el.classList.add('show');
  }

  /** 旁白闸门：点当前框、派发 narrative:continue、或 continueAfter 秒后继续。 */
  #untilContinue(step, gen) {
    const el = this.elPanel[step.side];
    const ms = (step.continueAfter ?? 3.4) * 1000;
    el?.classList.add('await-continue');
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      const onClick = (e) => {
        e.stopPropagation();
        finish();
      };
      const timer = setTimeout(finish, ms);
      const poll = setInterval(() => {
        if (this._skip || gen !== this._runGen) finish();
      }, 120);
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(poll);
        el?.removeEventListener('pointerdown', onClick);
        window.removeEventListener('narrative:continue', finish);
        el?.classList.remove('await-continue');
      };
      el?.addEventListener('pointerdown', onClick);
      window.addEventListener('narrative:continue', finish);
    });
  }

  async #synthesis(act) {
    const { key, fill, glow, hemi, ambient } = this.lights;
    const warm = new THREE.Color(0xffc98f);
    const from = key.color.clone();
    const grain0 = CONFIG.post.grain;
    const fill0 = CONFIG.lights.fill.intensity;
    const hemi0 = CONFIG.lights.hemi.intensity;
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      key.color.copy(from).lerp(warm, t);
      key.intensity = CONFIG.lights.key.intensity + 0.45 * t;
      if (fill) fill.intensity = fill0 + 0.28 * t;
      if (hemi) hemi.intensity = hemi0 + 0.18 * t;
      if (ambient) ambient.intensity = CONFIG.lights.ambient.intensity + 0.12 * t;
      if (glow) {
        const g = CONFIG.lights.glow.intensity + 2.5 * t;
        glow.intensity = g;
        glow.visible = g > 0.02;
      }
      CONFIG.post.grain = grain0 * (1 - 0.55 * t);
      await sleep(100);
    }

    const synth = document.getElementById('synth');
    const cards = [...synth.querySelectorAll('.syn-card')];
    act.menu?.cards.forEach((name, i) => { if (cards[i]) cards[i].textContent = name; });
    synth.hidden = false;
    cards.forEach((c, i) => setTimeout(() => c.classList.add('show'), i * 450));
    await sleep(2200);
    cards.forEach(c => c.classList.add('merge'));
    await sleep(1100);
    const menu = document.getElementById('menuCard');
    menu.textContent = act.menu?.line ?? '';
    menu.classList.add('show');
    await sleep(3000);
    synth.hidden = true;
    cards.forEach(c => c.classList.remove('show', 'merge'));
    menu.classList.remove('show');
  }

  async #glitch(step = {}) {
    const gen = this._runGen;   // 演出中途可能被 Y 重开；重开后这一段不许再改世界状态
    const glitchOverlay = step.image
      ? this.narrativeBg?.pulseGlitchOverlay(step.image, 2400)
      : Promise.resolve();
    const grain0 = CONFIG.post.grain;
    CONFIG.post.grain = 0.13;
    const morphMs = step.morphMs ?? 2800;
    const glitchMs = step.glitchMs ?? 2200;
    const holdBefore = step.holdBefore ?? 520;
    this.mask.beginLayoutMorph('wide');
    this.mask.resetWideViewport();
    startGlitchBed({ morphMs, glitchMs });
    await sleep(holdBefore);

    const t0 = Date.now();
    while (Date.now() - t0 < glitchMs) {
      const elapsed = Date.now() - t0;
      const morphT = Math.min(1, elapsed / morphMs);
      this.mask.setLayoutMorphProgress(morphT);
      this.hooks.setFisheyeFade?.(1 - morphT);
      setGlitchBedMorph(morphT);
      playGlitchTick({ intensity: 0.35 + morphT * 0.75 });
      this.elStage.style.transform = `translate(${rand(-16, 16)}px, ${rand(-9, 9)}px)`;
      this.elStage.style.filter = `hue-rotate(${rand(-40, 40)}deg) contrast(${rand(1, 1.7)})`;
      this.elFlash.style.transition = 'none';
      this.elFlash.style.background = '#0a0a0c';
      const gMax = CONFIG.frame.glitchFlashMax ?? 0.42;
      this.elFlash.style.opacity = Math.random() < 0.22 ? String(gMax * (0.55 + Math.random() * 0.45)) : '0';
      await sleep(80);
    }
    this.elStage.style.transform = '';
    this.elStage.style.filter = '';
    this.mask.finishLayoutMorph();
    this.hooks.setFisheyeFade?.(0);
    CONFIG.post.grain = grain0 * 0.4;

    this.elFlash.style.background = '#000';
    this.elFlash.style.opacity = '1';
    playGlitchBlackout();
    if (this.act?.backdropAfter === 'glitch' && this.act.backdrop) {
      await this.narrativeBg?.setBackdrop(this.act.backdrop, {
        immediate: true,
        dip: false,
        act: this.act,
      });
    }
    // —— 换货：就放在这一片全黑里 ——
    // 本幕（终幕）声明了 appearanceAfter 就表示"这一幕的显示态要等黑场之后再换"：
    // 同一批东西、同一套 collider，只是"他看见的"变回真实的样子。
    // 注意读的是 this.act —— glitch 步骤写在终幕自己的 script 里。
    // gen 守卫：这中间玩家按了 Y 重开的话，绝不能把 rot 再扣回世界（新一轮已经在跑 manifest 了）。
    const want = this.act?.appearanceAfter;
    if (want && want !== this._appearance && gen === this._runGen) {
      await this.hooks.onPoolAppearance?.(want, this.act);
      if (gen === this._runGen) this._appearance = want;
    }
    await sleep(280);
    if (gen !== this._runGen) return;   // 重开了：灯光与收尾都交给新一轮
    this.hooks.onLightsCold?.();
    await sleep(700);
    this.elFlash.style.transition = 'opacity 1.4s';
    this.elFlash.style.opacity = '0';
    await sleep(1400);
    this.elFlash.style.transition = '';
    endGlitchAudio();
    this.hooks.onGlitchEnd?.(this.act);
    await glitchOverlay;
  }

  /**
   * 俯拍扫过奖池：终幕"扫过腐败食物模型"这一拍。
   * 镜头交给 onPoolScan 钩子（main.js 里做位置/朝向插值），这里只管时长与收尾。
   *   restore   true（默认）扫完把镜头交还给原来的取景；false 则停在终点，
   *             等后面的 { type: 'restore' } 步骤收（终幕就是这条路径）
   */
  async #poolScan({ dur = 6, restore = true, preset = 'sweep' } = {}) {
    if (!this.hooks.onPoolScan) { await sleep(dur * 1000); return; }
    this._scanActive = true;
    try {
      await this.hooks.onPoolScan({ dur, restore, preset });
    } finally {
      if (restore) this._scanActive = false;
    }
  }

  async #revealBeat({ line, dur = 4, image }) {
    playRevealDrone();
    const el = this.elRevealBeat;
    if (!el) { await sleep(dur * 1000); return; }
    const visual = el.querySelector('.reveal-beat-visual');
    if (visual) visual.hidden = !image;
    if (image) this.narrativeBg?.setRevealBeatImage(image);
    const txt = el.querySelector('.reveal-beat-text');
    if (txt) txt.textContent = line ?? '';
    el.hidden = false;
    el.classList.add('show');
    await sleep(dur * 1000);
    el.classList.remove('show');
    el.hidden = true;
  }

  #hideReplayCue() {
    clearTimeout(this._replayTimer);
    this._replayTimer = 0;
    const el = this.elReplay;
    if (!el) return;
    el.classList.remove('show');
    el.hidden = true;
  }

  #showReplayCue() {
    const el = this.elReplay;
    if (!el || this.idx !== ACTS.length - 1) return;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
  }

  #stinger(text) {
    if (this.elGlobalGrabStat) this.elGlobalGrabStat.hidden = false;
    playMusicBoxStinger();
    this.elMsg.classList.add('stinger');
    this.elMsg.textContent = text;
    this.elMsg.style.opacity = '1';
    this.elHint.style.opacity = '1';
    this.elHint.textContent = '按住拖拽，自己再看一圈。';
    this.#hideReplayCue();
    this._replayTimer = setTimeout(() => {
      if (this.idx !== ACTS.length - 1) return;
      this.elHint.textContent = '风停在这儿。想再记一遍，就点下面。';
      this.#showReplayCue();
    }, 10000);
  }
}

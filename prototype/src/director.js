// ============================================================
// 幕导演：四幕 + 终幕的流程编排（分幕数据在 acts.js）
//
// 编排层只调稳定接口，不碰实现：
//   爪机  claw.controlEnabled / CONFIG.claw 参数 / collect 事件
//   画幅  FrameMask.setLayout / pulse
//   灯光  lights（四幕回暖、终幕转冷）
//   实景  hooks.onReveal（main 注入，内部怎么改都行）
// → 机器本体/爪子换 AI 生成资产时，本文件零改动。
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { ACTS, DEFAULT_HINT } from './acts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

export class Director {
  constructor({ mask, claw, rig, lights, hooks = {} }) {
    this.mask = mask;
    this.claw = claw;
    this.rig = rig;
    this.lights = lights;
    this.hooks = hooks;

    this.idx = -1;
    this.happened = new Set();   // 已到事件（防止 wait 注册前事件先到）
    this._waiter = null;
    this._skip = false;
    this._questDone = new Set();

    this.elMsg = document.getElementById('msg');
    this.elHint = document.getElementById('hint');
    this.elHud = document.getElementById('hud');
    this.elLabel = document.getElementById('actLabel');
    this.elStage = document.getElementById('stage');
    this.elFlash = document.getElementById('flash');
    this.elPanel = { left: document.getElementById('panelLeft'), right: document.getElementById('panelRight') };
  }

  get act() { return ACTS[this.idx]; }
  allow(what) { return this.act?.control?.[what] !== false; }

  // 外部事件入口（main 转发：collect / view）
  notify(event, payload) {
    this.happened.add(event);
    if (this._waiter?.event === event) { this._waiter.resolve(); this._waiter = null; }

    if (event === 'collect' && payload) {
      // 二幕首抓
      if (this.act?.id === 2 && !this.happened.has('firstCollect')) this.notify('firstCollect');
      // 三幕任务勾选 + 集齐白闪
      const q = this.act?.quest;
      if (q?.includes(payload.id) && !this._questDone.has(payload.id)) {
        this._questDone.add(payload.id);
        document.getElementById('q-' + payload.id)?.classList.add('done');
        if (q.every(id => this._questDone.has(id))) {
          this.mask.pulse('#fff', 160);          // 过曝白闪：记忆在美化现实
          setTimeout(() => this.notify('questComplete'), 700);
        }
      }
      // 三幕爪力衰减
      if (this.act?.tuning?.decayPerGrab)
        CONFIG.claw.gripStrength = Math.max(0.55, CONFIG.claw.gripStrength - this.act.tuning.decayPerGrab);
    }
    if (event === 'view' && payload) {
      this._viewsSeen ??= new Set(['front']);
      this._viewsSeen.add(payload);
      if (['left', 'front', 'right'].every(v => this._viewsSeen.has(v))) this.notify('allViews');
    }
  }

  skip() {   // 调试：跳幕（N 键 / 面板按钮）
    this._skip = true;
    if (this._waiter) { this._waiter.resolve(); this._waiter = null; }
  }

  start() { this.#enter(0); }

  // ---------------- 内部 ----------------

  async #enter(i) {
    this.idx = i;
    const act = this.act;
    if (!act) return;
    this._skip = false;
    this.happened = new Set();
    this._questDone = new Set();
    this._viewsSeen = null;

    this.mask.setLayout(act.layout, i > 0);
    if (act.framing) this.mask.setViewMode(act.framing);   // 缺省不写 = 沿用上一幕（保留玩家 V 键选择）
    this.rig?.setZoom(act.zoom ?? 1);
    this.claw.controlEnabled = !!(act.control.move || act.control.drop);
    if (act.tuning) {
      const { decayPerGrab, ...params } = act.tuning;
      Object.assign(CONFIG.claw, params);   // 幕间难度曲线
    }

    // HUD：仅任务幕显示
    this.elHud.style.display = act.quest ? 'block' : 'none';
    if (act.quest) for (const id of act.quest) document.getElementById('q-' + id)?.classList.remove('done');

    // 提示条
    this.elHint.style.opacity = act.hint === null ? '0' : '1';
    if (act.hint) this.elHint.textContent = act.hint;

    // 幕标题卡
    if (act.label) {
      this.elLabel.textContent = act.label;
      this.elLabel.classList.add('show');
      setTimeout(() => this.elLabel.classList.remove('show'), 2600);
    }

    // 面板清空（上一幕残留）
    this.#panel('left', ''); this.#panel('right', '');

    await sleep(400);
    await this.#run(act);
    if (ACTS[this.idx + 1]) this.#enter(this.idx + 1);
  }

  async #run(act) {
    for (const step of act.script) {
      if (this._skip) return;
      switch (step.type) {
        case 'sub':   await this.#sub(step); break;
        case 'panel': this.#panel(step.side, step.text); if (step.dur) await sleep(step.dur * 1000); break;
        case 'hint':  this.elHint.textContent = step.text; break;
        case 'wait':  await this.#waitFor(step.event); break;
        case 'synthesis': await this.#synthesis(act); break;
        case 'glitch': await this.#glitch(); break;
        case 'reveal': this.hooks.onReveal?.(); break;
        case 'stinger': this.#stinger(step.text); break;
      }
    }
  }

  #waitFor(event) {
    if (this.happened.has(event)) return Promise.resolve();
    return new Promise(resolve => (this._waiter = { event, resolve }));
  }

  msg(text) {   // 爪机台词也走这里
    this.elMsg.classList.remove('stinger');
    clearTimeout(this._msgTimer);
    clearInterval(this._typeTimer);
    this.elMsg.style.opacity = '1';
    // 打字机：>6 字的句子逐字出现（短提示瞬显，不拖节奏）
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
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text;
    el.classList.add('show');
  }

  // 四幕：合成演出（DOM 卡片 + 灯光回暖 + 颗粒减弱）
  async #synthesis(act) {
    const { key, glow } = this.lights;
    const warm = new THREE.Color(0xffc98f);
    const from = key.color.clone();
    const grain0 = CONFIG.post.grain;
    for (let i = 0; i <= 16; i++) {   // ~1.6s 色温渐升
      const t = i / 16;
      key.color.copy(from).lerp(warm, t);
      key.intensity = CONFIG.lights.key.intensity + 0.6 * t;
      glow.intensity = CONFIG.lights.glow.intensity + 7 * t;
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

  // 终幕：故障前兆 → 爆发 → 黑中切 16:9（灰盒版；正式版换 glitch shader）
  async #glitch() {
    const grain0 = CONFIG.post.grain;
    CONFIG.post.grain = 0.13;                    // 前兆：颗粒骤粗
    await sleep(1400);

    const t0 = Date.now();                       // 爆发 ~2s：错位 + 频闪
    while (Date.now() - t0 < 2000) {
      this.elStage.style.transform = `translate(${rand(-16, 16)}px, ${rand(-9, 9)}px)`;
      this.elStage.style.filter = `hue-rotate(${rand(-40, 40)}deg) contrast(${rand(1, 1.7)})`;
      this.elFlash.style.transition = 'none';
      this.elFlash.style.background = Math.random() < 0.5 ? '#000' : '#fff';
      this.elFlash.style.opacity = Math.random() < 0.3 ? '0.9' : '0';
      await sleep(80);
    }
    this.elStage.style.transform = '';
    this.elStage.style.filter = '';
    CONFIG.post.grain = grain0 * 0.4;            // 现实：颗粒退去大半

    this.elFlash.style.background = '#000';      // 黑中无动画展开 16:9 + 冷调
    this.elFlash.style.opacity = '1';
    await sleep(280);
    this.mask.setLayout('wide', false);
    this.hooks.onLightsCold?.();
    await sleep(700);
    this.elFlash.style.transition = 'opacity 1.4s';   // 缓慢亮起 = 梦醒
    this.elFlash.style.opacity = '0';
    await sleep(1400);
    this.elFlash.style.transition = '';
  }

  // 终幕手写体 + 八音盒彩蛋钩子
  #stinger(text) {
    this.elMsg.classList.add('stinger');
    this.elMsg.textContent = text;
    this.elMsg.style.opacity = '1';
    setTimeout(() => {
      this.elHint.style.opacity = '1';
      this.elHint.textContent = '（拖拽环视 · 点击继续）';
      const once = () => {
        window.removeEventListener('pointerdown', once);
        this.elHint.style.opacity = '0';
        this.elMsg.classList.remove('stinger');
        this.msg('……风里有一段走调的八音盒旋律。');
      };
      window.addEventListener('pointerdown', once);
    }, 5200);
  }
}

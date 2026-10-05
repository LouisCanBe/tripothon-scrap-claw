// 极简 Web Audio：无外部素材，终幕 glitch / reveal / 八音盒钩子
// AudioContext 仅在用户手势里创建/ resume，上货阶段只做 fetch + 静态 decode。
let ctx = null;
let unlockJob = null;

function ac() {
  return ctx;
}

function ensureAc() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

const pendingBytes = new Map();
const decodedCache = new Map();

function prefetchAudio(url) {
  if (pendingBytes.has(url)) return pendingBytes.get(url);
  const job = fetch(url, { cache: 'force-cache' })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
    .catch(() => fetch(url).then(r => (r.ok ? r.arrayBuffer() : null)))
    .catch(() => null);
  pendingBytes.set(url, job);
  return job;
}

const TYPE_TICK_URL = 'assets/audio/sfx_type_tick.wav';
const COIN_URL = 'assets/audio/sfx_coin.mp3';

// Kenney Impact Sounds（CC0）
const CLAW_SAMPLE = {
  open: 'assets/audio/claw-open.ogg',
  close: 'assets/audio/claw-close.ogg',
  thud: 'assets/audio/claw-thud.ogg',
};
const clawSample = {};

const BOOT_AUDIO_URLS = [
  CLAW_SAMPLE.open,
  CLAW_SAMPLE.close,
  CLAW_SAMPLE.thud,
  COIN_URL,
  TYPE_TICK_URL,
];

/** 上货期间：拉文件 + 尽量静态 decode（不创建 AudioContext） */
export function primeAudioFiles() {
  for (const url of BOOT_AUDIO_URLS) prefetchAudio(url);
  void primeAudioDecode();
}

/** 不建 AudioContext，用静态 decodeAudioData 预解码（支持则刷新后也快） */
export async function primeAudioDecode() {
  if (typeof AudioContext === 'undefined' || !AudioContext.decodeAudioData) return;
  const decode = AudioContext.decodeAudioData.bind(AudioContext);
  const urls = BOOT_AUDIO_URLS;
  for (const url of urls) {
    if (decodedCache.has(url)) continue;
    try {
      const raw = await prefetchAudio(url);
      if (!raw) continue;
      decodedCache.set(url, await decode(raw.slice(0)));
    } catch { /* unlock 时再解 */ }
  }
}

function mountDecodedSamples() {
  for (const [key, url] of Object.entries(CLAW_SAMPLE)) {
    const buf = decodedCache.get(url);
    if (buf) clawSample[key] = buf;
  }
  const coin = decodedCache.get(COIN_URL);
  if (coin) quotaCoin = coin;
  const tick = decodedCache.get(TYPE_TICK_URL);
  if (tick) typeTickBuf = tick;
}

async function decodeUrl(c, url) {
  const hit = decodedCache.get(url);
  if (hit) return hit;
  const raw = await prefetchAudio(url);
  if (!raw) return null;
  if (typeof AudioContext !== 'undefined' && AudioContext.decodeAudioData) {
    try {
      const buf = await AudioContext.decodeAudioData(raw.slice(0));
      decodedCache.set(url, buf);
      return buf;
    } catch { /* fall through */ }
  }
  if (!c) return null;
  const buf = await c.decodeAudioData(raw.slice(0));
  decodedCache.set(url, buf);
  return buf;
}

async function fillAllSamples(c) {
  await primeAudioDecode();
  mountDecodedSamples();
  for (const [key, url] of Object.entries(CLAW_SAMPLE)) {
    if (clawSample[key]) continue;
    try {
      const buf = await decodeUrl(c, url);
      if (buf) clawSample[key] = buf;
    } catch { /* keep fallback tones */ }
  }
  if (!quotaCoin) {
    try {
      const buf = await decodeUrl(c, COIN_URL);
      if (buf) quotaCoin = buf;
    } catch { quotaCoin = undefined; }
  }
  typeTickBuf = bakeTypeTickBuffer();
  try {
    const buf = decodedCache.get(TYPE_TICK_URL) ?? await decodeUrl(c, TYPE_TICK_URL);
    if (buf) typeTickBuf = buf;
  } catch { /* 保留烘焙缓冲 */ }
}

function runningCtx() {
  return ctx && ctx.state === 'running' ? ctx : null;
}

/** 播放前统一走这里：等 unlock + resume + 采样就绪 */
function withAudio(fn) {
  void unlockAudio().then(() => {
    const c = runningCtx();
    if (!c) return;
    try { fn(c); } catch (e) { console.warn('[audio] play', e); }
  });
}

/**
 * 须在点击手势的同一帧里调用。
 * resume() 必须先于任何 await，否则解码拖过手势窗口，整段音效（含打字）都会被浏览器静音。
 */
export function unlockAudio() {
  const c = ensureAc();
  const resumeP = c.state === 'suspended' ? c.resume() : Promise.resolve();
  if (!unlockJob) {
    unlockJob = resumeP
      .then(() => fillAllSamples(c))
      .catch((e) => {
        unlockJob = null;
        console.warn('[audio] samples', e);
      });
  }
  return resumeP;
}

/** 上货层 / 首次点屏解锁（同一手势只跑一次） */
export function installAudioUnlock(loadingEl) {
  let armed = false;
  const go = () => {
    if (armed) return;
    armed = true;
    void unlockAudio().then(() => loadingEl?.classList.add('audio-ready'));
  };
  loadingEl?.addEventListener('pointerdown', go, { capture: true });
  loadingEl?.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') go();
  });
  document.addEventListener('pointerdown', go, { once: true, capture: true });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') go();
  }, { once: true });
}

let typeTickBuf;

function bakeTypeTickBuffer() {
  const c = ensureAc();
  const len = Math.max(1, (c.sampleRate * 0.02) | 0);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.exp(-t * 16);
    d[i] = (Math.sin((2 * Math.PI * 108 * i) / c.sampleRate) * 0.55 + (Math.random() * 2 - 1) * 0.1) * env;
  }
  return buf;
}

let quotaCoin = undefined;

/** 抓到计入配额的一件：中小音量的投币声 */
export function playQuotaCoin() {
  withAudio((c) => {
    if (!quotaCoin) return;
    const src = c.createBufferSource();
    src.buffer = quotaCoin;
    const g = c.createGain();
    g.gain.value = 0.32;
    src.connect(g).connect(c.destination);
    src.start();
  });
}

function playClawSample(key, gain, fallback, { rate = 1, dur = 0.1 } = {}) {
  withAudio((c) => {
    const buf = clawSample[key];
    if (!buf) {
      fallback?.(c);
      return;
    }
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g).connect(c.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  });
}

function noiseBurst(c, { dur = 0.06, gain = 0.08, filterHz = 800 } = {}) {
  const len = Math.max(1, (c.sampleRate * dur) | 0);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = filterHz;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filt).connect(g).connect(c.destination);
  src.start();
}

/** @param {{ intensity?: number }} [opts] 0~1，随画幅展开加大 */
export function playGlitchTick({ intensity = 1 } = {}) {
  withAudio((c) => {
    const k = 0.35 + 0.65 * Math.min(1, Math.max(0, intensity));
    noiseBurst(c, {
      dur: 0.035 + Math.random() * 0.03,
      gain: 0.045 * k,
      filterHz: 900 + intensity * 2200 + Math.random() * 1400,
    });
  });
}

let _glitchBed = null;

function stopGlitchBed() {
  if (!_glitchBed) return;
  const { src, hum, gBed, gHum } = _glitchBed;
  try {
    const c = runningCtx();
    if (!c) return;
    const t = c.currentTime;
    gBed.gain.cancelScheduledValues(t);
    gHum.gain.cancelScheduledValues(t);
    gBed.gain.setValueAtTime(gBed.gain.value, t);
    gHum.gain.setValueAtTime(gHum.gain.value, t);
    gBed.gain.linearRampToValueAtTime(0, t + 0.35);
    gHum.gain.linearRampToValueAtTime(0, t + 0.35);
    src.stop(t + 0.4);
    hum.stop(t + 0.4);
  } catch { /* already stopped */ }
  _glitchBed = null;
}

/**
 * 终幕故障：底噪 + 嗡声随画幅展开爬升（与 director #glitch 时长对齐）
 * @param {{ morphMs?: number, glitchMs?: number }} opts
 */
export function startGlitchBed({ morphMs = 2800, glitchMs = 2200 } = {}) {
  withAudio((c) => {
  stopGlitchBed();
  const len = Math.max(1, (c.sampleRate * 2) | 0);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = 280;
  filt.Q.value = 0.7;
  const gBed = c.createGain();
  gBed.gain.value = 0;
  src.connect(filt).connect(gBed).connect(c.destination);
  src.start();

  const hum = c.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 38;
  const gHum = c.createGain();
  gHum.gain.value = 0;
  hum.connect(gHum).connect(c.destination);
  hum.start();

  const rampEnd = Math.min(morphMs, glitchMs) / 1000;
  const t0 = c.currentTime;
  gBed.gain.linearRampToValueAtTime(0.028, t0 + 0.25);
  gBed.gain.linearRampToValueAtTime(0.11, t0 + rampEnd);
  gHum.gain.linearRampToValueAtTime(0.008, t0 + 0.3);
  gHum.gain.linearRampToValueAtTime(0.032, t0 + rampEnd);

  _glitchBed = { src, hum, gBed, gHum, filt };
  });
}

/** 画幅展开进度 0~1，实时拧滤波与底噪亮度 */
export function setGlitchBedMorph(morphT) {
  if (!_glitchBed) return;
  const t = Math.min(1, Math.max(0, morphT));
  const c = runningCtx();
  if (!c) return;
  _glitchBed.hum.frequency.setTargetAtTime(34 + t * 52, c.currentTime, 0.08);
  _glitchBed.filt.frequency.setTargetAtTime(220 + t * 680, c.currentTime, 0.08);
  _glitchBed.gBed.gain.setTargetAtTime(0.09 + t * 0.05, c.currentTime, 0.06);
}

export function playGlitchBlackout() {
  withAudio((c) => {
  stopGlitchBed();
  noiseBurst(c, { dur: 0.12, gain: 0.14, filterHz: 180 });
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = 42;
  g.gain.setValueAtTime(0.12, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.36);
  });
}

export function endGlitchAudio() {
  stopGlitchBed();
}

export function playRevealDrone() {
  withAudio((c) => {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = 55;
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(0.04, c.currentTime + 1.2);
  g.gain.linearRampToValueAtTime(0.02, c.currentTime + 4);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 4.2);
  });
}

function tone(c, { freq = 440, type = 'sine', dur = 0.08, gain = 0.05, slide } = {}) {
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let _travel = null;
let _room = null;

function loopNoise(c, filterHz, q = 0.8) {
  if (!c) return null;
  const len = Math.max(1, (c.sampleRate * 1) | 0);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = filterHz;
  filt.Q.value = q;
  const g = c.createGain();
  g.gain.value = 0;
  src.connect(filt).connect(g).connect(c.destination);
  src.start();
  return { src, filt, g };
}

function fadeOutNode(node, seconds = 0.2) {
  if (!node) return;
  try {
    const c = runningCtx();
    if (!c) return;
    const t = c.currentTime;
    node.g.gain.cancelScheduledValues(t);
    node.g.gain.setValueAtTime(node.g.gain.value, t);
    node.g.gain.linearRampToValueAtTime(0, t + seconds);
    node.src.stop(t + seconds + 0.05);
  } catch { /* already stopped */ }
}

/** 按住移动时的低滚。amount 0 松开。 */
export function setClawTravel(amount) {
  const on = amount > 0.2;
  if (on && !_travel) {
    withAudio((c) => {
    if (_travel) return;
    const len = Math.max(1, (c.sampleRate * 1) | 0);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 420;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(filt).connect(g).connect(c.destination);
    src.start();
    g.gain.linearRampToValueAtTime(0.03, c.currentTime + 0.06);
    _travel = { src, g };
    });
  } else if (!on && _travel) {
    fadeOutNode(_travel, 0.1);
    _travel = null;
  }
}

export function playClawClose() {
  playClawSample('close', 0.46, (c) => tone(c, { freq: 140, type: 'sine', dur: 0.06, gain: 0.04 }), { rate: 1.08, dur: 0.09 });
}

export function playClawOpen() {
  playClawSample('open', 0.4, (c) => tone(c, { freq: 160, type: 'sine', dur: 0.05, gain: 0.035 }), { rate: 1.12, dur: 0.08 });
}

/** 落到奖池底：一下，不在下落过程里滑音 */
export function playClawThud() {
  playClawSample('thud', 0.44, (c) => tone(c, { freq: 78, type: 'sine', dur: 0.07, gain: 0.05 }), { rate: 1.05, dur: 0.1 });
}

export function playSlip() {
  playClawSample('open', 0.28, (c) => tone(c, { freq: 150, type: 'sine', dur: 0.05, gain: 0.03 }), { rate: 1.2, dur: 0.06 });
}

export function playFloorHit() {
  playClawSample('thud', 0.22, (c) => tone(c, { freq: 70, type: 'sine', dur: 0.06, gain: 0.04 }), { dur: 0.07 });
}

/** 落入出货口 */
export function playHoleDrop() {
  playClawSample('thud', 0.3, (c) => tone(c, { freq: 90, type: 'sine', dur: 0.07, gain: 0.04 }), { rate: 0.92, dur: 0.09 });
}

/** 字幕逐字：实时方波，不走文件解码（解码会拖过点击手势，整段静音） */
export function playTypeTick() {
  const c = ac();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(80 + Math.random() * 24, t);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1200;
  const g = c.createGain();
  g.gain.setValueAtTime(0.04, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.016);
  o.connect(filt).connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.018);
}

/** 字幕或操作提示落下时的一下打印头，很短，不连打 */
export function playPrinterTick() {
  withAudio((c) => {
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.028);
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(filt).connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.045);
  });
}

/** 相纸抽出 / 菜单翻开：闷一点的摩擦，不要高频噪声 */
export function playPaper() {
  withAudio((c) => {
  const dur = 0.28;
  const len = Math.max(1, (c.sampleRate * dur) | 0);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const fade = 1 - i / len;
    data[i] = (Math.random() * 2 - 1) * fade * fade;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  const t = c.currentTime;
  filt.frequency.setValueAtTime(900, t);
  filt.frequency.exponentialRampToValueAtTime(280, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.022, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t);
  });
}

/** 黑幕淡开后的房间底噪，很低，盖过突然的静音 */
export function startRoomReturn(seconds = 1.6) {
  withAudio((c) => {
  if (_room) fadeOutNode(_room, 0.2);
  _room = loopNoise(c, 220, 0.5);
  if (!_room) return;
  const t = c.currentTime;
  _room.g.gain.setValueAtTime(0, t);
  _room.g.gain.linearRampToValueAtTime(0.02, t + seconds);
  });
}

export function stopRoomReturn() {
  fadeOutNode(_room, 0.4);
  _room = null;
}

/** 走调八音盒三音（约 3s） */
export function playMusicBoxStinger() {
  withAudio((c) => {
  const notes = [523.25, 659.25, 783.99];
  const detune = 18;
  notes.forEach((freq, i) => {
    const t0 = c.currentTime + i * 0.95;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.detune.value = detune + (i - 1) * 7;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.07, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + 0.9);
  });
  });
}

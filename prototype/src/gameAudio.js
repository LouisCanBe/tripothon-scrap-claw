// 极简 Web Audio：无外部素材，终幕 glitch / reveal / 八音盒钩子
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (c.state === 'suspended') c.resume().catch(() => {});
  preloadClawSamples();
}

// Kenney Impact Sounds（CC0）：整包才有下载，这里只留开、合、落地三下金属。
const CLAW_SAMPLE = {
  open: 'assets/audio/claw-open.ogg',
  close: 'assets/audio/claw-close.ogg',
  thud: 'assets/audio/claw-thud.ogg',
};
const clawSample = {};

function preloadClawSamples() {
  const c = ac();
  for (const [key, url] of Object.entries(CLAW_SAMPLE)) {
    if (clawSample[key] || clawSample[key] === null) continue;
    clawSample[key] = null;
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(buf => c.decodeAudioData(buf))
      .then(audio => { clawSample[key] = audio; })
      .catch(() => { delete clawSample[key]; });
  }
}

function playClawSample(key, gain, fallback, { rate = 1, dur = 0.1 } = {}) {
  unlockAudio();
  const buf = clawSample[key];
  if (!buf) { fallback?.(); return; }
  const c = ac();
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
}

function noiseBurst({ dur = 0.06, gain = 0.08, filterHz = 800 } = {}) {
  const c = ac();
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
  unlockAudio();
  const k = 0.35 + 0.65 * Math.min(1, Math.max(0, intensity));
  noiseBurst({
    dur: 0.035 + Math.random() * 0.03,
    gain: 0.045 * k,
    filterHz: 900 + intensity * 2200 + Math.random() * 1400,
  });
}

let _glitchBed = null;

function stopGlitchBed() {
  if (!_glitchBed) return;
  const { src, hum, gBed, gHum } = _glitchBed;
  try {
    const c = ac();
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
  unlockAudio();
  stopGlitchBed();
  const c = ac();
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
}

/** 画幅展开进度 0~1，实时拧滤波与底噪亮度 */
export function setGlitchBedMorph(morphT) {
  if (!_glitchBed) return;
  const t = Math.min(1, Math.max(0, morphT));
  const c = ac();
  _glitchBed.hum.frequency.setTargetAtTime(34 + t * 52, c.currentTime, 0.08);
  _glitchBed.filt.frequency.setTargetAtTime(220 + t * 680, c.currentTime, 0.08);
  _glitchBed.gBed.gain.setTargetAtTime(0.09 + t * 0.05, c.currentTime, 0.06);
}

export function playGlitchBlackout() {
  unlockAudio();
  stopGlitchBed();
  const c = ac();
  noiseBurst({ dur: 0.12, gain: 0.14, filterHz: 180 });
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.value = 42;
  g.gain.setValueAtTime(0.12, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.36);
}

export function endGlitchAudio() {
  stopGlitchBed();
}

export function playRevealDrone() {
  unlockAudio();
  const c = ac();
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
}

function tone({ freq = 440, type = 'sine', dur = 0.08, gain = 0.05, slide } = {}) {
  const c = ac();
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

function loopNoise(filterHz, q = 0.8) {
  const c = ac();
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
    const c = ac();
    const t = c.currentTime;
    node.g.gain.cancelScheduledValues(t);
    node.g.gain.setValueAtTime(node.g.gain.value, t);
    node.g.gain.linearRampToValueAtTime(0, t + seconds);
    node.src.stop(t + seconds + 0.05);
  } catch { /* already stopped */ }
}

/** 按住移动时的低滚。amount 0 松开。 */
export function setClawTravel(amount) {
  unlockAudio();
  const on = amount > 0.2;
  if (on && !_travel) {
    const c = ac();
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
  } else if (!on && _travel) {
    fadeOutNode(_travel, 0.1);
    _travel = null;
  }
}

export function playClawClose() {
  playClawSample('close', 0.46, () => tone({ freq: 140, type: 'sine', dur: 0.06, gain: 0.04 }), { rate: 1.08, dur: 0.09 });
}

export function playClawOpen() {
  playClawSample('open', 0.4, () => tone({ freq: 160, type: 'sine', dur: 0.05, gain: 0.035 }), { rate: 1.12, dur: 0.08 });
}

/** 落到奖池底：一下，不在下落过程里滑音 */
export function playClawThud() {
  playClawSample('thud', 0.44, () => tone({ freq: 78, type: 'sine', dur: 0.07, gain: 0.05 }), { rate: 1.05, dur: 0.1 });
}

export function playSlip() {
  playClawSample('open', 0.28, () => tone({ freq: 150, type: 'sine', dur: 0.05, gain: 0.03 }), { rate: 1.2, dur: 0.06 });
}

export function playFloorHit() {
  playClawSample('thud', 0.22, () => tone({ freq: 70, type: 'sine', dur: 0.06, gain: 0.04 }), { dur: 0.07 });
}

/** 落入出货口 */
export function playHoleDrop() {
  playClawSample('thud', 0.3, () => tone({ freq: 90, type: 'sine', dur: 0.07, gain: 0.04 }), { rate: 0.92, dur: 0.09 });
}

/** 字幕逐字：很轻的一下，跟在每个字后面 */
export function playTypeTick() {
  unlockAudio();
  const c = ac();
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
  unlockAudio();
  const c = ac();
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
}

/** 相纸抽出 / 菜单翻开：闷一点的摩擦，不要高频噪声 */
export function playPaper() {
  unlockAudio();
  const c = ac();
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
}

/** 黑幕淡开后的房间底噪，很低，盖过突然的静音 */
export function startRoomReturn(seconds = 1.6) {
  unlockAudio();
  if (_room) fadeOutNode(_room, 0.2);
  _room = loopNoise(220, 0.5);
  const c = ac();
  const t = c.currentTime;
  _room.g.gain.setValueAtTime(0, t);
  _room.g.gain.linearRampToValueAtTime(0.02, t + seconds);
}

export function stopRoomReturn() {
  fadeOutNode(_room, 0.4);
  _room = null;
}

/** 走调八音盒三音（约 3s） */
export function playMusicBoxStinger() {
  unlockAudio();
  const c = ac();
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
}

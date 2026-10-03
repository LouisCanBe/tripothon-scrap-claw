// 极简 Web Audio：无外部素材，终幕 glitch / reveal / 八音盒钩子
let ctx = null;

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (c.state === 'suspended') c.resume().catch(() => {});
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

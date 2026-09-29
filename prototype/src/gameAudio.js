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

export function playGlitchTick() {
  unlockAudio();
  noiseBurst({ dur: 0.04, gain: 0.06, filterHz: 1200 + Math.random() * 2000 });
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

// js/audio.js — Web Audio 合成警示音

let ctx = null;
let enabled = true;

function ensureCtx() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('[audio] AudioContext unavailable', e);
    }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setEnabled(on) { enabled = !!on; }
export function isEnabled() { return enabled; }

function tone({ freq = 880, type = 'square', dur = 0.12, gain = 0.08, attack = 0.005, release = 0.06, when = 0 }) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + attack);
  g.gain.setValueAtTime(gain, t0 + dur - release);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sweep({ from = 220, to = 1200, dur = 0.25, type = 'sawtooth', gain = 0.06, when = 0 }) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// 漲: 上揚雙嗶
export function alertUp() {
  if (!enabled) return;
  tone({ freq: 880, dur: 0.08, gain: 0.07 });
  tone({ freq: 1320, dur: 0.1, gain: 0.07, when: 0.1 });
  sweep({ from: 660, to: 1760, dur: 0.18, gain: 0.04, when: 0.05 });
}

// 跌: 下降雙嗶
export function alertDown() {
  if (!enabled) return;
  tone({ freq: 660, dur: 0.08, gain: 0.07, type: 'sawtooth' });
  tone({ freq: 330, dur: 0.12, gain: 0.07, type: 'sawtooth', when: 0.1 });
  sweep({ from: 1200, to: 200, dur: 0.22, gain: 0.04, when: 0.05 });
}

// 維持率警戒: 急促重複
export function alertWarning() {
  if (!enabled) return;
  for (let i = 0; i < 4; i++) {
    tone({ freq: 1200, dur: 0.06, gain: 0.08, when: i * 0.1 });
  }
}

// 介面點擊 - 細微回饋
export function blip() {
  if (!enabled) return;
  tone({ freq: 1800, dur: 0.04, gain: 0.03, type: 'sine' });
}

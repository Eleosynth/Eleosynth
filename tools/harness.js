// Loads the AudioWorklet engine in Node with tiny shims so the DSP can be measured offline.
'use strict';
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');

function load(sr = 48000) {
  const procs = {};
  const g = { sampleRate: sr, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => { (this.port.sent = this.port.sent || []).push(m); }, onmessage: null }; } }, registerProcessor: (n, c) => { procs[n] = c; } };
  const code = fs.readFileSync(path.join(SRC, 'worklet.js'), 'utf8');
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', code)(g.sampleRate, g.AudioWorkletProcessor, g.registerProcessor);
  const ctx = {};
  new Function('ctx', fs.readFileSync(path.join(SRC, 'tables.js'), 'utf8') + ';' + fs.readFileSync(path.join(SRC, 'sources.js'), 'utf8') + ';ctx.WT=WT;ctx.SRC=SRC;')(ctx);
  const eng = new procs['eleo-engine']();
  const send = (m) => eng.port.onmessage({ data: m });
  return { eng, send, WT: ctx.WT, SRCS: ctx.SRC, sr };
}

function render(E, seconds, input) {
  const n = Math.floor(seconds * E.sr / 128) * 128, L = new Float32Array(n), R = new Float32Array(n);
  const oL = new Float32Array(128), oR = new Float32Array(128), inb = new Float32Array(128);
  for (let o = 0; o < n; o += 128) {
    if (input) for (let i = 0; i < 128; i++) inb[i] = input[(o + i) % input.length] || 0;
    E.eng.process([input ? [inb] : []], [[oL, oR]]);
    L.set(oL, o); R.set(oR, o);
  }
  return { L, R };
}

function pitchOf(x, sr, from = 0.2, len = 0.5) { // interpolated rising zero crossings, first to last
  const a = Math.floor(from * sr), N = Math.floor(len * sr); let first = -1, last = -1, cnt = 0;
  for (let i = a + 1; i < a + N; i++) if (x[i - 1] < 0 && x[i] >= 0) { const t = i - 1 + (-x[i - 1]) / (x[i] - x[i - 1]); if (first < 0) first = t; else { last = t; cnt++; } }
  return cnt ? sr * cnt / (last - first) : 0;
}
function stats(x) { let pk = 0, ss = 0, nan = 0; for (const v of x) { if (v !== v) nan++; else { pk = Math.max(pk, Math.abs(v)); ss += v * v; } } return { pk, rms: Math.sqrt(ss / x.length), nan }; }
const db = v => (20 * Math.log10(v + 1e-12)).toFixed(1);

module.exports = { load, render, pitchOf, stats, db };

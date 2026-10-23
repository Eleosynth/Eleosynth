// SPDX-License-Identifier: GPL-3.0-or-later
// Eleosynth — DSP engine (AudioWorklet). Part of the DAWters and Son suite.
// Copyright (C) 2026 Josh Wilk.
//
// One processor, "eleo-engine": guitar in (input 0) -> pedal chain, plus a
// wavetable / virtual-analog / granular synth, mixed to a stereo output.
// Everything is plain JavaScript; there are no network requests.
'use strict';

const SR = sampleRate;
const TAU = Math.PI * 2;
const TN = 2048, TMASK = 2047, MIPS = 11;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function ftanh(x) { if (x > 3) return 1; if (x < -3) return -1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }
function dbToGain(d) { return Math.pow(10, d / 20); }
function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

let rngState = 0x12345678;
function rnd() { // xorshift32, 0..1
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return (rngState >>> 0) / 4294967296;
}
function brnd() { return rnd() * 2 - 1; }

// Hann window lookup
const HANN = new Float32Array(1025);
for (let i = 0; i <= 1024; i++) HANN[i] = 0.5 - 0.5 * Math.cos(TAU * i / 1024);

// ---------------------------------------------------------------- building blocks
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, db) {
    f = clamp(f, 5, SR * 0.49); q = Math.max(q || 0.707, 0.05);
    const w = TAU * f / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q);
    const A = Math.pow(10, (db || 0) / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'peak': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
      case 'ls': { const s = 2 * Math.sqrt(A) * al;
        b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
        a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'hs': { const s = 2 * Math.sqrt(A) * al;
        b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
        a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      default: b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  reset() { this.z1 = this.z2 = 0; }
}

class Delay {
  constructor(sec) { let s = 4; const need = Math.ceil(sec * SR) + 8; while (s < need) s <<= 1; this.b = new Float32Array(s); this.m = s - 1; this.w = 0; }
  write(x) { this.b[this.w] = x; this.w = (this.w + 1) & this.m; }
  read(d) { // d samples behind the newest written sample (d >= 0)
    const p = this.w - 1 - d; const i = Math.floor(p); const f = p - i;
    const a = this.b[i & this.m], b = this.b[(i + 1) & this.m];
    return a + (b - a) * f;
  }
  clear() { this.b.fill(0); }
}

class Follower { // peak envelope follower
  constructor(attMs, relMs) { this.v = 0; this.set(attMs, relMs); }
  set(a, r) { this.a = 1 - Math.exp(-1 / (a * 0.001 * SR)); this.r = 1 - Math.exp(-1 / (r * 0.001 * SR)); }
  run(x) { x = x < 0 ? -x : x; this.v += (x - this.v) * (x > this.v ? this.a : this.r); return this.v; }
}

// 2x oversampler (windowed-sinc halfband FIR), for the clipping stages
const OS_TAPS = (() => {
  const N = 31, h = new Float32Array(N), c = (N - 1) / 2;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const x = i - c, s = x === 0 ? 0.5 : Math.sin(Math.PI * x * 0.5) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos(TAU * i / (N - 1)) + 0.08 * Math.cos(2 * TAU * i / (N - 1));
    h[i] = s * w; sum += h[i];
  }
  for (let i = 0; i < N; i++) h[i] /= sum;
  return h;
})();
class OS2 {
  constructor() { this.u = new Float32Array(64); this.ui = 0; this.d = new Float32Array(64); this.di = 0; }
  // upsample x -> [y0, y1]
  up(x, o) {
    this.u[this.ui] = x; this.u[this.ui + 32] = x; // mirrored ring for contiguous reads
    const base = this.ui + 32; let y0 = 0, y1 = 0; const h = OS_TAPS;
    // zero-stuffed signal: even taps hit current/older samples for phase 0, odd taps for phase 1
    for (let k = 0; k < 16; k++) { const s = this.u[base - k]; y0 += h[2 * k] * s; if (k < 15) y1 += h[2 * k + 1] * s; }
    this.ui = (this.ui + 1) & 31;
    o[0] = y1 * 2; o[1] = y0 * 2; // ordering keeps causality: odd phase first
  }
  down(a, b) {
    this.d[this.di] = a; this.d[this.di + 32] = a; this.di = (this.di + 1) & 31;
    this.d[this.di] = b; this.d[this.di + 32] = b;
    const base = this.di + 32; let y = 0; const h = OS_TAPS;
    for (let k = 0; k < 31; k++) y += h[k] * this.d[base - k];
    this.di = (this.di + 1) & 31;
    return y;
  }
}

// Delay-line pitch shifter (two crossfaded taps)
class Shifter {
  constructor(winMs) { this.dl = new Delay(0.25); this.win = Math.round((winMs || 60) * 0.001 * SR); this.ph = 0; this.ratio = 1; }
  run(x) {
    this.dl.write(x);
    const W = this.win; this.ph += (1 - this.ratio); if (this.ph >= W) this.ph -= W; if (this.ph < 0) this.ph += W;
    const d1 = this.ph, d2 = (this.ph + W * 0.5) % W;
    const g1 = HANN[Math.floor(d1 / W * 1024)], g2 = HANN[Math.floor(d2 / W * 1024)];
    return this.dl.read(d1 + 2) * g1 + this.dl.read(d2 + 2) * g2;
  }
}

function lfoShape(shape, ph) { // ph 0..1 -> -1..1
  switch (shape) {
    case 1: return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;   // triangle
    case 2: return ph * 2 - 1;                          // saw up
    case 3: return 1 - ph * 2;                          // saw down
    case 4: return ph < 0.5 ? 1 : -1;                   // square
    default: return Math.sin(TAU * ph);                 // sine
  }
}
const SYNC_BEATS = [0, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 2 / 3, 1 / 3, 1 / 6, 1.5, 0.75, 0.375];
// 0 off, 4/1, 2/1, 1/1, 1/2, 1/4, 1/8, 1/16, 1/32, 1/4T, 1/8T, 1/16T, 1/4D, 1/8D, 1/16D
const DLY_BEATS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 4];
// 1/32, 1/16T, 1/16, 1/16D, 1/8T, 1/8, 1/8D, 1/4T, 1/4, 1/4D, 1/2, 1/1

// ---------------------------------------------------------------- effects / pedals
// Every unit: setParams(p, bpm) and process(L, R, n, stereo) -> stereo out?
// Mono units keep two channel states and only run R when the signal is already stereo.

class Gate {
  constructor() { this.f = new Follower(0.5, 30); this.g = 0; this.hold = 0; }
  setParams(p) { this.thr = dbToGain(p.thresh); this.rel = 1 - Math.exp(-1 / (p.release * 0.001 * SR)); this.att = 1 - Math.exp(-1 / (0.0008 * SR)); }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      const e = this.f.run(st ? Math.max(Math.abs(L[i]), Math.abs(R[i])) : L[i]);
      if (e > this.thr) this.hold = SR * 0.02; else if (this.hold > 0) this.hold--;
      const t = (e > this.thr * 0.5 && this.hold > 0) ? 1 : 0;
      this.g += (t - this.g) * (t > this.g ? this.att : this.rel);
      L[i] *= this.g; if (st) R[i] *= this.g;
    }
    return st;
  }
}

class Comp {
  constructor() { this.env = 0; }
  setParams(p) {
    this.thr = -8 - p.sustain * 38; this.ratio = 3 + p.sustain * 9;
    this.att = 1 - Math.exp(-1 / (p.attack * 0.001 * SR)); this.rel = 1 - Math.exp(-1 / (0.18 * SR));
    this.make = dbToGain(-this.thr * (1 - 1 / this.ratio) * 0.6 + p.level); this.blend = p.blend;
  }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      const x = st ? Math.max(Math.abs(L[i]), Math.abs(R[i])) : Math.abs(L[i]);
      this.env += (x - this.env) * (x > this.env ? this.att : this.rel);
      const db = 20 * Math.log10(this.env + 1e-9);
      const over = db - this.thr; const gr = over > 0 ? -over * (1 - 1 / this.ratio) : 0;
      const g = dbToGain(gr) * this.make, w = this.blend, d = 1 - w;
      L[i] = L[i] * (d + w * g); if (st) R[i] = R[i] * (d + w * g);
    }
    this.gr = this.env;
    return st;
  }
}

class Boost {
  constructor() { this.lo = [new Biquad(), new Biquad()]; this.hi = [new Biquad(), new Biquad()]; }
  setParams(p) { this.g = dbToGain(p.gain); for (const b of this.lo) b.set('ls', 160, 0.7, -p.tone * 6); for (const b of this.hi) b.set('hs', 2500, 0.7, p.tone * 6); }
  process(L, R, n, st) {
    for (let c = 0; c < (st ? 2 : 1); c++) {
      const X = c ? R : L, lo = this.lo[c], hi = this.hi[c], g = this.g;
      for (let i = 0; i < n; i++) { const y = hi.run(lo.run(X[i])) * g; X[i] = y > 1 || y < -1 ? ftanh(y) : y; }
    }
    return st;
  }
}

class Drive { // "Crema Drive": mid-hump overdrive, clip path oversampled
  constructor() { this.ch = [0, 1].map(() => ({ hp: new Biquad(), lp: new Biquad(), lp2: new Biquad(), os: new OS2() })); this.o = new Float32Array(2); }
  setParams(p) {
    this.g = 2 + p.drive * p.drive * 120; this.lvl = dbToGain(p.level);
    for (const c of this.ch) { c.hp.set('hp', 720, 0.6); c.lp.set('lp', 800 + p.tone * p.tone * 6200, 0.6); c.lp2.set('lp', 9000, 0.7); }
  }
  process(L, R, n, st) {
    const o = this.o;
    for (let k = 0; k < (st ? 2 : 1); k++) {
      const X = k ? R : L, c = this.ch[k], g = this.g;
      for (let i = 0; i < n; i++) {
        const x = X[i], h = c.hp.run(x) * g;
        c.os.up(h, o);
        const a = ftanh(o[0] + 0.08) - 0.08, b = ftanh(o[1] + 0.08) - 0.08;
        const cl = c.os.down(a, b);
        X[i] = c.lp.run(c.lp2.run(x * 0.6 + cl * 0.55)) * this.lvl;
      }
    }
    return st;
  }
}

class Fuzz { // "Burnt Fuzz": asymmetric hard fuzz, starve, octave, scooped tone
  constructor() { this.ch = [0, 1].map(() => ({ hpIn: new Biquad(), lp: new Biquad(), hp: new Biquad(), os: new OS2(), f: new Follower(1, 60), dc: 0 })); this.o = new Float32Array(2); }
  setParams(p) {
    this.g = 8 + p.fuzz * p.fuzz * 400; this.oct = p.octave; this.bias = p.gate * 0.6; this.tone = p.tone; this.lvl = dbToGain(p.level);
    for (const c of this.ch) { c.hpIn.set('hp', 90, 0.7); c.lp.set('lp', 650, 0.6); c.hp.set('hp', 1100, 0.6); }
  }
  process(L, R, n, st) {
    const o = this.o;
    for (let k = 0; k < (st ? 2 : 1); k++) {
      const X = k ? R : L, c = this.ch[k];
      for (let i = 0; i < n; i++) {
        let x = c.hpIn.run(X[i]);
        const e = c.f.run(x);
        if (this.oct > 0) x = x * (1 - this.oct) + Math.abs(x) * this.oct * 1.6;
        const starve = this.bias * (1 - clamp(e * 8, 0, 1));
        c.os.up(x * this.g, o);
        const a = clamp(ftanh(o[0] * 0.6 + 0.15) - starve, -0.85, 0.95), b = clamp(ftanh(o[1] * 0.6 + 0.15) - starve, -0.85, 0.95);
        let y = c.os.down(a, b);
        c.dc += (y - c.dc) * 0.0005; y -= c.dc;
        const lo = c.lp.run(y), hi = c.hp.run(y);
        X[i] = (lo * (1 - this.tone) + hi * this.tone) * 0.8 * this.lvl;
      }
    }
    return st;
  }
}

class Octaver { // analog-style divider (sub) + rectifier (up)
  constructor() { this.lp1 = new Biquad(); this.lp2 = new Biquad(); this.sl = new Biquad(); this.uhp = new Biquad(); this.f = new Follower(2, 50); this.ff = 1; this.prev = 0; this.arm = true; }
  setParams(p) { this.sub = p.sub; this.upm = p.up; this.dry = p.dry; this.lp1.set('lp', 380, 0.7); this.lp2.set('lp', 380, 0.7); this.sl.set('lp', 900, 0.7); this.uhp.set('hp', 120, 0.7); }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      const x = st ? (L[i] + R[i]) * 0.5 : L[i];
      const e = this.f.run(x), y = this.lp2.run(this.lp1.run(x));
      const h = e * 0.08;
      if (this.arm && y > h) { this.ff = -this.ff; this.arm = false; } else if (y < -h) this.arm = true;
      const sub = this.sl.run(this.ff * e * 1.4);
      const up = this.uhp.run(Math.abs(x) * 1.5);
      const o = x * this.dry + sub * this.sub + up * this.upm;
      L[i] = o; if (st) R[i] = o;
    }
    return st;
  }
}

class Pitch {
  constructor() { this.s = [new Shifter(55), new Shifter(55)]; }
  setParams(p) { const r = Math.pow(2, p.interval / 12); this.s[0].ratio = r; this.s[1].ratio = r * Math.pow(2, p.detune / 1200); this.mix = p.mix; }
  process(L, R, n, st) {
    const w = this.mix, d = w < 0.5 ? 1 : 2 * (1 - w), g = w < 0.5 ? 2 * w : 1;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = st ? R[i] : xl;
      const a = this.s[0].run(xl), b = this.s[1].run(xr);
      L[i] = xl * d + a * g; R[i] = xr * d + b * g;
    }
    return true;
  }
}

class EnvFilter {
  constructor() { this.f = new Follower(2, 90); this.s = [{ a: 0, b: 0 }, { a: 0, b: 0 }]; }
  setParams(p) { this.sens = p.sens; this.range = p.range; this.q = p.q; this.mode = p.mode; this.dir = p.dir; this.mix = p.mix; }
  process(L, R, n, st) {
    const k = 2 - 2 * (0.3 + this.q * 0.68);
    for (let i = 0; i < n; i++) {
      const xi = st ? (L[i] + R[i]) * 0.5 : L[i];
      let e = clamp(this.f.run(xi) * (2 + this.sens * 40), 0, 1);
      if (this.dir) e = 1 - e;
      const fc = 180 * Math.pow(2, this.range * 6.2 * e);
      const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      for (let c = 0; c < (st ? 2 : 1); c++) {
        const X = c ? R : L, s = this.s[c], v0 = X[i];
        const v3 = v0 - s.b, v1 = a1 * s.a + a2 * v3, v2 = s.b + a2 * s.a + a3 * v3;
        s.a = 2 * v1 - s.a; s.b = 2 * v2 - s.b;
        const y = this.mode ? v1 * 1.6 : v2;
        X[i] = v0 * (1 - this.mix) + y * this.mix;
      }
    }
    return st;
  }
}

const AMP_MODELS = [ // gain range, stages, bright
  { g: 2.5, s: 1, pre: 0.6 }, { g: 14, s: 1, pre: 1 }, { g: 60, s: 2, pre: 1.2 }, { g: 6, s: 1, pre: 0.5 }];
class Amp {
  constructor() {
    this.ch = [0, 1].map(() => ({ hp: new Biquad(), b: new Biquad(), m: new Biquad(), t: new Biquad(), pr: new Biquad(), os: new OS2(), cab: [0, 1, 2, 3, 4].map(() => new Biquad()) }));
    this.o = new Float32Array(2);
  }
  setParams(p) {
    const M = AMP_MODELS[p.model | 0] || AMP_MODELS[0]; this.M = M;
    this.g = 1 + p.gain * p.gain * M.g; this.master = 0.3 + p.master * 1.6; this.cabOn = (p.cab | 0) > 0; this.lvl = dbToGain(p.level || 0);
    for (const c of this.ch) {
      c.hp.set('hp', p.model == 3 ? 40 : 90, 0.7);
      c.b.set('ls', 120, 0.7, (p.bass - 0.5) * 18); c.m.set('peak', p.model == 3 ? 500 : 750, 0.8, (p.mid - 0.5) * 16);
      c.t.set('hs', 2600, 0.7, (p.treble - 0.5) * 18); c.pr.set('hs', 5000, 0.7, (p.presence - 0.5) * 10);
      const cab = p.cab | 0, C = c.cab;
      if (cab === 1) { C[0].set('hp', 85, 0.8); C[1].set('peak', 130, 1.2, 3); C[2].set('peak', 2200, 1.5, 3); C[3].set('lp', 5600, 0.8); C[4].set('lp', 6500, 0.6); }
      else if (cab === 2) { C[0].set('hp', 75, 0.8); C[1].set('peak', 110, 1.1, 4); C[2].set('peak', 1500, 1.2, -3); C[3].set('lp', 4800, 0.9); C[4].set('lp', 5600, 0.6); }
      else if (cab === 3) { C[0].set('hp', 70, 1.0); C[1].set('peak', 100, 1.3, 5); C[2].set('peak', 2500, 1.4, 3); C[3].set('lp', 4200, 1.0); C[4].set('lp', 5000, 0.7); }
      else if (cab === 4) { C[0].set('hp', 45, 0.8); C[1].set('peak', 80, 1.0, 4); C[2].set('peak', 900, 1.0, -2); C[3].set('lp', 3200, 0.8); C[4].set('lp', 4500, 0.6); }
    }
  }
  process(L, R, n, st) {
    const o = this.o, M = this.M;
    for (let k = 0; k < (st ? 2 : 1); k++) {
      const X = k ? R : L, c = this.ch[k];
      for (let i = 0; i < n; i++) {
        let x = c.hp.run(X[i]) * this.g * M.pre;
        c.os.up(x, o);
        let a = ftanh(o[0] + 0.1) - 0.0997, b = ftanh(o[1] + 0.1) - 0.0997;
        if (M.s > 1) { a = ftanh(a * 3.5 - 0.05); b = ftanh(b * 3.5 - 0.05); }
        x = c.os.down(a, b);
        x = c.pr.run(c.t.run(c.m.run(c.b.run(x))));
        x = ftanh(x * this.master) * 0.7;
        if (this.cabOn) { const C = c.cab; x = C[4].run(C[3].run(C[2].run(C[1].run(C[0].run(x))))) * 1.2; }
        X[i] = x * this.lvl;
      }
    }
    return st;
  }
}

class EQ4 {
  constructor() { this.ch = [0, 1].map(() => [0, 1, 2, 3].map(() => new Biquad())); }
  setParams(p) { this.lv = dbToGain(p.level); for (const b of this.ch) { b[0].set('ls', 100, 0.7, p.low); b[1].set('peak', 400, 1, p.lowmid); b[2].set('peak', 1800, 1, p.himid); b[3].set('hs', 6000, 0.7, p.high); } }
  process(L, R, n, st) {
    for (let c = 0; c < (st ? 2 : 1); c++) { const X = c ? R : L, b = this.ch[c]; for (let i = 0; i < n; i++) X[i] = b[3].run(b[2].run(b[1].run(b[0].run(X[i])))) * this.lv; }
    return st;
  }
}

class Chorus {
  constructor() { this.dl = [new Delay(0.06), new Delay(0.06)]; this.ph = 0; }
  setParams(p) { this.rate = p.rate; this.depth = p.depth; this.mix = p.mix; this.mode = p.mode | 0; }
  process(L, R, n, st) {
    const inc = this.rate / SR, D = this.depth * 0.0045 * SR, base = (this.mode === 1 ? 0.006 : 0.011) * SR;
    const w = this.mix, dry = 1 - w * 0.5, wet = w * 0.9;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = st ? R[i] : xl;
      this.dl[0].write(xl); this.dl[1].write(xr);
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      let wl, wr;
      if (this.mode === 2) { // tri-voice
        const a = this.dl[0].read(base + D * (1 + Math.sin(TAU * this.ph))), b = this.dl[0].read(base + D * (1 + Math.sin(TAU * (this.ph + 1 / 3)))), c = this.dl[1].read(base + D * (1 + Math.sin(TAU * (this.ph + 2 / 3))));
        wl = a * 0.8 + b * 0.5; wr = c * 0.8 + b * 0.5;
      } else if (this.mode === 1) { // dimension: both voices to both sides, anti-phase
        const m1 = Math.sin(TAU * this.ph), a = this.dl[0].read(base + D * (1 + m1)), b = this.dl[1].read(base + D * (1 - m1));
        wl = a * 0.75 - b * 0.35; wr = b * 0.75 - a * 0.35;
      } else {
        wl = this.dl[0].read(base + D * (1 + Math.sin(TAU * this.ph)));
        wr = this.dl[1].read(base + D * (1 + Math.sin(TAU * (this.ph + 0.25))));
      }
      L[i] = xl * dry + wl * wet; R[i] = xr * dry + wr * wet;
    }
    return true;
  }
}

class Phaser {
  constructor() { this.s = [new Float32Array(12), new Float32Array(12)]; this.fb = [0, 0]; this.ph = 0; }
  setParams(p) { this.rate = p.rate; this.depth = p.depth; this.fbk = p.fb; this.stages = p.stages | 0 || 6; this.mix = p.mix; }
  process(L, R, n, st) {
    const inc = this.rate / SR, N = this.stages;
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      for (let c = 0; c < 2; c++) {
        const x = c && st ? R[i] : L[i];
        const m = 0.5 + 0.5 * Math.sin(TAU * (this.ph + c * 0.25));
        const f = 160 * Math.pow(2, this.depth * 5.5 * m);
        const t = Math.tan(Math.PI * Math.min(f, SR * 0.45) / SR), a = (t - 1) / (t + 1);
        let y = x + this.fb[c] * this.fbk; const S = this.s[c];
        for (let k = 0; k < N; k++) { const o = a * y + S[k]; S[k] = y - a * o; y = o; }
        this.fb[c] = y;
        const out = x * (1 - this.mix * 0.5) + y * this.mix * 0.5 * 2 * 0.5;
        if (c) R[i] = out; else L[i] = out;
      }
    }
    return true;
  }
}

class Flanger {
  constructor() { this.dl = [new Delay(0.03), new Delay(0.03)]; this.y = [0, 0]; this.ph = 0; }
  setParams(p) { this.rate = p.rate; this.depth = p.depth; this.man = p.manual; this.fb = p.fb; this.mix = p.mix; }
  process(L, R, n, st) {
    const inc = this.rate / SR;
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      for (let c = 0; c < 2; c++) {
        const x = c && st ? R[i] : L[i], m = 0.5 + 0.5 * Math.sin(TAU * (this.ph + c * 0.18));
        const d = (0.0004 + this.man * 0.005 + this.depth * 0.004 * m) * SR;
        const dl = this.dl[c]; dl.write(x + this.y[c] * this.fb);
        const y = dl.read(d); this.y[c] = y;
        const o = x * (1 - this.mix * 0.5) + y * this.mix * 0.7;
        if (c) R[i] = o; else L[i] = o;
      }
    }
    return true;
  }
}

class Trem {
  constructor() { this.ph = 0; this.sm = 1; this.smr = 1; }
  setParams(p, bpm) { this.rate = p.sync > 0 ? (bpm / 60) / SYNC_BEATS[p.sync] : p.rate; this.depth = p.depth; this.shape = p.shape | 0; this.stereo = p.stereo; }
  process(L, R, n, st) {
    const inc = this.rate / SR, a = 1 - Math.exp(-1 / (0.002 * SR));
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      const m = 0.5 + 0.5 * lfoShape(this.shape, this.ph);
      const tl = 1 - this.depth * m, tr = 1 - this.depth * (this.stereo * (1 - m) + (1 - this.stereo) * m);
      this.sm += (tl - this.sm) * a; this.smr += (tr - this.smr) * a;
      const xl = L[i], xr = st ? R[i] : xl;
      L[i] = xl * this.sm; R[i] = xr * this.smr;
    }
    return true;
  }
}

class Cassette {
  constructor() { this.dl = [new Delay(0.05), new Delay(0.05)]; this.lp = [new Biquad(), new Biquad()]; this.hp = [new Biquad(), new Biquad()]; this.ph = 0; this.fph = 0; this.rw = 0; this.rt = 0; }
  setParams(p) { this.wow = p.wow; this.flut = p.flutter; this.hiss = p.hiss; this.sat = 1 + p.age * 2.5; for (let c = 0; c < 2; c++) { this.lp[c].set('lp', 16000 - p.age * 12500, 0.6); this.hp[c].set('hp', 30 + p.age * 110, 0.6); } }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      this.ph += 0.55 / SR; if (this.ph >= 1) this.ph -= 1;
      this.fph += 6.8 / SR; if (this.fph >= 1) this.fph -= 1;
      if (--this.rt <= 0) { this.rt = SR * 0.08; this.rwT = brnd(); }
      this.rw += ((this.rwT || 0) - this.rw) * 0.0003;
      const mod = (0.004 + this.wow * 0.0028 * (Math.sin(TAU * this.ph) + 0.5 * this.rw) + this.flut * 0.00025 * Math.sin(TAU * this.fph)) * SR;
      for (let c = 0; c < 2; c++) {
        const x = c && st ? R[i] : L[i];
        this.dl[c].write(x);
        let y = this.dl[c].read(mod);
        y = ftanh(y * this.sat) / this.sat * 1.15;
        y = this.lp[c].run(this.hp[c].run(y)) + brnd() * this.hiss * 0.012;
        if (c) R[i] = y; else L[i] = y;
      }
    }
    return true;
  }
}

class Swell {
  constructor() { this.f = new Follower(1, 40); this.g = 0; this.quiet = 0; this.rising = false; }
  setParams(p) { this.rise = Math.max(0.03, p.rise * 0.001); this.thr = dbToGain(-60 + p.sens * 40); }
  process(L, R, n, st) {
    const up = 1 / (this.rise * SR), down = 1 - Math.exp(-1 / (0.06 * SR));
    for (let i = 0; i < n; i++) {
      const e = this.f.run(st ? (L[i] + R[i]) * 0.5 : L[i]);
      if (e < this.thr) { this.quiet++; if (this.quiet > SR * 0.03) { this.g += (0 - this.g) * down; this.rising = false; } }
      else { if (this.quiet > SR * 0.03) this.rising = true; this.quiet = 0; }
      if (this.rising || e >= this.thr) { this.g = Math.min(1, this.g + up); }
      const g = this.g * this.g * (3 - 2 * this.g);
      L[i] *= g; if (st) R[i] *= g;
    }
    return st;
  }
}

class EchoDelay {
  constructor() { this.dl = [new Delay(2.6), new Delay(2.6)]; this.lp = [new Biquad(), new Biquad()]; this.hp = [new Biquad(), new Biquad()]; this.ph = 0; this.cur = [0, 0]; }
  setParams(p, bpm) {
    const t = p.sync > 0 ? (60 / bpm) * DLY_BEATS[p.sync - 1] : p.time * 0.001;
    this.tL = clamp(t, 0.005, 2.5) * SR; this.tR = (p.mode == 3 ? clamp(t * 1.5, 0.005, 2.5) : clamp(t, 0.005, 2.5)) * SR;
    this.fb = p.fb; this.mix = p.mix; this.mode = p.mode | 0; this.wow = p.wow;
    for (let c = 0; c < 2; c++) { this.lp[c].set('lp', 1500 + p.tone * p.tone * 14000, 0.6); this.hp[c].set('hp', 80, 0.6); }
    if (!this.cur[0]) { this.cur[0] = this.tL; this.cur[1] = this.tR; }
  }
  process(L, R, n, st) {
    const w = this.mix, dry = w < 0.5 ? 1 : 2 * (1 - w), wet = w < 0.5 ? 2 * w : 1, tape = this.mode === 1, ping = this.mode === 2;
    const glide = 1 - Math.exp(-1 / (0.12 * SR));
    for (let i = 0; i < n; i++) {
      this.ph += 0.7 / SR; if (this.ph >= 1) this.ph -= 1;
      this.cur[0] += (this.tL - this.cur[0]) * glide; this.cur[1] += (this.tR - this.cur[1]) * glide;
      const wm = (tape ? 0.0012 + this.wow * 0.003 : this.wow * 0.002) * SR * Math.sin(TAU * this.ph);
      const xl = L[i], xr = st ? R[i] : xl;
      let yl = this.dl[0].read(this.cur[0] + wm), yr = this.dl[1].read(this.cur[1] - wm * 0.7);
      yl = this.lp[0].run(this.hp[0].run(yl)); yr = this.lp[1].run(this.hp[1].run(yr));
      if (tape) { yl = ftanh(yl * 1.3) / 1.3; yr = ftanh(yr * 1.3) / 1.3; }
      if (ping) { this.dl[0].write((xl + xr) * 0.5 + yr * this.fb); this.dl[1].write(yl * this.fb); }
      else { this.dl[0].write(xl + yl * this.fb); this.dl[1].write(xr + yr * this.fb); }
      L[i] = xl * dry + yl * wet; R[i] = xr * dry + yr * wet;
    }
    return true;
  }
}

const FDN_MS = [31.3, 37.9, 41.5, 45.7, 53.9, 61.1, 67.3, 77.7];
const AP_MS = [[4.77, 3.59, 12.73, 9.31], [5.13, 3.31, 11.97, 8.71]];
class Reverb { // 8-line feedback delay network with input diffusion, modulation, shimmer and freeze
  constructor() {
    this.d = FDN_MS.map(() => new Delay(0.42)); this.lp = new Float32Array(8); this.o = new Float32Array(8);
    this.ap = AP_MS.map(row => row.map(ms => ({ d: new Delay(0.03), len: ms * 0.001 * SR })));
    this.pre = [new Delay(0.3), new Delay(0.3)]; this.sh = new Shifter(80); this.sh.ratio = 2; this.shOut = 0;
    this.mph = new Float32Array(8).map((_, i) => i / 8); this.len = new Float32Array(8); this.g = new Float32Array(8);
    this.hpL = new Biquad().set('hp', 120, 0.7); this.hpR = new Biquad().set('hp', 120, 0.7); this.shHp = new Biquad().set('hp', 300, 0.7);
  }
  setParams(p) {
    const size = 0.35 + p.size * 2.1;
    for (let j = 0; j < 8; j++) { this.len[j] = FDN_MS[j] * 0.001 * SR * size; this.g[j] = Math.pow(10, -3 * this.len[j] / (Math.max(0.2, p.decay) * SR)); }
    this.damp = Math.exp(-TAU * (19000 * Math.pow(1 - p.damp, 2) + 900) / SR);
    this.preS = p.pre * 0.001 * SR; this.mix = p.mix; this.shim = p.shimmer; this.mod = p.mod * 0.0016 * SR; this.freeze = !!p.freeze;
    if (p.lowcut !== undefined) { this.hpL.set('hp', 20 + p.lowcut * 480, 0.7); this.hpR.set('hp', 20 + p.lowcut * 480, 0.7); }
  }
  process(L, R, n, st) {
    const w = this.mix, dry = w < 0.5 ? 1 : 2 * (1 - w), wet = (w < 0.5 ? 2 * w : 1) * 0.42;
    const fr = this.freeze, damp = fr ? 0 : this.damp, inG = fr ? 0 : 0.35, mInc = 0.37 / SR;
    const D = this.d, lp = this.lp, o = this.o, len = this.len, g = this.g, mph = this.mph;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = st ? R[i] : xl;
      this.pre[0].write(xl); this.pre[1].write(xr);
      let a = this.hpL.run(this.pre[0].read(this.preS)), b = this.hpR.run(this.pre[1].read(this.preS));
      for (let k = 0; k < 4; k++) {
        const A = this.ap[0][k], B = this.ap[1][k];
        const da = A.d.read(A.len), va = a - 0.65 * da; A.d.write(va); a = da + 0.65 * va;
        const db = B.d.read(B.len), vb = b - 0.65 * db; B.d.write(vb); b = db + 0.65 * vb;
      }
      let sum = 0;
      for (let j = 0; j < 8; j++) {
        mph[j] += mInc * (1 + j * 0.13); if (mph[j] >= 1) mph[j] -= 1;
        let y = D[j].read(len[j] + this.mod * (1 + Math.sin(TAU * mph[j])));
        lp[j] = y + (lp[j] - y) * damp; y = lp[j];
        o[j] = y; sum += y;
      }
      sum *= 0.25; // 2/N
      let shf = 0;
      if (this.shim > 0) { this.shOut = this.sh.run(this.shHp.run((o[0] + o[3] + o[5] + o[6]) * 0.25)); shf = this.shOut * this.shim * 0.55; }
      for (let j = 0; j < 8; j++) {
        const inp = (j & 1 ? b : a) * inG + shf * (fr ? 0 : 1);
        D[j].write((o[j] - sum) * (fr ? 1 : g[j]) + inp);
      }
      const wl = o[0] - o[2] + o[4] + o[6] * 0.7, wr = o[1] + o[3] - o[5] + o[7] * 0.7;
      L[i] = xl * dry + wl * wet; R[i] = xr * dry + wr * wet;
    }
    return true;
  }
}

class Looper {
  constructor() { this.max = Math.floor(SR * 40); this.bL = new Float32Array(this.max); this.bR = new Float32Array(this.max); this.state = 0; this.len = 0; this.pos = 0; this.level = 1; }
  // state: 0 empty, 1 recording, 2 playing, 3 overdubbing, 4 stopped
  setParams(p) { this.level = p.level; }
  cmd(c) {
    if (c === 'tap') {
      if (this.state === 0) { this.state = 1; this.len = 0; this.pos = 0; }
      else if (this.state === 1) { this.len = Math.max(this.pos, 1); this.state = 2; this.pos = 0; }
      else if (this.state === 2) this.state = 3;
      else if (this.state === 3) this.state = 2;
      else if (this.state === 4) { this.state = 2; this.pos = 0; }
    } else if (c === 'stop') { if (this.state === 1) { this.len = Math.max(this.pos, 1); } if (this.state !== 0) this.state = this.state === 4 ? 2 : 4; this.pos = 0; }
    else if (c === 'clear') { this.state = 0; this.len = 0; this.pos = 0; this.bL.fill(0); this.bR.fill(0); }
  }
  process(L, R, n, st) {
    const s = this.state;
    if (s === 0 || s === 4) return st;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = st ? R[i] : xl;
      if (s === 1) { this.bL[this.pos] = xl; this.bR[this.pos] = xr; this.pos++; if (this.pos >= this.max) { this.len = this.max; this.state = 2; this.pos = 0; } }
      else {
        const pl = this.bL[this.pos], pr = this.bR[this.pos];
        if (s === 3) { this.bL[this.pos] = pl + xl; this.bR[this.pos] = pr + xr; }
        L[i] = xl + pl * this.level; R[i] = xr + pr * this.level;
        if (++this.pos >= this.len) this.pos = 0;
      }
    }
    return s === 1 ? st : true;
  }
}

class Grind { // synth distortion: Tube / Tape / Fold / Crush
  constructor() { this.lp = [new Biquad(), new Biquad()]; this.hold = [0, 0]; this.cnt = 0; }
  setParams(p) { this.type = p.type | 0; this.amt = p.amt; this.mix = p.mix; for (const b of this.lp) b.set('lp', 1200 + p.tone * p.tone * 18000, 0.7); }
  process(L, R, n, st) {
    const t = this.type, a = this.amt, g = 1 + a * a * 30, mix = this.mix;
    const bits = Math.pow(2, 16 - a * 13), step = Math.max(1, Math.round(1 + a * a * 24));
    for (let i = 0; i < n; i++) {
      const crushTick = (this.cnt = (this.cnt + 1) % step) === 0;
      for (let c = 0; c < 2; c++) {
        const x = c && st ? R[i] : L[i]; let y;
        if (t === 1) y = ftanh(x * g * 0.5) * (1 / Math.sqrt(1 + a * 4)) + x * 0.15;
        else if (t === 2) y = Math.sin(x * g * 0.8) * 0.8;
        else if (t === 3) { if (crushTick) this.hold[c] = Math.round(x * bits) / bits; y = this.hold[c]; }
        else y = (ftanh(x * g + 0.2) - 0.197) * 0.9 / (1 + a);
        y = this.lp[c].run(y);
        const o = x * (1 - mix) + y * mix;
        if (c) R[i] = o; else L[i] = o;
      }
    }
    return true;
  }
}

class Plate extends Reverb { // denser, brighter, shorter lines
  setParams(p) { super.setParams(Object.assign({}, p, { size: p.size * 0.45, shimmer: 0 })); this.damp = Math.exp(-TAU * (20000 * Math.pow(1 - p.damp, 1.5) + 2500) / SR); }
}

class Ensemble { // string-machine ensemble: three taps, each with a slow and a fast LFO
  constructor() { this.dl = new Delay(0.05); this.p1 = 0; this.p2 = 0; }
  setParams(p) { this.depth = p.depth; this.mix = p.mix; this.speed = p.speed; }
  process(L, R, n, st) {
    const i1 = (0.5 + this.speed * 0.6) / SR, i2 = (5.5 + this.speed * 2) / SR, base = 0.010 * SR, ds = this.depth * 0.0032 * SR, df = this.depth * 0.00045 * SR;
    const w = this.mix, dry = 1 - w * 0.6;
    for (let i = 0; i < n; i++) {
      const x = st ? (L[i] + R[i]) * 0.5 : L[i]; this.dl.write(x);
      this.p1 += i1; if (this.p1 >= 1) this.p1 -= 1; this.p2 += i2; if (this.p2 >= 1) this.p2 -= 1;
      const t0 = this.dl.read(base + ds * (1 + Math.sin(TAU * this.p1)) + df * Math.sin(TAU * this.p2));
      const t1 = this.dl.read(base + ds * (1 + Math.sin(TAU * (this.p1 + 1 / 3))) + df * Math.sin(TAU * (this.p2 + 1 / 3)));
      const t2 = this.dl.read(base + ds * (1 + Math.sin(TAU * (this.p1 + 2 / 3))) + df * Math.sin(TAU * (this.p2 + 2 / 3)));
      const xl = st ? L[i] : x, xr = st ? R[i] : x;
      L[i] = xl * dry + (t0 * 0.7 + t1 * 0.45) * w; R[i] = xr * dry + (t2 * 0.7 + t1 * 0.45) * w;
    }
    return true;
  }
}

class Rotary { // two-rotor speaker: horn (treble) and drum (bass), doppler + amplitude, slow/fast with inertia
  constructor() {
    this.xl = new Biquad(); this.xh = new Biquad(); this.hd = [new Delay(0.01), new Delay(0.01)]; this.hp = 0; this.dp = 0; this.hr = 0.8; this.dr = 0.67;
  }
  setParams(p) { this.fast = p.speed | 0; this.drive = 1 + p.drive * 6; this.mix = p.mix; this.bal = p.balance; this.xl.set('lp', 800, 0.7); this.xh.set('hp', 800, 0.7); }
  process(L, R, n, st) {
    const ht = this.fast ? 6.8 : 0.83, dt = this.fast ? 5.7 : 0.7;
    this.hr += (ht - this.hr) * (1 - Math.exp(-n / (0.6 * SR))); this.dr += (dt - this.dr) * (1 - Math.exp(-n / (2.8 * SR)));
    const hi = this.hr / SR, di = this.dr / SR, w = this.mix;
    for (let i = 0; i < n; i++) {
      const xin = st ? (L[i] + R[i]) * 0.5 : L[i];
      const x = ftanh(xin * this.drive) / Math.sqrt(this.drive);
      const lo = this.xl.run(x), h = this.xh.run(x);
      this.hp += hi; if (this.hp >= 1) this.hp -= 1; this.dp += di; if (this.dp >= 1) this.dp -= 1;
      const sh = Math.sin(TAU * this.hp), ch = Math.cos(TAU * this.hp), sd = Math.sin(TAU * this.dp), cd = Math.cos(TAU * this.dp);
      this.hd[0].write(h); this.hd[1].write(h);
      const hl = this.hd[0].read((0.0022 + 0.0009 * sh) * SR) * (0.72 + 0.28 * ch), hr = this.hd[1].read((0.0022 - 0.0009 * ch) * SR) * (0.72 + 0.28 * sh);
      const dl = lo * (0.8 + 0.2 * sd), dr = lo * (0.8 + 0.2 * cd);
      const hg = 0.5 + this.bal * 0.5, dg = 1.5 - this.bal;
      const ol = hl * hg + dl * dg, or = hr * hg + dr * dg;
      const xl = st ? L[i] : xin, xr = st ? R[i] : xin;
      L[i] = xl * (1 - w) + ol * w; R[i] = xr * (1 - w) + or * w;
    }
    return true;
  }
}

class AutoPan {
  constructor() { this.ph = 0; }
  setParams(p, bpm) { this.rate = p.sync > 0 ? (bpm / 60) / SYNC_BEATS[p.sync] : p.rate; this.depth = p.depth; this.shape = p.shape | 0; }
  process(L, R, n, st) {
    const inc = this.rate / SR;
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      const m = lfoShape(this.shape === 1 ? 1 : 0, this.ph) * this.depth, a = (m + 1) * Math.PI / 4;
      const gl = Math.cos(a) * 1.4142, gr = Math.sin(a) * 1.4142;
      const xl = L[i], xr = st ? R[i] : xl;
      L[i] = xl * gl; R[i] = xr * gr;
    }
    return true;
  }
}

class Vibe { // photocell phase-vibrato
  constructor() { this.s = [new Float32Array(4), new Float32Array(4)]; this.ph = 0; }
  setParams(p, bpm) { this.rate = p.rate; this.depth = p.depth; this.mode = p.mode | 0; this.mix = this.mode ? 1 : 0.5; this.vol = dbToGain(p.level || 0); }
  process(L, R, n, st) {
    const inc = this.rate / SR;
    for (let i = 0; i < n; i++) {
      this.ph += inc; if (this.ph >= 1) this.ph -= 1;
      let m = 0.5 + 0.5 * Math.sin(TAU * this.ph); m = m * m; // lamp/photocell skew
      for (let c = 0; c < (st ? 2 : 1); c++) {
        const X = c ? R : L, S = this.s[c], x = X[i]; let y = x;
        for (let k = 0; k < 4; k++) {
          const f = (k === 0 ? 90 : k === 1 ? 300 : k === 2 ? 900 : 2400) * Math.pow(2, this.depth * 2.5 * m);
          const t = Math.tan(Math.PI * Math.min(f, SR * 0.45) / SR), a = (t - 1) / (t + 1);
          const o = a * y + S[k]; S[k] = y - a * o; y = o;
        }
        X[i] = (x * (1 - this.mix) + y * this.mix) * this.vol * (this.mode ? 1 : 1.3);
      }
    }
    return st;
  }
}

class RingMod {
  constructor() { this.ph = 0; this.lp = 0; }
  setParams(p, bpm) { this.f = p.freq; this.lr = p.lfoRate; this.ld = p.lfoDepth; this.mix = p.mix; }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      this.lp += this.lr / SR; if (this.lp >= 1) this.lp -= 1;
      const f = this.f * Math.pow(2, this.ld * 2 * Math.sin(TAU * this.lp));
      this.ph += f / SR; if (this.ph >= 1) this.ph -= 1;
      const c = Math.sin(TAU * this.ph), w = this.mix;
      L[i] = L[i] * (1 - w) + L[i] * c * w; if (st) R[i] = R[i] * (1 - w) + R[i] * c * w;
    }
    return st;
  }
}

class HilbertAP { constructor(a) { this.a2 = a * a; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; } run(x) { const y = this.a2 * (x + this.y2) - this.x2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; } }
const HIL_A = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737], HIL_B = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278];
class FreqShift { // single-sideband shift via a 90-degree IIR pair; barber-pole feedback
  constructor() { this.ch = [0, 1].map(() => ({ a: HIL_A.map(c => new HilbertAP(c)), b: HIL_B.map(c => new HilbertAP(c)), d: 0, fb: 0 })); this.ph = 0; }
  setParams(p) { this.shift = p.shift; this.fbk = p.fb; this.mix = p.mix; this.spread = p.spread; }
  process(L, R, n, st) {
    const w = this.mix;
    for (let i = 0; i < n; i++) {
      this.ph += this.shift / SR; this.ph -= Math.floor(this.ph);
      for (let c = 0; c < 2; c++) {
        const C = this.ch[c], x0 = c && st ? R[i] : L[i], x = x0 + C.fb * this.fbk;
        let a = x, b = x; for (const s of C.a) a = s.run(a); for (const s of C.b) b = s.run(b);
        const I = C.d; C.d = a;
        const ang = TAU * (c && this.spread ? -this.ph : this.ph);
        const y = I * Math.cos(ang) - b * Math.sin(ang);
        C.fb = ftanh(y);
        const o = x0 * (1 - w) + y * w;
        if (c) R[i] = o; else L[i] = o;
      }
    }
    return true;
  }
}

class MotionFilter {
  constructor() { this.s = [new Float64Array(2), new Float64Array(2)]; this.ph = 0; this.f = new Follower(3, 120); }
  setParams(p, bpm) { this.type = p.type | 0; this.cut = p.cutoff; this.res = p.res; this.drive = 1 + p.drive * 6; this.rate = p.sync > 0 ? (bpm / 60) / SYNC_BEATS[p.sync] : p.rate; this.ld = p.lfo; this.env = p.env; this.mix = p.mix; this.stereo = p.stereo; }
  process(L, R, n, st) {
    if (!st) R.set(L.subarray(0, n));
    const k = 2 - 2 * this.res * 0.98;
    for (let off = 0; off < n; off += 16) {
      const m = Math.min(16, n - off);
      this.ph += this.rate * m / SR; this.ph -= Math.floor(this.ph);
      let e = 0; for (let i = off; i < off + m; i++) e = this.f.run((L[i] + R[i]) * 0.5);
      for (let c = 0; c < 2; c++) {
        const x = this.cut + this.ld * 0.35 * Math.sin(TAU * (this.ph + c * this.stereo * 0.25)) + this.env * clamp(e * 3, 0, 1) * 0.5;
        const fc = clamp(30 * Math.pow(2, clamp(x, 0, 1) * 9.4), 20, SR * 0.45);
        const g = Math.tan(Math.PI * fc / SR), a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2, S = this.s[c];
        const X = c ? R : L;
        for (let i = off; i < off + m; i++) {
          const v0 = X[i], vin = ftanh(v0 * this.drive) / this.drive * 1.2;
          const v3 = vin - S[1], v1 = a1 * S[0] + a2 * v3, v2 = S[1] + a2 * S[0] + a3 * v3;
          S[0] = 2 * v1 - S[0]; S[1] = 2 * v2 - S[1];
          const y = this.type === 0 ? v2 : this.type === 1 ? v1 * (1 + this.res) : this.type === 2 ? vin - k * v1 - v2 : vin - k * v1;
          X[i] = v0 * (1 - this.mix) + y * this.mix;
        }
      }
    }
    return true;
  }
}

class Crush {
  constructor() { this.h = [0, 0]; this.acc = 0; }
  setParams(p) { this.q = Math.pow(2, p.bits - 1); this.step = SR / Math.max(200, p.rate); this.mix = p.mix; }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      this.acc += 1; if (this.acc >= this.step) { this.acc -= this.step; this.h[0] = Math.round(L[i] * this.q) / this.q; this.h[1] = Math.round((st ? R[i] : L[i]) * this.q) / this.q; }
      L[i] = L[i] * (1 - this.mix) + this.h[0] * this.mix; if (st) R[i] = R[i] * (1 - this.mix) + this.h[1] * this.mix;
    }
    return st;
  }
}

class Widener {
  constructor() { this.hd = new Delay(0.03); this.lpm = new Biquad(); this.lps = new Biquad(); }
  setParams(p) { this.w = p.width; this.haas = p.haas * 0.001 * SR; this.bass = p.bass; if (p.bass > 0) { this.lpm.set('lp', p.bass, 0.7); this.lps.set('lp', p.bass, 0.7); } }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      let l = L[i], r = st ? R[i] : l;
      if (this.haas > 0) { this.hd.write(r); r = this.hd.read(this.haas); }
      let m = (l + r) * 0.5, s = (l - r) * 0.5 * this.w;
      if (this.bass > 0) s -= this.lps.run(s);
      L[i] = m + s; R[i] = m - s;
    }
    return true;
  }
}

class Limiter {
  constructor() { this.d = [new Delay(0.01), new Delay(0.01)]; this.g = 1; this.hold = 0; this.pk = 0; }
  setParams(p) { this.ceil = dbToGain(p.ceiling); this.gain = dbToGain(p.gain); this.rel = 1 - Math.exp(-1 / (p.release * 0.001 * SR)); }
  process(L, R, n, st) {
    const la = Math.round(0.0015 * SR), att = 1 - Math.exp(-1 / (la * 0.3));
    for (let i = 0; i < n; i++) {
      const l = L[i] * this.gain, r = (st ? R[i] : L[i]) * this.gain;
      this.d[0].write(l); this.d[1].write(r);
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p >= this.pk) { this.pk = p; this.hold = la; } else if (--this.hold <= 0) this.pk *= 0.9995;
      const t = this.pk > this.ceil ? this.ceil / this.pk : 1;
      this.g += (t - this.g) * (t < this.g ? att : this.rel);
      L[i] = clamp(this.d[0].read(la) * this.g, -this.ceil, this.ceil); R[i] = clamp(this.d[1].read(la) * this.g, -this.ceil, this.ceil);
    }
    return true;
  }
}

class Exciter {
  constructor() { this.hp = [new Biquad(), new Biquad()]; this.hp2 = [new Biquad(), new Biquad()]; }
  setParams(p) { this.amt = p.amount; this.drv = 1 + p.drive * 10; for (let c = 0; c < 2; c++) { this.hp[c].set('hp', p.freq, 0.7); this.hp2[c].set('hp', p.freq, 0.7); } }
  process(L, R, n, st) {
    for (let c = 0; c < (st ? 2 : 1); c++) { const X = c ? R : L; for (let i = 0; i < n; i++) { const h = this.hp[c].run(X[i]); X[i] += this.hp2[c].run(ftanh(h * this.drv)) * this.amt * 0.6; } }
    return st;
  }
}

class Transient {
  constructor() { this.f = new Follower(0.8, 60); this.s = new Follower(25, 180); }
  setParams(p) { this.att = p.attack; this.sus = p.sustain; this.out = dbToGain(p.level || 0); }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      const x = st ? Math.max(Math.abs(L[i]), Math.abs(R[i])) : Math.abs(L[i]);
      const f = this.f.run(x) + 1e-6, s = this.s.run(x) + 1e-6, d = 20 * Math.log10(f / s);
      const gdb = this.att * clamp(d, 0, 18) * 0.9 + this.sus * clamp(-d, 0, 18) * 0.9;
      const g = dbToGain(gdb) * this.out;
      L[i] *= g; if (st) R[i] *= g;
    }
    return st;
  }
}

const VOWELS = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
class Formant {
  constructor() { this.b = [0, 1].map(() => [new Biquad(), new Biquad(), new Biquad()]); this.ph = 0; this.cnt = 0; }
  setParams(p, bpm) { this.v = p.vowel; this.rate = p.sync > 0 ? (bpm / 60) / SYNC_BEATS[p.sync] : p.rate; this.depth = p.depth; this.q = 4 + p.res * 14; this.mix = p.mix; this.shift = Math.pow(2, p.shift || 0); this.cnt = 0; }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      this.ph += this.rate / SR; if (this.ph >= 1) this.ph -= 1;
      if (this.cnt-- <= 0) {
        this.cnt = 32;
        for (let c = 0; c < 2; c++) {
          const v = clamp(this.v + this.depth * 0.5 * Math.sin(TAU * (this.ph + c * 0.15)), 0, 1) * 4, i0 = Math.floor(Math.min(v, 3.999)), fr = v - i0;
          for (let k = 0; k < 3; k++) this.b[c][k].set('bp', (VOWELS[i0][k] * (1 - fr) + VOWELS[i0 + 1][k] * fr) * this.shift, this.q * (k ? 1.3 : 1));
        }
      }
      for (let c = 0; c < 2; c++) {
        const x = c && st ? R[i] : L[i], B = this.b[c];
        const y = (B[0].run(x) * 1.0 + B[1].run(x) * 0.7 + B[2].run(x) * 0.45) * 2.2;
        const o = x * (1 - this.mix) + y * this.mix;
        if (c) R[i] = o; else L[i] = o;
      }
    }
    return true;
  }
}

class Spring { // dispersive allpass chain in a feedback loop: the "boing"
  constructor() { this.ch = [0, 1].map((c) => ({ ap: new Float32Array(16), d: new Delay(0.08), lp: 0, hp: new Biquad().set('hp', 200, 0.7), len: (c ? 0.0371 : 0.0329) * SR })); }
  setParams(p) { this.fb = 0.55 + p.decay * 0.42; this.a = 0.45 + p.drip * 0.4; this.tone = Math.exp(-TAU * (2000 + p.tone * 6000) / SR); this.mix = p.mix; }
  process(L, R, n, st) {
    const w = this.mix, dry = w < 0.5 ? 1 : 2 * (1 - w), wet = (w < 0.5 ? 2 * w : 1) * 0.7, a = this.a;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = st ? R[i] : xl;
      for (let c = 0; c < 2; c++) {
        const C = this.ch[c]; let y = C.d.read(C.len);
        C.lp = y + (C.lp - y) * this.tone; y = C.lp;
        let v = C.hp.run((c ? xr : xl) * 0.6) + y * this.fb;
        for (let k = 0; k < 16; k++) { const o = -a * v + C.ap[k]; C.ap[k] = v + a * o; v = o; }
        C.d.write(ftanh(v));
        if (c) R[i] = xr * dry + y * wet; else L[i] = xl * dry + y * wet;
      }
    }
    return true;
  }
}

class Cloud { // granular texture / delay: grains from the recent past, pitched, reversed, frozen
  constructor() { this.len = Math.floor(SR * 4); this.buf = new Float32Array(this.len); this.w = 0; this.G = 28; this.act = new Uint8Array(this.G); this.pos = new Float64Array(this.G); this.inc = new Float64Array(this.G); this.age = new Float64Array(this.G); this.gl = new Float64Array(this.G); this.gL = new Float32Array(this.G); this.gR = new Float32Array(this.G); this.t = 0; this.fbS = 0; }
  setParams(p) { this.posS = p.position * SR * 3.5; this.size = p.size * 0.001 * SR; this.dens = p.density; this.pitch = Math.pow(2, p.pitch / 12); this.shim = p.shimmer; this.spray = p.spray; this.rev = p.reverse; this.fb = p.feedback; this.freeze = !!p.freeze; this.mix = p.mix; }
  process(L, R, n, st) {
    const w = this.mix, dry = w < 0.5 ? 1 : 2 * (1 - w), wet = w < 0.5 ? 2 * w : 1;
    for (let i = 0; i < n; i++) {
      const xl = L[i], xr = st ? R[i] : xl;
      if (!this.freeze) { this.buf[this.w] = (xl + xr) * 0.5 + this.fbS * this.fb; this.w = (this.w + 1) % this.len; }
      if (--this.t <= 0) {
        this.t = SR / this.dens * (0.5 + rnd());
        for (let k = 0; k < this.G; k++) if (!this.act[k]) {
          const back = this.size * 2 + this.posS + rnd() * this.spray * SR;
          this.act[k] = 1; this.pos[k] = (this.w - back + this.len * 4) % this.len; let r = this.pitch * (rnd() < this.shim ? 2 : 1);
          if (rnd() < this.rev) r = -r; this.inc[k] = r; this.age[k] = 0; this.gl[k] = this.size;
          const sp = brnd() * 0.8; const g = 0.9 / Math.sqrt(Math.max(1, this.dens * this.size / SR)); this.gL[k] = g * Math.min(1, 1 - sp); this.gR[k] = g * Math.min(1, 1 + sp); break;
        }
      }
      let ol = 0, or = 0;
      for (let k = 0; k < this.G; k++) {
        if (!this.act[k]) continue;
        const a = this.age[k] / this.gl[k]; if (a >= 1) { this.act[k] = 0; continue; }
        let p = this.pos[k]; p = ((p % this.len) + this.len) % this.len;
        const ip = p | 0, fr = p - ip, s = (this.buf[ip] + (this.buf[(ip + 1) % this.len] - this.buf[ip]) * fr) * HANN[(a * 1024) | 0];
        ol += s * this.gL[k]; or += s * this.gR[k]; this.pos[k] = p + this.inc[k]; this.age[k]++;
      }
      this.fbS = ftanh((ol + or) * 0.5);
      L[i] = xl * dry + ol * wet; R[i] = xr * dry + or * wet;
    }
    return true;
  }
}

class ReverseDelay {
  constructor() { this.dl = [new Delay(4.2), new Delay(4.2)]; this.k = 0; this.y = [0, 0]; }
  setParams(p, bpm) { const t = p.sync > 0 ? (60 / bpm) * DLY_BEATS[p.sync - 1] : p.time * 0.001; this.T = Math.max(256, Math.floor(clamp(t, 0.05, 2) * SR)); this.fb = p.fb; this.mix = p.mix; }
  process(L, R, n, st) {
    const T = this.T, w = this.mix, dry = w < 0.5 ? 1 : 2 * (1 - w), wet = w < 0.5 ? 2 * w : 1;
    for (let i = 0; i < n; i++) {
      this.k = (this.k + 1) % T; const k1 = this.k, k2 = (this.k + (T >> 1)) % T;
      const g1 = HANN[((k1 / T) * 1024) | 0], g2 = HANN[((k2 / T) * 1024) | 0];
      for (let c = 0; c < 2; c++) {
        const x = c && st ? R[i] : L[i], d = this.dl[c];
        const y = d.read(2 * k1 + 1) * g1 + d.read(2 * k2 + 1) * g2;
        d.write(x + y * this.fb);
        const o = x * dry + y * wet;
        if (c) R[i] = o; else L[i] = o;
      }
    }
    return true;
  }
}

class Pump { // tempo-synced ducking
  constructor() { this.ph = 0; this.sm = 1; }
  setParams(p, bpm) { this.inc = (bpm / 60) / SYNC_BEATS[p.sync || 5] / SR; this.depth = p.depth; this.curve = 0.5 + p.shape * 4; }
  process(L, R, n, st) {
    for (let i = 0; i < n; i++) {
      this.ph += this.inc; if (this.ph >= 1) this.ph -= 1;
      const t = 1 - this.depth * Math.pow(1 - this.ph, this.curve);
      this.sm += (t - this.sm) * 0.02;
      L[i] *= this.sm; if (st) R[i] *= this.sm;
    }
    return st;
  }
}

class Hyper { // six-voice detuned chorus
  constructor() { this.dl = new Delay(0.06); this.ph = new Float64Array(6).map((_, i) => i / 6); }
  setParams(p) { this.rate = p.rate; this.depth = p.depth; this.mix = p.mix; this.spread = p.spread; }
  process(L, R, n, st) {
    const w = this.mix;
    for (let i = 0; i < n; i++) {
      const x = st ? (L[i] + R[i]) * 0.5 : L[i]; this.dl.write(x);
      let ol = 0, or = 0;
      for (let v = 0; v < 6; v++) {
        this.ph[v] += this.rate * (0.6 + v * 0.17) / SR; if (this.ph[v] >= 1) this.ph[v] -= 1;
        const s = this.dl.read((0.008 + v * 0.0023) * SR + this.depth * 0.003 * SR * (1 + Math.sin(TAU * this.ph[v])));
        const pan = ((v / 5) * 2 - 1) * this.spread; ol += s * (1 - pan) * 0.5; or += s * (1 + pan) * 0.5;
      }
      const xl = st ? L[i] : x, xr = st ? R[i] : x;
      L[i] = xl * (1 - w * 0.5) + ol * w * 0.6; R[i] = xr * (1 - w * 0.5) + or * w * 0.6;
    }
    return true;
  }
}

const UNIT_TYPES = { gate: Gate, comp: Comp, boost: Boost, drive: Drive, fuzz: Fuzz, octave: Octaver, pitch: Pitch, envf: EnvFilter, amp: Amp, eq: EQ4, chorus: Chorus, phaser: Phaser, flanger: Flanger, trem: Trem, cassette: Cassette, swell: Swell, delay: EchoDelay, reverb: Reverb, looper: Looper, grind: Grind,
  plate: Plate, ensemble: Ensemble, rotary: Rotary, autopan: AutoPan, vibe: Vibe, ringmod: RingMod, freqshift: FreqShift, mfilter: MotionFilter, crush: Crush, widener: Widener, limiter: Limiter, exciter: Exciter, transient: Transient, formant: Formant, spring: Spring, cloud: Cloud, revdelay: ReverseDelay, pump: Pump, hyper: Hyper };

class Chain {
  constructor() { this.u = []; }
  set(defs, bpm) {
    const old = this.u, next = [];
    for (const c of defs) {
      if (!UNIT_TYPES[c.type]) continue;
      const prev = old.find(o => o.id === c.id && o.type === c.type);
      const unit = prev ? prev.unit : new UNIT_TYPES[c.type]();
      const p = Object.assign({}, c.p); unit.setParams(p, bpm);
      next.push({ id: c.id, type: c.type, on: !!c.on, p, unit });
    }
    this.u = next;
  }
  param(i, k, v, bpm) { const c = this.u[i]; if (c) { c.p[k] = v; c.unit.setParams(c.p, bpm); } }
  refresh(bpm) { for (const c of this.u) c.unit.setParams(c.p, bpm); }
  process(L, R, n, st) { for (const c of this.u) if (c.on) st = c.unit.process(L, R, n, st) || st; return st; }
}

// ---------------------------------------------------------------- pitch detector (YIN on 4x-decimated input)
class Yin {
  constructor() {
    this.dec = 4; this.dsr = SR / this.dec; this.lp1 = new Biquad().set('lp', this.dsr * 0.42, 0.7); this.lp2 = new Biquad().set('lp', this.dsr * 0.42, 0.7);
    this.N = 2048; this.buf = new Float32Array(this.N); this.w = 0; this.c = 0; this.hop = 0; this.d = new Float32Array(1024);
    this.freq = 0; this.conf = 0; this.minF = 60; this.W = 0;
  }
  push(x) { // returns true when a new estimate was made
    const y = this.lp2.run(this.lp1.run(x));
    if (++this.c < this.dec) return false; this.c = 0;
    this.buf[this.w] = y; this.w = (this.w + 1) % this.N;
    if (++this.hop < 48) return false; this.hop = 0;
    this.analyse(); return true;
  }
  analyse() {
    const tauMax = Math.min(1000, Math.floor(this.dsr / this.minF)), tauMin = Math.floor(this.dsr / 1500), W = Math.min(1000, tauMax + 64);
    const N = this.N, start = (this.w - (W + tauMax) + N * 2) % N, b = this.buf, d = this.d;
    let energy = 0;
    for (let j = 0; j < W; j++) { const v = b[(start + j) % N]; energy += v * v; }
    if (energy / W < 1e-7) { this.conf = 0; this.freq = 0; return; }
    // linearise ring access once
    const lin = this.lin || (this.lin = new Float32Array(2048));
    for (let j = 0; j < W + tauMax; j++) lin[j] = b[(start + j) % N];
    let run = 0; d[0] = 1;
    let best = -1;
    for (let t = 1; t <= tauMax; t++) {
      let s = 0;
      for (let j = 0; j < W; j++) { const df = lin[j] - lin[j + t]; s += df * df; }
      run += s; d[t] = run > 0 ? s * t / run : 1;
      if (best < 0 && t > tauMin + 1 && d[t - 1] < 0.15 && d[t - 1] <= d[t] && d[t - 1] <= d[t - 2]) { best = t - 1; break; }
    }
    if (best < 0) { // fall back to the global minimum
      let m = 1e9; for (let t = tauMin; t < tauMax; t++) if (d[t] < m) { m = d[t]; best = t; }
      if (m > 0.35) { this.conf = 0; return; }
      // octave guard: if half the period is nearly as good, the true pitch is an octave higher
      for (let pass = 0; pass < 2; pass++) {
        const h = Math.round(best / 2); if (h <= tauMin + 1) break;
        let hb = h; for (let t = h - 2; t <= h + 2; t++) if (d[t] < d[hb]) hb = t;
        if (d[hb] < 0.3 && d[hb] < d[best] + 0.12) best = hb; else break;
      }
    }
    const a = d[best - 1], c = d[best + 1] !== undefined ? d[best + 1] : d[best], bb = d[best];
    const den = a + c - 2 * bb, sh = den !== 0 ? 0.5 * (a - c) / den : 0;
    this.freq = this.dsr / (best + clamp(sh, -1, 1)); this.conf = 1 - clamp(bb, 0, 1);
  }
}

// ---------------------------------------------------------------- synth voice
const NDST = 20;
// sources: 0 none,1 env1,2 env2,3 env3,4 lfo1,5 lfo2,6 velocity,7 note,8 mod wheel,9 random,10 guitar env,11 aftertouch(=mod wheel alias)
// dests: 0 none,1 A pos,2 A pitch,3 A level,4 A warp,5 B pos,6 B pitch,7 B level,8 B warp,9 cutoff,10 res,11 drive,
//        12 aroma pos,13 aroma level,14 sub level,15 noise level,16 detune,17 pan,18 volume,19 pitch (all)
const MAXG = 20;
// Electric-piano (tine) models: bell partial ratios, bell amount, pickup bark, pickup offset, decay at C3 (s), hammer thump, tone ceiling, reed
const EP_MODELS = [
  { b1: 14, b2: 3.0, bell: 0.55, bark: 0.6, sym: 0.35, dec: 6.5, th: 0.35, lp: 9000, reed: 0 },   // Stage 73
  { b1: 14, b2: 7.0, bell: 0.75, bark: 0.38, sym: 0.25, dec: 7.5, th: 0.25, lp: 11000, reed: 0 }, // Suitcase
  { b1: 14, b2: 21, bell: 1.0, bark: 0.45, sym: 0.3, dec: 6.0, th: 0.3, lp: 15000, reed: 0 },     // Bright tines
  { b1: 6, b2: 3, bell: 0.25, bark: 0.25, sym: 0.2, dec: 7.0, th: 0.55, lp: 5000, reed: 0 },      // Felt ballad
  { b1: 0, b2: 0, bell: 0, bark: 0.8, sym: 0.5, dec: 2.8, th: 0.4, lp: 7000, reed: 1 },           // Reed piano
  { b1: 4.07, b2: 10.2, bell: 0.9, bark: 0.1, sym: 0.1, dec: 3.2, th: 0.15, lp: 14000, reed: 0 },  // Celeste
];
class Voice {
  constructor(id) {
    this.id = id; this.active = false; this.note = 60; this.vel = 0; this.gate = false; this.age = 0; this.pitch = 60; this.target = 60; this.bend = 0; this.gtr = false;
    this.aPh = new Float64Array(8); this.bPh = new Float64Array(8); this.subPh = 0;
    this.e = [{ st: 0, lv: 0 }, { st: 0, lv: 0 }, { st: 0, lv: 0 }];
    this.lph = [0, 0]; this.lsh = [0, 0]; this.lfoV = [0, 0]; this.t = 0; this.rnd = 0; this.drift = 0; this.driftT = 0; this.dFil = 0;
    this.z = [new Float64Array(5), new Float64Array(5)]; this.sv = [new Float64Array(2), new Float64Array(2)];
    this.comb = null; this.cw = 0;
    this.pk = new Float64Array(7); this.brown = 0; this.crk = 0;
    this.gAct = new Uint8Array(MAXG); this.gPos = new Float64Array(MAXG); this.gInc = new Float64Array(MAXG); this.gAge = new Float64Array(MAXG); this.gLen = new Float64Array(MAXG); this.gL = new Float32Array(MAXG); this.gR = new Float32Array(MAXG);
    this.gTimer = 0; this.lastA = 0; this.lastB = 0; this.D = new Float32Array(NDST);
    this.monL = 0; this.monR = 0;
    this.rPh = 0; this.rB1 = 0; this.rB2 = 0; this.rT = 0; this.rB = 0; this.rTh = 0; this.rAtk = 0; this.rLp = 0; this.rThLp = 0;
  }
}

function envTick(e, c) { // c = {a,d,s,r}
  switch (e.st) {
    case 1: e.lv += (1.2 - e.lv) * c.a; if (e.lv >= 1) { e.lv = 1; e.st = 2; } break;
    case 2: e.lv += (c.s - e.lv) * c.d; if (Math.abs(e.lv - c.s) < 1e-4) { e.lv = c.s; e.st = 3; } break;
    case 3: e.lv = c.s; break;
    case 4: e.lv += (0 - e.lv) * c.r; if (e.lv < 2e-5) { e.lv = 0; e.st = 0; } break;
  }
  return e.lv;
}
function envCoefs(a, d, s, r) {
  return {
    a: 1 - Math.exp(-Math.log(6) / Math.max(1, a * SR)),
    d: 1 - Math.exp(-4.6 / Math.max(1, d * SR)),
    s: s,
    r: 1 - Math.exp(-4.6 / Math.max(1, r * SR)),
  };
}

// ---------------------------------------------------------------- the processor
class EleoEngine extends AudioWorkletProcessor {
  constructor() {
    super();
    this.P = {}; this.dirty = true; this.tables = []; this.sources = []; this.srcRate = [];
    this.voices = []; for (let i = 0; i < 16; i++) this.voices.push(new Voice(i));
    this.bpm = 112; this.wheel = 0; this.pb = 0; this.sustain = false; this.sustained = new Set();
    this.held = []; // keyboard notes in press order
    this.arpOn = false; this.arpPos = 0; this.arpCount = 0; this.arpNote = -1; this.arpStep = 0; this.arpGateLeft = 0; this.arpLatched = []; this.arpHeldCount = 0;
    this.gl = new Float32Array(128); this.sL = new Float32Array(128); this.sR = new Float32Array(128); this.pL = new Float32Array(128); this.pR = new Float32Array(128);
    // guitar side
    this.R = { inGain: 1, inCh: 0, gtrLevel: 1, synthLevel: 1, master: 0.8, synthToPedals: false, track: false, trackDry: 1, trackOct: 0, trackBend: true, trackSens: 0.5, tuner: false, tunerMute: false, testOn: false, testLevel: 1, guitarOn: true, synthOn: true };
    this.ped = new Chain(); this.fx = new Chain();
    this.toneLo = [new Biquad(), new Biquad()]; this.toneHi = [new Biquad(), new Biquad()];
    this.yin = new Yin(); this.gEnv = new Follower(1, 120); this.gEnvSlow = new Follower(30, 300); this.gEnvVal = 0;
    this.trk = { on: false, note: -1, stable: 0, cand: -1, peak: 0, lastF: 0 };
    this.capLen = Math.floor(SR * 8); this.cap = new Float32Array(this.capLen); this.capW = 0;
    this.test = null; this.testPos = 0;
    this.limG = 1; this.meterT = 0; this.pkIn = 0; this.pkOut = 0; this.pkSyn = 0; this.tuneT = 0;
    this.lim = 0.97; this.dcL = 0; this.dcR = 0; this.dcxL = 0; this.dcxR = 0;
    this.lfoG = [0, 0];
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(m) {
    switch (m.t) {
      case 'tables': this.tables = m.tables; break;
      case 'table': this.tables[m.i] = m.tab; break;
      case 'source': this.sources[m.i] = m.buf; this.srcRate[m.i] = (m.sr || SR) / SR; break;
      case 'patch': this.P = Object.assign({}, m.p); this.dirty = true; break;
      case 'p': this.P[m.k] = m.v; this.dirty = true; if (m.k === 'arp.on' && !m.v) this.arpStop(); break;
      case 'on': this.keyOn(m.n, m.v); break;
      case 'off': this.keyOff(m.n); break;
      case 'allOff': this.allOff(); break;
      case 'wheel': this.wheel = m.v; break;
      case 'bend': this.pb = m.v; break;
      case 'sustain': this.sustain = m.v; if (!m.v) { for (const n of this.sustained) this.noteOff(n); this.sustained.clear(); } break;
      case 'bpm': this.bpm = m.v; this.dirty = true; this.ped.refresh(m.v); this.fx.refresh(m.v); break;
      case 'route': Object.assign(this.R, m.r); break;
      case 'chain': (m.w === 'fx' ? this.fx : this.ped).set(m.chain, this.bpm); break;
      case 'pp': (m.w === 'fx' ? this.fx : this.ped).param(m.i, m.k, m.v, this.bpm); break;
      case 'pon': { const u = (m.w === 'fx' ? this.fx : this.ped).u[m.i]; if (u) u.on = m.v; break; }
      case 'loop': { const u = (m.w === 'fx' ? this.fx : this.ped).u[m.i]; if (u && u.unit.cmd) u.unit.cmd(m.c); break; }
      case 'test': this.test = m.buf; this.testPos = 0; this.testInc = (m.sr || SR) / SR; break;
      case 'capture': this.capture(m.sec || 6); break;
    }
  }

  capture(sec) {
    const n = Math.min(this.capLen, Math.floor(sec * SR)); const out = new Float32Array(n);
    let r = (this.capW - n + this.capLen) % this.capLen;
    for (let i = 0; i < n; i++) { out[i] = this.cap[r]; r = (r + 1) % this.capLen; }
    // normalise
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
    if (pk > 1e-4) for (let i = 0; i < n; i++) out[i] *= 0.9 / pk;
    this.sources[6] = out; this.srcRate[6] = 1;
    const ov = new Float32Array(200); const step = Math.floor(n / 200);
    for (let k = 0; k < 200; k++) { let m = 0; for (let j = 0; j < step; j++) m = Math.max(m, Math.abs(out[k * step + j])); ov[k] = m; }
    this.port.postMessage({ t: 'captured', ov, pk });
  }

  // ------------------------------------------------ notes
  keyOn(n, v) {
    this.held = this.held.filter(x => x !== n); this.held.push(n); this.sustained.delete(n);
    if (this.P['arp.on']) {
      if (this.P['arp.latch'] && this.arpHeldCount === 0) this.arpLatched = [];
      this.arpHeldCount++;
      if (!this.arpLatched.includes(n)) this.arpLatched.push(n);
      this.arpVel = v; if (!this.arpRunning) { this.arpRunning = true; this.arpCount = 0; this.arpStep = 0; this.arpPos = -1; }
      return;
    }
    this.noteOn(n, v, false);
  }
  keyOff(n) {
    this.held = this.held.filter(x => x !== n);
    if (this.P['arp.on']) {
      this.arpHeldCount = Math.max(0, this.arpHeldCount - 1);
      if (!this.P['arp.latch']) { this.arpLatched = this.arpLatched.filter(x => x !== n); if (!this.arpLatched.length) this.arpStop(); }
      return;
    }
    if (this.sustain) { this.sustained.add(n); return; }
    this.noteOff(n);
  }
  arpStop() { this.arpRunning = false; if (this.arpNote >= 0) { this.noteOff(this.arpNote); this.arpNote = -1; } this.arpLatched = []; this.arpHeldCount = 0; }

  voiceMode() { return this.P['v.mode'] | 0; } // 0 poly, 1 mono, 2 legato
  noteOn(n, v, gtr) {
    const P = this.P, mode = this.voiceMode();
    if (mode > 0 || gtr) {
      // mono: reuse voice 0 (guitar tracking uses voice 15 so keys and guitar can play together)
      const vc = this.voices[gtr ? 15 : 0];
      const legato = vc.active && vc.gate && (mode === 2 || gtr);
      if (!gtr) this.monoStack = (this.monoStack || []).filter(x => x !== n).concat([n]);
      this.startVoice(vc, n, v, legato, gtr);
      return;
    }
    const poly = clamp(P['v.poly'] | 0 || 8, 1, 15);
    let vc = null;
    for (let i = 0; i < poly; i++) { const x = this.voices[i]; if (x.active && x.note === n && !x.gtr) { vc = x; break; } }
    if (!vc) for (let i = 0; i < poly; i++) if (!this.voices[i].active) { vc = this.voices[i]; break; }
    if (!vc) { // steal: oldest released, then oldest
      let best = null;
      for (let i = 0; i < poly; i++) { const x = this.voices[i]; if (!x.gate && (!best || x.age > best.age)) best = x; }
      if (!best) for (let i = 0; i < poly; i++) { const x = this.voices[i]; if (!best || x.age > best.age) best = x; }
      vc = best;
    }
    this.startVoice(vc, n, v, false, false);
  }
  startVoice(vc, n, v, legato, gtr) {
    const P = this.P;
    vc.note = n; vc.target = n; vc.gtr = gtr; vc.gate = true; vc.vel = v;
    const glide = P['v.glide'] || 0;
    if (!vc.active || (glide <= 0.0005)) vc.pitch = n;
    if (legato) return;
    if (!vc.active) {
      vc.pitch = n; vc.t = 0;
      const ra = P['a.rand'] || 0, rb = P['b.rand'] || 0, pa = P['a.phase'] || 0, pb = P['b.phase'] || 0;
      for (let u = 0; u < 8; u++) { vc.aPh[u] = (pa + ra * rnd()) % 1; vc.bPh[u] = (pb + rb * rnd()) % 1; }
      vc.subPh = 0; for (const z of vc.z) z.fill(0); for (const s of vc.sv) s.fill(0); vc.gAct.fill(0); vc.gTimer = 0;
      vc.drift = brnd() * 0.5;
    } else if (P['a.retrig']) { for (let u = 0; u < 8; u++) vc.aPh[u] = ((P['a.phase'] || 0) + (P['a.rand'] || 0) * rnd()) % 1; }
    vc.active = true; vc.age = 0; vc.rnd = brnd();
    for (const e of vc.e) e.st = 1;
    vc.rPh = 0; vc.rB1 = 0; vc.rB2 = 0; vc.rT = 1; vc.rB = 1; vc.rTh = 1; vc.rAtk = 0;
    for (let k = 0; k < 2; k++) {
      if (P['l' + (k + 1) + '.retrig']) { vc.lph[k] = P['l' + (k + 1) + '.phase'] || 0; vc.t = 0; }
      else vc.lph[k] = this.lfoG[k];
      vc.lsh[k] = brnd();
    }
    vc.t = 0;
  }
  noteOff(n) {
    const mode = this.voiceMode();
    if (mode > 0) {
      this.monoStack = (this.monoStack || []).filter(x => x !== n);
      const vc = this.voices[0];
      if (vc.note !== n) return;
      if (this.monoStack.length) { const prev = this.monoStack[this.monoStack.length - 1]; vc.note = prev; vc.target = prev; if (mode === 1) { /* retrigger in mono */ for (const e of vc.e) e.st = 1; } return; }
      this.release(vc); return;
    }
    for (const vc of this.voices) if (vc.active && vc.gate && vc.note === n && !vc.gtr) this.release(vc);
  }
  release(vc) { vc.gate = false; for (const e of vc.e) if (e.st) e.st = 4; }
  allOff() { this.held = []; this.sustained.clear(); this.monoStack = []; this.arpStop(); for (const vc of this.voices) { vc.gate = false; vc.active = false; for (const e of vc.e) { e.st = 0; e.lv = 0; } } this.trk.note = -1; }

  // ------------------------------------------------ arpeggiator
  arpTick(n) {
    if (!this.P['arp.on'] || !this.arpRunning || !this.arpLatched.length) return;
    const P = this.P, rates = [1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];
    const beats = rates[P['arp.rate'] | 0] || 0.25;
    const step = (60 / this.bpm) * beats * SR;
    const sw = (this.arpStep % 2 === 1) ? step * (P['arp.swing'] || 0) * 0.33 : 0;
    if (this.arpPos < 0) this.arpPos = 0; // fire immediately
    else this.arpPos += n;
    if (this.arpNote >= 0) { this.arpGateLeft -= n; if (this.arpGateLeft <= 0) { this.noteOff(this.arpNote); this.arpNote = -1; } }
    const due = this.arpStep === 0 && this.arpCount === 0 ? 0 : step + sw;
    if (this.arpPos >= due) {
      this.arpPos = this.arpCount === 0 && this.arpStep === 0 ? n : this.arpPos - due;
      const notes = this.arpSeq();
      if (!notes.length) return;
      const mode = P['arp.mode'] | 0; let nn;
      if (mode === 4) nn = notes[Math.floor(rnd() * notes.length)];
      else nn = notes[this.arpCount % notes.length];
      if (this.arpNote >= 0) this.noteOff(this.arpNote);
      if (mode === 5) { // chord: play everything held
        for (const x of this.arpLatched) this.noteOn(x, this.arpVel || 0.8, false);
        this.arpChord = this.arpLatched.slice(); this.arpNote = -1; this.arpChordLeft = step * (P['arp.gate'] || 0.5);
      } else { this.noteOn(nn, (this.arpVel || 0.8) * (this.arpStep % 4 === 0 ? 1 : 0.85), false); this.arpNote = nn; }
      this.arpGateLeft = step * clamp(P['arp.gate'] || 0.5, 0.05, 1.2);
      this.arpCount++; this.arpStep++;
    }
    if (this.arpChord) { this.arpChordLeft -= n; if (this.arpChordLeft <= 0) { for (const x of this.arpChord) this.noteOff(x); this.arpChord = null; } }
  }
  arpSeq() {
    const P = this.P, base = this.arpLatched.slice(); const mode = P['arp.mode'] | 0, oct = clamp(P['arp.oct'] | 0 || 1, 1, 4);
    const asPlayed = mode === 3; if (!asPlayed) base.sort((a, b) => a - b);
    let s = []; for (let o = 0; o < oct; o++) for (const x of base) s.push(x + o * 12);
    if (mode === 1) s.reverse();
    else if (mode === 2 && s.length > 1) s = s.concat(s.slice(1, -1).reverse());
    return s;
  }

  // ------------------------------------------------ guitar -> synth tracking
  trackStep(env) {
    const T = this.trk, y = this.yin, R = this.R;
    const thrOn = 0.003 + (1 - R.trackSens) * 0.05, thrOff = thrOn * 0.45;
    const midiF = y.freq > 0 ? 69 + 12 * Math.log2(y.freq / 440) : -1;
    const ok = y.conf > 0.82 && midiF > 20;
    const nn = ok ? Math.round(midiF) : -1;
    if (T.note < 0) {
      if (env > thrOn && ok) {
        if (nn === T.cand) T.stable++; else { T.cand = nn; T.stable = 0; }
        if (T.stable >= 2) { T.note = nn; T.age = 0; this.noteOn(nn + R.trackOct * 12, clamp(0.35 + env * 6, 0.3, 1), true); T.peak = env; }
      }
    } else {
      T.age++;
      const vc = this.voices[15];
      if (env < thrOff) { T.note = -1; T.cand = -1; this.release(vc); vc.bend = 0; return; }
      if (ok) {
        if (nn !== T.note) { if (nn === T.cand) T.stable++; else { T.cand = nn; T.stable = 0; }
          if (T.stable >= ((nn - T.note) % 12 === 0 && T.age > 14 ? 6 : 3)) { T.note = nn; vc.target = nn + R.trackOct * 12; vc.note = vc.target; vc.bend = 0; } }
        else { T.stable = 0; vc.bend = R.trackBend ? clamp(midiF - nn, -1.5, 1.5) : 0; }
      }
      // re-pick: sharp rise while a note sounds
      if (env > T.peak * 1.8 && env > thrOn * 2) { for (const e of vc.e) e.st = 1; }
      T.peak = Math.max(env, T.peak * 0.995);
    }
  }

  // ------------------------------------------------ synth render
  prepare() {
    const P = this.P;
    this.c1 = envCoefs(P['e1.a'], P['e1.d'], P['e1.s'], P['e1.r']);
    this.c2 = envCoefs(P['e2.a'], P['e2.d'], P['e2.s'], P['e2.r']);
    this.c3 = envCoefs(P['e3.a'], P['e3.d'], P['e3.s'], P['e3.r']);
    const mods = [];
    for (let i = 0; i < 8; i++) { const s = P['m' + i + '.s'] | 0, d = P['m' + i + '.d'] | 0, a = +P['m' + i + '.a'] || 0; if (s && d && a) mods.push([s, d, a]); }
    this.mods = mods;
    for (let c = 0; c < 2; c++) { this.toneLo[c].set('ls', 180, 0.7, P['v.low'] || 0); this.toneHi[c].set('hs', 4000, 0.7, P['v.high'] || 0); }
    this.dirty = false;
  }

  lfoRate(k) {
    const P = this.P, s = P['l' + k + '.sync'] | 0;
    return s > 0 ? (this.bpm / 60) / SYNC_BEATS[s] : (P['l' + k + '.rate'] || 1);
  }

  renderVoice(vc, L, R, off, n) {
    const P = this.P, D = vc.D; D.fill(0);
    // --- modulation sources at block start
    const rate1 = this.lfoRate(1), rate2 = this.lfoRate(2);
    for (let k = 0; k < 2; k++) {
      const shape = P['l' + (k + 1) + '.shape'] | 0, rate = k ? rate2 : rate1;
      const prev = vc.lph[k];
      vc.lph[k] += rate * n / SR; if (vc.lph[k] >= 1) { vc.lph[k] -= Math.floor(vc.lph[k]); vc.lsh[k] = brnd(); }
      let v;
      if (shape === 5) v = vc.lsh[k];
      else if (shape === 6) { vc.lfoV[k] += (vc.lsh[k] - vc.lfoV[k]) * Math.min(1, rate * n / SR * 4); v = vc.lfoV[k]; }
      else v = lfoShape(shape, prev);
      const fade = P['l' + (k + 1) + '.fade'] || 0;
      if (fade > 0) v *= clamp(vc.t / fade, 0, 1);
      vc.lfoV[k] = shape === 6 ? vc.lfoV[k] : v;
      vc['lv' + k] = v;
    }
    const src = this.srcV || (this.srcV = new Float32Array(12));
    src[1] = vc.e[0].lv; src[2] = vc.e[1].lv; src[3] = vc.e[2].lv; src[4] = vc.lv0; src[5] = vc.lv1;
    src[6] = vc.vel; src[7] = (vc.note - 60) / 60; src[8] = this.wheel; src[9] = vc.rnd; src[10] = this.gEnvVal; src[11] = this.wheel;
    for (const m of this.mods) D[m[1]] += src[m[0]] * m[2];

    // drift (slow random walk, Diva-style)
    const drift = P['v.drift'] || 0;
    if ((vc.driftT -= n) <= 0) { vc.driftT = SR * (0.3 + rnd() * 0.6); vc.driftTarget = brnd(); }
    vc.drift += ((vc.driftTarget || 0) - vc.drift) * (n / SR) * 1.5;
    const driftC = vc.drift * drift * 9; // cents

    // glide
    const gl = P['v.glide'] || 0;
    if (gl > 0.0005) vc.pitch += (vc.target - vc.pitch) * (1 - Math.exp(-n / (gl * SR * 0.35))); else vc.pitch = vc.target;
    const base = vc.pitch + vc.bend + this.pb * (P['v.bend'] || 2) + driftC / 100 + D[19] * 24;
    vc.t += n / SR; vc.age += n;

    // --- oscillator setup
    const out = this.oscSetup || (this.oscSetup = { A: this.mkOsc(), B: this.mkOsc() });
    const A = this.setupOsc(out.A, 'a', vc, base, D[1], D[2], D[3], D[4], D[16]);
    const B = this.setupOsc(out.B, 'b', vc, base, D[5], D[6], D[7], D[8], D[16]);
    const subOn = P['sub.on'], subLvl = subOn ? clamp((P['sub.level'] || 0) + D[14], 0, 1) : 0;
    const subInc = mtof(base + (P['sub.oct'] == 1 ? -24 : -12)) / SR, subShape = P['sub.shape'] | 0;
    const nOn = P['n.on'], nLvl = nOn ? clamp((P['n.level'] || 0) + D[15], 0, 1) : 0, nType = P['n.type'] | 0;
    const gOn = P['g.on'] && this.sources[P['g.src'] | 0];
    const gLvl = gOn ? clamp((P['g.level'] || 0) + D[13], 0, 1) : 0;
    const fA = P['a.flt'] !== 0, fB = P['b.flt'] !== 0, fS = P['sub.flt'] !== 0, fN = P['n.flt'] !== 0, fG = P['g.flt'] !== 0;

    // --- filter setup
    const ftype = P['f.type'] | 0;
    let cx = (P['f.cutoff'] !== undefined ? P['f.cutoff'] : 1) + D[9] + vc.e[1].lv * (P['f.env'] || 0) * 0.75
      + (vc.note - 60) / 120 * (P['f.key'] || 0) + vc.vel * (P['f.vel'] || 0) * 0.3 + vc.drift * drift * 0.01;
    cx = clamp(cx, 0, 1.05);
    const fc = clamp(20 * Math.pow(2, cx * 10), 15, SR * 0.45);
    const res = clamp((P['f.res'] || 0) + D[10], 0, 1), drv = 1 + clamp((P['f.drive'] || 0) + D[11], 0, 1) * 7;
    const g = Math.tan(Math.PI * fc / SR);
    const G = g / (1 + g), k4 = res * 4.3, comp = 1 + res * 0.9;
    const kS = 2 - 2 * res * 0.985, a1 = 1 / (1 + g * (g + kS)), a2 = g * a1, a3 = g * a2;
    const outDrv = 1 / (1 + (drv - 1) * 0.35);
    if (ftype === 7 && !vc.comb) { vc.comb = [new Float32Array(4096), new Float32Array(4096)]; vc.cw = 0; }
    const combLen = clamp(SR / fc, 2, 4000), combFb = res * 0.96;

    // --- amp
    const velAmp = P['v.velamp'] !== undefined ? P['v.velamp'] : 0.5;
    const vg = (1 - velAmp + velAmp * vc.vel) * clamp(1 + D[18], 0, 2) * (P['v.vol'] !== undefined ? P['v.vol'] : 0.7);
    const pan = clamp(D[17], -1, 1), pL = Math.min(1, 1 - pan), pR = Math.min(1, 1 + pan);
    vc.modOut = [A.pos, B.pos, cx];

    // --- aroma grains
    const aroma = gOn ? this.sources[P['g.src'] | 0] : null;
    let gSpawn = 0, gBase = 0;
    if (aroma) {
      const dens = P['g.dens'] || 12;
      gSpawn = SR / dens;
      gBase = clamp((P['g.pos'] || 0) + D[12], 0, 1) * aroma.length;
    }
    // --- electric piano (tine) layer
    const rOn = !!P['r.on'];
    let rInc = 0, rDec = 1, rBDec = 1, rBell = 0, rA = 0, rK = 1, rOff = 0, rOff0 = 0, rLvl = 0, rLpC = 0, rB1i = 0, rB2i = 0, rThA = 0, rReed = 0;
    const fR2 = P['r.flt'] !== 0;
    if (rOn) {
      const M = EP_MODELS[P['r.model'] | 0] || EP_MODELS[0], nt = vc.note, v = vc.vel;
      const f = mtof(base); rInc = f / SR;
      const T60 = clamp(M.dec * (P['r.decay'] || 1) * Math.pow(2, -(nt - 48) / 16), 0.35, 18);
      rDec = vc.gate ? Math.exp(-6.9 / (T60 * SR)) : Math.exp(-6.9 / (Math.max(0.02, P['r.damp'] || 0.18) * SR));
      const bT = 0.07 + 0.33 * Math.pow(2, -(nt - 60) / 24);
      rBDec = vc.gate ? Math.exp(-6.9 / (bT * SR)) : rDec;
      rBell = Math.pow(v, 1.5) * (P['r.bell'] !== undefined ? P['r.bell'] : 0.5) * 2 * M.bell * (0.55 + 0.45 * clamp((nt - 36) / 48, 0, 1));
      rA = 0.25 + v * 0.95;
      rK = 1 + (P['r.bark'] !== undefined ? P['r.bark'] : 0.5) * 2.4 * M.bark * 6 * (0.4 + v);
      rOff = M.sym * (0.3 + (P['r.sym'] !== undefined ? P['r.sym'] : 0.5) * 1.4); rOff0 = ftanh(rK * rOff);
      rLvl = (P['r.level'] !== undefined ? P['r.level'] : 0.8) / (rK * 0.5 + 0.5) * 1.1;
      const lpHz = 900 + (P['r.tone'] !== undefined ? P['r.tone'] : 0.6) * M.lp;
      rLpC = Math.exp(-TAU * Math.min(lpHz, SR * 0.45) / SR);
      rB1i = M.b1 && f * M.b1 < SR * 0.45 ? rInc * M.b1 : 0; rB2i = M.b2 && f * M.b2 < SR * 0.45 ? rInc * M.b2 : 0;
      rThA = M.th * v * 0.5; rReed = M.reed;
    }
    const rThDec = Math.exp(-1 / (0.004 * SR)), rAtkInc = 1 / (0.0012 * SR);
    const c1 = this.c1, c2 = this.c2, c3 = this.c3, e0 = vc.e[0], e1 = vc.e[1], e2 = vc.e[2];
    const zl = vc.z[0], zr = vc.z[1], sl = vc.sv[0], sr = vc.sv[1];
    const pk = vc.pk;

    for (let i = 0; i < n; i++) {
      const amp = envTick(e0, c1); envTick(e1, c2); envTick(e2, c3);
      let fL = 0, fR = 0, dL = 0, dR = 0;
      // oscillator B first so A can FM from it
      let bOut = 0;
      if (B.on) {
        const r = this.runOsc(B, vc.bPh, vc.lastA); bOut = r; if (fB) { fL += this.oL; fR += this.oR; } else { dL += this.oL; dR += this.oR; }
        vc.lastB = r;
      }
      if (A.on) {
        const r = this.runOsc(A, vc.aPh, vc.lastB); if (fA) { fL += this.oL; fR += this.oR; } else { dL += this.oL; dR += this.oR; }
        vc.lastA = r;
      }
      if (subLvl > 0) {
        vc.subPh += subInc; if (vc.subPh >= 1) vc.subPh -= 1; const p = vc.subPh;
        let s;
        if (subShape === 0) s = Math.sin(TAU * p);
        else if (subShape === 1) s = p < 0.5 ? p * 4 - 1 : 3 - p * 4;
        else { s = p < 0.5 ? 1 : -1; // polyBLEP square
          const dt = subInc; let t = p; if (t < dt) { t /= dt; s += t + t - t * t - 1; } else if (t > 1 - dt) { t = (t - 1) / dt; s += t * t + t + t + 1; }
          t = (p + 0.5) % 1; if (t < dt) { t /= dt; s -= t + t - t * t - 1; } else if (t > 1 - dt) { t = (t - 1) / dt; s -= t * t + t + t + 1; } s *= 0.7; }
        s *= subLvl * 0.8; if (fS) { fL += s; fR += s; } else { dL += s; dR += s; }
      }
      if (nLvl > 0) {
        const w = brnd(); let s;
        if (nType === 1) { pk[0] = 0.99886 * pk[0] + w * 0.0555179; pk[1] = 0.99332 * pk[1] + w * 0.0750759; pk[2] = 0.969 * pk[2] + w * 0.153852; pk[3] = 0.8665 * pk[3] + w * 0.3104856; pk[4] = 0.55 * pk[4] + w * 0.5329522; pk[5] = -0.7616 * pk[5] - w * 0.016898; s = (pk[0] + pk[1] + pk[2] + pk[3] + pk[4] + pk[5] + pk[6] + w * 0.5362) * 0.11; pk[6] = w * 0.115926; }
        else if (nType === 2) { vc.brown = (vc.brown + w * 0.02) * 0.998; s = vc.brown * 3; }
        else if (nType === 3) { vc.crk *= 0.9; if (rnd() < 0.0004) vc.crk = brnd() * 0.9; s = vc.crk + w * 0.015; }
        else s = w * 0.5;
        s *= nLvl; if (fN) { fL += s; fR += s; } else { dL += s; dR += s; }
      }
      if (aroma) {
        if ((vc.gTimer -= 1) <= 0) { vc.gTimer = gSpawn * (0.6 + rnd() * 0.8); this.spawnGrain(vc, aroma, gBase); }
        let gl2 = 0, gr2 = 0; const len = aroma.length;
        for (let k = 0; k < MAXG; k++) {
          if (!vc.gAct[k]) continue;
          const a = vc.gAge[k] / vc.gLen[k]; if (a >= 1) { vc.gAct[k] = 0; continue; }
          let p = vc.gPos[k]; if (p < 0) p += len; else if (p >= len - 1) p -= len - 1;
          const ip = p | 0, fr = p - ip, s = (aroma[ip] + (aroma[ip + 1] - aroma[ip]) * fr) * HANN[(a * 1024) | 0];
          gl2 += s * vc.gL[k]; gr2 += s * vc.gR[k];
          vc.gPos[k] = p + vc.gInc[k]; vc.gAge[k]++;
        }
        gl2 *= gLvl; gr2 *= gLvl;
        if (fG) { fL += gl2; fR += gr2; } else { dL += gl2; dR += gr2; }
      }
      if (rOn) {
        vc.rPh += rInc; if (vc.rPh >= 1) vc.rPh -= 1;
        if (vc.rAtk < 1) vc.rAtk = Math.min(1, vc.rAtk + rAtkInc);
        const x = Math.sin(TAU * vc.rPh) * vc.rT * rA; vc.rT *= rDec;
        let y;
        if (rReed) { const k = rK * 1.4; y = ftanh(k * (x + rOff * 0.4)) - ftanh(k * rOff * 0.4); y = y * 0.8 + ftanh(y * 2.2) * 0.25; }
        else y = ftanh(rK * (x + rOff)) - rOff0;
        if (rB1i) { vc.rB1 += rB1i; if (vc.rB1 >= 1) vc.rB1 -= 1; y += Math.sin(TAU * vc.rB1) * rBell * vc.rB * vc.rT; }
        if (rB2i) { vc.rB2 += rB2i; if (vc.rB2 >= 1) vc.rB2 -= 1; y += Math.sin(TAU * vc.rB2) * rBell * 0.45 * vc.rB * vc.rT; }
        vc.rB *= rBDec;
        if (vc.rTh > 1e-4) { vc.rThLp += (brnd() - vc.rThLp) * 0.12; y += vc.rThLp * vc.rTh * rThA; vc.rTh *= rThDec; }
        vc.rLp = y + (vc.rLp - y) * rLpC;
        const o = vc.rLp * rLvl * vc.rAtk;
        if (fR2) { fL += o; fR += o; } else { dL += o; dR += o; }
      }
      // filter
      let yL = fL, yR = fR;
      if (ftype === 1 || ftype === 2) {
        const st = ftype === 1 ? 4 : 2;
        for (let c = 0; c < 2; c++) {
          const z = c ? zr : zl; let x = ftanh(((c ? fR : fL) * drv - k4 * z[4]) * 0.5) * 2;
          let v = (x - z[0]) * G; let y = v + z[0]; z[0] = y + v; x = y;
          v = (x - z[1]) * G; y = v + z[1]; z[1] = y + v; x = y;
          if (st === 4) { v = (x - z[2]) * G; y = v + z[2]; z[2] = y + v; x = y; v = (x - z[3]) * G; y = v + z[3]; z[3] = y + v; x = y; }
          z[4] = x; const o = x * comp * outDrv;
          if (c) yR = o; else yL = o;
        }
      } else if (ftype >= 3 && ftype <= 6) {
        for (let c = 0; c < 2; c++) {
          const s = c ? sr : sl, v0 = ftanh((c ? fR : fL) * drv * 0.5) * 2;
          const v3 = v0 - s[1], v1 = a1 * s[0] + a2 * v3, v2 = s[1] + a2 * s[0] + a3 * v3;
          s[0] = 2 * v1 - s[0]; s[1] = 2 * v2 - s[1];
          let o = ftype === 3 ? v2 : ftype === 4 ? v1 * (1 + res) : ftype === 5 ? v0 - kS * v1 - v2 : v0 - kS * v1;
          o *= outDrv; if (c) yR = o; else yL = o;
        }
      } else if (ftype === 7) {
        const cb = vc.comb, w = vc.cw;
        for (let c = 0; c < 2; c++) {
          const b = cb[c], x = (c ? fR : fL);
          const rp = w - combLen; const ip = Math.floor(rp), fr = rp - ip;
          const d = b[ip & 4095] + (b[(ip + 1) & 4095] - b[ip & 4095]) * fr;
          const y = x + d * combFb; b[w & 4095] = ftanh(y * drv * 0.5) * 2 / drv;
          if (c) yR = (x + d) * 0.6; else yL = (x + d) * 0.6;
        }
        vc.cw = (w + 1) & 4095;
      }
      const gg = amp * vg;
      L[off + i] += (yL + dL) * gg * pL; R[off + i] += (yR + dR) * gg * pR;
    }
    if (e0.st === 0) vc.active = false;
  }

  mkOsc() { return { on: false, tab: null, b0: 0, b1: 0, ff: 0, n: 1, inc: new Float64Array(8), gl: new Float32Array(8), gr: new Float32Array(8), warp: 0, wm: 0, pos: 0, fold: 1, sync: 1, fm: 0 }; }
  setupOsc(o, pre, vc, base, dPos, dPitch, dLvl, dWarp, dDet) {
    const P = this.P;
    o.on = !!P[pre + '.on'] && this.tables.length > 0;
    if (!o.on) return o;
    const T = this.tables[P[pre + '.wt'] | 0] || this.tables[0];
    const pos = clamp((P[pre + '.pos'] || 0) + dPos, 0, 1); o.pos = pos;
    const fpos = pos * (T.frames - 1), f0 = Math.floor(fpos);
    o.ff = fpos - f0; o.b0 = f0 * TN; o.b1 = Math.min(f0 + 1, T.frames - 1) * TN;
    const uni = clamp(P[pre + '.uni'] | 0 || 1, 1, 8); o.n = uni;
    const det = clamp((P[pre + '.detune'] || 0) + dDet, 0, 1), blend = P[pre + '.blend'] !== undefined ? P[pre + '.blend'] : 0.5, spread = P[pre + '.spread'] !== undefined ? P[pre + '.spread'] : 0.7;
    const lvl = clamp((P[pre + '.level'] !== undefined ? P[pre + '.level'] : 0.8) + dLvl, 0, 1);
    const opan = P[pre + '.pan'] || 0;
    const pitch = base + (P[pre + '.oct'] || 0) * 12 + (P[pre + '.semi'] || 0) + (P[pre + '.fine'] || 0) / 100 + dPitch * 24;
    o.wm = P[pre + '.warpMode'] | 0; o.warp = clamp((P[pre + '.warp'] || 0) + dWarp, -1, 1);
    const syncR = o.wm === 4 ? 1 + Math.abs(o.warp) * 7 : 1; o.sync = syncR;
    o.fold = 1 + Math.abs(o.warp) * 5; o.fm = Math.abs(o.warp) * 0.6;
    o.bend = Math.pow(2, o.warp * 2.5);
    o.sq = 0.5 + o.warp * 0.45;
    let maxInc = 0, gsum = 0;
    const dmax = det * det * 0.6 + det * 0.15; // semitones at the outermost voice
    for (let u = 0; u < uni; u++) {
      const d = uni === 1 ? 0 : (u / (uni - 1)) * 2 - 1;
      const inc = mtof(pitch + d * dmax + (vc.id * 0.0013 + u * 0.0021) * (P['v.drift'] || 0)) / SR; o.inc[u] = inc; if (inc > maxInc) maxInc = inc;
      const ad = Math.abs(d), gn = uni === 1 ? 1 : (ad < 0.34 ? (1 - blend) * 1.4 + 0.2 : blend * 1.4 + 0.2);
      const p = clamp(d * spread + opan, -1, 1);
      o.gl[u] = gn * Math.min(1, 1 - p); o.gr[u] = gn * Math.min(1, 1 + p); gsum += gn;
    }
    const norm = lvl / Math.max(1, Math.sqrt(gsum * 1.2));
    for (let u = 0; u < uni; u++) { o.gl[u] *= norm; o.gr[u] *= norm; }
    // pick the mip level that keeps the highest harmonic under Nyquist
    const maxH = 0.5 / (maxInc * syncR * (o.wm === 6 ? 2.5 : 1) + 1e-9);
    let L = Math.ceil(Math.log2(1024 / Math.max(1, maxH))); L = clamp(L, 0, MIPS - 1);
    o.tab = T.mips[L];
    return o;
  }
  runOsc(o, ph, fmIn) {
    const t = o.tab, b0 = o.b0, b1 = o.b1, ff = o.ff, wm = o.wm;
    let sl = 0, sr = 0, mono = 0;
    for (let u = 0; u < o.n; u++) {
      let p = ph[u] + o.inc[u]; if (p >= 1) p -= 1; ph[u] = p;
      let q = p;
      switch (wm) {
        case 1: q = Math.pow(p, o.bend); break;
        case 2: q = p < o.sq ? p * 0.5 / o.sq : 0.5 + (p - o.sq) * 0.5 / (1 - o.sq); break;
        case 3: { const m = p < 0.5 ? p * 2 : 2 - p * 2; q = p + (m - p) * Math.abs(o.warp); break; }
        case 4: q = (p * o.sync) % 1; break;
        case 5: q = p + fmIn * o.fm; q -= Math.floor(q); break;
      }
      const x = q * TN, i = x | 0, f = x - i, j = (i + 1) & TMASK, ii = i & TMASK;
      const s0 = t[b0 + ii] + (t[b0 + j] - t[b0 + ii]) * f, s1 = t[b1 + ii] + (t[b1 + j] - t[b1 + ii]) * f;
      let s = s0 + (s1 - s0) * ff;
      if (wm === 6) s = Math.sin(s * o.fold * 1.5707963);
      sl += s * o.gl[u]; sr += s * o.gr[u]; mono += s;
    }
    this.oL = sl; this.oR = sr;
    return mono / o.n;
  }
  spawnGrain(vc, src, base) {
    const P = this.P; let k = -1;
    for (let j = 0; j < MAXG; j++) if (!vc.gAct[j]) { k = j; break; }
    if (k < 0) return;
    const len = src.length, size = (P['g.size'] || 0.12) * SR;
    let pos = base + brnd() * (P['g.spray'] || 0) * len * 0.5;
    pos = ((pos % len) + len) % len;
    let ratio = (P['g.key'] !== 0 ? Math.pow(2, (vc.pitch + vc.bend - 60) / 12) : 1) * (this.srcRate[P['g.src'] | 0] || 1);
    ratio *= Math.pow(2, brnd() * (P['g.pitchRand'] || 0) * 0.5 / 12 * 2);
    if (rnd() < (P['g.shimmer'] || 0)) ratio *= 2;
    const rev = rnd() < (P['g.rev'] || 0);
    vc.gAct[k] = 1; vc.gPos[k] = pos; vc.gInc[k] = rev ? -ratio : ratio; vc.gAge[k] = 0; vc.gLen[k] = Math.max(64, size);
    const sp = (P['g.spread'] !== undefined ? P['g.spread'] : 0.6) * brnd();
    const dens = P['g.dens'] || 12, ol = Math.max(1, dens * (P['g.size'] || 0.12));
    const gn = 0.9 / Math.sqrt(ol);
    vc.gL[k] = gn * Math.min(1, 1 - sp); vc.gR[k] = gn * Math.min(1, 1 + sp);
  }

  // ------------------------------------------------ main
  process(inputs, outputs) {
    const out = outputs[0]; if (!out || !out[0]) return true;
    const oL = out[0], oR = out[1] || out[0], n = oL.length;
    if (this.dirty) this.prepare();
    const R = this.R, gl = this.gl;
    // --- guitar input (mono)
    const inp = inputs[0];
    let pkIn = 0;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (R.guitarOn && inp && inp.length) {
        const a = inp[0] ? inp[0][i] : 0, b = inp[1] ? inp[1][i] : a;
        x = R.inCh === 1 ? a : R.inCh === 2 ? b : (inp.length > 1 ? (a + b) * 0.5 : a);
      }
      if (R.testOn && this.test) { const ip = this.testPos | 0, f = this.testPos - ip, tb = this.test; x += (tb[ip] + ((tb[ip + 1] || 0) - tb[ip]) * f) * R.testLevel; this.testPos += this.testInc || 1; if (this.testPos >= tb.length - 1) this.testPos = 0; }
      x *= R.inGain;
      gl[i] = x; const ax = x < 0 ? -x : x; if (ax > pkIn) pkIn = ax;
      this.cap[this.capW] = x; if (++this.capW >= this.capLen) this.capW = 0;
    }
    // envelope follower + pitch detection
    const needYin = R.tuner || R.track;
    let env = 0;
    for (let i = 0; i < n; i++) {
      env = this.gEnv.run(gl[i]);
      if (needYin && this.yin.push(gl[i]) && R.track) this.trackStep(this.gEnv.v);
    }
    this.gEnvVal = clamp((20 * Math.log10(env + 1e-6) + 50) / 50, 0, 1);
    if (!R.track && this.trk.note >= 0) { this.release(this.voices[15]); this.trk.note = -1; }

    // --- synth
    const sL = this.sL, sR = this.sR; sL.fill(0, 0, n); sR.fill(0, 0, n);
    for (let off = 0; off < n; off += 32) {
      const m = Math.min(32, n - off);
      this.arpTick(m);
      for (const vc of this.voices) if (vc.active) this.renderVoice(vc, sL, sR, off, m);
    }
    for (let i = 0; i < n; i++) { sL[i] *= 0.45; sR[i] *= 0.45; } // voice headroom
    for (let k = 0; k < 2; k++) { this.lfoG[k] += this.lfoRate(k + 1) * n / SR; this.lfoG[k] -= Math.floor(this.lfoG[k]); }
    // tone + synth FX
    let pkS = 0;
    for (let i = 0; i < n; i++) { sL[i] = this.toneHi[0].run(this.toneLo[0].run(sL[i])); sR[i] = this.toneHi[1].run(this.toneLo[1].run(sR[i])); }
    this.fx.process(sL, sR, n, true);
    for (let i = 0; i < n; i++) { const a = Math.abs(sL[i]) > Math.abs(sR[i]) ? Math.abs(sL[i]) : Math.abs(sR[i]); if (a > pkS) pkS = a; }

    // --- pedal chain
    const pL = this.pL, pR = this.pR;
    let st = false;
    const tunerMute = R.tuner && R.tunerMute;
    const dry = R.track ? R.trackDry : 1;
    for (let i = 0; i < n; i++) { pL[i] = gl[i] * dry; pR[i] = pL[i]; }
    if (R.synthToPedals) { for (let i = 0; i < n; i++) { pL[i] += sL[i] * R.synthLevel; pR[i] += sR[i] * R.synthLevel; } st = true; }
    st = this.ped.process(pL, pR, n, st);
    if (!st) for (let i = 0; i < n; i++) pR[i] = pL[i];

    // --- mix + master
    const gL = R.gtrLevel * (tunerMute ? 0 : 1), sLv = R.synthToPedals ? 0 : R.synthLevel * (R.synthOn ? 1 : 0), mv = R.master;
    const att = 1 - Math.exp(-1 / (0.0007 * SR)), rel = 1 - Math.exp(-1 / (0.15 * SR)), ceil = this.lim;
    let pkO = 0;
    for (let i = 0; i < n; i++) {
      let l = (pL[i] * gL + sL[i] * sLv) * mv, r = (pR[i] * gL + sR[i] * sLv) * mv;
      if (R.synthToPedals && tunerMute) { l = 0; r = 0; }
      // DC blocker
      const yl = l - this.dcxL + 0.9995 * this.dcL; this.dcxL = l; this.dcL = yl; l = yl;
      const yr = r - this.dcxR + 0.9995 * this.dcR; this.dcxR = r; this.dcR = yr; r = yr;
      if (l !== l || r !== r) { l = 0; r = 0; this.panic(); }
      const pk = Math.max(Math.abs(l), Math.abs(r));
      const tgt = pk > ceil ? ceil / pk : 1;
      this.limG += (tgt - this.limG) * (tgt < this.limG ? att : rel);
      l *= this.limG; r *= this.limG;
      if (l > 0.98 || l < -0.98) l = ftanh(l); if (r > 0.98 || r < -0.98) r = ftanh(r);
      oL[i] = l; oR[i] = r;
      if (pk * this.limG > pkO) pkO = pk * this.limG;
    }
    // meters ~ 30 Hz
    this.pkIn = Math.max(this.pkIn, pkIn); this.pkOut = Math.max(this.pkOut, pkO); this.pkSyn = Math.max(this.pkSyn, pkS);
    if ((this.meterT += n) >= SR / 30) {
      this.meterT = 0; let voices = 0; let mv0 = null;
      for (const vc of this.voices) if (vc.active) { voices++; if (!mv0) mv0 = vc.modOut; }
      const loops = []; this.ped.u.forEach((c, i) => { if (c.type === 'looper') loops.push({ i, s: c.unit.state, p: c.unit.len ? c.unit.pos / c.unit.len : 0, len: (c.unit.state === 1 ? c.unit.pos : c.unit.len) / SR }); });
      this.port.postMessage({ t: 'm', i: this.pkIn, o: this.pkOut, s: this.pkSyn, v: voices, mv: mv0, lim: this.limG, ge: this.gEnvVal, loops, tn: this.trk.note });
      this.pkIn = 0; this.pkOut = 0; this.pkSyn = 0;
    }
    if (R.tuner && (this.tuneT += n) >= SR / 20) { this.tuneT = 0; this.port.postMessage({ t: 'tu', f: this.yin.freq, c: this.yin.conf, e: this.gEnv.v }); }
    return true;
  }
  panic() { for (const vc of this.voices) { vc.z.forEach(z => z.fill(0)); vc.sv.forEach(s => s.fill(0)); } this.dcL = this.dcR = this.dcxL = this.dcxR = 0; this.port.postMessage({ t: 'panic' }); }
}
registerProcessor('eleo-engine', EleoEngine);

// recorder: captures what the engine plays
class EleoRec extends AudioWorkletProcessor {
  constructor() { super(); this.on = false; this.bl = new Float32Array(8192); this.br = new Float32Array(8192); this.k = 0; this.port.onmessage = (e) => { if (e.data === 'start') { this.on = true; this.k = 0; } else if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ t: 'done' }); } }; }
  flush() { if (this.k) { this.port.postMessage({ t: 'chunk', l: this.bl.slice(0, this.k), r: this.br.slice(0, this.k) }); this.k = 0; } }
  process(inputs, outputs) {
    const i = inputs[0], o = outputs[0];
    if (i && i[0]) { for (let c = 0; c < o.length; c++) o[c].set(i[c] || i[0]); }
    if (this.on && i && i[0]) {
      const l = i[0], r = i[1] || i[0];
      for (let j = 0; j < l.length; j++) { this.bl[this.k] = l[j]; this.br[this.k] = r[j]; if (++this.k >= 8192) this.flush(); }
    }
    return true;
  }
}
registerProcessor('eleo-rec', EleoRec);

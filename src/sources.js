// SPDX-License-Identifier: GPL-3.0-or-later
// Eleosynth — sound sources rendered at start-up: Aroma (granular) textures and test guitar DI loops.
// All of it is synthesised here, so the library is ours outright.
'use strict';
const SRC = (() => {
  let s = 1234567; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  function norm(b, pk = 0.9) { let m = 0; for (const v of b) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= pk / m; return b; }
  function onepoleLP(b, hz, sr) { const a = Math.exp(-2 * Math.PI * hz / sr); let y = 0; for (let i = 0; i < b.length; i++) { y = b[i] + (y - b[i]) * a; b[i] = y; } return b; }

  // ---------------- Aroma textures (root note C4 = MIDI 60)
  function glassAir(sr) {
    const n = Math.floor(sr * 7), b = new Float32Array(n), chord = [60, 64, 67, 71, 74];
    chord.forEach((m, k) => {
      const f = mtof(m);
      [[1, 1], [2, 0.35], [3, 0.12], [4.02, 0.08]].forEach(([ratio, g]) => {
        const w = 2 * Math.PI * f * ratio / sr, rate = 0.15 + k * 0.07 + ratio * 0.03, ph0 = k * 1.3 + ratio;
        for (let i = 0; i < n; i++) b[i] += Math.sin(w * i + ph0) * g * (0.55 + 0.45 * Math.sin(2 * Math.PI * rate * i / sr + ph0)) * 0.2;
      });
    });
    let lp = 0; for (let i = 0; i < n; i++) { lp += (r() - lp) * 0.08; b[i] += lp * 0.04; }
    return norm(b);
  }
  function steam(sr) {
    const n = Math.floor(sr * 7), b = new Float32Array(n); let z1 = 0, z2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, fc = 900 + 700 * Math.sin(t * 0.7) + 400 * Math.sin(t * 2.3), q = 3;
      const g = Math.tan(Math.PI * fc / sr), k = 1 / q, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
      const v0 = r() * (0.6 + 0.4 * Math.sin(t * 1.1)), v3 = v0 - z2, v1 = a1 * z1 + a2 * v3, v2 = z2 + a2 * z1 + a3 * v3;
      z1 = 2 * v1 - z1; z2 = 2 * v2 - z2; b[i] = v1 + r() * 0.03 * (Math.sin(t * 5) > 0.7 ? 1 : 0.2);
    }
    return norm(b);
  }
  function musicBox(sr) {
    const n = Math.floor(sr * 8), b = new Float32Array(n), scale = [60, 62, 64, 67, 69, 72, 74, 76, 79];
    let t = 0.05;
    while (t < 7.6) {
      const m = scale[Math.floor((r() * 0.5 + 0.5) * scale.length)], f = mtof(m), st = Math.floor(t * sr);
      for (const [ratio, g, d] of [[1, 1, 1.6], [2.76, 0.35, 0.5], [5.4, 0.18, 0.2], [8.93, 0.08, 0.1]]) {
        const w = 2 * Math.PI * f * ratio / sr, len = Math.min(n - st, Math.floor(sr * d * 3));
        for (let i = 0; i < len; i++) b[st + i] += Math.sin(w * i) * g * Math.exp(-i / (sr * d)) * 0.3;
      }
      t += [0.25, 0.25, 0.5, 0.125][Math.floor((r() * 0.5 + 0.5) * 4)];
    }
    return norm(b);
  }
  function tinRain(sr) {
    const n = Math.floor(sr * 7), b = new Float32Array(n);
    for (let d = 0; d < 260; d++) {
      const st = Math.floor((r() * 0.5 + 0.5) * (n - sr * 0.3)), f = 1800 + (r() * 0.5 + 0.5) * 4200, w = 2 * Math.PI * f / sr, dec = sr * (0.004 + (r() * 0.5 + 0.5) * 0.02), g = 0.2 + (r() * 0.5 + 0.5) * 0.8;
      for (let i = 0; i < dec * 5; i++) b[st + i] += Math.sin(w * i * (1 - i / (dec * 40))) * Math.exp(-i / dec) * g * 0.25;
    }
    let lp = 0; for (let i = 0; i < n; i++) { lp += (r() - lp) * 0.02; b[i] += lp * 0.25; }
    return norm(b);
  }
  function bowedSteel(sr) {
    const n = Math.floor(sr * 7), b = new Float32Array(n), f = mtof(48);
    const parts = [[1, 1], [2.32, 0.6], [4.25, 0.45], [6.63, 0.3], [9.38, 0.22], [12.5, 0.12]];
    parts.forEach(([ratio, g], k) => {
      const w = 2 * Math.PI * f * ratio / sr;
      for (let i = 0; i < n; i++) { const t = i / sr; b[i] += Math.sin(w * i + 0.002 * Math.sin(2 * Math.PI * (0.3 + k * 0.11) * t) * i / sr * 600) * g * (0.6 + 0.4 * Math.sin(2 * Math.PI * (0.13 + k * 0.05) * t + k)); }
    });
    let lp = 0; for (let i = 0; i < n; i++) { lp += (r() - lp) * 0.3; b[i] += lp * 0.05 * (1 + Math.sin(i / sr * 3)); }
    return norm(b);
  }
  function choirBed(sr) {
    const n = Math.floor(sr * 7), b = new Float32Array(n), F = [[730, 1, 90], [1090, 0.5, 110], [2440, 0.3, 160]];
    for (const m of [48, 55, 60, 64]) {
      const f = mtof(m), H = Math.floor(5000 / f);
      for (let h = 1; h <= H; h++) {
        let a = 0; for (const [Fq, g, bw] of F) a += g * Math.exp(-Math.pow((h * f - Fq) / bw, 2)); a = a / Math.pow(h, 0.4) + 0.003;
        const ph = r() * 6.28, vib = 0.004 + 0.002 * r();
        for (let i = 0; i < n; i++) { const t = i / sr; b[i] += Math.sin(2 * Math.PI * h * f * (t + vib * Math.sin(2 * Math.PI * 5.1 * t) / (2 * Math.PI * 5.1)) + ph) * a * 0.1; }
      }
    }
    return norm(b);
  }
  const AROMAS = [['Glass Air', glassAir], ['Steam', steam], ['Music Box', musicBox], ['Tin Rain', tinRain], ['Bowed Steel', bowedSteel], ['Choir Bed', choirBed]];

  // ---------------- test guitar DI: extended Karplus-Strong
  function pluck(out, st, midi, vel, sr, opts = {}) {
    const f = mtof(midi), N = sr / f, len = Math.floor(N) + 2, line = new Float32Array(len + 4);
    const pickPos = opts.pick || 0.18, damp = opts.damp || 0.996, dur = Math.floor((opts.dur || 2.5) * sr);
    // excitation: filtered noise with a pick-position comb
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += (r() - lp) * (0.35 + vel * 0.5); line[i] = lp; }
    const pp = Math.max(1, Math.floor(N * pickPos)); for (let i = len - 1; i >= pp; i--) line[i] -= line[i - pp];
    let w = 0, prev = 0; const frac = N - Math.floor(N), Ni = Math.floor(N);
    let ap = 0, apIn = 0; const c = (1 - frac) / (1 + frac); // allpass fractional tuning
    for (let i = 0; i < dur && st + i < out.length; i++) {
      const rd = (w - Ni + len * 4) % len;
      const x = line[rd];
      const avg = 0.5 * (x + prev); prev = x;
      const y = c * avg + apIn - c * ap; apIn = avg; ap = y;
      const mute = opts.mute && i > dur * 0.85 ? 0.9 : 1;
      line[w] = y * damp * mute; w = (w + 1) % len;
      out[st + i] += x * vel * 0.5 * Math.min(1, i / 8);
    }
  }
  function riff(sr, kind) {
    const bpm = 96, beat = 60 / bpm, bars = 4, n = Math.floor(sr * beat * 4 * bars), b = new Float32Array(n);
    const at = beats => Math.floor(beats * beat * sr);
    if (kind === 0) { // clean arpeggio: Am  F  C  G
      const chords = [[45, 52, 57, 60, 64], [41, 48, 53, 57, 60], [48, 52, 55, 60, 64], [43, 50, 55, 59, 62]];
      chords.forEach((c, bar) => { const order = [0, 2, 3, 4, 3, 2, 1, 2]; order.forEach((k, j) => pluck(b, at(bar * 4 + j * 0.5), c[k], j === 0 ? 0.95 : 0.7, sr, { dur: 2.2 })); });
    } else if (kind === 1) { // single-note melody (good for guitar -> synth)
      const mel = [[64, 0, 1], [67, 1, 0.5], [69, 1.5, 1.5], [67, 3, 1], [64, 4, 1.5], [62, 5.5, 0.5], [60, 6, 2], [62, 8, 1], [64, 9, 1], [67, 10, 2], [72, 12, 1], [71, 13, 1], [69, 14, 2]];
      mel.forEach(([m, t, d]) => pluck(b, at(t), m, 0.9, sr, { dur: d * beat, mute: true, damp: 0.998 }));
    } else if (kind === 2) { // strummed chords
      const chords = [[40, 47, 52, 55, 59, 64], [36, 43, 48, 52, 55, 64], [43, 47, 50, 55, 59, 67], [38, 45, 50, 57, 62, 66]];
      chords.forEach((c, bar) => [0, 1.5, 2, 3, 3.5].forEach((t, j) => { const down = j % 2 === 0; (down ? c : c.slice().reverse()).forEach((m, k) => pluck(b, at(bar * 4 + t) + k * Math.floor(sr * 0.012), m, down ? 0.8 : 0.55, sr, { dur: 1.4, pick: 0.25 })); }));
    } else { // bass line (low register)
      const line = [[33, 0], [33, 1], [45, 1.5], [33, 2], [36, 3], [38, 3.5], [29, 4], [29, 5], [41, 5.5], [31, 6], [31, 7], [43, 7.5]];
      for (let rep = 0; rep < 2; rep++) line.forEach(([m, t]) => pluck(b, at(rep * 8 + t), m, 0.9, sr, { dur: 0.9, pick: 0.12, damp: 0.995, mute: true }));
    }
    onepoleLP(b, 6500, sr);
    return norm(b, 0.5);
  }
  const RIFFS = ['Clean arpeggio', 'Single-note melody', 'Strummed chords', 'Bass line'];

  return { AROMAS, RIFFS, riff, aroma: (i, sr) => AROMAS[i][1](sr) };
})();

// SPDX-License-Identifier: GPL-3.0-or-later
// Eleosynth — wavetable factory. Every table is generated here at start-up (nothing sampled from elsewhere),
// then band-limited into 11 mip levels (one per octave) so high notes never alias.
'use strict';
const WT = (() => {
  const N = 2048, OS = 8192, FRAMES = 16, LEVELS = 11;

  function fft(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  // harmonic coefficients (complex, 1..1023) from a spectral recipe or a time-domain function
  function fromSpectrum(amp, ph) {
    const cr = new Float64Array(1024), ci = new Float64Array(1024);
    for (let h = 1; h < 1024; h++) {
      const a = amp[h] || 0; if (!a) continue;
      const p = (ph ? ph[h] || 0 : 0) - Math.PI / 2; // sine phase
      cr[h] = (N / 2) * a * Math.cos(p); ci[h] = (N / 2) * a * Math.sin(p);
    }
    return { cr, ci };
  }
  function fromFunction(fn) {
    const re = new Float64Array(OS), im = new Float64Array(OS);
    for (let i = 0; i < OS; i++) re[i] = fn(i / OS);
    fft(re, im, false);
    const cr = new Float64Array(1024), ci = new Float64Array(1024), s = N / OS;
    for (let h = 1; h < 1024; h++) { cr[h] = re[h] * s; ci[h] = im[h] * s; }
    return { cr, ci };
  }
  function fromSamples(buf) { // one cycle of any length -> coefficients
    let n = 1; while (n < buf.length) n <<= 1;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { const x = i * buf.length / n, k = Math.floor(x), f = x - k; re[i] = buf[k % buf.length] * (1 - f) + buf[(k + 1) % buf.length] * f; }
    fft(re, im, false);
    const cr = new Float64Array(1024), ci = new Float64Array(1024), s = N / n;
    for (let h = 1; h < Math.min(1024, n / 2); h++) { cr[h] = re[h] * s; ci[h] = im[h] * s; }
    return { cr, ci };
  }

  function build(frameCoefs) {
    const frames = frameCoefs.length, mips = [], preview = new Float32Array(frames * N);
    for (let L = 0; L < LEVELS; L++) mips.push(new Float32Array(frames * N));
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let f = 0; f < frames; f++) {
      const { cr, ci } = frameCoefs[f];
      let norm = 1;
      for (let L = 0; L < LEVELS; L++) {
        const hmax = Math.max(1, 1024 >> L);
        re.fill(0); im.fill(0);
        for (let h = 1; h < Math.min(hmax + 1, 1024); h++) { re[h] = cr[h]; im[h] = ci[h]; re[N - h] = cr[h]; im[N - h] = -ci[h]; }
        fft(re, im, true);
        if (L === 0) { let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(re[i])); norm = pk > 1e-9 ? 0.95 / pk : 1; }
        const out = mips[L], o = f * N;
        for (let i = 0; i < N; i++) out[o + i] = re[i] * norm;
        if (L === 0) preview.set(out.subarray(o, o + N), o);
      }
    }
    return { frames, mips, preview };
  }

  // ------------------------------------------------ recipes
  let seed = 7; const srand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const shapes = {
    sine: h => h === 1 ? 1 : 0,
    tri: h => h % 2 ? (8 / (Math.PI * Math.PI)) / (h * h) * (((h - 1) / 2) % 2 ? -1 : 1) : 0,
    saw: h => (2 / Math.PI) / h * (h % 2 ? 1 : -1),
    square: h => h % 2 ? (4 / Math.PI) / h : 0,
  };
  function spec(fnAmp) { const a = new Float64Array(1024); for (let h = 1; h < 1024; h++) a[h] = fnAmp(h); return a; }
  const FORM = { a: [[730, 1], [1090, 0.5], [2440, 0.3]], e: [[530, 1], [1840, 0.6], [2480, 0.35]], i: [[270, 1], [2290, 0.4], [3010, 0.3]], o: [[570, 1], [840, 0.6], [2410, 0.2]], u: [[300, 1], [870, 0.4], [2240, 0.12]] };
  function formantAmp(h, f0, fm, bw) { let a = 0; for (const [F, g] of fm) a += g * Math.exp(-Math.pow((h * f0 - F) / bw, 2)); return a / Math.pow(h, 0.35) + 0.002 / h; }
  function mixForm(a, b, t) { return a.map((x, k) => [lerp(x[0], b[k][0], t), lerp(x[1], b[k][1], t)]); }

  const RECIPES = [
    { name: 'Crema Basics', f: t => {
      const seg = t * 3, i = Math.min(2, Math.floor(seg)), u = seg - i, order = [shapes.sine, shapes.tri, shapes.saw, shapes.square];
      return fromSpectrum(spec(h => lerp(order[i](h), order[i + 1](h), u)));
    } },
    { name: 'Analog PWM', f: t => { const w = 0.5 - t * 0.46; return fromFunction(p => (p < w ? 1 : -1) + (1 - 2 * w) * 1); } },
    { name: 'Hard Sync', f: t => { const r = 1 + t * 7; return fromFunction(p => 2 * ((p * r) % 1) - 1); } },
    { name: 'Dark Roast', f: t => { const hc = Math.pow(2, 0.3 + t * 9.3); return fromSpectrum(spec(h => shapes.saw(h) / Math.sqrt(1 + Math.pow(h / hc, 8)))); } },
    { name: 'Resonant Sweep', f: t => { const hp = Math.pow(2, 0.6 + t * 6.8); return fromSpectrum(spec(h => shapes.saw(h) / Math.sqrt(1 + Math.pow(h / hp, 8)) * (1 + 7 * Math.exp(-Math.pow((h - hp) / (hp * 0.12 + 0.7), 2))))); } },
    { name: 'Vowel Pour', f: t => {
      const seq = ['a', 'e', 'i', 'o', 'u'], s = t * 4, i = Math.min(3, Math.floor(s)), u = s - i, fm = mixForm(FORM[seq[i]], FORM[seq[i + 1]], u);
      return fromSpectrum(spec(h => formantAmp(h, 120, fm, 110)));
    } },
    { name: 'Bloom Harmonics', f: t => { const n = 1 + t * 60; return fromSpectrum(spec(h => h > n + 1 ? 0 : Math.min(1, n + 1 - h) / Math.pow(h, 0.65))); } },
    { name: 'Drawbar Organ', f: t => {
      // registrations over harmonics 1,2,3,4,5,6,8 (8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1')
      const H = [1, 2, 3, 4, 5, 6, 8], R = [[8, 0, 0, 0, 0, 0, 0], [8, 8, 8, 0, 0, 0, 0], [8, 3, 8, 0, 0, 0, 0], [8, 8, 8, 8, 0, 0, 0], [8, 8, 8, 8, 8, 8, 8]];
      const s = t * 4, i = Math.min(3, Math.floor(s)), u = s - i;
      return fromSpectrum(spec(h => { const k = H.indexOf(h); return k < 0 ? 0 : Math.pow(10, (lerp(R[i][k], R[i + 1][k], u) - 8) * 3 / 20) * (lerp(R[i][k], R[i + 1][k], u) > 0.05 ? 1 : 0) / Math.sqrt(h); }));
    } },
    { name: 'Moka FM', f: t => { const I = t * 7; return fromFunction(p => Math.sin(2 * Math.PI * p + I * Math.sin(4 * Math.PI * p))); } },
    { name: 'Glass Bells', f: t => {
      seed = 99; const P = [1, 3, 7, 12, 19, 27, 41, 57, 73], ph = new Float64Array(1024);
      const amp = new Float64Array(1024);
      P.forEach((h, k) => { amp[h] = k === 0 ? 1 : Math.pow(0.62, k) * (0.25 + t * 1.3); ph[h] = srand() * 6.283; });
      return fromSpectrum(amp, ph);
    } },
    { name: 'String Pluck', f: t => { const b = 0.04 + t * 0.46; return fromSpectrum(spec(h => Math.sin(Math.PI * h * b) / Math.pow(h, 1.25))); } },
    { name: 'Fold Grind', f: t => { const g = 1 + t * 9; return fromFunction(p => Math.sin(g * Math.sin(2 * Math.PI * p))); } },
    { name: 'Digital Steps', f: t => { const q = Math.max(1, Math.round(2 + Math.pow(1 - t, 2) * 30)); return fromFunction(p => Math.round(Math.sin(2 * Math.PI * p) * q) / q); } },
    { name: 'Spectral Comb', f: t => { const d = 0.02 + t * 0.32; return fromSpectrum(spec(h => shapes.saw(h) * (0.15 + 0.85 * (0.5 + 0.5 * Math.cos(2 * Math.PI * h * d))))); } },
    { name: 'Juno Blend', f: t => { const w = 0.5 - t * 0.38; return fromFunction(p => (2 * p - 1) * (1 - t * 0.55) + ((p < w ? 1 : -1) + (1 - 2 * w)) * (0.25 + t * 0.6)); } },
    { name: 'Choir Haze', f: t => {
      seed = 31; const fm = mixForm(FORM.u, FORM.a, t), ph = new Float64Array(1024);
      for (let h = 1; h < 1024; h++) ph[h] = srand() * 6.283;
      seed = 57;
      return fromSpectrum(spec(h => formantAmp(h, 110, fm, 140) * (0.7 + 0.6 * srand()) + (h > 18 ? 0.004 / Math.sqrt(h) : 0)), ph);
    } },
  ];

  function makeAll(onProgress) {
    const out = [];
    for (let k = 0; k < RECIPES.length; k++) {
      const r = RECIPES[k], coefs = [];
      for (let f = 0; f < FRAMES; f++) coefs.push(r.f(f / (FRAMES - 1)));
      const t = build(coefs); t.name = r.name; out.push(t);
      if (onProgress) onProgress((k + 1) / (RECIPES.length + 1));
    }
    // slot for an imported table: starts as a copy of the first
    const imp = build([RECIPES[0].f(0), RECIPES[0].f(0.66)]); imp.name = 'Your Wavetable'; out.push(imp);
    return out;
  }

  // Import: audio -> frames. A short file becomes one cycle; a long one is cut into up to 64 frames.
  function fromAudio(data) {
    const frames = [];
    if (data.length <= 4096) frames.push(fromSamples(data));
    else if (data.length % N === 0 && data.length / N <= 256) {
      const total = data.length / N, step = Math.max(1, Math.ceil(total / 64));
      for (let f = 0; f < total; f += step) frames.push(fromSamples(data.subarray(f * N, f * N + N)));
    } else {
      const count = Math.min(64, Math.max(2, Math.floor(data.length / N)));
      for (let f = 0; f < count; f++) { const o = Math.floor(f * (data.length - N) / (count - 1)); frames.push(fromSamples(data.subarray(o, o + N))); }
    }
    const t = build(frames); t.name = 'Your Wavetable'; return t;
  }

  return { makeAll, fromAudio, names: RECIPES.map(r => r.name).concat(['Your Wavetable']), N };
})();

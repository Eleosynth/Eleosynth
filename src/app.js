// SPDX-License-Identifier: GPL-3.0-or-later
// Eleosynth — application: audio start-up, panels, displays, pedalboard, keyboard, MIDI, recording, presets.
// Copyright (C) 2026 Josh Wilk. Part of the DAWters and Son suite.
'use strict';
(() => {
  const { h, knob, select, field, toggle, power, menu, toast, overlay, fitCanvas } = KIT;
  const { BYID, INIT, FX, CATS: FXCATS, fxDefaults } = SCHEMA;
  const $ = (s, r = document) => r.querySelector(s);

  // ------------------------------------------------------------------ state
  const store = {
    get(k, d) { try { const v = localStorage.getItem('eleosynth.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('eleosynth.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  let uid = 1; const newId = () => uid++;
  const S = {
    patch: Object.assign({}, INIT), fx: [], name: 'Init', cat: 'Init', desc: '', edited: false,
    rig: { name: 'Clean DI', chain: [] },
    route: { inGain: 1, inCh: 0, gtrLevel: 0.9, synthLevel: 0.9, master: 0.8, synthToPedals: false, track: false, trackDry: 1, trackOct: 0, trackBend: true, trackSens: 0.55, tuner: false, tunerMute: true, testOn: false, testLevel: 1, guitarOn: true, synthOn: true },
    bpm: store.get('bpm', 112), oct: 3, a4: 440, tab: 'synth', modTab: 0,
    user: store.get('user', []), userRigs: store.get('userRigs', []), learn: store.get('learn', {}), learnArm: null,
    takes: [], recording: false, micOn: false, riff: 0,
  };
  const DSTMAP = { 1: ['a.pos'], 3: ['a.level'], 4: ['a.warp'], 5: ['b.pos'], 7: ['b.level'], 8: ['b.warp'], 9: ['f.cutoff'], 10: ['f.res'], 11: ['f.drive'], 12: ['g.pos'], 13: ['g.level'], 14: ['sub.level'], 15: ['n.level'], 16: ['a.detune', 'b.detune'], 18: ['v.vol'] };
  const PARAM2DST = {}; for (const d in DSTMAP) for (const id of DSTMAP[d]) PARAM2DST[id] = +d;
  Object.assign(PARAM2DST, { 'a.semi': 2, 'a.fine': 2, 'b.semi': 6, 'b.fine': 6, 'v.bend': 19 });

  // ------------------------------------------------------------------ audio engine
  let ctx = null, node = null, recNode = null, analyser = null, micSrc = null, micStream = null;
  let previews = null, wtData = null; const aromaBufs = [], aromaOv = [];
  const post = (m, tr) => { if (node) node.port.postMessage(m, tr || []); };

  function makeTables() {
    if (wtData) return;
    wtData = WT.makeAll();
    previews = wtData.map(t => ({ frames: t.frames, data: t.preview, name: t.name }));
    redrawAll();
  }
  function overview(buf, n = 300) { const ov = new Float32Array(n), st = Math.max(1, Math.floor(buf.length / n)); for (let k = 0; k < n; k++) { let m = 0; for (let j = 0; j < st; j++) m = Math.max(m, Math.abs(buf[k * st + j] || 0)); ov[k] = m; } return ov; }
  function makeSources() {
    return new Promise((res) => {
      let i = 0;
      const step = () => {
        if (i >= SRC.AROMAS.length) { res(); return; }
        if (!aromaBufs[i]) { aromaBufs[i] = SRC.aroma(i, 48000); aromaOv[i] = overview(aromaBufs[i]); }
        post({ t: 'source', i, buf: aromaBufs[i].slice(0), sr: 48000 });
        i++; if (S.patch['g.src'] < 6) drawAroma(); setTimeout(step, 0);
      };
      step();
    });
  }

  async function start() {
    if (ctx) { if (ctx.state !== 'running') await ctx.resume(); hideWake(); return; }
    const btn = $('#wake-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Warming up…'; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      const code = document.getElementById('worklet-src').textContent;
      try { await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))); }
      catch (e) { await ctx.audioWorklet.addModule('data:application/javascript;base64,' + btoa(unescape(encodeURIComponent(code)))); }
      node = new AudioWorkletNode(ctx, 'eleo-engine', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
      recNode = new AudioWorkletNode(ctx, 'eleo-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      node.connect(recNode); recNode.connect(analyser); analyser.connect(ctx.destination);
      node.port.onmessage = (e) => onEngine(e.data); recNode.port.onmessage = (e) => onRec(e.data);
      makeTables();
      const tabs = wtData.map(t => ({ frames: t.frames, mips: t.mips.map(m => m.slice(0)) }));
      post({ t: 'tables', tables: tabs }, [].concat(...tabs.map(t => t.mips.map(m => m.buffer))));
      sendAll();
      if (ctx.state !== 'running') await ctx.resume();
      hideWake();
      updateAudioInfo();
      requestAnimationFrame(scopeLoop);
      await makeSources();
      setRiff(S.riff, false);
    } catch (err) {
      console.error(err);
      if (btn) { btn.disabled = false; btn.textContent = 'Start Eleosynth'; }
      toast('Audio could not start: ' + (err && err.message ? err.message : err));
    }
  }
  function sendAll() {
    post({ t: 'bpm', v: S.bpm });
    post({ t: 'patch', p: S.patch });
    post({ t: 'chain', w: 'fx', chain: S.fx });
    post({ t: 'chain', w: 'ped', chain: S.rig.chain });
    post({ t: 'route', r: S.route });
  }
  function hideWake() { const w = $('#wake'); if (w) w.hidden = true; }

  // ------------------------------------------------------------------ engine messages
  let lastMv = null, lastTn = -1;
  function onEngine(m) {
    if (m.t === 'm') {
      meter('#m-out', m.o); meter('#m-in', m.i); meter('#m-in2', m.i);
      const vc = $('#voices'); if (vc) vc.textContent = m.v;
      if (m.mv) { lastMv = m.mv; drawWT('a', true); drawWT('b', true); }
      else if (lastMv) { lastMv = null; drawWT('a'); drawWT('b'); }
      if (m.tn !== lastTn) { keyMark(lastTn + S.route.trackOct * 12, 'gtr', false); lastTn = m.tn; if (m.tn >= 0) keyMark(m.tn + S.route.trackOct * 12, 'gtr', true); }
      for (const l of m.loops) updateLooper(l);
    } else if (m.t === 'tu') tunerShow(m);
    else if (m.t === 'captured') {
      aromaOv[6] = m.ov; toast(m.pk > 0.001 ? 'Captured 6 seconds of guitar for Aroma' : 'Captured silence: play while you press Capture');
      if (S.patch['g.src'] !== 6) setParam('g.src', 6); drawAroma();
      if (!S.patch['g.on']) setParam('g.on', 1);
    } else if (m.t === 'panic') toast('The engine reset a filter that ran away');
  }
  const meterEls = {};
  function meter(sel, v) {
    const el = meterEls[sel] || (meterEls[sel] = $(sel + ' i')); if (!el) return;
    const db = 20 * Math.log10(v + 1e-6); el.style.height = Math.max(0, Math.min(100, (db + 54) / 54 * 100)) + '%';
  }

  // ------------------------------------------------------------------ parameters + controls
  const ctl = {};
  const reg = (id, el) => { (ctl[id] || (ctl[id] = [])).push(el); return el; };
  function setParam(id, v, src) {
    S.patch[id] = v; post({ t: 'p', k: id, v });
    for (const el of ctl[id] || []) if (el !== src) el.set(v);
    markEdited(); paramChanged(id);
  }
  function paramChanged(id) {
    const g = id.split('.')[0];
    if (g === 'a' || g === 'b') { drawWT(g); panelState(); }
    else if (g === 'f') drawFilter();
    else if (/^e\d/.test(g) || /^l\d/.test(g)) drawMod();
    else if (g === 'g') { drawAroma(); panelState(); }
    else if (g === 'r') { drawTine(); panelState(); }
    else if (/^m\d$/.test(g)) { modRings(); renderMatrix(); }
    else if (g === 'sub' || g === 'n' || g === 'arp') panelState();
  }
  function markEdited() { if (!S.edited) { S.edited = true; showPatchName(); } }
  function K(id, opt = {}) {
    const s = BYID[id];
    const el = knob(s, S.patch[id], (v) => setParam(id, v, el), { size: opt.size, label: opt.label, menu: (e, k) => knobMenu(e, k, 'p:' + id, id) });
    el.dataset.pid = id; return reg(id, el);
  }
  function SEL(id, label) { const s = BYID[id]; const el = select(s.opts, S.patch[id], (v) => setParam(id, v, el), { 'aria-label': label || s.label }); reg(id, el); return label === false ? el : field(label || s.label, el); }
  function TOG(id, label) { const el = toggle(label || BYID[id].label, !!S.patch[id], (v) => setParam(id, v ? 1 : 0, el)); return reg(id, el); }
  function PWR(id, label) { const el = power(!!S.patch[id], (v) => setParam(id, v ? 1 : 0, el), label); return reg(id, el); }
  function refreshControls() { for (const id in ctl) for (const el of ctl[id]) el.set(S.patch[id]); }

  function panel(title, opts = {}) {
    const head = h('div', { class: 'phead' }, [h('h2', { html: title + (opts.sub ? `<small>${opts.sub}</small>` : '') })].concat(opts.head || []));
    const body = h('div', { class: 'pbody' });
    const el = h('section', { class: 'panel ' + (opts.cls || ''), 'aria-label': opts.label || title.replace(/<[^>]+>/g, '') }, [head, body]);
    if (opts.onId) el.dataset.on = opts.onId;
    return { el, body, head };
  }
  function panelState() { document.querySelectorAll('.panel[data-on]').forEach(p => p.classList.toggle('off', !S.patch[p.dataset.on])); }

  // knob context menu: reset, MIDI learn, quick modulation
  function knobMenu(e, el, target, pid) {
    const items = [{ label: 'Reset to default', act: () => el.setNorm(KIT.toNorm(el.spec, el.spec.vals ? el.spec.vals[el.spec.def] : el.spec.def)) }];
    const cc = Object.keys(S.learn).find(c => S.learn[c] === target);
    items.push({ label: S.learnArm && S.learnArm.target === target ? 'Cancel MIDI learn' : 'MIDI learn (move a controller)', act: () => armLearn(target, el) });
    if (cc !== undefined) items.push({ label: 'Forget MIDI CC ' + cc, act: () => { delete S.learn[cc]; store.set('learn', S.learn); toast('MIDI CC ' + cc + ' forgotten'); } });
    if (pid && PARAM2DST[pid]) {
      items.push('-', { head: 'Modulate with' });
      for (const [src, name] of [[2, 'Env 2'], [3, 'Env 3'], [4, 'LFO 1'], [5, 'LFO 2'], [6, 'Velocity'], [8, 'Mod wheel'], [7, 'Note'], [9, 'Random'], [10, 'Guitar env']]) items.push({ label: name, act: () => addMod(src, PARAM2DST[pid]) });
    }
    menu(e.clientX, e.clientY, items);
  }
  function armLearn(target, el) {
    if (S.learnArm) { S.learnArm.el.classList.remove('learn'); if (S.learnArm.target === target) { S.learnArm = null; return; } }
    S.learnArm = { target, el }; el.classList.add('learn');
    toast(midiAccess ? 'Move a knob or slider on your MIDI controller' : 'MIDI learn is armed; connect a MIDI controller to finish');
  }
  function addMod(src, dst, amt = 0.4) {
    let slot = -1;
    for (let i = 0; i < 8; i++) if (!(S.patch['m' + i + '.s'] | 0) || !(S.patch['m' + i + '.d'] | 0)) { slot = i; break; }
    if (slot < 0) { toast('All eight matrix slots are in use. Clear one in the Mod matrix.'); return; }
    setParam('m' + slot + '.s', src); setParam('m' + slot + '.d', dst); setParam('m' + slot + '.a', amt);
    toast(SCHEMA.SRCS[src] + ' → ' + SCHEMA.DSTS[dst] + ' (slot ' + (slot + 1) + ')');
  }
  function modRings() {
    const sum = {};
    for (let i = 0; i < 8; i++) {
      const s = S.patch['m' + i + '.s'] | 0, d = S.patch['m' + i + '.d'] | 0, a = +S.patch['m' + i + '.a'] || 0;
      if (s && d && a && DSTMAP[d]) for (const id of DSTMAP[d]) sum[id] = (sum[id] || 0) + a / (BYID[id].max - BYID[id].min);
    }
    if (S.patch['f.env']) sum['f.cutoff'] = (sum['f.cutoff'] || 0) + S.patch['f.env'] * 0.75;
    for (const id in ctl) for (const el of ctl[id]) if (el.setMod) el.setMod(sum[id] || 0);
  }

  // ------------------------------------------------------------------ displays
  function drawWT(o, live) {
    const c = $('#wt-' + o); if (!c || !c.clientWidth || !previews) return;
    const { w, h: H } = fitCanvas(c), g = c.getContext('2d');
    g.clearRect(0, 0, w, H);
    const T = previews[S.patch[o + '.wt'] | 0]; if (!T) return;
    const on = S.patch[o + '.on'], F = T.frames, N = 2048, step = Math.max(1, Math.floor(F / 24)), pts = 96;
    const dx = w * 0.16, dy = H * 0.34, amp = H * 0.2, x0 = w * 0.05, ww = w * 0.74, yb = H * 0.62;
    const line = (fi, xo, yo, style, lw) => {
      g.beginPath(); const base = Math.floor(fi) * N, base2 = Math.min(F - 1, Math.floor(fi) + 1) * N, fr = fi - Math.floor(fi);
      for (let i = 0; i <= pts; i++) { const k = Math.floor(i / pts * (N - 1)); const v = T.data[base + k] * (1 - fr) + T.data[base2 + k] * fr; const x = x0 + xo + i / pts * ww, y = yb - yo - v * amp; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = style; g.lineWidth = lw; g.stroke();
    };
    for (let f = F - 1; f >= 0; f -= step) { const t = f / Math.max(1, F - 1); line(f, dx * t, dy * t, `rgba(188,180,169,${0.08 + 0.18 * (1 - t)})`, 1); }
    const pos = S.patch[o + '.pos'], fpos = pos * (F - 1);
    line(fpos, dx * pos, dy * pos, on ? '#f2b134' : '#7a7168', 2.2 * (w > 400 ? 1.4 : 1));
    if (live && lastMv) { const mp = lastMv[o === 'a' ? 0 : 1]; if (Math.abs(mp - pos) > 0.004) line(mp * (F - 1), dx * mp, dy * mp, 'rgba(212,39,47,.9)', 1.6); }
    g.fillStyle = '#a99586'; g.font = `600 ${Math.round(10 * (w / c.clientWidth))}px Archivo, sans-serif`;
    g.fillText(T.name.toUpperCase() + '  ·  FRAME ' + (Math.round(fpos) + 1) + '/' + F, 8 * (w / c.clientWidth), H - 6 * (w / c.clientWidth));
  }
  function filterMag(type, fc, res, f) {
    const sr = ctx ? ctx.sampleRate : 48000;
    if (type === 0) return 1;
    const w = f / fc;
    if (type === 1 || type === 2) {
      const k = res * 4.3 * (type === 1 ? 1 : 0.5), n = type === 1 ? 4 : 2;
      // (1 + jw)^n + k
      let re = 1, im = 0; for (let i = 0; i < n; i++) { const r2 = re - im * w, i2 = re * w + im; re = r2; im = i2; }
      re += k; return (1 + res * 0.9) / Math.hypot(re, im);
    }
    if (type === 7) { const T = 1 / fc, g = res * 0.96, ph = 2 * Math.PI * f * T; return 0.6 * Math.hypot(1 + Math.cos(ph) * 0, 0) / Math.hypot(1 - g * Math.cos(ph), g * Math.sin(ph)) * (1 + 0); }
    const kS = 2 - 2 * res * 0.985, dr = 1 - w * w, di = kS * w, den = Math.hypot(dr, di);
    if (type === 3) return 1 / den; if (type === 4) return w * (1 + res) / den; if (type === 5) return w * w / den; return Math.abs(dr) / den;
  }
  function drawFilter() {
    const c = $('#flt'); if (!c || !c.clientWidth) return;
    const { w, h: H } = fitCanvas(c), g = c.getContext('2d'); g.clearRect(0, 0, w, H);
    g.strokeStyle = 'rgba(188,180,169,.12)'; g.lineWidth = 1;
    for (const f of [100, 1000, 10000]) { const x = Math.log(f / 20) / Math.log(1000) * w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    const y0 = H * 0.42; g.beginPath(); g.moveTo(0, y0); g.lineTo(w, y0); g.stroke();
    const type = S.patch['f.type'] | 0, fc = 20 * Math.pow(2, S.patch['f.cutoff'] * 10), res = S.patch['f.res'];
    const dbY = db => y0 - db / 30 * (H * 0.42);
    g.beginPath();
    for (let i = 0; i <= 160; i++) { const f = 20 * Math.pow(1000, i / 160); const m = filterMag(type, fc, res, f); const y = Math.min(H, dbY(20 * Math.log10(m + 1e-6))); i ? g.lineTo(i / 160 * w, y) : g.moveTo(0, y); }
    g.strokeStyle = '#f2b134'; g.lineWidth = 2.2; g.stroke();
    g.lineTo(w, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(242,177,52,.08)'; g.fill();
    if (lastMv && type) { const fx = Math.log(20 * Math.pow(2, lastMv[2] * 10) / 20) / Math.log(1000) * w; g.strokeStyle = 'rgba(212,39,47,.85)'; g.beginPath(); g.moveTo(fx, 0); g.lineTo(fx, H); g.stroke(); }
    g.fillStyle = '#a99586'; g.font = `600 ${Math.round(10 * (w / c.clientWidth))}px Martian Mono, monospace`;
    g.fillText(type ? (fc >= 1000 ? (fc / 1000).toFixed(2) + ' kHz' : Math.round(fc) + ' Hz') : 'BYPASS', 8 * (w / c.clientWidth), 16 * (w / c.clientWidth));
  }
  const MODTABS = [['ENV 1', 'e1', 'Amp', 1], ['ENV 2', 'e2', 'Filter', 2], ['ENV 3', 'e3', 'Mod', 3], ['LFO 1', 'l1', '', 4], ['LFO 2', 'l2', '', 5]];
  function drawMod() {
    const c = $('#modc'); if (!c || !c.clientWidth) return;
    const { w, h: H } = fitCanvas(c), g = c.getContext('2d'); g.clearRect(0, 0, w, H);
    const [, pre] = MODTABS[S.modTab];
    g.strokeStyle = '#f2b134'; g.lineWidth = 2.2; g.beginPath();
    const pad = 10, top = 10, bot = H - 12, ht = bot - top;
    if (pre[0] === 'e') {
      const a = S.patch[pre + '.a'], d = S.patch[pre + '.d'], s = S.patch[pre + '.s'], r = S.patch[pre + '.r'];
      const sc = t => Math.sqrt(t) ; const tot = sc(a) + sc(d) + 0.6 + sc(r), u = (w - pad * 2) / tot;
      let x = pad; g.moveTo(x, bot); x += sc(a) * u; g.lineTo(x, top);
      const x1 = x; x += sc(d) * u; for (let i = 1; i <= 24; i++) { const t = i / 24; g.lineTo(x1 + (x - x1) * t, top + (1 - (s + (1 - s) * Math.exp(-4.6 * t))) * ht); }
      g.lineTo(x + 0.6 * u, top + (1 - s) * ht); x += 0.6 * u; const x2 = x; x += sc(r) * u;
      for (let i = 1; i <= 24; i++) { const t = i / 24; g.lineTo(x2 + (x - x2) * t, top + (1 - s * Math.exp(-4.6 * t)) * ht); }
    } else {
      const sh = S.patch[pre + '.shape'] | 0; let seed = 3; const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
      let held = rr(), sm = 0;
      for (let i = 0; i <= 200; i++) {
        const ph = (i / 200 * 2) % 1; let v;
        if (sh === 5) { if (i % 25 === 0) held = rr(); v = held; } else if (sh === 6) { if (i % 25 === 0) held = rr(); sm += (held - sm) * 0.12; v = sm; }
        else v = [Math.sin(2 * Math.PI * ph), ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4, ph * 2 - 1, 1 - ph * 2, ph < 0.5 ? 1 : -1][sh];
        const x = pad + i / 200 * (w - pad * 2), y = top + (0.5 - v * 0.45) * ht; i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  function drawAroma() {
    const c = $('#aroma'); if (!c || !c.clientWidth) return;
    const { w, h: H } = fitCanvas(c), g = c.getContext('2d'); g.clearRect(0, 0, w, H);
    const i = S.patch['g.src'] | 0, ov = aromaOv[i];
    if (!ov) { g.fillStyle = '#7b6a5e'; g.font = `600 ${Math.round(11 * w / c.clientWidth)}px Archivo, sans-serif`; g.fillText(i === 6 ? 'PRESS CAPTURE WHILE YOU PLAY GUITAR' : i === 7 ? 'LOAD AN AUDIO FILE' : 'ROASTING…', 10, H / 2 + 4); return; }
    g.fillStyle = S.patch['g.on'] ? 'rgba(188,180,169,.55)' : 'rgba(188,180,169,.25)';
    const n = ov.length; for (let k = 0; k < n; k++) { const v = ov[k] * H * 0.45; g.fillRect(k / n * w, H / 2 - v, Math.max(1, w / n - 0.5), v * 2); }
    const p = S.patch['g.pos'], sp = S.patch['g.spray'];
    g.fillStyle = 'rgba(242,177,52,.16)'; g.fillRect((p - sp * 0.5) * w, 0, sp * w, H);
    g.fillStyle = '#f2b134'; g.fillRect(p * w - 1, 0, 2.5, H);
  }
  function drawTine() {
    const c = $('#tine'); if (!c || !c.clientWidth) return;
    const { w, h: H } = fitCanvas(c), g = c.getContext('2d'); g.clearRect(0, 0, w, H);
    const on = S.patch['r.on'], sc = w / c.clientWidth, bark = S.patch['r.bark'], bell = S.patch['r.bell'], sym = S.patch['r.sym'];
    const steel = g.createLinearGradient(0, 0, 0, 14 * sc); steel.addColorStop(0, '#efe8dc'); steel.addColorStop(0.5, '#8a8279'); steel.addColorStop(1, '#3a3430');
    // tone bar
    g.fillStyle = on ? '#6b4429' : '#3a2a20'; g.fillRect(w * 0.08, H * 0.22, w * 0.62, 12 * sc);
    // tine (thin rod) vibrating
    const ty = H * 0.62, amp = (6 + bark * 6) * sc;
    g.strokeStyle = on ? '#e9e2d6' : '#7a7168'; g.lineWidth = 3 * sc; g.beginPath();
    for (let i = 0; i <= 60; i++) { const t = i / 60, x = w * 0.08 + t * w * 0.6, y = ty + Math.sin(t * Math.PI) * amp * Math.sin(t * 3.2); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    // hammer
    g.fillStyle = '#2a1a12'; g.fillRect(w * 0.18, ty + 10 * sc, 18 * sc, 18 * sc);
    // pickup: moves closer with bark, offset with pickup symmetry
    const px = w * 0.74 + (1 - bark) * w * 0.1, py = ty - 14 * sc + (sym - 0.5) * 18 * sc;
    g.fillStyle = steel; g.fillRect(px, py, 26 * sc, 28 * sc);
    g.fillStyle = '#d4272f'; g.fillRect(px + 26 * sc, py + 8 * sc, 8 * sc, 12 * sc);
    // bell glints
    g.fillStyle = `rgba(242,177,52,${0.25 + bell * 0.7})`;
    for (let k = 0; k < 3 + Math.round(bell * 4); k++) { const x = w * 0.6 + k * 7 * sc, y = ty - 18 * sc - (k % 2) * 8 * sc; g.beginPath(); g.arc(x, y, 1.6 * sc, 0, 7); g.fill(); }
    g.fillStyle = '#a99586'; g.font = `600 ${Math.round(10 * sc)}px Archivo, sans-serif`;
    g.fillText(SCHEMA.EP[S.patch['r.model'] | 0].toUpperCase(), 8 * sc, H - 6 * sc);
  }
  let scopeBuf = null;
  function scopeLoop() {
    const c = $('#scope');
    if (c && analyser) {
      if (!scopeBuf) scopeBuf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(scopeBuf);
      const { w, h: H } = fitCanvas(c), g = c.getContext('2d'); g.clearRect(0, 0, w, H);
      let z = 0; for (let i = 1; i < 512; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { z = i; break; }
      g.beginPath(); for (let i = 0; i < 400; i++) { const x = i / 400 * w, y = H / 2 - scopeBuf[z + i] * H * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = '#f2b134'; g.lineWidth = 1.5; g.stroke();
    }
    requestAnimationFrame(scopeLoop);
  }
  function redrawAll() { drawWT('a'); drawWT('b'); drawFilter(); drawMod(); drawAroma(); drawTine(); }

  // ------------------------------------------------------------------ SYNTH view
  function buildSynth(root) {
    const grid = h('div', { class: 'grid' }); root.append(grid);
    for (const o of ['a', 'b']) {
      const tsel = SEL(o + '.wt', false);
      tsel.addEventListener('change', () => { if (+tsel.value === 16 && !wtImported) toast('Your Wavetable: use Import to load a WAV or single-cycle file'); });
      const imp = h('button', { class: 'btn small', type: 'button', text: 'Import', title: 'Import a wavetable or single cycle from an audio file', onclick: () => importWavetable(o) });
      const p = panel('Osc ' + o.toUpperCase(), { sub: 'wavetable', head: [PWR(o + '.on', 'Oscillator ' + o.toUpperCase() + ' on'), h('span', { class: 'grow' }), tsel, imp], onId: o + '.on', cls: 'span-6' });
      p.body.append(h('canvas', { class: 'disp', id: 'wt-' + o, style: 'height:132px', 'aria-label': 'Wavetable display' }));
      p.body.append(h('div', { class: 'row' }, [K(o + '.pos', { size: 'lg' }), SEL(o + '.warpMode'), K(o + '.warp'), K(o + '.uni'), K(o + '.detune'), K(o + '.blend'), K(o + '.spread'), K(o + '.level'), K(o + '.pan')]));
      p.body.append(h('div', { class: 'row' }, [K(o + '.oct', { size: 'sm' }), K(o + '.semi', { size: 'sm' }), K(o + '.fine', { size: 'sm' }), K(o + '.phase', { size: 'sm' }), K(o + '.rand', { size: 'sm' }), h('div', { class: 'row', style: 'align-self:center;gap:4px' }, [TOG(o + '.flt'), TOG(o + '.retrig')])]));
      grid.append(p.el);
    }
    // tine piano
    const tp = panel('Tine piano', { sub: 'electric piano', head: [PWR('r.on', 'Tine piano on'), h('span', { class: 'grow' }), SEL('r.model', false)], onId: 'r.on', cls: 'span-4' });
    tp.body.append(h('canvas', { class: 'disp', id: 'tine', style: 'height:84px', 'aria-label': 'Tine and pickup drawing' }));
    tp.body.append(h('div', { class: 'row' }, [K('r.level'), K('r.bell'), K('r.bark'), K('r.sym'), K('r.tone'), K('r.decay'), K('r.damp'), h('div', { style: 'align-self:center' }, [TOG('r.flt')])]));
    tp.body.append(h('p', { class: 'hint', html: '<b>Bark</b> drives the pickup harder as you play harder. <b>Pickup</b> moves it off-centre for more even-harmonic growl. Add <b>Suitcase Pan</b> or <b>Swirl</b> from the FX rack for the classic stage sounds.' }));
    grid.append(tp.el);
    // aroma
    const cap = h('button', { class: 'btn small', type: 'button', text: 'Capture guitar', title: 'Use the last six seconds of guitar input', onclick: () => { if (!node) return toast('Start Eleosynth first'); post({ t: 'capture', sec: 6 }); } });
    const ld = h('button', { class: 'btn small', type: 'button', text: 'Load file', onclick: () => loadAromaFile() });
    const ap = panel('Aroma', { sub: 'granular', head: [PWR('g.on', 'Aroma on'), h('span', { class: 'grow' }), SEL('g.src', false), cap, ld], onId: 'g.on', cls: 'span-4' });
    const ac = h('canvas', { class: 'disp', id: 'aroma', style: 'height:84px', 'aria-label': 'Aroma source: drag to set position' });
    ac.addEventListener('pointerdown', (e) => { const r = ac.getBoundingClientRect(); const mv = (ev) => setParam('g.pos', Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))); mv(e); ac.setPointerCapture(e.pointerId); ac.onpointermove = mv; ac.onpointerup = () => { ac.onpointermove = null; }; });
    ap.body.append(ac);
    ap.body.append(h('div', { class: 'row' }, [K('g.pos'), K('g.spray'), K('g.size'), K('g.dens'), K('g.pitchRand'), K('g.shimmer'), K('g.rev'), K('g.spread'), K('g.level')]));
    ap.body.append(h('div', { class: 'row' }, [TOG('g.key'), TOG('g.flt')]));
    grid.append(ap.el);
    // sub + noise
    const sp = panel('Sub & noise', { cls: 'span-4' });
    const subBox = h('div', {}, [h('div', { class: 'row', style: 'align-items:center;gap:8px;margin-bottom:6px' }, [PWR('sub.on', 'Sub oscillator on'), h('span', { class: 'sub-h', style: 'margin:0', text: 'Sub' }), SEL('sub.shape', false)]), h('div', { class: 'row' }, [SEL('sub.oct'), K('sub.level'), h('div', { style: 'align-self:center' }, [TOG('sub.flt')])])]);
    const nBox = h('div', {}, [h('div', { class: 'row', style: 'align-items:center;gap:8px;margin-bottom:6px' }, [PWR('n.on', 'Noise on'), h('span', { class: 'sub-h', style: 'margin:0', text: 'Noise' }), SEL('n.type', false)]), h('div', { class: 'row' }, [K('n.level'), h('div', { style: 'align-self:center' }, [TOG('n.flt')])])]);
    sp.body.append(h('div', { class: 'split' }, [subBox, nBox]));
    sp.body.append(h('div', { class: 'sub-h', style: 'margin-top:12px', text: 'Voice' }));
    sp.body.append(h('div', { class: 'row' }, [SEL('v.mode'), K('v.poly', { size: 'sm' }), K('v.glide', { size: 'sm' }), K('v.bend', { size: 'sm' }), K('v.drift', { size: 'sm' }), K('v.velamp', { size: 'sm' })]));
    sp.body.append(h('div', { class: 'row' }, [K('v.vol', { size: 'sm' }), K('v.low', { size: 'sm' }), K('v.high', { size: 'sm' })]));
    grid.append(sp.el);
    // filter
    const fp = panel('Filter', { head: [h('span', { class: 'grow' }), SEL('f.type', false)], cls: 'span-4' });
    fp.body.append(h('canvas', { class: 'disp', id: 'flt', style: 'height:110px', 'aria-label': 'Filter response' }));
    fp.body.append(h('div', { class: 'row' }, [K('f.cutoff', { size: 'lg' }), K('f.res', { size: 'lg' }), K('f.drive'), K('f.key'), K('f.env'), K('f.vel')]));
    grid.append(fp.el);
    // modulators
    const mp = panel('Modulators', { sub: 'drag ⠿ onto any knob', cls: 'span-4' });
    const tabs = h('div', { class: 'modtabs', role: 'tablist' });
    const pages = MODTABS.map(([name, pre, sub, srcIdx], i) => {
      const grip = h('span', { class: 'grip', text: '⠿', title: 'Drag onto a knob to modulate it', 'aria-hidden': 'true' });
      const t = h('button', { class: 'modtab', role: 'tab', type: 'button', 'aria-selected': i === S.modTab ? 'true' : 'false' }, [grip, name + (sub ? ' · ' + sub : '')]);
      t.addEventListener('click', () => { S.modTab = i; tabs.querySelectorAll('.modtab').forEach((x, j) => x.setAttribute('aria-selected', j === i)); pagesEls.forEach((p, j) => p.hidden = j !== i); drawMod(); });
      grip.addEventListener('pointerdown', (e) => startModDrag(e, srcIdx, name));
      tabs.append(t);
      const page = h('div', { class: 'row' });
      if (pre[0] === 'e') page.append(K(pre + '.a'), K(pre + '.d'), K(pre + '.s'), K(pre + '.r'));
      else page.append(SEL(pre + '.shape'), K(pre + '.rate'), SEL(pre + '.sync'), K(pre + '.phase', { size: 'sm' }), K(pre + '.fade', { size: 'sm' }), h('div', { style: 'align-self:center' }, [TOG(pre + '.retrig')]));
      page.hidden = i !== S.modTab; return page;
    });
    const pagesEls = pages;
    mp.body.append(tabs, h('canvas', { class: 'disp', id: 'modc', style: 'height:84px', 'aria-label': 'Modulator shape' }), ...pages);
    grid.append(mp.el);
    // arp
    const rp = panel('Arpeggiator', { head: [PWR('arp.on', 'Arpeggiator on')], onId: 'arp.on', cls: 'span-4' });
    rp.body.append(h('div', { class: 'row' }, [SEL('arp.mode'), SEL('arp.rate'), K('arp.oct', { size: 'sm' }), K('arp.gate', { size: 'sm' }), K('arp.swing', { size: 'sm' }), h('div', { style: 'align-self:center' }, [TOG('arp.latch')])]));
    rp.body.append(h('p', { class: 'hint', text: 'Follows the tempo in the header. Hold a chord to play it; Latch keeps it going after you let go.' }));
    grid.append(rp.el);
    // matrix
    const xp = panel('Mod matrix', { sub: 'eight routes', cls: 'span-12' });
    xp.body.append(h('div', { class: 'matrix', id: 'matrix' }));
    xp.body.append(h('p', { class: 'hint', html: 'Drag a modulator’s <b>⠿</b> grip onto a knob, or right-click (long-press) any knob and choose <b>Modulate with</b>. Red rings on knobs show where modulation lands.' }));
    grid.append(xp.el);
    renderMatrix();
  }
  function renderMatrix() {
    const m = $('#matrix'); if (!m) return;
    if (!m.children.length) {
      for (let i = 0; i < 8; i++) {
        const s = select(SCHEMA.SRCS, S.patch['m' + i + '.s'], (v) => setParam('m' + i + '.s', v, s), { 'aria-label': 'Route ' + (i + 1) + ' source' });
        const d = select(SCHEMA.DSTS, S.patch['m' + i + '.d'], (v) => setParam('m' + i + '.d', v, d), { 'aria-label': 'Route ' + (i + 1) + ' destination' });
        const amt = h('span', { class: 'amt' });
        const r = h('input', { type: 'range', min: -100, max: 100, step: 1, value: Math.round(S.patch['m' + i + '.a'] * 100), 'aria-label': 'Route ' + (i + 1) + ' amount' });
        r.addEventListener('input', () => setParam('m' + i + '.a', +r.value / 100, r));
        r.addEventListener('dblclick', () => setParam('m' + i + '.a', 0));
        r.set = (v) => { r.value = Math.round(v * 100); };
        reg('m' + i + '.s', s); reg('m' + i + '.d', d); reg('m' + i + '.a', r);
        const clr = h('button', { class: 'icon-btn', type: 'button', text: '×', 'aria-label': 'Clear route ' + (i + 1), onclick: () => { setParam('m' + i + '.s', 0); setParam('m' + i + '.d', 0); setParam('m' + i + '.a', 0); } });
        m.append(h('div', { class: 'mrow' }, [h('span', { class: 'idx', text: i + 1 }), s, d, h('div', { style: 'display:grid;grid-template-columns:1fr 34px;gap:4px;align-items:center' }, [r, amt]), clr]));
      }
    }
    m.querySelectorAll('.amt').forEach((el, i) => { const a = S.patch['m' + i + '.a']; el.textContent = (a > 0 ? '+' : '') + Math.round(a * 100); });
  }
  function startModDrag(e, src, name) {
    e.preventDefault(); e.stopPropagation();
    const ghost = h('div', { class: 'drag-ghost', text: name + ' →' }); document.body.append(ghost);
    let target = null;
    const move = (ev) => {
      ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
      const el = document.elementFromPoint(ev.clientX, ev.clientY), k = el && el.closest('.knob[data-pid]');
      const ok = k && PARAM2DST[k.dataset.pid] ? k : null;
      if (target !== ok) { if (target) target.classList.remove('drop'); target = ok; if (target) target.classList.add('drop'); }
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); ghost.remove();
      if (target) { target.classList.remove('drop'); addMod(src, PARAM2DST[target.dataset.pid]); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); move(e);
  }

  // ------------------------------------------------------------------ effect units (rack + pedalboard)
  const INKS = { cream: 'cream', gold: 'gold', red: 'red', steel: 'steel', brown: 'brown' };
  function unitKnob(w, unit, kd) {
    const spec = Object.assign({}, kd, { curve: kd.curve, unit: kd.unit });
    const send = (v) => { unit.p[kd.k] = v; post({ t: 'pp', w, i: chainOf(w).indexOf(unit), k: kd.k, v }); };
    if (kd.opts && kd.opts.length <= 4 && !kd.vals) {
      const el = select(kd.opts, unit.p[kd.k], (v) => send(v), { 'aria-label': kd.label });
      const f = field(kd.label, el); f.ctl = el; return f;
    }
    if (kd.opts && !kd.vals) { const el = select(kd.opts, unit.p[kd.k], (v) => send(v), { 'aria-label': kd.label }); const f = field(kd.label, el); f.ctl = el; return f; }
    const el = knob(spec, unit.p[kd.k], send, { size: w === 'ped' ? 'sm' : undefined, menu: (e, k) => knobMenu(e, k, w + ':' + unit.id + ':' + kd.k) });
    el.dataset.unit = unit.id; el.dataset.k = kd.k; return el;
  }
  const chainOf = (w) => w === 'fx' ? S.fx : S.rig.chain;
  function sendChain(w) { post({ t: 'chain', w, chain: chainOf(w) }); if (w === 'fx') { markEdited(); const c = $('#fx-count'); if (c) c.textContent = S.fx.length; } }
  function moveUnit(w, unit, dir) { const ch = chainOf(w), i = ch.indexOf(unit), j = i + dir; if (j < 0 || j >= ch.length) return; ch.splice(i, 1); ch.splice(j, 0, unit); sendChain(w); rebuild(w); }
  function removeUnit(w, unit) { const ch = chainOf(w); ch.splice(ch.indexOf(unit), 1); sendChain(w); rebuild(w); }
  function addUnit(w, type) {
    const unit = { id: newId(), type, on: true, p: fxDefaults(type) };
    chainOf(w).push(unit); sendChain(w); rebuild(w);
    toast(FX[type].name + ' added' + (w === 'fx' ? ' to the synth rack' : ' to the pedalboard'));
  }
  function rebuild(w) { if (w === 'fx') buildRack(); else buildBoard(); }
  function openPool(w) {
    overlay((close) => {
      const sh = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Add an effect' });
      const q = h('input', { type: 'search', placeholder: 'Search 39 effects…', 'aria-label': 'Search effects' });
      const pool = h('div', { class: 'pool' });
      const draw = () => {
        pool.innerHTML = ''; const s = q.value.trim().toLowerCase();
        FXCATS.forEach((cat, ci) => {
          const items = Object.keys(FX).filter(t => FX[t].cat === ci && !(w === 'fx' && FX[t].looper) && (!s || (FX[t].name + ' ' + FX[t].kind).toLowerCase().includes(s)));
          if (!items.length) return;
          pool.append(h('div', { class: 'pool-col' }, [h('h4', { text: cat })].concat(items.map(t => h('button', { type: 'button', class: 'inks-' + FX[t].ink, onclick: () => { addUnit(w, t); close(); } }, [h('b', { text: FX[t].name }), h('span', { text: FX[t].kind })])))));
        });
      };
      q.addEventListener('input', draw); draw();
      sh.append(h('div', { class: 'sheet-h' }, [h('h2', { text: w === 'fx' ? 'Add to synth FX' : 'Add a pedal' }), q, h('button', { class: 'btn', type: 'button', text: 'Close', onclick: close })]), pool);
      setTimeout(() => q.focus(), 30);
      return sh;
    });
  }
  function buildRack() {
    const r = $('#rack'); if (!r) return; r.innerHTML = '';
    if (!S.fx.length) r.append(h('div', { class: 'empty', text: 'No effects on this sound yet. Add one from the pool of 39.' }));
    S.fx.forEach((u, i) => {
      const d = FX[u.type]; if (!d) return;
      const led = h('span', { class: 'led' + (u.on ? ' on' : '') });
      const pw = power(u.on, (v) => { u.on = v; led.classList.toggle('on', v); el.classList.toggle('off', !v); post({ t: 'pon', w: 'fx', i: S.fx.indexOf(u), v }); markEdited(); }, d.name + ' on');
      const el = h('div', { class: 'unit inks-' + d.ink + (u.on ? '' : ' off') }, [
        h('div', { class: 'uhead' }, [pw, led, h('h3', { text: d.name }), h('span', { class: 'kind', text: d.kind }), h('span', { class: 'grow', style: 'flex:1' }),
          h('button', { class: 'icon-btn', type: 'button', text: '↑', 'aria-label': 'Move up', disabled: i === 0 ? true : null, onclick: () => moveUnit('fx', u, -1) }),
          h('button', { class: 'icon-btn', type: 'button', text: '↓', 'aria-label': 'Move down', disabled: i === S.fx.length - 1 ? true : null, onclick: () => moveUnit('fx', u, 1) }),
          h('button', { class: 'icon-btn', type: 'button', text: '×', 'aria-label': 'Remove ' + d.name, onclick: () => removeUnit('fx', u) })]),
        h('div', { class: 'row' }, d.knobs.map(kd => unitKnob('fx', u, kd)))]);
      r.append(el);
    });
  }
  function buildBoard() {
    const b = $('#board'); if (!b) return; b.innerHTML = '';
    S.rig.chain.forEach((u, i) => {
      const d = FX[u.type]; if (!d) return;
      const led = h('span', { class: 'led' + (u.on ? ' on' : '') });
      const knobs = d.knobs.map(kd => unitKnob('ped', u, kd));
      const ped = h('div', { class: 'pedal p-' + d.ink + (u.on ? '' : ' off') + (d.knobs.length > 6 ? ' wide' : ''), 'aria-label': d.name + ' pedal' });
      const foot = h('button', { class: 'foot-btn', type: 'button', 'aria-label': (d.looper ? 'Record, play or overdub' : 'Switch ' + d.name), title: d.looper ? 'Tap: record → play → overdub' : 'On / off' });
      ped.append(h('div', { class: 'ptop' }, [led, h('div', { class: 'pnav' }, [
        h('button', { type: 'button', text: '◀', 'aria-label': 'Move left', onclick: () => moveUnit('ped', u, -1) }),
        h('button', { type: 'button', text: '▶', 'aria-label': 'Move right', onclick: () => moveUnit('ped', u, 1) }),
        h('button', { type: 'button', text: '×', 'aria-label': 'Remove ' + d.name, onclick: () => removeUnit('ped', u) })])]));
      ped.append(h('div', { class: 'knobs' }, knobs));
      if (d.looper) {
        const st = h('div', { class: 'loopstate', id: 'loop-st-' + u.id, text: 'Empty · tap to record' });
        const bar = h('div', { class: 'loopbar' }, [h('i', { id: 'loop-bar-' + u.id })]);
        ped.append(st, bar, h('div', { class: 'row', style: 'justify-content:center' }, [
          h('button', { class: 'btn small', type: 'button', text: 'Stop', onclick: () => post({ t: 'loop', w: 'ped', i: S.rig.chain.indexOf(u), c: 'stop' }) }),
          h('button', { class: 'btn small', type: 'button', text: 'Clear', onclick: () => post({ t: 'loop', w: 'ped', i: S.rig.chain.indexOf(u), c: 'clear' }) })]));
        foot.addEventListener('click', () => { if (!node) return toast('Start Eleosynth first'); if (!u.on) { u.on = true; post({ t: 'pon', w: 'ped', i: S.rig.chain.indexOf(u), v: true }); led.classList.add('on'); } post({ t: 'loop', w: 'ped', i: S.rig.chain.indexOf(u), c: 'tap' }); });
      } else foot.addEventListener('click', () => { u.on = !u.on; led.classList.toggle('on', u.on); ped.classList.toggle('off', !u.on); post({ t: 'pon', w: 'ped', i: S.rig.chain.indexOf(u), v: u.on }); });
      ped.append(h('div', { class: 'foot' }, [h('div', {}, [h('div', { class: 'pname', text: d.name }), h('div', { class: 'pkind', text: d.kind })]), foot]));
      b.append(ped);
      b.append(h('span', { class: 'cable', 'aria-hidden': 'true' }));
    });
    b.append(h('button', { class: 'add-tile', type: 'button', text: '+ Add pedal', onclick: () => openPool('ped') }));
    const rn = $('#rig-name'); if (rn) rn.textContent = S.rig.name;
  }
  const LOOP_ST = ['Empty · tap to record', 'Recording…', 'Playing', 'Overdubbing', 'Stopped'];
  function updateLooper(l) {
    const u = S.rig.chain[l.i]; if (!u) return;
    const st = $('#loop-st-' + u.id), bar = $('#loop-bar-' + u.id);
    if (st) st.textContent = LOOP_ST[l.s] + (l.len ? ' · ' + l.len.toFixed(1) + ' s' : '');
    if (bar) bar.style.width = (l.s === 1 ? 100 : l.p * 100) + '%';
  }

  // ------------------------------------------------------------------ PEDALBOARD view (I/O, tuner, guitar->synth)
  function R(k, v) { S.route[k] = v; post({ t: 'route', r: { [k]: v } }); }
  function rKnob(k, spec, label, toV = (x) => x, fromV = (x) => x, size) {
    const el = knob(Object.assign({ label }, spec), fromV(S.route[k]), (v) => R(k, toV(v)), { size, menu: (e, kk) => knobMenu(e, kk, 'r:' + k) });
    el.dataset.route = k; return el;
  }
  function buildPedalboard(root) {
    const io = h('div', { class: 'io' }); root.append(io);
    // input
    const inp = panel('Guitar input', { cls: '' });
    const conn = h('button', { class: 'btn gold', type: 'button', id: 'mic-btn', text: 'Connect guitar input', onclick: connectMic });
    const dev = h('select', { class: 'sel', id: 'mic-dev', 'aria-label': 'Input device', hidden: true }); dev.addEventListener('change', () => connectMic(true));
    const ch = select(['Both channels', 'Input 1 (left)', 'Input 2 (right)'], S.route.inCh, (v) => R('inCh', v), { 'aria-label': 'Input channel' });
    const riff = select(SRC.RIFFS, S.riff, (v) => setRiff(v, true), { 'aria-label': 'Test guitar riff' });
    const testBtn = toggle('Play test guitar', S.route.testOn, (v) => { if (!node) { testBtn.set(false); return toast('Start Eleosynth first'); } R('testOn', v); });
    testBtn.id = 'test-btn';
    const fileBtn = h('button', { class: 'btn small', type: 'button', text: 'Use an audio file', onclick: loadTestFile });
    inp.body.append(h('div', { class: 'row', style: 'align-items:center;gap:8px' }, [conn, dev, ch]));
    inp.body.append(h('div', { class: 'row', style: 'align-items:flex-end;gap:8px;margin-top:8px' }, [
      rKnob('inGain', { min: -12, max: 24, def: 0, unit: 'dB' }, 'Input gain', (v) => Math.pow(10, v / 20), (g) => 20 * Math.log10(g)),
      h('div', { class: 'meter', id: 'm-in', style: 'height:46px', title: 'Input level' }, [h('i')]),
      h('div', { class: 'field' }, [h('span', { class: 'lbl', text: 'Test guitar' }), riff, h('div', { class: 'row', style: 'gap:4px' }, [testBtn, fileBtn])])]));
    inp.body.append(h('p', { class: 'hint', id: 'mic-note', html: 'Plug in through an audio interface. Monitor on headphones. <b>Test guitar</b> plays a DI recording through the board so you can shape a tone without plugging in.' }));
    io.append(inp.el);
    // tuner
    const tu = panel('Tuner', { head: [h('span', { class: 'grow' }), toggle('On', S.route.tuner, (v) => { R('tuner', v); if (!v) tunerShow(null); })] });
    tu.body.append(h('div', { class: 'tuner-face' }, [h('div', { class: 'tuner-note', id: 'tn-note', text: '–' }), h('div', { class: 'tuner-scale' }, [h('span', { class: 'zone' }), h('span', { class: 'needle', id: 'tn-needle' })])]));
    tu.body.append(h('div', { class: 'tuner-read', id: 'tn-read', text: 'Switch the tuner on and play one string.' }));
    tu.body.append(h('div', { class: 'row', style: 'align-items:center;gap:8px' }, [toggle('Mute while tuning', S.route.tunerMute, (v) => R('tunerMute', v)),
      knob({ label: 'A4', min: 430, max: 450, def: 440, int: true, unit: 'Hz' }, S.a4, (v) => { S.a4 = v; }, { size: 'sm' })]));
    io.append(tu.el);
    // guitar -> synth
    const gs = panel('Guitar → Synth', { sub: 'pitch tracking' });
    const trackBtn = toggle('Play the synth', S.route.track, (v) => { R('track', v); if (v && !S.patch['v.mode']) toast('Tip: Guitar synth patches are mono and glide; try the Guitar synth category'); });
    gs.body.append(h('div', { class: 'row', style: 'align-items:center;gap:6px' }, [trackBtn, toggle('Follow bends', S.route.trackBend, (v) => R('trackBend', v)),
      select(['−2 oct', '−1 oct', 'Same', '+1 oct', '+2 oct'], S.route.trackOct + 2, (v) => R('trackOct', v - 2), { 'aria-label': 'Synth octave' })]));
    gs.body.append(h('div', { class: 'row', style: 'margin-top:6px' }, [rKnob('trackDry', { min: 0, max: 1, def: 1 }, 'Dry guitar', undefined, undefined, 'sm'), rKnob('trackSens', { min: 0, max: 1, def: 0.55 }, 'Sensitivity', undefined, undefined, 'sm'),
      h('div', { class: 'field', style: 'align-self:center' }, [h('button', { class: 'btn small', type: 'button', text: 'Capture 6 s for Aroma', onclick: () => { if (!node) return toast('Start Eleosynth first'); post({ t: 'capture', sec: 6 }); } })])]));
    gs.body.append(h('p', { class: 'hint', html: 'Single notes track best. Your guitar plays the current synth patch; the red key shows the note it hears. <b>Guitar env</b> is also a mod source in the matrix.' }));
    io.append(gs.el);
    // mix
    const mx = panel('Mix');
    mx.body.append(h('div', { class: 'row' }, [rKnob('gtrLevel', { min: 0, max: 1.5, def: 0.9 }, 'Guitar'), rKnob('synthLevel', { min: 0, max: 1.5, def: 0.9 }, 'Synth')]));
    mx.body.append(h('div', { class: 'row', style: 'margin-top:6px' }, [toggle('Synth into pedals', S.route.synthToPedals, (v) => R('synthToPedals', v))]));
    mx.body.append(h('p', { class: 'hint', text: 'Synth into pedals sends the synth (after its own FX rack) through this board too.' }));
    io.append(mx.el);
    // rig bar + board
    const rigBar = h('div', { class: 'row', style: 'align-items:center;gap:8px;margin:4px 0 10px' }, [
      h('span', { class: 'lbl', text: 'Rig' }),
      h('button', { class: 'icon-btn', type: 'button', text: '‹', 'aria-label': 'Previous rig', onclick: () => stepRig(-1) }),
      h('button', { class: 'patch-btn', type: 'button', onclick: openRigs }, [h('i', { text: 'Pedalboard' }), h('b', { id: 'rig-name', text: S.rig.name })]),
      h('button', { class: 'icon-btn', type: 'button', text: '›', 'aria-label': 'Next rig', onclick: () => stepRig(1) }),
      h('button', { class: 'btn small', type: 'button', text: 'Save rig', onclick: saveRig }),
      h('button', { class: 'btn small', type: 'button', text: 'Clear board', onclick: () => { S.rig = { name: 'Empty board', chain: [] }; sendChain('ped'); buildBoard(); } }),
      h('span', { style: 'flex:1' }),
      h('span', { class: 'lbl', text: 'Signal flows left to right' })]);
    root.append(rigBar, h('div', { class: 'board', id: 'board' }));
    buildBoard();
  }
  const NOTE_N = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function tunerShow(m) {
    const n = $('#tn-note'), nd = $('#tn-needle'), rd = $('#tn-read'); if (!n) return;
    if (!m || m.c < 0.85 || m.f <= 0 || m.e < 0.002) { n.textContent = '–'; n.classList.remove('in'); nd.style.left = '50%'; if (m) rd.textContent = 'Listening…'; return; }
    const midi = 69 + 12 * Math.log2(m.f / S.a4), r = Math.round(midi), cents = (midi - r) * 100;
    n.textContent = NOTE_N[((r % 12) + 12) % 12]; n.classList.toggle('in', Math.abs(cents) < 3);
    nd.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
    rd.textContent = `${m.f.toFixed(1)} Hz · ${NOTE_N[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1} · ${cents > 0 ? '+' : ''}${cents.toFixed(1)} ¢ ${Math.abs(cents) < 3 ? '· in tune' : cents < 0 ? '· tune up' : '· tune down'}`;
  }
  async function connectMic(switchDev) {
    if (!ctx) await start();
    const note = $('#mic-note');
    try {
      if (micStream) { micStream.getTracks().forEach(t => t.stop()); if (micSrc) micSrc.disconnect(); }
      const dev = $('#mic-dev');
      const c = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, latency: 0 };
      if (switchDev === true && dev && dev.value) c.deviceId = { exact: dev.value };
      if (window.eleoNative && window.eleoNative.micAccess) await window.eleoNative.micAccess();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: c });
      micSrc = ctx.createMediaStreamSource(micStream); micSrc.connect(node);
      S.micOn = true; $('#mic-btn').textContent = 'Input connected'; $('#mic-btn').classList.remove('gold');
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      if (dev) { dev.innerHTML = ''; devs.forEach(d => dev.append(h('option', { value: d.deviceId, text: d.label || 'Input ' + (dev.length + 1) }))); dev.hidden = devs.length < 2; const cur = micStream.getAudioTracks()[0].getSettings().deviceId; if (cur) dev.value = cur; }
      note.className = 'hint'; note.innerHTML = 'Input is live. Keep the input gain so the meter peaks in the yellow. Use headphones to avoid feedback.';
      updateAudioInfo();
    } catch (err) {
      note.className = 'notice red';
      note.innerHTML = 'Eleosynth could not open an audio input here. ' + (location.protocol === 'file:' || location.hostname.includes('claude') || location.hostname.includes('usercontent') ? 'This preview blocks live inputs: run the standalone version (the web launcher in the download) in Chrome or Edge to plug in a guitar. ' : 'Allow microphone access for this page in the browser, then try again. ') + 'Until then, <b>Play test guitar</b> runs the board.';
    }
  }
  function setRiff(i, announce) {
    S.riff = i; if (!node) return;
    const b = SRC.riff(48000, i); post({ t: 'test', buf: b, sr: 48000 }, [b.buffer]);
    if (announce) toast('Test guitar: ' + SRC.RIFFS[i]);
  }
  function pickFile(accept) { return new Promise((res) => { const i = h('input', { type: 'file', accept }); i.addEventListener('change', () => res(i.files[0] || null)); i.click(); }); }
  async function decodeFile(accept) {
    const f = await pickFile(accept); if (!f) return null;
    if (!ctx) await start();
    try { const ab = await ctx.decodeAudioData(await f.arrayBuffer()); const n = ab.length, m = new Float32Array(n); for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i] / ab.numberOfChannels; } return { data: m, sr: ab.sampleRate, name: f.name }; }
    catch (e) { toast('That file could not be read as audio'); return null; }
  }
  async function loadTestFile() {
    const a = await decodeFile('audio/*'); if (!a) return;
    let pk = 0; for (const v of a.data) pk = Math.max(pk, Math.abs(v)); if (pk > 0) for (let i = 0; i < a.data.length; i++) a.data[i] *= 0.5 / pk;
    post({ t: 'test', buf: a.data, sr: a.sr }, [a.data.buffer]); R('testOn', true); const tb = $('#test-btn'); if (tb) tb.set(true);
    toast('Playing ' + a.name + ' through the board');
  }
  async function loadAromaFile() {
    const a = await decodeFile('audio/*'); if (!a) return;
    const d = a.data.length > a.sr * 20 ? a.data.slice(0, a.sr * 20) : a.data;
    let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / pk;
    aromaOv[7] = overview(d); post({ t: 'source', i: 7, buf: d, sr: a.sr });
    setParam('g.src', 7); if (!S.patch['g.on']) setParam('g.on', 1); drawAroma(); toast('Aroma source: ' + a.name);
  }
  let wtImported = false;
  async function importWavetable(o) {
    const a = await decodeFile('audio/*,.wav'); if (!a) return;
    makeTables();
    const t = WT.fromAudio(a.data); wtImported = true;
    previews[16] = { frames: t.frames, data: t.preview, name: 'Your Wavetable' };
    post({ t: 'table', i: 16, tab: { frames: t.frames, mips: t.mips } }, t.mips.map(m => m.buffer));
    setParam(o + '.wt', 16); drawWT(o); toast(`Imported ${a.name}: ${t.frames} frame${t.frames > 1 ? 's' : ''}`);
  }

  // ------------------------------------------------------------------ patches + rigs
  function loadPatch(pr) {
    post({ t: 'allOff' });
    S.patch = Object.assign({}, INIT, pr.p || {});
    S.fx = (pr.fx || []).map(f => ({ id: newId(), type: f.type, on: f.on !== false, p: Object.assign(fxDefaults(f.type), f.p || {}) }));
    S.name = pr.name; S.cat = pr.cat || 'User'; S.desc = pr.desc || ''; S.edited = false;
    post({ t: 'patch', p: S.patch }); post({ t: 'chain', w: 'fx', chain: S.fx });
    refreshControls(); buildRack(); renderMatrix(); modRings(); panelState(); redrawAll(); showPatchName();
    const c = $('#fx-count'); if (c) c.textContent = S.fx.length;
    store.set('last', { name: S.name });
  }
  function showPatchName() {
    $('#patch-name').textContent = S.name + (S.edited ? ' *' : '');
    $('#patch-cat').textContent = S.cat;
    const d = $('#patch-desc'); if (d) d.textContent = S.desc;
  }
  const allPatches = () => PRESETS.PATCHES.concat(S.user);
  function stepPatch(d) {
    const list = allPatches(); let i = list.findIndex(p => p.name === S.name && (p.cat || 'User') === S.cat);
    i = (i + d + list.length) % list.length; loadPatch(list[i]);
  }
  function openBrowser() {
    overlay((close) => {
      const sh = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Sound browser' });
      const q = h('input', { type: 'search', placeholder: 'Search sounds…', 'aria-label': 'Search sounds' });
      const cats = h('div', { class: 'cats', role: 'tablist' }), list = h('div', { class: 'plist' });
      let cat = 'All';
      const names = ['All'].concat(PRESETS.CATS, ['User']);
      const draw = () => {
        cats.innerHTML = '';
        names.forEach(c => cats.append(h('button', { type: 'button', role: 'tab', 'aria-selected': c === cat ? 'true' : 'false', text: c + (c === 'User' ? ' (' + S.user.length + ')' : ''), onclick: () => { cat = c; draw(); } })));
        list.innerHTML = ''; const s = q.value.trim().toLowerCase();
        const items = allPatches().filter(p => (cat === 'All' || (p.cat || 'User') === cat || (cat === 'User' && S.user.includes(p))) && (!s || (p.name + ' ' + (p.desc || '') + ' ' + p.cat).toLowerCase().includes(s)));
        if (!items.length) list.append(h('div', { class: 'empty', text: cat === 'User' ? 'Sounds you save appear here.' : 'Nothing matches that search.' }));
        for (const p of items) list.append(h('button', { type: 'button', class: 'pcard', 'aria-current': p.name === S.name ? 'true' : 'false', onclick: () => { loadPatch(p); draw(); }, ondblclick: close }, [h('i', { text: p.cat || 'User' }), h('b', { text: p.name }), h('span', { text: p.desc || '' })]));
      };
      q.addEventListener('input', draw); draw();
      sh.append(h('div', { class: 'sheet-h' }, [h('h2', { text: 'Sounds' }), q,
        h('button', { class: 'btn', type: 'button', text: 'Init', onclick: () => { loadPatch({ name: 'Init', cat: 'Init', p: {}, fx: [] }); close(); } }),
        h('button', { class: 'btn gold', type: 'button', text: 'Surprise me', onclick: () => { loadPatch(randomPatch()); close(); } }),
        h('button', { class: 'btn', type: 'button', text: 'Done', onclick: close })]), h('div', { class: 'sheet-b' }, [cats, list]));
      setTimeout(() => q.focus(), 30);
      return sh;
    });
  }
  function savePatch() {
    overlay((close) => {
      const name = h('input', { type: 'text', value: S.edited || S.cat === 'Init' ? (S.name === 'Init' ? 'My sound' : S.name + ' II') : S.name, 'aria-label': 'Name', style: 'flex:1;min-width:160px;background:var(--char);border:1px solid var(--line);border-radius:8px;padding:8px 10px' });
      const cat = select(PRESETS.CATS, Math.max(0, PRESETS.CATS.indexOf(S.cat)), () => {}, { 'aria-label': 'Category' });
      const desc = h('input', { type: 'text', placeholder: 'A line about it (optional)', 'aria-label': 'Description', style: 'flex:2;min-width:180px;background:var(--char);border:1px solid var(--line);border-radius:8px;padding:8px 10px' });
      const go = (e) => {
        e && e.preventDefault(); const nm = name.value.trim() || 'My sound';
        const p = {}; for (const k in S.patch) if (S.patch[k] !== INIT[k]) p[k] = S.patch[k];
        const pr = { name: nm, cat: PRESETS.CATS[+cat.value], desc: desc.value.trim(), user: true, p, fx: S.fx.map(u => ({ type: u.type, on: u.on, p: Object.assign({}, u.p) })) };
        S.user = S.user.filter(u => u.name !== nm).concat([pr]); store.set('user', S.user);
        S.name = nm; S.cat = pr.cat; S.desc = pr.desc; S.edited = false; showPatchName(); close(); toast('Saved “' + nm + '” on this device');
      };
      const f = h('form', { class: 'sheet', style: 'width:min(640px,100%)', onsubmit: go }, [
        h('div', { class: 'sheet-h' }, [h('h2', { text: 'Save sound' })]),
        h('div', { class: 'row', style: 'padding:14px 16px;gap:10px;align-items:center' }, [name, cat, desc]),
        h('div', { class: 'row', style: 'padding:0 16px 16px;gap:8px' }, [h('button', { class: 'btn gold', type: 'submit', text: 'Save' }), h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close }), h('span', { class: 'hint', style: 'align-self:center', text: 'Saved in this browser. Use Export on the Takes & files tab to keep a copy.' })])]);
      setTimeout(() => name.select(), 30);
      return f;
    });
  }
  function loadRig(r) {
    S.rig = { name: r.name, chain: r.chain.map(f => ({ id: newId(), type: f.type, on: f.on !== false, p: Object.assign(fxDefaults(f.type), f.p || {}) })) };
    sendChain('ped'); buildBoard();
  }
  const allRigs = () => PRESETS.RIGS.concat(S.userRigs);
  function stepRig(d) { const l = allRigs(); let i = l.findIndex(r => r.name === S.rig.name); i = (i + d + l.length) % l.length; loadRig(l[i]); toast('Rig: ' + l[i].name); }
  function openRigs() {
    overlay((close) => {
      const sh = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Rigs' });
      const list = h('div', { class: 'plist', style: 'padding:14px' });
      for (const r of allRigs()) list.append(h('button', { type: 'button', class: 'pcard', 'aria-current': r.name === S.rig.name ? 'true' : 'false', onclick: () => { loadRig(r); close(); } }, [h('i', { text: r.chain.length + ' pedals' }), h('b', { text: r.name }), h('span', { text: r.desc || r.chain.map(c => FX[c.type].name).join(' → ') })]));
      sh.append(h('div', { class: 'sheet-h' }, [h('h2', { text: 'Pedalboard rigs' }), h('span', { style: 'flex:1' }), h('button', { class: 'btn', type: 'button', text: 'Close', onclick: close })]), list);
      return sh;
    });
  }
  function saveRig() {
    const base = S.rig.name.replace(/ \(mine\)$/, ''), nm = base + ' (mine)';
    const r = { name: nm, desc: 'Saved ' + new Date().toLocaleDateString(), chain: S.rig.chain.map(u => ({ type: u.type, on: u.on, p: Object.assign({}, u.p) })) };
    S.userRigs = S.userRigs.filter(x => x.name !== nm).concat([r]); store.set('userRigs', S.userRigs); S.rig.name = nm; buildBoard(); toast('Saved rig “' + nm + '” on this device');
  }
  function randomPatch() {
    const r = Math.random, pick = (a) => a[Math.floor(r() * a.length)];
    const kind = pick(['pad', 'pluck', 'keys', 'lead', 'bass']);
    const p = { 'a.wt': Math.floor(r() * 16), 'a.pos': r(), 'a.uni': kind === 'bass' ? 1 + Math.floor(r() * 3) : 1 + Math.floor(r() * 7), 'a.detune': 0.1 + r() * 0.35, 'f.type': pick([1, 1, 2, 3, 3, 7]), 'f.cutoff': 0.35 + r() * 0.45, 'f.res': r() * 0.5, 'v.drift': 0.15 + r() * 0.3 };
    if (r() < 0.6) Object.assign(p, { 'b.on': 1, 'b.wt': Math.floor(r() * 16), 'b.pos': r(), 'b.oct': pick([-1, 0, 0, 1]), 'b.level': 0.3 + r() * 0.4, 'b.uni': 1 + Math.floor(r() * 4) });
    if (kind === 'pad') Object.assign(p, { 'e1.a': 0.3 + r() * 1.5, 'e1.s': 0.9, 'e1.r': 1 + r() * 3, 'l1.rate': 0.05 + r() * 0.5, 'm0.s': 4, 'm0.d': pick([1, 5, 9]), 'm0.a': 0.15 + r() * 0.3 });
    if (kind === 'pluck') Object.assign(p, { 'e1.a': 0.001, 'e1.d': 0.3 + r() * 0.8, 'e1.s': 0, 'e1.r': 0.3 + r() * 0.5, 'f.env': 0.3 + r() * 0.3, 'e2.d': 0.15 + r() * 0.3, 'e2.s': 0 });
    if (kind === 'keys') Object.assign(p, { 'r.on': r() < 0.6 ? 1 : 0, 'r.model': Math.floor(r() * 6), 'a.level': 0.45, 'e1.a': 0.002, 'e1.s': 1, 'e1.r': 0.5 });
    if (kind === 'lead') Object.assign(p, { 'v.mode': 2, 'v.glide': r() * 0.12, 'e1.s': 1, 'e1.r': 0.25, 'l1.rate': 5, 'l1.fade': 0.5, 'm0.s': 4, 'm0.d': 19, 'm0.a': 0.005 });
    if (kind === 'bass') Object.assign(p, { 'v.mode': 2, 'sub.on': 1, 'sub.level': 0.4, 'f.cutoff': 0.3 + r() * 0.2, 'f.env': 0.3 + r() * 0.3, 'e2.d': 0.2 + r() * 0.3, 'e2.s': 0.05, 'e1.r': 0.12 });
    if (r() < 0.3) Object.assign(p, { 'g.on': 1, 'g.src': Math.floor(r() * 6), 'g.level': 0.35 });
    const pool = kind === 'bass' ? ['comp', 'grind', 'widener'] : ['chorus', 'hyper', 'ensemble', 'phaser', 'delay', 'revdelay', 'reverb', 'plate', 'cassette', 'autopan', 'cloud', 'formant'];
    const fxl = []; const n = 1 + Math.floor(r() * 3); while (fxl.length < n) { const t = pick(pool); if (!fxl.find(x => x.type === t)) fxl.push({ type: t, p: {} }); }
    if (kind !== 'bass' && !fxl.find(x => x.type === 'reverb' || x.type === 'plate')) fxl.push({ type: pick(['reverb', 'plate']), p: { mix: 0.3 } });
    const A = ['Roasted', 'Velvet', 'Midnight', 'Copper', 'Steamed', 'Burnt', 'Honey', 'Cherry', 'Neon', 'Paper', 'Golden', 'Smoky', 'Iron', 'Morning'], B = ['Lagoon', 'Static', 'Bloom', 'Pour', 'Signal', 'Crema', 'Arcade', 'Harbor', 'Choir', 'Drift', 'Engine', 'Lantern', 'Orchard', 'Cassette'];
    return { name: pick(A) + ' ' + pick(B), cat: { pad: 'Pads', pluck: 'Plucks', keys: 'Keys', lead: 'Leads', bass: 'Bass' }[kind], desc: 'Rolled by Surprise me. Save it if you like it.', p, fx: fxl };
  }

  // ------------------------------------------------------------------ TAKES & FILES view
  function buildTakes(root) {
    const grid = h('div', { class: 'grid' }); root.append(grid);
    const tp = panel('Takes', { sub: 'record what you hear', cls: 'span-7' });
    tp.body.append(h('div', { class: 'row', style: 'align-items:center;gap:10px;margin-bottom:10px' }, [h('button', { class: 'btn red', type: 'button', id: 'rec-big', text: 'Record', onclick: toggleRec }), h('span', { class: 'hint', style: 'margin:0', text: 'Records the master output: synth, guitar and every effect. The red button in the header does the same.' })]));
    tp.body.append(h('div', { class: 'takes', id: 'takes' }, [h('div', { class: 'empty', text: 'No takes yet.' })]));
    grid.append(tp.el);
    const fp = panel('Sounds & rigs', { cls: 'span-5' });
    fp.body.append(h('div', { class: 'row', style: 'gap:8px' }, [
      h('button', { class: 'btn', type: 'button', text: 'Export this sound', onclick: () => saveFile(S.name.replace(/[^\w\- ]+/g, '') + '.eleosynth.json', JSON.stringify(currentPatchJSON(), null, 1)) }),
      h('button', { class: 'btn', type: 'button', text: 'Import a sound', onclick: importPatch }),
      h('button', { class: 'btn', type: 'button', text: 'Export my library', onclick: () => saveFile('eleosynth-library.json', JSON.stringify({ app: 'Eleosynth', sounds: S.user, rigs: S.userRigs }, null, 1)) })]));
    fp.body.append(h('p', { class: 'hint', text: 'Sounds and rigs you save stay in this browser. Exports are plain JSON you can keep, share or load into the Android and desktop builds later.' }));
    fp.body.append(h('div', { class: 'sub-h', style: 'margin-top:12px', text: 'MIDI' }));
    fp.body.append(h('p', { class: 'hint', id: 'midi-status', text: 'Looking for MIDI…' }));
    fp.body.append(h('div', { class: 'sub-h', style: 'margin-top:12px', text: 'Audio' }));
    fp.body.append(h('p', { class: 'hint', id: 'audio-info', text: 'Start Eleosynth to see the sample rate and latency.' }));
    fp.body.append(h('div', { class: 'sub-h', style: 'margin-top:12px', text: 'Playing from the computer keyboard' }));
    fp.body.append(h('p', { class: 'hint', html: '<b>A W S E D F T G Y H U J K O L P</b> play notes, <b>Z / X</b> move the octave, <b>Space</b> holds notes like a sustain pedal, <b>Esc</b> stops everything.' }));
    fp.body.append(h('div', { class: 'sub-h', style: 'margin-top:12px', text: 'About' }));
    fp.body.append(h('p', { class: 'hint', html: '<b>Eleosynth</b> is free software in the DAWters and Son suite. Copyright © 2026 Josh Wilk, licensed under the GNU GPL version 3 or later. No price, no sign-up, no tracking: it makes no network requests. Fonts: Big Shoulders Display, Archivo and Martian Mono (SIL Open Font License 1.1). Every wavetable, texture and test recording is generated by the app itself.' }));
    grid.append(fp.el);
  }
  const currentPatchJSON = () => { const p = {}; for (const k in S.patch) if (S.patch[k] !== INIT[k]) p[k] = S.patch[k]; return { app: 'Eleosynth', version: 1, name: S.name, cat: S.cat, desc: S.desc, p, fx: S.fx.map(u => ({ type: u.type, on: u.on, p: u.p })) }; };
  async function importPatch() {
    const f = await pickFile('.json,application/json'); if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.sounds) { S.user = S.user.concat(j.sounds); S.userRigs = S.userRigs.concat(j.rigs || []); store.set('user', S.user); store.set('userRigs', S.userRigs); toast(`Imported ${j.sounds.length} sounds and ${(j.rigs || []).length} rigs`); return; }
      if (!j.p) throw new Error('not a sound');
      const pr = { name: j.name || 'Imported', cat: j.cat || 'Pads', desc: j.desc || '', user: true, p: j.p, fx: j.fx || [] };
      S.user = S.user.filter(u => u.name !== pr.name).concat([pr]); store.set('user', S.user); loadPatch(pr); toast('Imported “' + pr.name + '”');
    } catch (e) { toast('That file is not an Eleosynth sound'); }
  }
  // recording
  let recChunks = [];
  function toggleRec() {
    if (!node) return toast('Start Eleosynth first');
    S.recording = !S.recording;
    $('#rec').setAttribute('aria-pressed', S.recording); const rb = $('#rec-big'); if (rb) rb.textContent = S.recording ? 'Stop recording' : 'Record';
    if (S.recording) { recChunks = []; recNode.port.postMessage('start'); toast('Recording'); } else recNode.port.postMessage('stop');
  }
  function onRec(m) {
    if (m.t === 'chunk') recChunks.push(m);
    else if (m.t === 'done') {
      const n = recChunks.reduce((a, c) => a + c.l.length, 0); if (!n) return;
      const L = new Float32Array(n), Rr = new Float32Array(n); let o = 0; for (const c of recChunks) { L.set(c.l, o); Rr.set(c.r, o); o += c.l.length; }
      const take = { id: newId(), name: 'Take ' + (S.takes.length + 1) + ' · ' + S.name, L, R: Rr, sr: ctx.sampleRate };
      S.takes.unshift(take); renderTakes(); toast('Saved ' + take.name.split(' · ')[0] + ' (' + (n / ctx.sampleRate).toFixed(1) + ' s)');
      const tc = $('#takes-count'); if (tc) tc.textContent = S.takes.length;
    }
  }
  let playing = null;
  function renderTakes() {
    const el = $('#takes'); if (!el) return; el.innerHTML = '';
    if (!S.takes.length) { el.append(h('div', { class: 'empty', text: 'No takes yet.' })); return; }
    for (const t of S.takes) {
      const dur = t.L.length / t.sr;
      const play = h('button', { class: 'btn small', type: 'button', text: 'Play', onclick: () => {
        if (playing) { playing.stop(); playing = null; if (play.textContent === 'Stop') { play.textContent = 'Play'; return; } }
        const b = ctx.createBuffer(2, t.L.length, t.sr); b.copyToChannel(t.L, 0); b.copyToChannel(t.R, 1);
        const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(); playing = s; play.textContent = 'Stop'; s.onended = () => { play.textContent = 'Play'; if (playing === s) playing = null; };
      } });
      el.append(h('div', { class: 'take' }, [h('div', {}, [h('b', { text: t.name }), h('br'), h('span', { text: dur.toFixed(1) + ' s · ' + t.sr / 1000 + ' kHz · stereo' })]), h('div', { class: 'acts' }, [play,
        h('button', { class: 'btn small gold', type: 'button', text: 'Save WAV', onclick: () => saveFile(t.name.replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() + '.wav', wav24(t)) }),
        h('button', { class: 'icon-btn', type: 'button', text: '×', 'aria-label': 'Delete ' + t.name, onclick: () => { S.takes = S.takes.filter(x => x !== t); renderTakes(); } })])]));
    }
  }
  function wav24(t) {
    const n = t.L.length, bytes = 44 + n * 6, b = new ArrayBuffer(bytes), v = new DataView(b), u8 = new Uint8Array(b);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, t.sr, true); v.setUint32(28, t.sr * 6, true); v.setUint16(32, 6, true); v.setUint16(34, 24, true); str(36, 'data'); v.setUint32(40, n * 6, true);
    let o = 44; for (let i = 0; i < n; i++) for (const ch of [t.L, t.R]) { const s = Math.max(-1, Math.min(1, ch[i])), x = Math.round(s * 8388607); u8[o++] = x & 255; u8[o++] = (x >> 8) & 255; u8[o++] = (x >> 16) & 255; }
    return new Uint8Array(b);
  }
  // CRC32 + a stored (uncompressed) zip, for hosts that only accept zip downloads
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip1(name, data) {
    const nm = new TextEncoder().encode(name), crc = crc32(data), sz = data.length;
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true);
    const cdOff = 30 + nm.length + sz, eo = new DataView(new ArrayBuffer(22)); eo.setUint32(0, 0x06054b50, true); eo.setUint16(8, 1, true); eo.setUint16(10, 1, true); eo.setUint32(12, 46 + nm.length, true); eo.setUint32(16, cdOff, true);
    return new Blob([lh.buffer, nm, data, ch.buffer, nm, eo.buffer]);
  }
  async function saveFile(name, data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (window.eleoNative && window.eleoNative.saveFile) { // desktop app: a real Save dialog
      const p = await window.eleoNative.saveFile(name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (p) toast('Saved ' + p); return;
    }
    if (window.EleoAndroid) { // Android app: written in chunks to Music/Eleosynth
      const id = window.EleoAndroid.begin(name); if (id < 0) { toast('Could not create ' + name); return; }
      for (let o = 0; o < bytes.length; o += 393216) { let bin = ''; const ch = bytes.subarray(o, o + 393216); for (let i = 0; i < ch.length; i += 8192) bin += String.fromCharCode.apply(null, ch.subarray(i, i + 8192)); if (!window.EleoAndroid.append(id, btoa(bin))) { toast('Saving ' + name + ' failed'); return; } }
      const p = window.EleoAndroid.finish(id); toast(p ? 'Saved to ' + p : 'Saving ' + name + ' failed'); return;
    }
    if (window.claude && window.claude.use) {
      try {
        const dl = await window.claude.use('downloads');
        if (dl) { const ok = /\.(json|zip)$/.test(name); await dl.save({ filename: ok ? name : name + '.zip', data: ok ? new Blob([bytes]) : zip1(name, bytes) }); toast('Saved ' + name); return; }
      } catch (e) { if (e && e.code === 'declined') return; toast('This preview could not save the file' + (e && e.message ? ': ' + e.message : '')); return; }
    }
    const url = URL.createObjectURL(new Blob([bytes])); const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function updateAudioInfo() {
    const el = $('#audio-info'); if (!el || !ctx) return;
    const lat = ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
    el.textContent = `${ctx.sampleRate / 1000} kHz · ${lat ? lat.toFixed(1) + ' ms output latency' : 'latency not reported by this browser'} · input ${S.micOn ? 'connected' : 'not connected'}.`;
  }

  // ------------------------------------------------------------------ keyboard dock
  const held = new Map(); // pointerId -> note
  let keyEls = {}, sustainOn = false;
  function noteOn(n, v) { if (!node) { start(); return; } post({ t: 'on', n, v }); keyMark(n, 'on', true); }
  function noteOff(n) { post({ t: 'off', n }); keyMark(n, 'on', false); }
  function keyMark(n, cls, on) { const k = keyEls[n]; if (k) k.classList.toggle(cls, on); }
  function buildKeys() {
    const wrap = $('#keys'); wrap.innerHTML = ''; keyEls = {};
    const W = wrap.clientWidth || 600, minW = innerWidth < 640 ? 30 : 24;
    const whites = Math.max(10, Math.min(36, Math.floor(W / minW))), ww = W / whites;
    let n = 12 * (S.oct + 1), x = 0, count = 0;
    while (count < whites) {
      const pc = n % 12, black = [1, 3, 6, 8, 10].includes(pc);
      const el = h('div', { class: 'key ' + (black ? 'b' : 'w'), 'data-n': n });
      if (black) { el.style.left = (x - ww * 0.32) + 'px'; el.style.width = (ww * 0.64) + 'px'; }
      else { el.style.left = x + 'px'; el.style.width = ww + 'px'; if (pc === 0) el.append(h('span', { class: 'c', text: 'C' + (Math.floor(n / 12) - 1) })); x += ww; count++; }
      wrap.append(el); keyEls[n] = el; n++;
    }
  }
  function keyAt(x, y) { const el = document.elementFromPoint(x, y); const k = el && el.closest('.key'); if (!k) return null; const r = k.getBoundingClientRect(); return { n: +k.dataset.n, v: Math.max(0.3, Math.min(1, 0.35 + (y - r.top) / r.height * 0.75)) }; }
  function bindKeys() {
    const wrap = $('#keys');
    wrap.addEventListener('pointerdown', (e) => { e.preventDefault(); wrap.setPointerCapture(e.pointerId); const k = keyAt(e.clientX, e.clientY); if (!k) return; held.set(e.pointerId, k.n); noteOn(k.n, k.v); });
    wrap.addEventListener('pointermove', (e) => { if (!held.has(e.pointerId)) return; const k = keyAt(e.clientX, e.clientY); if (!k || k.n === held.get(e.pointerId)) return; noteOff(held.get(e.pointerId)); held.set(e.pointerId, k.n); noteOn(k.n, k.v); });
    const up = (e) => { if (!held.has(e.pointerId)) return; noteOff(held.get(e.pointerId)); held.delete(e.pointerId); };
    wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    // wheels
    for (const [id, kind] of [['#pw', 'bend'], ['#mw', 'wheel']]) {
      const w = $(id), cap = w.querySelector('i');
      const place = (v) => { cap.style.top = ((1 - (kind === 'bend' ? (v + 1) / 2 : v)) * (w.clientHeight - 14)) + 'px'; };
      place(kind === 'bend' ? 0 : 0);
      const mv = (e) => { const r = w.getBoundingClientRect(); let v = 1 - (e.clientY - r.top) / r.height; v = Math.max(0, Math.min(1, v)); if (kind === 'bend') v = v * 2 - 1; place(v); post({ t: kind, v }); };
      w.addEventListener('pointerdown', (e) => { w.setPointerCapture(e.pointerId); mv(e); w.onpointermove = mv; });
      w.addEventListener('pointerup', () => { w.onpointermove = null; if (kind === 'bend') { place(0); post({ t: 'bend', v: 0 }); } });
      w.place = place;
    }
    addEventListener('resize', () => { clearTimeout(bindKeys.t); bindKeys.t = setTimeout(() => { buildKeys(); redrawAll(); }, 150); });
  }
  const KMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };
  const kbHeld = {};
  function bindComputerKeys() {
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { post({ t: 'allOff' }); document.querySelectorAll('.key.on').forEach(k => k.classList.remove('on')); return; }
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'x') { if (!e.repeat) { S.oct = Math.max(0, Math.min(7, S.oct + (k === 'z' ? -1 : 1))); $('#oct').textContent = 'C' + S.oct; buildKeys(); } return; }
      if (k === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); if (!e.repeat) setSustain(true); return; }
      if (k in KMAP && !e.repeat && !kbHeld[k]) { if (t && t.classList && t.classList.contains('knob')) return; const n = 12 * (S.oct + 1) + KMAP[k]; kbHeld[k] = n; noteOn(n, 0.82); }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ') { setSustain(false); return; }
      if (kbHeld[k] !== undefined) { noteOff(kbHeld[k]); delete kbHeld[k]; }
    });
  }
  function setSustain(v) { sustainOn = v; post({ t: 'sustain', v }); const b = $('#hold'); if (b) b.set(v); }

  // ------------------------------------------------------------------ MIDI
  let midiAccess = null;
  async function initMIDI() {
    const st = () => $('#midi-status');
    if (!navigator.requestMIDIAccess) { if (st()) st().textContent = 'This browser has no Web MIDI. Chrome and Edge do; the on-screen and computer keys always work.'; return; }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      const hook = () => { const names = []; midiAccess.inputs.forEach((i) => { i.onmidimessage = onMIDI; names.push(i.name); }); if (st()) st().textContent = names.length ? 'Listening to: ' + names.join(', ') + '. Right-click a knob to MIDI-learn it.' : 'No MIDI devices found. Plug one in and it connects automatically.'; };
      midiAccess.onstatechange = hook; hook();
    } catch (e) { if (st()) st().textContent = 'MIDI access is blocked here. The standalone version in Chrome or Edge can use MIDI keyboards and controllers.'; }
  }
  function onMIDI(e) {
    const [s, a, b] = e.data, cmd = s & 0xf0;
    if (cmd === 0x90 && b > 0) noteOn(a, b / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) noteOff(a);
    else if (cmd === 0xE0) { const v = ((b << 7) | a) / 8192 - 1; post({ t: 'bend', v }); $('#pw').place(v); }
    else if (cmd === 0xB0) {
      if (S.learnArm) { S.learn[a] = S.learnArm.target; store.set('learn', S.learn); S.learnArm.el.classList.remove('learn'); toast('CC ' + a + ' now controls ' + (S.learnArm.el.spec ? S.learnArm.el.spec.label : 'that knob')); S.learnArm = null; return; }
      if (S.learn[a]) return applyLearn(S.learn[a], b / 127);
      if (a === 1) { post({ t: 'wheel', v: b / 127 }); $('#mw').place(b / 127); }
      else if (a === 64) setSustain(b >= 64);
      else if (a === 123 || a === 120) post({ t: 'allOff' });
    }
  }
  function applyLearn(target, x) {
    const [w, a, k] = target.split(':');
    if (w === 'p') { const s = BYID[a]; setParam(a, KIT.fromNorm(s, x)); }
    else if (w === 'fx' || w === 'ped') {
      const u = chainOf(w).find(c => c.id === +a); if (!u) return; const kd = FX[u.type].knobs.find(q => q.k === k); if (!kd) return;
      const v = KIT.fromNorm(kd, x); u.p[k] = v; post({ t: 'pp', w, i: chainOf(w).indexOf(u), k, v });
      const el = document.querySelector(`.knob[data-unit="${u.id}"][data-k="${k}"]`); if (el) el.set(v);
    } else if (w === 'r') { const el = document.querySelector(`.knob[data-route="${a}"]`); if (el) el.setNorm(x); }
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    $('#logo').src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(document.getElementById('logo-src').textContent)));
    buildSynth($('#view-synth'));
    const rackRoot = $('#view-fx');
    rackRoot.append(h('div', { class: 'row', style: 'align-items:center;gap:10px;margin-bottom:12px' }, [
      h('h2', { style: 'margin:0;font:900 26px/1 var(--f-display);letter-spacing:.05em;text-transform:uppercase', text: 'Synth FX rack' }),
      h('span', { class: 'hint', style: 'margin:0', text: 'Runs top to bottom on the synth. 39 effects to choose from, saved with each sound.' }),
      h('span', { style: 'flex:1' }), h('button', { class: 'btn gold', type: 'button', text: '+ Add effect', onclick: () => openPool('fx') })]), h('div', { class: 'rack', id: 'rack' }));
    buildPedalboard($('#view-pedals'));
    buildTakes($('#view-takes'));
    // tabs
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
      S.tab = t.dataset.tab; document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === t));
      document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + S.tab);
      try { history.replaceState(null, '', '#' + S.tab); } catch (e) { /* sandboxed */ }
      requestAnimationFrame(redrawAll);
    }));
    const hash = (location.hash || '').slice(1); if (['synth', 'fx', 'pedals', 'takes'].includes(hash)) document.querySelector(`.tab[data-tab="${hash}"]`).click();
    // header controls
    $('#patch-open').addEventListener('click', openBrowser);
    $('#prev').addEventListener('click', () => stepPatch(-1)); $('#next').addEventListener('click', () => stepPatch(1));
    $('#save').addEventListener('click', savePatch);
    $('#rec').addEventListener('click', toggleRec);
    $('#panic').addEventListener('click', () => { post({ t: 'allOff' }); document.querySelectorAll('.key.on').forEach(k => k.classList.remove('on')); toast('All notes off'); });
    const bpm = $('#bpm'); bpm.value = S.bpm; bpm.addEventListener('change', () => { S.bpm = Math.max(30, Math.min(300, +bpm.value || 112)); bpm.value = S.bpm; post({ t: 'bpm', v: S.bpm }); store.set('bpm', S.bpm); });
    const mv = knob({ label: 'Master', min: 0, max: 1.2, def: 0.8 }, S.route.master, (v) => R('master', v), { size: 'sm' }); $('#master').append(mv);
    $('#wake-btn').addEventListener('click', start);
    // dock
    $('#oct-dn').addEventListener('click', () => { S.oct = Math.max(0, S.oct - 1); $('#oct').textContent = 'C' + S.oct; buildKeys(); });
    $('#oct-up').addEventListener('click', () => { S.oct = Math.min(7, S.oct + 1); $('#oct').textContent = 'C' + S.oct; buildKeys(); });
    const hold = toggle('Hold', false, (v) => setSustain(v)); hold.id = 'hold'; $('#hold-slot').append(hold);
    buildKeys(); bindKeys(); bindComputerKeys();
    // first sound: the last one played, else a showcase pad
    const last = store.get('last', null), first = (last && allPatches().find(p => p.name === last.name)) || PRESETS.PATCHES[0];
    loadPatch(first);
    loadRig(PRESETS.RIGS[0]);
    setTimeout(() => { makeTables(); }, 60);
    initMIDI();
    if (window.eleoNative && window.eleoNative.onMenu) window.eleoNative.onMenu((cmd) => {
      if (cmd.startsWith('tab:')) { const t = document.querySelector(`.tab[data-tab="${cmd.slice(4)}"]`); if (t) t.click(); }
      else if (cmd === 'browse') openBrowser(); else if (cmd === 'save') savePatch(); else if (cmd === 'prev') stepPatch(-1); else if (cmd === 'next') stepPatch(1);
      else if (cmd === 'surprise') loadPatch(randomPatch()); else if (cmd === 'record') toggleRec(); else if (cmd === 'panic') $('#panic').click();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

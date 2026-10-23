// SPDX-License-Identifier: GPL-3.0-or-later
// Eleosynth — interface kit: element builder, knobs, selects, toggles, menus, toasts.
'use strict';
const KIT = (() => {
  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    if (kids) for (const c of [].concat(kids)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }

  // ---------------- value mapping
  function toNorm(s, v) {
    if (s.vals) { const i = s.vals.indexOf(v); return (i < 0 ? s.def : i) / Math.max(1, s.vals.length - 1); }
    const { min, max } = s;
    switch (s.curve) {
      case 'exp': return Math.log(Math.max(v, min) / min) / Math.log(max / min);
      case 'pow': return Math.cbrt(Math.max(0, (v - min) / (max - min)));
      case 'sym': { const m = Math.max(Math.abs(min), Math.abs(max)), u = Math.cbrt(Math.abs(v) / m) * Math.sign(v); return (u + 1) / 2; }
      default: return (v - min) / (max - min);
    }
  }
  function fromNorm(s, x) {
    x = Math.min(1, Math.max(0, x));
    if (s.vals) return s.vals[Math.round(x * (s.vals.length - 1))];
    const { min, max } = s; let v;
    switch (s.curve) {
      case 'exp': v = min * Math.pow(max / min, x); break;
      case 'pow': v = min + (max - min) * x * x * x; break;
      case 'sym': { const m = Math.max(Math.abs(min), Math.abs(max)), u = x * 2 - 1; v = m * Math.pow(Math.abs(u), 3) * Math.sign(u); break; }
      default: v = min + (max - min) * x;
    }
    if (s.int || s.opts || s.bool) v = Math.round(v);
    return v;
  }
  function fmt(s, v) {
    if (s.opts) return s.opts[s.vals ? Math.max(0, s.vals.indexOf(v)) : Math.round(v)] || '';
    if (s.hz) { const f = 20 * Math.pow(2, v * 10); return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + 'k' : Math.round(f) + ''; }
    const u = s.unit || '';
    if (u === 's') return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(v < 10 ? 2 : 1) + 's';
    if (u === 'ms') return v >= 1000 ? (v / 1000).toFixed(2) + 's' : Math.round(v) + 'ms';
    if (u === 'Hz') return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v < 10 ? v.toFixed(2) : Math.round(v) + '';
    if (u === 'dB') return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 1 : 0);
    if (s.int) return (v > 0 && s.min < 0 ? '+' : '') + Math.round(v) + (u === 'st' ? 'st' : '');
    if (u === 'ct') return (v > 0 ? '+' : '') + Math.round(v) + 'c';
    if (u === '×') return v.toFixed(2) + '×';
    if (u === '/s') return v.toFixed(v < 10 ? 1 : 0);
    if (u) return v.toFixed(Math.abs(v) < 10 ? 1 : 0) + u;
    if (s.min < 0) return (v > 0 ? '+' : '') + Math.round(v * 100);
    return Math.round((v - s.min) / (s.max - s.min) * 100) + '';
  }

  // ---------------- knob
  const A0 = 135, SW = 270;
  function arc(cx, cy, r, a0, a1) {
    const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1), large = Math.abs(a1 - a0) > 180 ? 1 : 0, sweep = a1 > a0 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  let dragging = null;
  function knob(spec, value, onChange, opt = {}) {
    const el = h('div', { class: 'knob' + (opt.size ? ' ' + opt.size : ''), tabindex: 0, role: 'slider', 'aria-label': opt.label || spec.label });
    el.innerHTML = '<svg viewBox="0 0 50 50"><path class="ktrack"/><path class="karc"/><path class="kmod"/><circle class="kface" cx="25" cy="25" r="15.5"/><circle class="kcap" cx="25" cy="25" r="12"/><line class="kptr" x1="25" y1="25" x2="25" y2="13"/></svg>';
    const kv = h('span', { class: 'kv' }), kl = h('span', { class: 'kl', text: opt.label || spec.label });
    el.append(kv, kl);
    const [trk, val, modp, , , ptr] = el.querySelector('svg').children;
    trk.setAttribute('d', arc(25, 25, 21, A0, A0 + SW));
    const bip = spec.min < 0 && !spec.vals && spec.curve !== 'exp';
    let v = value, modAmt = 0;
    function draw() {
      const x = toNorm(spec, v), a = A0 + SW * x;
      const c = bip ? A0 + SW * toNorm(spec, 0) : A0;
      val.setAttribute('d', Math.abs(a - c) < 0.5 ? '' : arc(25, 25, 21, Math.min(a, c), Math.max(a, c)));
      if (modAmt) { const m = Math.min(1, Math.max(0, x + modAmt)), b = A0 + SW * m; modp.setAttribute('d', Math.abs(b - a) < 0.5 ? '' : arc(25, 25, 17.5, Math.min(a, b), Math.max(a, b))); }
      else modp.setAttribute('d', '');
      ptr.setAttribute('x2', (25 + 12 * Math.cos(a * Math.PI / 180)).toFixed(2));
      ptr.setAttribute('y2', (25 + 12 * Math.sin(a * Math.PI / 180)).toFixed(2));
      kv.textContent = opt.fmt ? opt.fmt(v) : fmt(spec, v);
      el.setAttribute('aria-valuetext', kv.textContent);
    }
    function set(nv, fire) {
      if (spec.int || spec.opts) nv = spec.vals ? nv : Math.round(nv);
      if (!spec.vals) nv = Math.min(spec.max, Math.max(spec.min, nv));
      if (nv === v) return;
      v = nv; draw(); if (fire) onChange(v);
    }
    let startY = 0, startX = 0, startN = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 2) return;
      el.focus({ preventScroll: true });
      startY = e.clientY; startX = e.clientX; startN = toNorm(spec, v); dragging = el;
      el.setPointerCapture(e.pointerId); e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (dragging !== el) return;
      const d = (startY - e.clientY) + (e.clientX - startX) * 0.25, sc = e.shiftKey ? 900 : 180;
      set(fromNorm(spec, startN + d / sc), true);
    });
    const end = () => { if (dragging === el) dragging = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => set(spec.vals ? spec.vals[spec.def] : spec.def, true));
    el.addEventListener('wheel', (e) => { if (document.activeElement !== el) return; e.preventDefault(); const st = spec.opts || spec.int ? 1 / Math.max(1, (spec.vals ? spec.vals.length - 1 : spec.max - spec.min)) : 0.01; set(fromNorm(spec, toNorm(spec, v) + (e.deltaY < 0 ? st : -st)), true); }, { passive: false });
    el.addEventListener('keydown', (e) => {
      const st = spec.opts || spec.int ? 1 / Math.max(1, (spec.vals ? spec.vals.length - 1 : spec.max - spec.min)) : (e.shiftKey ? 0.002 : 0.02);
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(fromNorm(spec, toNorm(spec, v) + st), true); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(fromNorm(spec, toNorm(spec, v) - st), true); e.preventDefault(); }
      else if (e.key === 'Home') { set(fromNorm(spec, 0), true); e.preventDefault(); }
      else if (e.key === 'End') { set(fromNorm(spec, 1), true); e.preventDefault(); }
    });
    if (opt.menu) el.addEventListener('contextmenu', (e) => { e.preventDefault(); opt.menu(e, el); });
    let lp = null;
    el.addEventListener('touchstart', (e) => { if (!opt.menu) return; const t = e.touches[0]; lp = setTimeout(() => { dragging = null; opt.menu({ clientX: t.clientX, clientY: t.clientY }, el); }, 550); }, { passive: true });
    el.addEventListener('touchmove', () => clearTimeout(lp), { passive: true });
    el.addEventListener('touchend', () => clearTimeout(lp));
    el.set = (nv) => set(nv, false);
    el.get = () => v;
    el.setMod = (a) => { modAmt = a; draw(); };
    el.setNorm = (x) => set(fromNorm(spec, x), true);
    el.spec = spec;
    draw();
    return el;
  }

  function select(opts, value, onChange, attrs = {}) {
    const el = h('select', Object.assign({ class: 'sel' }, attrs));
    opts.forEach((o, i) => el.append(h('option', { value: i, text: o })));
    el.value = value;
    el.addEventListener('change', () => onChange(+el.value));
    el.set = (v) => { el.value = v; };
    return el;
  }
  function field(label, ctrl) { return h('label', { class: 'field' }, [h('span', { class: 'lbl', text: label }), ctrl]); }
  function toggle(label, on, onChange, cls = 'toggle') {
    const el = h('button', { class: cls, type: 'button', 'aria-pressed': on ? 'true' : 'false', text: label });
    el.addEventListener('click', () => { const v = el.getAttribute('aria-pressed') !== 'true'; el.setAttribute('aria-pressed', v); onChange(v); });
    el.set = (v) => el.setAttribute('aria-pressed', v ? 'true' : 'false');
    return el;
  }
  function power(on, onChange, label) { const el = toggle('', on, onChange, 'power'); el.setAttribute('aria-label', label || 'On'); el.title = label || 'On / off'; return el; }

  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function menu(x, y, items) {
    closeMenu();
    menuEl = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it === '-') menuEl.append(h('hr'));
      else if (it.head) menuEl.append(h('div', { class: 'lbl mh', text: it.head }));
      else menuEl.append(h('button', { role: 'menuitem', text: it.label, onclick: () => { closeMenu(); it.act(); } }));
    }
    document.body.append(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    setTimeout(() => addEventListener('pointerdown', function off(e) { if (menuEl && !menuEl.contains(e.target)) { closeMenu(); removeEventListener('pointerdown', off, true); } }, true), 0);
  }
  let toastT = null, toastEl = null;
  function toast(msg) {
    if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status' }); document.body.append(toastEl); }
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 2400);
  }
  function overlay(build) {
    const scrim = h('div', { class: 'scrim' });
    const close = () => { scrim.remove(); removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
    addEventListener('keydown', esc);
    scrim.append(build(close));
    document.body.append(scrim);
    return close;
  }
  function fitCanvas(c) {
    const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, Math.round(r.width * d)), hh = Math.max(10, Math.round(r.height * d));
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    return { w, h: hh, d };
  }
  return { h, knob, select, field, toggle, power, menu, closeMenu, toast, overlay, toNorm, fromNorm, fmt, fitCanvas };
})();

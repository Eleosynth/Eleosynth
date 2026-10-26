// SPDX-License-Identifier: GPL-3.0-or-later
// Eleosynth — parameter schema shared by the interface, the presets and the tests.
'use strict';
const SCHEMA = (() => {
  const SYNC = ['Free', '4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/4T', '1/8T', '1/16T', '1/4D', '1/8D', '1/16D'];
  const DLY = ['Free', '1/32', '1/16T', '1/16', '1/16D', '1/8T', '1/8', '1/8D', '1/4T', '1/4', '1/4D', '1/2', '1/1'];
  const WAVES = ['Crema Basics', 'Analog PWM', 'Hard Sync', 'Dark Roast', 'Resonant Sweep', 'Vowel Pour', 'Bloom Harmonics', 'Drawbar Organ', 'Moka FM', 'Glass Bells', 'String Pluck', 'Fold Grind', 'Digital Steps', 'Spectral Comb', 'Juno Blend', 'Choir Haze', 'Your Wavetable'];
  const WARPS = ['Off', 'Bend', 'Squeeze', 'Mirror', 'Sync', 'FM from other', 'Fold'];
  const SRCS = ['—', 'Env 1', 'Env 2', 'Env 3', 'LFO 1', 'LFO 2', 'Velocity', 'Note', 'Mod wheel', 'Random', 'Guitar env'];
  const DSTS = ['—', 'A position', 'A pitch', 'A level', 'A warp', 'B position', 'B pitch', 'B level', 'B warp', 'Cutoff', 'Resonance', 'Filter drive', 'Aroma position', 'Aroma level', 'Sub level', 'Noise level', 'Unison detune', 'Pan', 'Volume', 'Pitch (all)'];
  const AROMAS = ['Glass Air', 'Steam', 'Music Box', 'Tin Rain', 'Bowed Steel', 'Choir Bed', 'Guitar capture', 'Your file'];
  const EP = ['Stage 73', 'Suitcase', 'Bright tines', 'Felt ballad', 'Reed piano', 'Celeste'];
  const FILT = ['Off', 'Ladder 24', 'Ladder 12', 'SVF low-pass', 'SVF band-pass', 'SVF high-pass', 'SVF notch', 'Comb'];

  const P = []; // synth params
  const add = (id, label, min, max, def, o = {}) => P.push(Object.assign({ id, label, min, max, def }, o));
  const en = (id, label, opts, def, o = {}) => add(id, label, 0, opts.length - 1, def, Object.assign({ opts }, o));
  const bool = (id, label, def) => add(id, label, 0, 1, def, { bool: true });
  const T = { curve: 'exp', unit: 's' };

  // voice
  en('v.mode', 'Voices', ['Poly', 'Mono', 'Legato'], 0);
  add('v.poly', 'Polyphony', 1, 12, 8, { int: true });
  add('v.glide', 'Glide', 0, 2, 0, { curve: 'pow', unit: 's' });
  add('v.bend', 'Bend range', 0, 24, 2, { int: true, unit: 'st' });
  add('v.drift', 'Drift', 0, 1, 0.2);
  add('v.velamp', 'Velocity', 0, 1, 0.5);
  add('v.vol', 'Volume', 0, 2, 0.7);
  add('v.low', 'Low', -12, 12, 0, { unit: 'dB' });
  add('v.high', 'High', -12, 12, 0, { unit: 'dB' });
  // oscillators
  for (const o of ['a', 'b']) {
    bool(o + '.on', 'On', o === 'a' ? 1 : 0);
    en(o + '.wt', 'Table', WAVES, 0);
    add(o + '.pos', 'Position', 0, 1, 0);
    en(o + '.warpMode', 'Warp', WARPS, 0);
    add(o + '.warp', 'Warp amt', -1, 1, 0);
    add(o + '.oct', 'Octave', -3, 3, 0, { int: true });
    add(o + '.semi', 'Semi', -12, 12, 0, { int: true });
    add(o + '.fine', 'Fine', -100, 100, 0, { unit: 'ct' });
    add(o + '.uni', 'Unison', 1, 8, 1, { int: true });
    add(o + '.detune', 'Detune', 0, 1, 0.25);
    add(o + '.blend', 'Blend', 0, 1, 0.5);
    add(o + '.spread', 'Width', 0, 1, 0.7);
    add(o + '.phase', 'Phase', 0, 1, 0);
    add(o + '.rand', 'Random', 0, 1, 1);
    add(o + '.level', 'Level', 0, 1, 0.75);
    add(o + '.pan', 'Pan', -1, 1, 0);
    bool(o + '.flt', 'To filter', 1);
    bool(o + '.retrig', 'Retrigger', 0);
  }
  bool('sub.on', 'On', 0); en('sub.shape', 'Shape', ['Sine', 'Triangle', 'Square'], 0); en('sub.oct', 'Octave', ['−1 oct', '−2 oct'], 0); add('sub.level', 'Level', 0, 1, 0.5); bool('sub.flt', 'To filter', 1);
  bool('n.on', 'On', 0); en('n.type', 'Color', ['White', 'Pink', 'Brown', 'Vinyl crackle'], 1); add('n.level', 'Level', 0, 1, 0.2); bool('n.flt', 'To filter', 1);
  // electric piano (tine)
  bool('r.on', 'On', 0); en('r.model', 'Model', EP, 0); add('r.level', 'Level', 0, 1, 0.8); add('r.bell', 'Bell', 0, 1, 0.5); add('r.bark', 'Bark', 0, 1, 0.5);
  add('r.sym', 'Pickup', 0, 1, 0.5); add('r.decay', 'Decay', 0.3, 3, 1, { curve: 'exp', unit: '×' }); add('r.damp', 'Damper', 0.03, 1, 0.18, T); add('r.tone', 'Tone', 0, 1, 0.6); bool('r.flt', 'To filter', 1);
  // aroma (granular)
  bool('g.on', 'On', 0); en('g.src', 'Source', AROMAS, 0); add('g.pos', 'Position', 0, 1, 0.3); add('g.spray', 'Spray', 0, 1, 0.1);
  add('g.size', 'Grain', 0.01, 0.5, 0.12, T); add('g.dens', 'Density', 1, 60, 14, { curve: 'exp', unit: '/s' }); add('g.pitchRand', 'Pitch jitter', 0, 1, 0.1);
  add('g.shimmer', 'Shimmer', 0, 1, 0); add('g.rev', 'Reverse', 0, 1, 0); bool('g.key', 'Follow keys', 1); add('g.spread', 'Width', 0, 1, 0.6); add('g.level', 'Level', 0, 1, 0.6); bool('g.flt', 'To filter', 1);
  // filter
  en('f.type', 'Type', FILT, 1); add('f.cutoff', 'Cutoff', 0, 1, 0.75, { hz: true }); add('f.res', 'Resonance', 0, 1, 0.1); add('f.drive', 'Drive', 0, 1, 0);
  add('f.key', 'Key track', 0, 1, 0.3); add('f.env', 'Env 2', -1, 1, 0); add('f.vel', 'Velocity', 0, 1, 0);
  // envelopes
  const envDef = { 1: [0.004, 0.4, 0.8, 0.35], 2: [0.01, 0.5, 0.3, 0.4], 3: [0.3, 1.0, 0.5, 0.8] };
  for (const k of [1, 2, 3]) {
    const d = envDef[k];
    add('e' + k + '.a', 'Attack', 0.0005, 20, d[0], T); add('e' + k + '.d', 'Decay', 0.001, 20, d[1], T); add('e' + k + '.s', 'Sustain', 0, 1, d[2]); add('e' + k + '.r', 'Release', 0.001, 20, d[3], T);
  }
  for (const k of [1, 2]) {
    en('l' + k + '.shape', 'Shape', ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square', 'Sample & hold', 'Smooth random'], 0);
    add('l' + k + '.rate', 'Rate', 0.02, 30, k === 1 ? 2 : 0.3, { curve: 'exp', unit: 'Hz' });
    en('l' + k + '.sync', 'Sync', SYNC, 0); bool('l' + k + '.retrig', 'Retrigger', 0); add('l' + k + '.phase', 'Phase', 0, 1, 0); add('l' + k + '.fade', 'Fade in', 0, 5, 0, { curve: 'pow', unit: 's' });
  }
  for (let i = 0; i < 8; i++) { en('m' + i + '.s', 'Source', SRCS, 0); en('m' + i + '.d', 'Destination', DSTS, 0); add('m' + i + '.a', 'Amount', -1, 1, 0); }
  bool('arp.on', 'Arp', 0); en('arp.mode', 'Mode', ['Up', 'Down', 'Up-down', 'As played', 'Random', 'Chord'], 0); en('arp.rate', 'Rate', ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'], 3);
  add('arp.oct', 'Octaves', 1, 4, 2, { int: true }); add('arp.gate', 'Gate', 0.05, 1, 0.55); add('arp.swing', 'Swing', 0, 1, 0); bool('arp.latch', 'Latch', 0);

  const BYID = {}; for (const p of P) BYID[p.id] = p;
  const INIT = {}; for (const p of P) INIT[p.id] = p.def;

  // ------------------------------------------------ effects pool (shared by the synth FX rack and the pedalboard)
  const k = (id, label, min, max, def, o = {}) => Object.assign({ k: id, label, min, max, def }, o);
  const ke = (id, label, opts, def, o = {}) => Object.assign({ k: id, label, min: 0, max: opts.length - 1, def, opts }, o);
  const kv = (id, label, opts, vals, def) => ({ k: id, label, min: 0, max: opts.length - 1, def, opts, vals });
  const ms = { curve: 'exp', unit: 'ms' }, dB = { unit: 'dB' }, hz = { curve: 'exp', unit: 'Hz' };
  const CATS = ['Dynamics', 'Drive', 'Pitch', 'Filter & EQ', 'Modulation', 'Time & space'];
  const FX = {
    gate: { name: 'Grounds Gate', kind: 'Noise gate', cat: 0, ink: 'steel', knobs: [k('thresh', 'Threshold', -80, -20, -58, dB), k('release', 'Release', 10, 500, 80, ms)] },
    comp: { name: 'Squeeze', kind: 'Compressor', cat: 0, ink: 'cream', knobs: [k('sustain', 'Sustain', 0, 1, 0.5), k('attack', 'Attack', 1, 50, 8, ms), k('blend', 'Blend', 0, 1, 0.7), k('level', 'Level', -12, 12, 0, dB)] },
    limiter: { name: 'The Lid', kind: 'Limiter', cat: 0, ink: 'steel', knobs: [k('gain', 'Gain', 0, 24, 0, dB), k('ceiling', 'Ceiling', -12, 0, -1, dB), k('release', 'Release', 10, 500, 80, ms)] },
    transient: { name: 'Snap', kind: 'Transient shaper', cat: 0, ink: 'gold', knobs: [k('attack', 'Attack', -1, 1, 0.4), k('sustain', 'Sustain', -1, 1, 0), k('level', 'Level', -12, 12, 0, dB)] },
    swell: { name: 'Morning Swell', kind: 'Volume swell', cat: 0, ink: 'cream', knobs: [k('rise', 'Rise', 50, 3000, 600, ms), k('sens', 'Sensitivity', 0, 1, 0.5)] },
    pump: { name: 'Percolate', kind: 'Tempo pump', cat: 0, ink: 'red', knobs: [ke('sync', 'Every', SYNC, 5), k('depth', 'Depth', 0, 1, 0.7), k('shape', 'Shape', 0, 1, 0.4)] },
    boost: { name: 'Sugar Boost', kind: 'Clean boost', cat: 1, ink: 'cream', knobs: [k('gain', 'Gain', 0, 24, 8, dB), k('tone', 'Tilt', -1, 1, 0)] },
    drive: { name: 'Crema Drive', kind: 'Overdrive', cat: 1, ink: 'gold', knobs: [k('drive', 'Drive', 0, 1, 0.5), k('tone', 'Tone', 0, 1, 0.5), k('level', 'Level', -24, 6, -4, dB)] },
    fuzz: { name: 'Burnt Fuzz', kind: 'Fuzz', cat: 1, ink: 'red', knobs: [k('fuzz', 'Fuzz', 0, 1, 0.7), k('tone', 'Tone', 0, 1, 0.5), k('octave', 'Octave', 0, 1, 0), k('gate', 'Starve', 0, 1, 0.2), k('level', 'Level', -24, 6, -6, dB)] },
    amp: { name: 'Roastmaster', kind: 'Amp + cabinet', cat: 1, ink: 'brown', knobs: [ke('model', 'Channel', ['Clean', 'Crunch', 'Lead', 'Bass'], 1), k('gain', 'Gain', 0, 1, 0.4), k('bass', 'Bass', 0, 1, 0.5), k('mid', 'Mid', 0, 1, 0.5), k('treble', 'Treble', 0, 1, 0.55), k('presence', 'Presence', 0, 1, 0.5), k('master', 'Master', 0, 1, 0.5), ke('cab', 'Cabinet', ['Off', '1×12 open', '2×12 alnico', '4×12 closed', '1×15 bass'], 2), k('level', 'Level', -24, 12, 0, dB)] },
    grind: { name: 'Grinder', kind: 'Distortion', cat: 1, ink: 'red', knobs: [ke('type', 'Type', ['Tube', 'Tape', 'Fold', 'Crush'], 0), k('amt', 'Amount', 0, 1, 0.4), k('tone', 'Tone', 0, 1, 0.7), k('mix', 'Mix', 0, 1, 0.7)] },
    crush: { name: 'Bit Mill', kind: 'Bitcrusher', cat: 1, ink: 'steel', knobs: [k('bits', 'Bits', 1, 16, 8, { int: true }), k('rate', 'Rate', 400, 48000, 12000, hz), k('mix', 'Mix', 0, 1, 0.7)] },
    cassette: { name: 'Cassette', kind: 'Lo-fi tape', cat: 1, ink: 'cream', knobs: [k('wow', 'Wow', 0, 1, 0.3), k('flutter', 'Flutter', 0, 1, 0.3), k('age', 'Age', 0, 1, 0.4), k('hiss', 'Hiss', 0, 1, 0.2)] },
    exciter: { name: 'Steam Wand', kind: 'Exciter', cat: 1, ink: 'steel', knobs: [k('freq', 'Freq', 1000, 10000, 3500, hz), k('drive', 'Drive', 0, 1, 0.4), k('amount', 'Amount', 0, 1, 0.4)] },
    octave: { name: 'Double Shot', kind: 'Octaver', cat: 2, ink: 'brown', knobs: [k('sub', 'Sub', 0, 1, 0.6), k('up', 'Up', 0, 1, 0), k('dry', 'Dry', 0, 1, 0.7)] },
    pitch: { name: 'Shift', kind: 'Pitch shifter', cat: 2, ink: 'gold', knobs: [kv('interval', 'Interval', ['−2 oct', '−1 oct', '−5th', '−4th', '−m3', '+m3', '+M3', '+4th', '+5th', '+1 oct', '+oct+5th', '+2 oct'], [-24, -12, -7, -5, -3, 3, 4, 5, 7, 12, 19, 24], 9), k('detune', 'Detune', -50, 50, 8, { unit: 'ct' }), k('mix', 'Mix', 0, 1, 0.5)] },
    freqshift: { name: 'Barber Pole', kind: 'Frequency shifter', cat: 2, ink: 'red', knobs: [k('shift', 'Shift', -1000, 1000, 4, { curve: 'sym', unit: 'Hz' }), k('fb', 'Feedback', 0, 0.95, 0.3), k('mix', 'Mix', 0, 1, 0.5), ke('spread', 'Stereo', ['Same', 'Opposed'], 1)] },
    ringmod: { name: 'Ring Ding', kind: 'Ring modulator', cat: 2, ink: 'steel', knobs: [k('freq', 'Freq', 20, 4000, 220, hz), k('lfoRate', 'LFO rate', 0.05, 10, 0.5, hz), k('lfoDepth', 'LFO depth', 0, 1, 0), k('mix', 'Mix', 0, 1, 0.5)] },
    eq: { name: 'Tone Bar', kind: '4-band EQ', cat: 3, ink: 'cream', knobs: [k('low', 'Low', -15, 15, 0, dB), k('lowmid', 'Low mid', -15, 15, 0, dB), k('himid', 'High mid', -15, 15, 0, dB), k('high', 'High', -15, 15, 0, dB), k('level', 'Level', -12, 12, 0, dB)] },
    envf: { name: 'Wake-Up', kind: 'Envelope filter', cat: 3, ink: 'gold', knobs: [k('sens', 'Sensitivity', 0, 1, 0.6), k('range', 'Range', 0, 1, 0.7), k('q', 'Peak', 0, 1, 0.6), ke('mode', 'Mode', ['Low-pass', 'Band-pass'], 1), ke('dir', 'Sweep', ['Up', 'Down'], 0), k('mix', 'Mix', 0, 1, 1)] },
    mfilter: { name: 'Pour Over', kind: 'Motion filter', cat: 3, ink: 'brown', knobs: [ke('type', 'Type', ['Low-pass', 'Band-pass', 'High-pass', 'Notch'], 0), k('cutoff', 'Cutoff', 0, 1, 0.55), k('res', 'Resonance', 0, 1, 0.4), k('drive', 'Drive', 0, 1, 0.1), k('rate', 'Rate', 0.02, 20, 0.5, hz), ke('sync', 'Sync', SYNC, 0), k('lfo', 'LFO', 0, 1, 0.5), k('env', 'Envelope', -1, 1, 0), k('stereo', 'Stereo', 0, 1, 0.5), k('mix', 'Mix', 0, 1, 1)] },
    formant: { name: 'Café Voice', kind: 'Formant filter', cat: 3, ink: 'red', knobs: [k('vowel', 'Vowel', 0, 1, 0.2), k('rate', 'Rate', 0.02, 8, 0.3, hz), ke('sync', 'Sync', SYNC, 0), k('depth', 'Depth', 0, 1, 0.5), k('res', 'Resonance', 0, 1, 0.5), k('shift', 'Shift', -1, 1, 0, { unit: 'oct' }), k('mix', 'Mix', 0, 1, 0.8)] },
    chorus: { name: 'Steam Chorus', kind: 'Chorus', cat: 4, ink: 'steel', knobs: [k('rate', 'Rate', 0.05, 5, 0.7, hz), k('depth', 'Depth', 0, 1, 0.5), k('mix', 'Mix', 0, 1, 0.5), ke('mode', 'Mode', ['Classic', 'Dimension', 'Tri-voice'], 0)] },
    ensemble: { name: 'String Café', kind: 'Ensemble', cat: 4, ink: 'cream', knobs: [k('speed', 'Speed', 0, 1, 0.4), k('depth', 'Depth', 0, 1, 0.6), k('mix', 'Mix', 0, 1, 0.6)] },
    hyper: { name: 'Hyper Brew', kind: 'Hyper chorus', cat: 4, ink: 'gold', knobs: [k('rate', 'Rate', 0.05, 3, 0.4, hz), k('depth', 'Depth', 0, 1, 0.5), k('spread', 'Width', 0, 1, 0.8), k('mix', 'Mix', 0, 1, 0.5)] },
    phaser: { name: 'Swirl', kind: 'Phaser', cat: 4, ink: 'red', knobs: [k('rate', 'Rate', 0.02, 8, 0.35, hz), k('depth', 'Depth', 0, 1, 0.7), k('fb', 'Feedback', 0, 0.95, 0.5), kv('stages', 'Stages', ['4', '6', '8', '12'], [4, 6, 8, 12], 1), k('mix', 'Mix', 0, 1, 0.7)] },
    flanger: { name: 'Jet Flanger', kind: 'Flanger', cat: 4, ink: 'steel', knobs: [k('rate', 'Rate', 0.02, 5, 0.2, hz), k('depth', 'Depth', 0, 1, 0.6), k('manual', 'Manual', 0, 1, 0.3), k('fb', 'Feedback', -0.95, 0.95, 0.5), k('mix', 'Mix', 0, 1, 0.6)] },
    vibe: { name: 'Lamp Vibe', kind: 'Photocell vibe', cat: 4, ink: 'gold', knobs: [k('rate', 'Speed', 0.2, 10, 2, hz), k('depth', 'Intensity', 0, 1, 0.6), ke('mode', 'Mode', ['Chorus', 'Vibrato'], 0), k('level', 'Level', -6, 6, 0, dB)] },
    trem: { name: 'Drip Trem', kind: 'Tremolo', cat: 4, ink: 'cream', knobs: [k('rate', 'Rate', 0.5, 15, 5, hz), ke('sync', 'Sync', SYNC, 0), k('depth', 'Depth', 0, 1, 0.6), ke('shape', 'Shape', ['Sine', 'Triangle', 'Saw up', 'Saw down', 'Square'], 0), k('stereo', 'Stereo', 0, 1, 0)] },
    autopan: { name: 'Suitcase Pan', kind: 'Auto-pan', cat: 4, ink: 'brown', knobs: [k('rate', 'Rate', 0.1, 10, 3, hz), ke('sync', 'Sync', SYNC, 0), k('depth', 'Depth', 0, 1, 0.8), ke('shape', 'Shape', ['Sine', 'Triangle'], 0)] },
    rotary: { name: 'Spin Cabinet', kind: 'Rotary speaker', cat: 4, ink: 'brown', knobs: [ke('speed', 'Speed', ['Slow', 'Fast'], 0), k('drive', 'Drive', 0, 1, 0.2), k('balance', 'Horn/drum', 0, 1, 0.5), k('mix', 'Mix', 0, 1, 1)] },
    widener: { name: 'Wide Mug', kind: 'Stereo width', cat: 4, ink: 'steel', knobs: [k('width', 'Width', 0, 2, 1.4), k('haas', 'Haas', 0, 20, 0, { unit: 'ms' }), k('bass', 'Mono bass', 0, 300, 120, { unit: 'Hz' })] },
    delay: { name: 'Tape Echo', kind: 'Delay', cat: 5, ink: 'gold', knobs: [k('time', 'Time', 20, 2000, 380, ms), ke('sync', 'Sync', DLY, 0), k('fb', 'Repeats', 0, 0.98, 0.4), k('mix', 'Mix', 0, 1, 0.3), k('tone', 'Tone', 0, 1, 0.6), ke('mode', 'Mode', ['Digital', 'Tape', 'Ping-pong', 'Dual'], 1), k('wow', 'Wow', 0, 1, 0.2)] },
    revdelay: { name: 'Backwash', kind: 'Reverse delay', cat: 5, ink: 'red', knobs: [k('time', 'Time', 50, 2000, 500, ms), ke('sync', 'Sync', DLY, 0), k('fb', 'Repeats', 0, 0.95, 0.3), k('mix', 'Mix', 0, 1, 0.4)] },
    reverb: { name: 'Cathedral', kind: 'Hall + shimmer', cat: 5, ink: 'cream', knobs: [k('size', 'Size', 0, 1, 0.7), k('decay', 'Decay', 0.3, 30, 4, { curve: 'exp', unit: 's' }), k('damp', 'Damping', 0, 1, 0.4), k('pre', 'Pre-delay', 0, 250, 20, { unit: 'ms' }), k('mix', 'Mix', 0, 1, 0.35), k('shimmer', 'Shimmer', 0, 1, 0), k('mod', 'Motion', 0, 1, 0.5), k('lowcut', 'Low cut', 0, 1, 0.2), ke('freeze', 'Freeze', ['Off', 'On'], 0)] },
    plate: { name: 'Steel Plate', kind: 'Plate reverb', cat: 5, ink: 'steel', knobs: [k('size', 'Size', 0, 1, 0.5), k('decay', 'Decay', 0.3, 10, 2, { curve: 'exp', unit: 's' }), k('damp', 'Damping', 0, 1, 0.3), k('pre', 'Pre-delay', 0, 250, 10, { unit: 'ms' }), k('mix', 'Mix', 0, 1, 0.3), k('mod', 'Motion', 0, 1, 0.3), k('lowcut', 'Low cut', 0, 1, 0.2), ke('freeze', 'Freeze', ['Off', 'On'], 0)] },
    spring: { name: 'Spring Tank', kind: 'Spring reverb', cat: 5, ink: 'brown', knobs: [k('decay', 'Decay', 0, 1, 0.5), k('tone', 'Tone', 0, 1, 0.5), k('drip', 'Drip', 0, 1, 0.5), k('mix', 'Mix', 0, 1, 0.3)] },
    cloud: { name: 'Aroma Cloud', kind: 'Granular texture', cat: 5, ink: 'gold', knobs: [k('position', 'Position', 0, 1, 0.1), k('size', 'Grain', 20, 500, 140, ms), k('density', 'Density', 1, 60, 14, { curve: 'exp', unit: '/s' }), k('pitch', 'Pitch', -12, 12, 0, { int: true, unit: 'st' }), k('shimmer', 'Shimmer', 0, 1, 0.2), k('spray', 'Spray', 0, 1, 0.2), k('reverse', 'Reverse', 0, 1, 0.2), k('feedback', 'Feedback', 0, 0.95, 0.3), ke('freeze', 'Freeze', ['Off', 'On'], 0), k('mix', 'Mix', 0, 1, 0.45)] },
    looper: { name: 'Loop Station', kind: 'Looper', cat: 5, ink: 'red', knobs: [k('level', 'Loop level', 0, 1.2, 0.9), k('feedback', 'Feedback', 0.3, 1, 1)], looper: true },
  };
  function fxDefaults(type) { const p = {}; for (const kk of FX[type].knobs) p[kk.k] = kk.vals ? kk.vals[kk.def] : kk.def; return p; }
  return { P, BYID, INIT, FX, CATS, fxDefaults, SYNC, DLY, WAVES, WARPS, SRCS, DSTS, AROMAS, EP, FILT };
})();

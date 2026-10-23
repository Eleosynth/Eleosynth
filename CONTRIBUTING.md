# Contributing to Eleosynth

Thank you for helping. Eleosynth is free software under the GNU GPL v3 or later; by contributing you agree your
work is released under the same licence.

- **No dependencies at run time.** The instrument is plain HTML, CSS and JavaScript plus one AudioWorklet. It must
  keep working offline and must never make a network request.
- **DSP lives in `src/worklet.js`.** Add an effect by writing a class with `setParams(p, bpm)` and
  `process(L, R, n, stereo)`, registering it in `UNIT_TYPES`, and describing its knobs in `src/params.js` (`FX`).
  It then appears in both the synth FX rack and the pedalboard.
- **Run the tests** before sending a change: `node tools/test_engine.js`, `node tools/test_presets.js`,
  `node tools/test_track.js`, and `python3 tools/ui_check.py /tmp` (needs Playwright with Chromium).
- **Sounds** are data in `src/presets.js`; they store only what differs from Init.
- Keep the "Tostado" look: tokens are at the top of `src/style.css`.

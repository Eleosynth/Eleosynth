# Eleosynth — synth & pedal studio

**Free software.** Copyright (C) 2026 Josh Wilk. GNU General Public License, version 3 or (at your option) any later
version — see [LICENSE](LICENSE). No price, no tiers, no sign-up, no tracking: the app makes no network requests.

Part of the **DAWters and Son** suite (DAWters and Son · Esperanza's Drum Kit · Eleosynth). A deep synthesizer
inspired by the reach of Serum (wavetables), Diva (drifting analog filters) and Omnisphere (layers and granular
texture), fused with a guitar pedalboard you play through live. Design: **"Tostado"**, a roaster's bench at night,
with a welded-steel coffee tree hung with red cherries as the logo. One codebase (plain HTML + Web Audio + one
AudioWorklet, no libraries, works offline).

## MVP 0.1

### Synth (per voice, up to 15 voices; poly / mono / legato, glide, drift)
- **Two wavetable oscillators**, 16 generated tables (Crema Basics, Analog PWM, Hard Sync, Dark Roast, Resonant Sweep,
  Vowel Pour, Bloom Harmonics, Drawbar Organ, Moka FM, Glass Bells, String Pluck, Fold Grind, Digital Steps,
  Spectral Comb, Juno Blend, Choir Haze) plus **Your Wavetable** (import any WAV: one cycle, or cut into up to 64 frames).
  Every table is band-limited into 11 octave mip levels. Unison 1–8 with detune, blend, width; warp modes Bend,
  Squeeze, Mirror, Sync, FM from the other oscillator, Fold. 3-D wavetable display with the live modulated frame.
- **Tine piano** (electric-piano engine): six models — Stage 73, Suitcase, Bright tines, Felt ballad, Reed piano,
  Celeste. Tine + nonlinear pickup (bark grows with velocity), bell partials, hammer thump, pitch-dependent decay, damper.
- **Aroma** granular layer: Glass Air, Steam, Music Box, Tin Rain, Bowed Steel, Choir Bed (all synthesised at start-up),
  a capture of the last 6 s of your guitar, or any audio file. Position, spray, grain, density, pitch jitter, octave
  shimmer, reverse, width; follows the keys.
- **Sub** (sine/triangle/square, −1/−2 oct) and **noise** (white, pink, brown, vinyl crackle).
- **Filter**: Ladder 24 / 12 (saturating, self-oscillating), SVF low/band/high/notch, tuned comb. Drive, key track,
  envelope, velocity; live response curve.
- **Modulation**: 3 envelopes, 2 LFOs (7 shapes, tempo sync, fade-in, retrigger), velocity, note, mod wheel, random,
  **guitar envelope**. 8-slot matrix to 19 destinations; drag a modulator's grip onto a knob, or right-click a knob →
  *Modulate with*. Red rings show modulation on knobs.
- **Arpeggiator**: up, down, up-down, as played, random, chord; 1/4–1/32 incl. triplets; 1–4 octaves; gate, swing, latch.

### Effects pool — 39 units, shared by the synth FX rack and the pedalboard
Dynamics: Grounds Gate, Squeeze (compressor), The Lid (limiter), Snap (transient), Morning Swell, Percolate (tempo pump).
Drive: Sugar Boost, Crema Drive, Burnt Fuzz, Roastmaster (amp + 5 cabinets), Grinder, Bit Mill, Cassette, Steam Wand (exciter).
Pitch: Double Shot (octaver), Shift (pitch shifter), Barber Pole (frequency shifter), Ring Ding (ring mod).
Filter & EQ: Tone Bar (4-band), Wake-Up (envelope filter), Pour Over (motion filter), Café Voice (formant).
Modulation: Steam Chorus, String Café (ensemble), Hyper Brew, Swirl (phaser), Jet Flanger, Lamp Vibe, Drip Trem,
Suitcase Pan, Spin Cabinet (rotary), Wide Mug (stereo width).
Time & space: Tape Echo, Backwash (reverse delay), Cathedral (hall + shimmer + freeze), Steel Plate, Spring Tank,
Aroma Cloud (granular texture), Loop Station (pedalboard looper).

### Guitar
- Live input with device and channel choice (In 1 / In 2 / both), input gain and meter; built-in test guitar
  (four DI riffs) and any audio file as the input when nothing is plugged in.
- **Pedalboard** in any order, footswitches, 15 rigs (Clean Shimmer, Dream-Pop Wall, Indie Crunch, Morning Swell,
  Tape Lo-Fi, Octave Fuzz Lead, Funk Wake-Up, Bass DI, Surf Spring, Barber Pole, Leslie Blues, Granular Halo,
  Looper Session, Vibe Machine, Clean DI); save your own.
- **Tuner** (mutes while tuning, A4 430–450 Hz).
- **Guitar → Synth**: monophonic pitch tracking plays the current patch, follows bends, retriggers on a new pick.
- **Synth into pedals** routes the synth through the board.

### Everything else
49 factory sounds in 8 categories (Pads, Keys, Leads, Bass, Plucks, Arps, Textures, Guitar synth), loudness-matched;
Surprise me; save / export / import sounds and rigs; record takes from the master output and save 24-bit WAV;
on-screen keyboard (velocity by where you strike), pitch and mod wheels, computer keys, Web MIDI with MIDI learn on
any knob; hold (sustain) pedal; tempo for arps, LFOs and delays; panic.

## Get it
Website: https://eleosynth.github.io/Eleosynth/ (play in the browser at /app/) · Releases: https://github.com/Eleosynth/Eleosynth/releases

| Build | File |
|---|---|
| Mac (Apple Silicon) | `Eleosynth-0.1.0-arm64.dmg` — Electron 45 shell, ad-hoc signed: first launch needs *Open Anyway* |
| Windows 10/11 (x64) | `Eleosynth-0.1.0-Setup-x64.exe` (per-user NSIS installer, Start-menu Pedalboard shortcut) and `-win-x64-portable.zip` |
| Ubuntu / Debian (amd64) | `Eleosynth-0.1.0-amd64.deb` — launcher with a Pedalboard action, hicolor icons, AppArmor userns profile |
| Android 7.0+ | `Eleosynth-0.1.0.apk` — WebView shell, package `com.wilk.eleosynth`, no INTERNET permission, saves to `Music/Eleosynth/` |
| Web | `Eleosynth-0.1.0-web.zip` — the page plus a local launcher (`http://localhost:8752`) for guitar input and MIDI |

## Build
```
python3 tools/make_logo.py   # regenerates src/logo.svg (make_logo_tiered.py is the alternate design)
python3 build.py             # -> dist/eleosynth.html (standalone), dist/eleosynth-page.html
sh build-all.sh              # -> every package in dist/ (see the header of build-all.sh for the toolchain)
sh tools/assemble_site.sh    # -> _site/ (website + web app), published by .github/workflows/pages.yml
```
Releases: bump `V=` in `build-all.sh`, `mac/app/package.json` and `android/AndroidManifest.xml`, then push a tag
(`git tag v0.1.1 && git push origin v0.1.1`) or start **Release** from the Actions tab. The APK is included only when
the repository secrets `ELEO_KEYSTORE_B64` and `ELEO_KS_PASS` hold the release key; the key is never in the repository.

## Test
```
node tools/test_engine.js     # pitch accuracy, every table × warp, every filter, tine models, all 39 effects, CPU
node tools/test_track.js      # guitar -> synth tracking on a melody; arpeggiator timing
node tools/test_presets.js    # every factory sound and rig renders cleanly
python3 tools/ui_check.py DIR # headless Chromium: start, play, every tab, desktop + phone screenshots, console errors
python3 tools/electron_check.py OUT.png  # boots the packaged Linux app under Xvfb and plays the test guitar
```
Measured: oscillator pitch within 0.01 cent from A1 to A5; heavy patch (2 × 7-voice unison, tine, aroma, ladder,
chorus + delay + hall, 8 notes) ≈ 26 % of one core; tracking follows a 13-note melody (one brief octave slip on the
synthetic test pluck). The packaged Linux desktop app boots and plays under Xvfb. **Not yet run on a physical Mac, Windows PC or Android device, or with a real guitar.**

## Layout
- `src/worklet.js` — the engine: voices, oscillators, tine piano, granular, filters, envelopes/LFOs, matrix, arp,
  all 39 effect units, chains, YIN pitch tracker, limiter; plus the recorder
- `src/tables.js` — wavetable recipes, FFT, mip levels, import
- `src/sources.js` — Aroma textures and test guitar riffs (Karplus-Strong)
- `src/params.js` — parameter schema and the effects pool
- `src/presets.js` — factory sounds and rigs
- `src/kit.js` — knobs, selects, menus, toasts; `src/app.js` — the application; `src/style.css` — Tostado
- `src/fonts/` — Big Shoulders Display, Archivo, Martian Mono (SIL OFL 1.1)
- `web/` — local launcher

## Roadmap
0.2 third oscillator, macro knobs, wavetable editor · 0.4 polyphonic guitar mode, MIDI out · 0.5 exchange sounds and
takes with DAWters and Son and Esperanza's Drum Kit · then a GitHub release alongside the suite.

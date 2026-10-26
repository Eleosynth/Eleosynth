**Eleosynth** — a free, open-source synthesizer and guitar pedal studio in the DAWters and Son suite.

### Downloads
| | File |
|---|---|
| Mac (Apple Silicon, macOS 12+) | `Eleosynth-*-arm64.dmg` — first launch: System Settings › Privacy & Security › Open Anyway |
| Windows 10/11 (x64) | `Eleosynth-*-Setup-x64.exe` (per-user, no admin) or the portable zip — SmartScreen: More info › Run anyway |
| Ubuntu / Debian (amd64) | `Eleosynth-*-amd64.deb` — `sudo apt install ./Eleosynth-*-amd64.deb` |
| Android 7+ | `Eleosynth-*.apk` |
| Browser | `Eleosynth-*-web.zip` (page + local launcher for guitar input and MIDI), or play at https://eleosynth.github.io/Eleosynth/app/ |

### New in 0.2.0
- **Inside DAWters and Son 2.4:** Eleosynth now runs as an instrument track in DAWters, on the song's clock and sample-accurate in exports, and its guitar pedalboard runs as an insert on any DAWters audio track (record clean, change the pedals later).
- **Send to DAWters** (Takes & files): sends this sound, with your pedalboard, to a new Eleosynth track in DAWters, or any take as an audio clip. On the web it opens DAWters for you; the desktop and Android apps save a `.dawsuite.json` to import there.

**DAWters & Son branding.** Eleosynth now wears the suite's type family: the Yesteryear script for the name (the wordmark, sound names, pedal names), Oswald for headings and labels, and Courier Prime for text and readouts. The header carries the "a DAWters & Son production" mark and the ★ Fresh roasted sound ★ tagline, and the website matches.

**From the Joshenthesizer, rebuilt for Eleosynth (new Perform and Master tabs):**
- **Drone lock:** hold notes and press Lock, the \ key or a sostenuto pedal (CC66); they keep sounding while you play over them. Press Lock first to arm it for the next chord.
- **DN Drone:** Tanpura (Pa/Ma/Ni/Sa first string, jawari buzz), Shruti box, Uilleann drones, Analog and Glass drones, with root, level, tone, fifth, movement, cycle and jawari.
- **Touch pad:** the keyboard dock switches to a multi-touch XY pad. Left to right plays the key and scale (or slides freely), up and down opens the filter, adds vibrato or changes volume; 1–3 octaves, hold.
- **Chord modes:** a key and scale (12 scales, including raga Bhairav), Chord and Rolled-chord play modes with triad, 7th, add 9 and sus 4 shapes, and a chord namer.
- **TN Tuner:** 20 instruments and tunings, string auto-detect or lock, reference tones, median-smoothed needle and a strobe; reaches a 5-string bass's low B.
- **MX Master:** 3-band EQ, glue compressor, stereo width and output ceiling with a live spectrum; takes record through it.
- **Looper:** every overdub pass is a layer; Undo layer (Backspace) and Feedback to fade older layers.
- **MIDI:** input channel, follow MIDI clock for the tempo, CC7 volume, CC66 drone lock, CC71 resonance, CC74 cutoff. PgUp/PgDn change octave.

### In 0.1.1
- **Bind keys:** a switch beside the keyboard ties your computer keyboard to the on-screen keys. Each bound key shows its letter (A W S E D F T G Y H U J K O L P ; ') and the letters follow the octave buttons and Z / X. Unbind it and typing never plays notes.
- **Key size:** Keys menu with Auto, Small, Medium, Large and Extra large. Bigger keys are wider and taller, so they're easier to hit on a phone. The choice is remembered.

### In 0.1.0
- Two wavetable oscillators (16 built-in tables + import your own), a six-model tine electric piano, the Aroma granular layer, sub and noise.
- Ladder, state-variable and comb filters with analog drift; 3 envelopes, 2 LFOs, an 8-slot matrix with drag-to-modulate; arpeggiator.
- 39 effects shared by the synth FX rack and the guitar pedalboard; 15 rigs; tuner; Loop Station.
- Guitar → Synth pitch tracking; capture your guitar into the granular layer.
- 49 factory sounds; record takes to 24-bit WAV; Web MIDI with MIDI learn.

Free software under the GNU GPL v3 or later. No price, no sign-up, no tracking: the app makes no network requests.
The installers are not yet signed with paid certificates.

<div align="center">

# VIVO

### Play chords with your hands. No instrument, no install, just a webcam.

[![CI](https://github.com/Lameda12/vivomusicano/actions/workflows/ci.yml/badge.svg)](https://github.com/Lameda12/vivomusicano/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Privacy: on-device](https://img.shields.io/badge/privacy-100%25%20on--device-blue.svg)](legal/PRIVACY.md)
[![GitHub stars](https://img.shields.io/github/stars/Lameda12/vivomusicano?style=social)](https://github.com/Lameda12/vivomusicano/stargazers)

**Swipe** to change the chord. **Raise** your hand for volume. **Pinch** to filter.<br>
A gesture synth that plays along with a singer, in real time, in your browser.

[Run it](#run-it) · [Controls](#controls) · [Roadmap](ROADMAP.md) · [Contribute](CONTRIBUTING.md)

📱 **Native app coming soon.** Get early access at [alamedinsabit.me](https://alamedinsabit.me)

</div>

---

## Why VIVO

- 🎤 **Built for singers.** Load a progression, then move the band forward with one hand while you sing.
- ⚡ **Fast.** About 15–30 ms from gesture to sound, measured live (press `D`).
- 🔒 **Private by design.** Hand tracking runs on your device. Video never leaves your browser. No account, no tracking.
- 🎹 **Sounds good out of the box.** Voice-led Pad, Keys, and Pluck presets, so chords glide instead of jump.
- 🧩 **Hackable.** About 1,400 lines of TypeScript. Add a preset or gesture in an afternoon.

Built with Next.js, MediaPipe HandLandmarker, and Tone.js. A chord progression is preloaded; your **right hand** decides *when* the next chord comes in, and your **left hand** shapes *how* it sounds.

## Run it

```bash
npm install
npm run dev        # copies MediaPipe WASM + downloads the hand model on first run
# open http://localhost:3000 in Chrome, press START, allow the camera
```

Production: `npm run build && npm start`. Needs a webcam and a WebGL-capable browser (Chrome/Edge/Arc recommended). Camera access requires `localhost` or HTTPS.

## Controls

| Input | Follow mode (default) | Auto mode |
|---|---|---|
| Right hand: quick **downward swipe** | next chord | — |
| Right hand: **open hand → fist** | next chord | — |
| Right hand **raised** / lowered | — | hold / resume |
| Left hand **height** | volume | volume |
| Left hand **pinch** (thumb–index) | low-pass filter cutoff | filter |
| `Space` / `→` | next chord (no camera needed) | skip ahead |
| `M` | toggle Follow / Auto | |
| `D` | debug overlay: fps, inference, gesture→trigger latency, gesture state | |
| `H` | swap hands (if your camera already mirrors) | |

One motion = one advance (250 ms debounce; a swipe must slow down before it can fire again). Songs loop at the end. When a hand leaves the frame its values are held, so nothing jumps.

**Sounds:** Pad (fat-saw pad, common tones sustain across changes), Keys (FM e-piano), Pluck (arpeggiates the chord on every advance). Voicings are chosen to move each voice as little as possible between chords.

**Songs:** three built-in progressions, plus **+ NEW** to paste your own (`G B C Cm`, `F#m7, Bbmaj7 | C/E Dsus4`), with bpm and beats per chord. Custom songs are saved in localStorage.

## Latency

The audio context runs with `latencyHint: "interactive"` and Tone's look-ahead set to 0, so notes fire the moment a gesture is detected. Press `D` to see the measured numbers: inference start → synth triggered (typically 15–30 ms), plus the browser-reported audio output latency (~5 ms on macOS). Camera capture adds latency the page can't measure. When inference falls behind the frame budget, frames are dropped so the model always works on the freshest one.

**Fallbacks:** if the GPU delegate fails, tracking falls back to CPU (badge top left shows `GPU`/`CPU TRACKING`). If the camera is blocked or WebGL is missing entirely, a message says so and `Space` still drives the song.

## Layout

```
lib/gestures.ts   velocity, pinch, fist/open, debounce, right/left hand state machines
lib/audio.ts      Tone setup, voice-leading voicer, Pad/Keys/Pluck presets
lib/songs.ts      song model, chord parser, localStorage
lib/vision.ts     HandLandmarker loader (GPU → CPU), handedness assignment
components/Stage.tsx      camera, detection loop, skeleton overlay, chord display
components/Controls.tsx   mode/song/preset bar, meters, song editor
components/GestureSynth.tsx  wires frames → gestures → audio, auto clock, keys
```

## 30-second demo script

Setup: Chrome fullscreen, good front light, sit ~1 m from the camera so both hands fit in frame. Song: **Slow Burn** (G B C Cm), preset **Pad**, Follow mode. Have a singer (or yourself) ready to hum.

| Time | Action | What the viewer sees and hears |
|---|---|---|
| 0–3 s | Press **START**. | Giant **G** appears, pad swells in. |
| 3–10 s | Singer starts. Right hand **swipes down** on each phrase: G → B → C. | Chord slams in with an orange flash, a ring pulses at the wrist, and the progress bar steps forward. |
| 10–14 s | Right hand **closes into a fist** to land on **Cm**. | Shows the second trigger gesture. The minor chord lands as the melody turns. |
| 14–20 s | Left hand **rises**, then **pinches closed** slowly. | VOL meter climbs, FILT meter falls, and the pad goes dark and muffled. Open the pinch for a bright swell. |
| 20–24 s | Click **PLUCK** and swipe twice. | The chord now ripples as an arpeggio on every advance. |
| 24–30 s | Press **M** for Auto, then **raise the right hand** to hold the chord on the singer's long note. Lower it to let the song roll on. | The **HOLD** tag lights up and the beat bar pauses, then resumes. |

Tip: press `D` before recording if you want the latency numbers on screen.

## Roadmap

The web app stays free and open source. Next up: MIDI out, shareable song links, more presets, and a calibration screen. Native **iOS, Android, and desktop apps** are on the way, along with an optional **VIVO Pro** tier (sound library, cloud setlists, recording and export, multiplayer jams). Full plan in [ROADMAP.md](ROADMAP.md).

## Contributing

Contributions of every size are welcome: presets, songs, gestures, docs, translations, bug reports. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [`good first issue`](https://github.com/Lameda12/vivomusicano/labels/good%20first%20issue) label. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

If VIVO made you smile, ⭐ the repo and share a clip. Tag it **#VIVOsynth**.

## Legal

- [MIT License](LICENSE) (code) · [Trademark policy](TRADEMARK.md) (name and logo)
- [Privacy Policy](legal/PRIVACY.md) · [Terms of Use](legal/TERMS.md) · [Safety notice](legal/SAFETY.md): flashing lights and loud audio
- [Security policy](SECURITY.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

## Contact

Alamedin Sabit, [alamedinsabit.me](https://alamedinsabit.me)

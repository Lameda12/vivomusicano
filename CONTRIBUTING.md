# Contributing to Vivomusicano

Thanks for wanting to help. Vivomusicano is open to contributions of every size: a new chord progression, a better swipe threshold, a new synth preset, docs, translations, or bug reports.

## Quick start

```bash
git clone https://github.com/Lameda12/vivomusicano.git
cd vivomusicano
npm install
npm run dev      # downloads the MediaPipe WASM + hand model on first run
```

Open http://localhost:3000 in Chrome, press START, allow the camera. No camera? `Space` advances chords so you can still work on audio and UI.

Before you open a PR:

```bash
npm run typecheck
npm run lint
npm run build
```

## Where to start

- Issues labeled [`good first issue`](https://github.com/Lameda12/vivomusicano/labels/good%20first%20issue) are small and well scoped.
- Issues labeled [`help wanted`](https://github.com/Lameda12/vivomusicano/labels/help%20wanted) are bigger and need someone to own them.
- Have an idea that isn't in an issue? Open a feature request first so we can agree on the approach before you write code.

## Map of the code

| File | What lives there |
|---|---|
| `lib/gestures.ts` | Swipe velocity, pinch, fist/open, debounce, per-hand state machines |
| `lib/audio.ts` | Tone.js setup, voice-leading voicer, Pad/Keys/Pluck presets |
| `lib/songs.ts` | Song model, chord parser, localStorage |
| `lib/vision.ts` | HandLandmarker loader (GPU, then CPU fallback) |
| `components/Stage.tsx` | Camera, detection loop, skeleton overlay |
| `components/Controls.tsx` | Mode, song and preset bar, meters, song editor |
| `components/GestureSynth.tsx` | Wires frames to gestures to audio |

## Ground rules

1. **Latency is the product.** Anything on the path from camera frame to note must stay fast. If a change touches that path, press `D` and include before/after latency numbers in the PR.
2. **Privacy is the product too.** Video never leaves the device. PRs that add analytics, telemetry, remote logging, or upload camera data in the open-source app will not be merged.
3. **Keep it client-side.** The open-source app must run with no backend and no account.
4. **Small PRs.** One change per PR. Easier to review, faster to merge.
5. **Match the code around you.** Same naming, same comment style, TypeScript strict.

## Commits and PRs

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `perf:`, `refactor:`, `chore:`.
- Fill in the PR template. For gesture or audio changes, a short screen recording helps a lot.
- A maintainer reviews every PR. Expect feedback; it's normal.

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under the project's [MIT License](LICENSE) and that you have the right to submit it. MIT allows the maintainer and anyone else to use the code in other products, including the planned Vivomusicano app and its paid tier (see [ROADMAP.md](ROADMAP.md)). Contributors are credited in release notes.

## Conduct

Everyone taking part must follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Questions

Open a [Discussion](https://github.com/Lameda12/vivomusicano/discussions) or reach out through [alamedinsabit.me](https://alamedinsabit.me).

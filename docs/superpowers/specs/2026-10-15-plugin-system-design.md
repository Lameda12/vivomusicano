# Vivomusicano plugin system — design

_Date: 2026-10-15 · Status: approved design, pending spec review_

## Goal

Grow the community by letting outside developers and musicians extend Vivomusicano the way VS Code extensions or Claude Code plugins extend those tools. Success means: a developer can ship a new gesture, instrument, song pack, or visual in one PR, and a musician can share a preset or song pack as a single link, without breaking the privacy promise (video never leaves the device) or adding audible latency.

## Decisions

| Decision | Choice |
|---|---|
| Primary goal | Community growth |
| Contribution types in v1 | Gestures, instruments, song packs, visuals/themes |
| Architecture | Hybrid: **code plugins** (TypeScript, in repo, added by PR) + **data-only packs** (JSON, loadable at runtime). One manifest format for both. |
| Deferred | Sandboxed third-party JS at runtime, Pro payments/unlock, MCP/AI bridge, ratings, auto-update, plugin-defined actions |

## 1. Architecture

Built-in features move into a `core` plugin, so the app runs on the same API community plugins use.

```
plugins/
  core/                       today's Pad/Keys/Pluck, songs, swipe/fist/raise, left-hand expression, skeleton visual
    vivomusicano.plugin.json
    index.ts
  strings/                    example code plugin (instrument)
  pinch-next/                 example data-only pack (gesture rule)
  catalog.json                generated at build, served same-origin
lib/plugins/
  types.ts      public contract: manifest, PluginApi, HandFrame, GestureEvent, Instrument, Visual
  registry.ts   contributions from enabled plugins; enable/disable; lookups by id
  loader.ts     activates built-in code plugins; installs/validates JSON packs
  schema.ts     strict pack validation (unknown fields rejected)
  rules.ts      compiles JSON gesture rules into detectors
  dispatch.ts   bindings table + per-action debounce + action dispatch
  guard.ts      error isolation and timing for every plugin call
  share.ts      share-link encode/decode
  storage.ts    IndexedDB for installed packs, localStorage for enabled state and bindings
```

### Manifest (`vivomusicano.plugin.json`)

```json
{
  "id": "strings",
  "name": "Lush Strings",
  "version": "1.0.0",
  "author": "github-handle",
  "description": "Slow-attack string ensemble",
  "apiVersion": 1,
  "tier": "community",
  "main": "index.ts",
  "contributes": {
    "instruments": [],
    "songs": [],
    "themes": [],
    "gestureRules": []
  }
}
```

- `id`: lowercase `[a-z0-9-]`, unique. All contribution ids are namespaced as `<pluginId>.<localId>` (e.g. `core.swipe-down`).
- `main` is present only for code plugins in the repo. Imported packs with `main` are rejected.
- `tier`: `"community" | "pro"`. Pro plugins are listed but not activatable in v1.
- `apiVersion` greater than the app's supported version → refused with "needs a newer Vivomusicano".

### Code plugin API

```ts
export default definePlugin({
  activate(api: PluginApi) {
    api.registerInstrument({ id, name, create: (ctx: InstrumentContext) => Instrument });
    api.registerGesture({ id, name, hand: "right" | "left" | "any", suggestedBinding?, detect: (f: HandFrame) => GestureEvent | null });
    api.registerVisual({ id, name, draw: (ctx: CanvasRenderingContext2D, f: HandFrame, s: VisualState) => void });
    api.registerSongPack({ id, name, songs: Song[] });
    api.registerTheme({ id, name, vars: Record<string, string> });
  },
});
```

`InstrumentContext` exposes the Tone.js module and the engine's output node. `VisualState` is read-only: current chord, beat progress, last trigger time, hold state, expression values.

### Privacy and safety rules

- Plugins receive `HandFrame` (21 landmarks per hand, timestamp). Never video pixels, never the `MediaStream`.
- Next config adds a Content-Security-Policy header with `connect-src 'self'`, `img-src 'self' data: blob:`, `media-src 'self' data: blob:`. No plugin or pack can reach the network.
- Theme `vars` only accept CSS custom properties (`--*`) with values matching a color/length allowlist pattern; no `url()`.

## 2. Data flow and contracts

```
camera → MediaPipe → HandFrame { t, right, left }
  → each enabled gesture detector (core + code plugins + compiled rules), via guard
  → GestureEvent[]
  → dispatch: bindings[gestureId] → action, per-action debounce
  → song state / AudioEngine / UI
  → each enabled visual draws on the overlay canvas, via guard
```

```ts
type HandFrame = { t: number; right: Pt[] | null; left: Pt[] | null };

type GestureEvent =
  | { kind: "trigger"; gesture: string }
  | { kind: "value"; gesture: string; value: number }; // 0..1

type TriggerAction = "next-chord" | "prev-chord" | "hold" | "release" | "next-instrument" | "toggle-mode";

type Binding = { gesture: string; action: TriggerAction | ValueAction; mode?: "follow" | "auto" }; // no mode = both
type ValueAction = "volume" | "filter" | "macro1" | "macro2";
```

- Trigger gestures bind to a `TriggerAction`; value gestures bind to a `ValueAction`. Binding a trigger to a value action (or the reverse) is impossible in the UI and rejected by `dispatch`.
- Debounce is per action (250 ms, same as today), so two gestures bound to `next-chord` cannot double-fire.
- Default bindings come from `suggestedBinding`; user overrides are stored in localStorage and win. Bindings can be limited to one mode. Core defaults reproduce today's behavior exactly: swipe-down and open→fist → `next-chord` (follow); right-hand raise → `hold` and lower → `release` (auto); left height → `volume` and left pinch → `filter` (both). `suggestedBinding` in a manifest may be an action id or `{ action, mode }`.
- When a hand leaves the frame, value actions hold their last value (today's behavior).

### JSON gesture rules

```json
{ "id": "pinch-next", "name": "Right pinch → next", "hand": "right",
  "when": { "metric": "pinch", "op": "<", "value": 0.3 },
  "fire": "enter", "suggestedBinding": "next-chord" }
```

- Metrics: `pinch`, `openness`, `extendedFingers`, `wristY`, `wristX`, `velocityY` — the existing functions in `lib/gestures.ts`.
- `op`: `<`, `>`. `fire: "enter"` emits one trigger when the condition becomes true and re-arms when it becomes false.
- Value rule (no `when`, no `fire`): `{ "metric": "wristY", "range": [0.8, 0.2] }` maps linearly and clamps to 0..1 (reversed range allowed).

### Instruments

```ts
interface Instrument {
  playChord(v: Voicing, time: number): void;
  release(time: number): void;
  setParam(p: ValueAction, v: number): void;
  dispose(): void;
}
```

`AudioEngine` keeps voice-leading (`voiceChord`) and the master chain and delegates sound to the active `Instrument`. `PresetName` union is replaced by instrument ids.

JSON instrument recipe:

```json
{ "id": "soft-strings", "name": "Soft Strings",
  "synth": "poly-synth", "params": { "oscillator": { "type": "fatsawtooth" }, "envelope": { "attack": 0.8, "release": 2.5 } },
  "effects": [ { "type": "chorus", "params": { "frequency": 0.5 } }, { "type": "reverb", "params": { "decay": 5 } } ],
  "macros": { "macro1": "reverb.wet" } }
```

- `synth`: `poly-synth | fm | am | pluck | sampler`. Params are passed to the matching Tone constructor after schema validation of known keys.
- `effects` allowlist: `reverb`, `delay`, `chorus`, `filter`, `distortion`.
- `sampler` samples: same-origin paths or `data:` URIs inside the pack; total pack size ≤ 5 MB.

## 3. Sharing, discovery, UI

### Ways in

1. **Catalog (bundled).** Every plugin folder in `plugins/` is built into the app. `npm run check-plugins` validates manifests and writes `plugins/catalog.json`. The Discover tab reads it same-origin.
2. **Share links.** Data-only packs without samples: JSON → `CompressionStream("deflate-raw")` → base64url → `#pack=…`. On load, the app decodes, validates, and shows the install card. Packs over 16 KB encoded show "too big for a link, export as file".
3. **File import.** Drag-and-drop or file picker for `.vmpack.json`.

Every import goes through `schema.ts`, then an install card ("Lush Strings by @x adds 1 instrument, 2 songs. Install?"). Installed packs are stored in IndexedDB; enabled flags and bindings in localStorage. The existing `vivo.songs.v1` custom songs stay where they are and appear as a "My songs" pack.

### Plugins panel (key `P`, top-bar button)

- **Installed** — card per plugin: name, author (GitHub link), version, contributions, toggle, Remove (packs only; `core` can't be removed), Share link (packs only).
- **Discover** — catalog with search and filter by type. Pro entries show 🔒 "Pro — coming soon" linking to ROADMAP.md.
- **Gestures** — table of available gestures, action dropdown per row, live "✓ detected" flash.
- **Import** — drop zone + paste box.

### Contributor tooling

- `npm run new-plugin <id>` scaffolds a folder with manifest and `index.ts` (or `--pack` for JSON only).
- `docs/PLUGINS.md`: guide with one worked example per contribution type.
- README "Plugin gallery" table generated from the catalog.
- `plugin` issue label.

## 4. Errors, testing, rollout

### Error handling

- `guard.ts` wraps every plugin call. Three throws within 10 s disables the plugin, shows a toast, and logs to console. The rest of the app keeps running.
- Timing: rolling average per detector and visual. `detect` > 2 ms or `draw` > 4 ms shows ⚠ on the plugin card and in the `D` overlay. No automatic disable for slowness.
- If the active instrument's plugin is disabled, the engine switches to `core.pad` without stopping the song.
- Schema errors name the exact path and reason, e.g. `instruments[0].effects[2].type: "bitcrusher" is not allowed`.

### Testing (Vitest; closes issue #1)

- `schema.ts`: valid and invalid packs, unknown fields, size limit, `main` in an imported pack.
- `rules.ts`: compiled detectors against recorded landmark fixtures (enter/re-arm, value mapping, reversed range).
- `dispatch.ts`: binding resolution, trigger/value mismatch rejection, per-action debounce.
- `guard.ts`: error counter window and disable.
- `share.ts`: encode/decode round trip, oversize, corrupt input.
- Core parity: core gestures on fixtures produce the same advances as the current implementation.
- CI runs `npm test` and `npm run check-plugins`.

### Rollout (three PRs, each shippable)

1. **Core refactor.** `lib/plugins/{types,registry,guard,dispatch}.ts`, `plugins/core`, AudioEngine on `Instrument`. No user-visible change; gesture→trigger latency in the `D` overlay must not regress.
2. **Code plugins + panel.** Loader, Installed and Gestures tabs, `strings` example instrument, CSP header.
3. **Packs and sharing.** Schema, rules compiler, share links, file import, IndexedDB storage, Discover tab, catalog script, `new-plugin` scaffold, `docs/PLUGINS.md`, README gallery, `pinch-next` example pack.

### Out of scope for v1

Sandboxed runtime JS from third parties, Pro payments and unlocking, MCP/AI bridge, ratings and reviews, auto-updates, plugin-defined actions.

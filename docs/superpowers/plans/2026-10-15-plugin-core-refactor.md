# Plugin System — Part 1: Core Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Vivomusicano's built-in sounds, songs, gestures and hand skeleton into a `core` plugin that runs on a typed plugin registry, with no user-visible change.

**Architecture:** A `Registry` holds contributions (instruments, gestures, visuals, song packs, themes) from plugin modules, namespaced `<pluginId>.<id>`. Each camera frame, `GestureSynth` runs every enabled gesture detector through a `Guard` (error isolation + timing), turns results into `GestureEvent`s, and a `Dispatcher` maps them to a fixed set of actions using mode-aware bindings with per-action debounce. `AudioEngine` keeps voice-leading and the master chain and delegates sound to an `Instrument`.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, TypeScript strict, Tone.js 15, MediaPipe Tasks Vision, Vitest (new).

**Spec:** `docs/superpowers/specs/2026-10-15-plugin-system-design.md` (this plan implements rollout step 1, "Core refactor"; parts 2 and 3 get their own plans after this lands).

## Global Constraints

- No user-visible change: same gestures, same defaults, same sounds, same UI apart from the instrument picker reading names from the registry.
- Gesture→trigger latency in the `D` overlay must not regress versus the baseline recorded in Task 1.
- Plugins receive `HandFrame` (landmarks + timestamp) only — never video pixels or the `MediaStream`.
- Contribution ids: lowercase `[a-z0-9-]`, namespaced as `<pluginId>.<localId>` (e.g. `core.swipe-down`).
- Trigger actions: `next-chord | prev-chord | hold | release | next-instrument | toggle-mode`. Value actions: `volume | filter | macro1 | macro2`.
- Debounce is per action, 250 ms.
- Guard: 3 throws within 10 s disables a plugin (except `core`); `detect` > 2 ms or `draw` > 4 ms average is flagged slow, never auto-disabled.
- Core default bindings: `core.swipe-down`, `core.fist` → `next-chord` (follow); `core.raise` → `hold`, `core.lower` → `release` (auto); `core.left-height` → `volume`, `core.left-pinch` → `filter` (both modes).
- Keep the localStorage key `vivo.songs.v1` unchanged (renaming it would erase users' saved songs).
- Read the relevant guide in `node_modules/next/dist/docs/` before changing Next-specific code (AGENTS.md).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A plugin value gesture returns `NaN` or a value outside 0..1 → the value is dropped (NaN) or clamped; volume never jumps to an invalid gain. Pinned in Task 3.
2. The right hand leaves the frame while raised in Auto mode → the song resumes (today's behavior). Pinned in Task 4.
3. Swipe and fist both fire on the same frame → exactly one chord advance. Pinned in Task 3 (per-action debounce) and Task 4 (both detectors fire).
4. A non-core plugin throws every frame → it is disabled after 3 errors in 10 s and playback continues; `core` is never disabled. Pinned in Task 2.
5. A plugin's `Instrument.create` throws when selected → the previous instrument keeps playing and a notice appears. Pinned by the manual check in Task 6 (Tone.js needs a real AudioContext).

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` (new) | Test runner config with the `@/` alias |
| `lib/plugins/types.ts` (new) | Public plugin contract: manifest, API, frame, gesture, instrument, visual types, action lists |
| `lib/plugins/registry.ts` (new) | Installs plugin modules, namespaces contributions, enable/disable, cached lookups, change subscription |
| `lib/plugins/guard.ts` (new) | Wraps every plugin call: try/catch, error window, disable callback, timing, slow list |
| `lib/plugins/dispatch.ts` (new) | Default bindings from suggestions, binding validation, mode filter, per-action debounce |
| `lib/plugins/runtime.ts` (new) | App singleton registry with built-in plugins installed |
| `plugins/index.ts` (new) | List of built-in plugin modules |
| `plugins/core/vivomusicano.plugin.json` (new) | Core manifest |
| `plugins/core/index.ts` (new) | Core plugin: registers everything below |
| `plugins/core/gestures.ts` (new) | Right-hand tracker, left-hand smoother, six core gesture definitions |
| `plugins/core/instruments.ts` (new) | Pad/Keys/Pluck as `Instrument`s |
| `plugins/core/visuals.ts` (new) | Hand skeleton visual |
| `tests/fixtures/hands.ts` (new) | Synthetic 21-point hand landmarks for tests |
| `lib/audio.ts` (modify) | Engine delegates to `Instrument`; `setParam`; remove presets |
| `lib/gestures.ts` (modify) | Remove `RightHandGestures`, `LeftHandExpression` (moved to core); keep math helpers |
| `lib/vision.ts` (modify) | Remove `HAND_CONNECTIONS` export (moved to core visual) |
| `components/Stage.tsx` (modify) | Rename frame type to `CameraFrame`; draw via `onDraw` callback |
| `components/Controls.tsx` (modify) | Instrument picker from registry; `Mode` from plugin types |
| `components/GestureSynth.tsx` (rewrite) | Frame → guard → dispatcher → actions; registry-driven songs/instruments; notices |
| `.github/workflows/ci.yml` (modify) | Run `npm test` |

---

### Task 1: Test runner, plugin contract, and registry

**Files:**
- Create: `vitest.config.ts`, `lib/plugins/types.ts`, `lib/plugins/registry.ts`
- Test: `lib/plugins/registry.test.ts`
- Modify: `package.json` (scripts, devDependency), `.github/workflows/ci.yml`, `docs/superpowers/specs/2026-10-15-plugin-system-design.md`

**Interfaces:**
- Consumes: `Pt` from `lib/gestures.ts`, `Song` from `lib/songs.ts`, `Voicing` from `lib/audio.ts` (type-only).
- Produces: everything exported from `lib/plugins/types.ts` below; `Registry`, `Registered<T>`, `PluginError` from `lib/plugins/registry.ts`.

- [ ] **Step 1: Record the latency baseline (manual, needs a webcam)**

Run `npm run dev`, open http://localhost:3000 in Chrome, press START, press `D`. Swipe down 10 times in Follow mode. Write the typical `gesture→trigger` and `inference` values into the PR description draft as "Baseline". These are compared in Task 6.

- [ ] **Step 2: Install Vitest and add scripts**

```bash
npm install -D vitest
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"
```

Create `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
```

In `.github/workflows/ci.yml`, add after `- run: npm run lint`:

```yaml
      - run: npm test
```

- [ ] **Step 3: Write the plugin contract**

Create `lib/plugins/types.ts`:

```ts
import type * as ToneNS from "tone";
import type { Voicing } from "@/lib/audio";
import type { Pt } from "@/lib/gestures";
import type { Song } from "@/lib/songs";

/** Plugin API version this build of the app supports. */
export const API_VERSION = 1;

export type Mode = "follow" | "auto";

/** One camera frame of hand landmarks (x, y in 0..1, y down). Plugins never see video pixels. */
export type HandFrame = { t: number; right: Pt[] | null; left: Pt[] | null };

export const TRIGGER_ACTIONS = ["next-chord", "prev-chord", "hold", "release", "next-instrument", "toggle-mode"] as const;
export const VALUE_ACTIONS = ["volume", "filter", "macro1", "macro2"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];
export type ValueAction = (typeof VALUE_ACTIONS)[number];
export type Action = TriggerAction | ValueAction;

export type GestureEvent =
  | { kind: "trigger"; gesture: string }
  | { kind: "value"; gesture: string; value: number };

export type SuggestedBinding = Action | { action: Action; mode?: Mode };
/** `mode` limits the binding to one playback mode; omitted = both. */
export type Binding = { gesture: string; action: Action; mode?: Mode };

type GestureBase = {
  id: string;
  name: string;
  hand: "right" | "left" | "any";
  suggestedBinding?: SuggestedBinding[];
};
/** `detect` returns true on the frame the gesture fires. */
export type TriggerGestureDef = GestureBase & { kind: "trigger"; detect: (f: HandFrame) => boolean };
/** `detect` returns 0..1, or null when there is no reading (value is held). */
export type ValueGestureDef = GestureBase & { kind: "value"; detect: (f: HandFrame) => number | null };
export type GestureDef = TriggerGestureDef | ValueGestureDef;

export interface Instrument {
  playChord(v: Voicing, time: number): void;
  release(time: number): void;
  setParam(p: ValueAction, v: number): void;
  dispose(): void;
}

export type InstrumentContext = {
  Tone: typeof ToneNS;
  /** connect your synth here; the engine's filter → chorus → reverb → master chain follows */
  output: ToneNS.ToneAudioNode;
  bpm: () => number;
};

export type InstrumentDef = {
  id: string;
  name: string;
  /** true: the current chord keeps sounding when switching to this instrument */
  sustains: boolean;
  create: (ctx: InstrumentContext) => Instrument;
};

export type VisualState = { lastTriggerAt: number; held: boolean; volume: number; filter: number };

export type VisualDef = {
  id: string;
  name: string;
  draw: (ctx: CanvasRenderingContext2D, f: HandFrame, s: VisualState, size: { w: number; h: number }) => void;
};

export type SongPackDef = { id: string; name: string; songs: Song[] };
export type ThemeDef = { id: string; name: string; vars: Record<string, string> };

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  apiVersion: number;
  tier: "community" | "pro";
  main?: string;
  contributes?: Record<string, unknown>;
};

export type PluginApi = {
  registerInstrument(def: InstrumentDef): void;
  registerGesture(def: GestureDef): void;
  registerVisual(def: VisualDef): void;
  registerSongPack(def: SongPackDef): void;
  registerTheme(def: ThemeDef): void;
};

export type PluginModule = { manifest: PluginManifest; activate?: (api: PluginApi) => void };

export const definePlugin = (p: PluginModule): PluginModule => p;
```

- [ ] **Step 4: Write the failing registry tests**

Create `lib/plugins/registry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PluginError, Registry } from "./registry";
import { definePlugin, type Instrument, type PluginManifest } from "./types";

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  author: "test",
  description: "",
  apiVersion: 1,
  tier: "community",
  ...over,
});

const noopInstrument: Instrument = { playChord() {}, release() {}, setParam() {}, dispose() {} };

describe("Registry", () => {
  it("namespaces contribution ids with the plugin id", () => {
    const r = new Registry();
    r.add(
      definePlugin({
        manifest: manifest(),
        activate(api) {
          api.registerInstrument({ id: "bell", name: "Bell", sustains: false, create: () => noopInstrument });
          api.registerGesture({ id: "tap", name: "Tap", hand: "right", kind: "trigger", detect: () => false });
        },
      }),
    );
    expect(r.instruments().map((i) => i.fullId)).toEqual(["demo.bell"]);
    expect(r.gestures()[0]).toMatchObject({ fullId: "demo.tap", pluginId: "demo" });
    expect(r.instrument("demo.bell")?.name).toBe("Bell");
  });

  it("rejects a second plugin with the same id", () => {
    const r = new Registry();
    r.add(definePlugin({ manifest: manifest() }));
    expect(() => r.add(definePlugin({ manifest: manifest() }))).toThrow(/already installed/);
  });

  it("refuses plugins that need a newer API", () => {
    const r = new Registry();
    expect(() => r.add(definePlugin({ manifest: manifest({ apiVersion: 2 }) }))).toThrow(/needs a newer Vivomusicano/);
  });

  it("rejects invalid plugin and contribution ids", () => {
    const r = new Registry();
    expect(() => r.add(definePlugin({ manifest: manifest({ id: "Bad Id" }) }))).toThrow(PluginError);
    expect(() =>
      r.add(
        definePlugin({
          manifest: manifest(),
          activate: (api) => api.registerVisual({ id: "x.y", name: "X", draw: () => {} }),
        }),
      ),
    ).toThrow(/invalid visuals id "x.y"/);
  });

  it("rejects duplicate contribution ids of the same kind but allows them across kinds", () => {
    const r = new Registry();
    expect(() =>
      r.add(
        definePlugin({
          manifest: manifest(),
          activate(api) {
            api.registerVisual({ id: "glow", name: "Glow", draw: () => {} });
            api.registerVisual({ id: "glow", name: "Glow 2", draw: () => {} });
          },
        }),
      ),
    ).toThrow(/duplicate visuals id "glow"/);

    r.add(
      definePlugin({
        manifest: manifest({ id: "other" }),
        activate(api) {
          api.registerVisual({ id: "glow", name: "Glow", draw: () => {} });
          api.registerTheme({ id: "glow", name: "Glow", vars: {} });
        },
      }),
    );
    expect(r.visuals()).toHaveLength(1);
    expect(r.themes()).toHaveLength(1);
  });

  it("does not install a plugin whose activate throws", () => {
    const r = new Registry();
    expect(() =>
      r.add(
        definePlugin({
          manifest: manifest(),
          activate() {
            throw new Error("boom");
          },
        }),
      ),
    ).toThrow(/"Demo" failed to activate: boom/);
    expect(r.plugins()).toHaveLength(0);
  });

  it("hides contributions of disabled plugins and notifies subscribers", () => {
    const r = new Registry();
    r.add(
      definePlugin({
        manifest: manifest(),
        activate: (api) => api.registerVisual({ id: "glow", name: "Glow", draw: () => {} }),
      }),
    );
    const listener = vi.fn();
    const unsubscribe = r.subscribe(listener);
    const v0 = r.version;

    r.setEnabled("demo", false);
    expect(r.visuals()).toEqual([]);
    expect(r.isEnabled("demo")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(r.version).toBeGreaterThan(v0);

    unsubscribe();
    r.setEnabled("demo", true);
    expect(r.visuals()).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps pro plugins disabled", () => {
    const r = new Registry();
    r.add(definePlugin({ manifest: manifest({ tier: "pro" }) }));
    expect(r.plugins()[0].enabled).toBe(false);
    expect(() => r.setEnabled("demo", true)).toThrow(/Pro plugin/);
  });

  it("collects songs from enabled song packs", () => {
    const r = new Registry();
    r.add(
      definePlugin({
        manifest: manifest(),
        activate: (api) =>
          api.registerSongPack({
            id: "pack",
            name: "Pack",
            songs: [{ id: "s1", name: "S1", bpm: 90, beatsPerChord: 4, chords: ["C", "G"] }],
          }),
      }),
    );
    expect(r.songs().map((s) => s.id)).toEqual(["s1"]);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test -- lib/plugins/registry.test.ts`
Expected: FAIL, `Failed to resolve import "./registry"`.

- [ ] **Step 6: Implement the registry**

Create `lib/plugins/registry.ts`:

```ts
import type { Song } from "@/lib/songs";
import {
  API_VERSION,
  type GestureDef,
  type InstrumentDef,
  type PluginApi,
  type PluginManifest,
  type PluginModule,
  type SongPackDef,
  type ThemeDef,
  type VisualDef,
} from "./types";

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export type Registered<T> = T & { pluginId: string; fullId: string };

type Contributions = {
  instruments: Registered<InstrumentDef>[];
  gestures: Registered<GestureDef>[];
  visuals: Registered<VisualDef>[];
  songPacks: Registered<SongPackDef>[];
  themes: Registered<ThemeDef>[];
};
type Kind = keyof Contributions;

type PluginRecord = { manifest: PluginManifest; enabled: boolean; contributions: Contributions };

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginError";
  }
}

export class Registry {
  private records = new Map<string, PluginRecord>();
  private listeners = new Set<() => void>();
  private cache = new Map<Kind, unknown[]>();
  private _version = 0;

  /** Install a plugin module. Throws PluginError and installs nothing if anything is wrong. */
  add(mod: PluginModule): void {
    const m = mod.manifest;
    if (!ID_RE.test(m.id)) throw new PluginError(`Invalid plugin id "${m.id}" (use lowercase letters, digits and dashes)`);
    if (this.records.has(m.id)) throw new PluginError(`Plugin "${m.id}" is already installed`);
    if (m.apiVersion > API_VERSION) {
      throw new PluginError(
        `"${m.name}" needs a newer Vivomusicano (plugin API ${m.apiVersion}, this app supports ${API_VERSION})`,
      );
    }

    const c: Contributions = { instruments: [], gestures: [], visuals: [], songPacks: [], themes: [] };
    const ns = <T extends { id: string }>(kind: Kind, list: Registered<T>[], def: T) => {
      if (!ID_RE.test(def.id)) throw new PluginError(`${m.id}: invalid ${kind} id "${def.id}"`);
      const fullId = `${m.id}.${def.id}`;
      if (list.some((x) => x.fullId === fullId)) throw new PluginError(`${m.id}: duplicate ${kind} id "${def.id}"`);
      list.push({ ...def, pluginId: m.id, fullId });
    };
    const api: PluginApi = {
      registerInstrument: (d) => ns("instruments", c.instruments, d),
      registerGesture: (d) => ns("gestures", c.gestures, d),
      registerVisual: (d) => ns("visuals", c.visuals, d),
      registerSongPack: (d) => ns("songPacks", c.songPacks, d),
      registerTheme: (d) => ns("themes", c.themes, d),
    };

    try {
      mod.activate?.(api);
    } catch (err) {
      if (err instanceof PluginError) throw err;
      throw new PluginError(`"${m.name}" failed to activate: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.records.set(m.id, { manifest: m, enabled: m.tier !== "pro", contributions: c });
    this.changed();
  }

  remove(id: string): void {
    if (this.records.delete(id)) this.changed();
  }

  setEnabled(id: string, enabled: boolean): void {
    const r = this.records.get(id);
    if (!r) return;
    if (enabled && r.manifest.tier === "pro") throw new PluginError(`"${r.manifest.name}" is a Pro plugin (coming soon)`);
    if (r.enabled === enabled) return;
    r.enabled = enabled;
    this.changed();
  }

  isEnabled(id: string): boolean {
    return this.records.get(id)?.enabled ?? false;
  }

  plugins(): { manifest: PluginManifest; enabled: boolean }[] {
    return [...this.records.values()].map((r) => ({ manifest: r.manifest, enabled: r.enabled }));
  }

  instruments() {
    return this.list("instruments");
  }
  gestures() {
    return this.list("gestures");
  }
  visuals() {
    return this.list("visuals");
  }
  songPacks() {
    return this.list("songPacks");
  }
  themes() {
    return this.list("themes");
  }

  instrument(fullId: string) {
    return this.instruments().find((i) => i.fullId === fullId);
  }

  songs(): Song[] {
    return this.songPacks().flatMap((p) => p.songs);
  }

  /** Increments on every change; use as a React external-store snapshot. */
  get version(): number {
    return this._version;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Enabled contributions of one kind, cached until the next change (read every camera frame). */
  private list<K extends Kind>(kind: K): Contributions[K] {
    let v = this.cache.get(kind) as Contributions[K] | undefined;
    if (!v) {
      v = [...this.records.values()].filter((r) => r.enabled).flatMap((r) => r.contributions[kind]) as Contributions[K];
      this.cache.set(kind, v);
    }
    return v;
  }

  private changed() {
    this.cache.clear();
    this._version++;
    this.listeners.forEach((fn) => fn());
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- lib/plugins/registry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 8: Align the spec with the detector signature**

In `docs/superpowers/specs/2026-10-15-plugin-system-design.md`, section "Code plugin API", replace the `registerGesture` line with:

```ts
    api.registerGesture({ id, name, hand: "right" | "left" | "any", kind: "trigger", suggestedBinding?, detect: (f: HandFrame) => boolean });
    api.registerGesture({ id, name, hand, kind: "value", suggestedBinding?, detect: (f: HandFrame) => number | null });
```

and add below the code block: "The registry wraps detector results into `GestureEvent`s with the namespaced id, so plugin authors never handle full ids."

- [ ] **Step 9: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: no output, exit 0.

```bash
git add vitest.config.ts package.json package-lock.json .github/workflows/ci.yml lib/plugins/types.ts lib/plugins/registry.ts lib/plugins/registry.test.ts docs/superpowers/specs/2026-10-15-plugin-system-design.md
git commit -m "feat(plugins): add plugin contract and registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Guard (error isolation and timing)

**Files:**
- Create: `lib/plugins/guard.ts`
- Test: `lib/plugins/guard.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `Guard` class with `run: Runner` (arrow property), `avgMs(key)`, `slow()`; `type Runner = <T>(pluginId: string, key: string, fn: () => T, fallback: T) => T`; `type GuardOptions`. Keys follow `detect:<fullId>`, `draw:<fullId>`, `play:<fullId>`, `create:<fullId>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/plugins/guard.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Guard } from "./guard";

function setup(protectedIds: string[] = []) {
  let now = 0;
  const disabled: string[] = [];
  const guard = new Guard({ now: () => now, onDisable: (id) => disabled.push(id), protectedIds });
  return { guard, disabled, tick: (ms: number) => (now += ms) };
}

const boom = () => {
  throw new Error("boom");
};

describe("Guard", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the result, or the fallback when the call throws", () => {
    const { guard } = setup();
    expect(guard.run("p", "detect:p.a", () => 42, 0)).toBe(42);
    expect(guard.run("p", "detect:p.a", boom, 7)).toBe(7);
  });

  it("disables a plugin after 3 errors within 10 s", () => {
    const { guard, disabled, tick } = setup();
    guard.run("p", "detect:p.a", boom, null);
    tick(4000);
    guard.run("p", "draw:p.b", boom, null);
    expect(disabled).toEqual([]);
    tick(4000);
    guard.run("p", "detect:p.a", boom, null);
    expect(disabled).toEqual(["p"]);
  });

  it("forgets errors older than the window", () => {
    const { guard, disabled, tick } = setup();
    guard.run("p", "k", boom, null);
    guard.run("p", "k", boom, null);
    tick(10_001);
    guard.run("p", "k", boom, null);
    expect(disabled).toEqual([]);
  });

  it("never disables protected plugins", () => {
    const { guard, disabled } = setup(["core"]);
    for (let i = 0; i < 5; i++) guard.run("core", "detect:core.x", boom, null);
    expect(disabled).toEqual([]);
  });

  it("flags detectors over 2 ms and visuals over 4 ms as slow", () => {
    const { guard, tick } = setup();
    guard.run("p", "detect:p.slow", () => tick(5), 0);
    guard.run("p", "detect:p.fast", () => tick(1), 0);
    guard.run("p", "draw:p.ok", () => tick(3), 0);
    guard.run("p", "draw:p.heavy", () => tick(6), 0);
    expect(guard.slow().map((s) => s.key).sort()).toEqual(["detect:p.slow", "draw:p.heavy"]);
    expect(guard.avgMs("detect:p.fast")).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/plugins/guard.test.ts`
Expected: FAIL, `Failed to resolve import "./guard"`.

- [ ] **Step 3: Implement the guard**

Create `lib/plugins/guard.ts`:

```ts
export type Runner = <T>(pluginId: string, key: string, fn: () => T, fallback: T) => T;

export type GuardOptions = {
  onDisable: (pluginId: string, error: unknown) => void;
  /** plugins that are logged but never disabled (the app can't run without them) */
  protectedIds?: string[];
  maxErrors?: number;
  windowMs?: number;
  now?: () => number;
};

const SLOW_MS: Record<string, number> = { detect: 2, draw: 4 };

/** Runs plugin code so one bad plugin can't take the show down. */
export class Guard {
  private errors = new Map<string, number[]>();
  private timings = new Map<string, number>();
  private onDisable: GuardOptions["onDisable"];
  private protectedIds: Set<string>;
  private maxErrors: number;
  private windowMs: number;
  private now: () => number;

  constructor(opts: GuardOptions) {
    this.onDisable = opts.onDisable;
    this.protectedIds = new Set(opts.protectedIds ?? []);
    this.maxErrors = opts.maxErrors ?? 3;
    this.windowMs = opts.windowMs ?? 10_000;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Arrow property so it can be passed around unbound (e.g. to AudioEngine). */
  run: Runner = (pluginId, key, fn, fallback) => {
    const t0 = this.now();
    try {
      const out = fn();
      const ms = this.now() - t0;
      const prev = this.timings.get(key);
      this.timings.set(key, prev === undefined ? ms : prev * 0.9 + ms * 0.1);
      return out;
    } catch (err) {
      this.fail(pluginId, key, err);
      return fallback;
    }
  };

  avgMs(key: string): number | undefined {
    return this.timings.get(key);
  }

  /** Detectors averaging over 2 ms and visuals over 4 ms. */
  slow(): { key: string; avgMs: number }[] {
    const out: { key: string; avgMs: number }[] = [];
    for (const [key, avgMs] of this.timings) {
      const limit = SLOW_MS[key.slice(0, key.indexOf(":"))];
      if (limit !== undefined && avgMs > limit) out.push({ key, avgMs });
    }
    return out;
  }

  private fail(pluginId: string, key: string, err: unknown) {
    console.error(`[plugin ${pluginId}] ${key} threw`, err);
    if (this.protectedIds.has(pluginId)) return;
    const now = this.now();
    const recent = (this.errors.get(pluginId) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    if (recent.length >= this.maxErrors) {
      this.errors.delete(pluginId);
      this.onDisable(pluginId, err);
    } else {
      this.errors.set(pluginId, recent);
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/plugins/guard.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/plugins/guard.ts lib/plugins/guard.test.ts
git commit -m "feat(plugins): isolate plugin errors and time plugin calls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dispatcher (bindings, modes, debounce)

**Files:**
- Create: `lib/plugins/dispatch.ts`
- Test: `lib/plugins/dispatch.test.ts`

**Interfaces:**
- Consumes: `Action`, `Binding`, `GestureEvent`, `Mode`, `SuggestedBinding`, `TriggerAction`, `ValueAction`, `TRIGGER_ACTIONS`, `VALUE_ACTIONS` from `lib/plugins/types.ts`.
- Produces: `isValidBinding(kind: "trigger" | "value", action: Action): boolean`; `defaultBindings(gestures: { fullId: string; kind: "trigger" | "value"; suggestedBinding?: SuggestedBinding[] }[]): Binding[]`; `class Dispatcher { constructor(h: DispatchHandlers, debounceMs = 250); setBindings(b: Binding[]): void; bindings(): Binding[]; handle(e: GestureEvent, mode: Mode, t: number): void }`; `type DispatchHandlers = { onTrigger(a: TriggerAction, gesture: string, t: number): void; onValue(a: ValueAction, v: number, gesture: string): void }`.

- [ ] **Step 1: Write the failing tests**

Create `lib/plugins/dispatch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultBindings, Dispatcher } from "./dispatch";
import type { Binding, TriggerAction, ValueAction } from "./types";

function setup(bindings: Binding[]) {
  const triggers: [TriggerAction, string][] = [];
  const values: [ValueAction, number][] = [];
  const d = new Dispatcher({
    onTrigger: (a, g) => triggers.push([a, g]),
    onValue: (a, v) => values.push([a, v]),
  });
  d.setBindings(bindings);
  return { d, triggers, values };
}

describe("Dispatcher", () => {
  it("routes a trigger gesture to its bound action", () => {
    const { d, triggers } = setup([{ gesture: "core.swipe-down", action: "next-chord" }]);
    d.handle({ kind: "trigger", gesture: "core.swipe-down" }, "follow", 0);
    expect(triggers).toEqual([["next-chord", "core.swipe-down"]]);
  });

  it("respects mode-limited bindings", () => {
    const { d, triggers } = setup([{ gesture: "core.swipe-down", action: "next-chord", mode: "follow" }]);
    d.handle({ kind: "trigger", gesture: "core.swipe-down" }, "auto", 0);
    expect(triggers).toEqual([]);
    d.handle({ kind: "trigger", gesture: "core.swipe-down" }, "follow", 0);
    expect(triggers).toHaveLength(1);
  });

  it("debounces per action, so swipe + fist on one frame advance once", () => {
    const { d, triggers } = setup([
      { gesture: "core.swipe-down", action: "next-chord" },
      { gesture: "core.fist", action: "next-chord" },
      { gesture: "core.raise", action: "hold" },
    ]);
    d.handle({ kind: "trigger", gesture: "core.swipe-down" }, "follow", 1000);
    d.handle({ kind: "trigger", gesture: "core.fist" }, "follow", 1000);
    d.handle({ kind: "trigger", gesture: "core.raise" }, "follow", 1010);
    d.handle({ kind: "trigger", gesture: "core.fist" }, "follow", 1249);
    d.handle({ kind: "trigger", gesture: "core.fist" }, "follow", 1250);
    expect(triggers).toEqual([
      ["next-chord", "core.swipe-down"],
      ["hold", "core.raise"],
      ["next-chord", "core.fist"],
    ]);
  });

  it("ignores bindings whose kind does not match the event", () => {
    const { d, triggers, values } = setup([
      { gesture: "a.tap", action: "volume" },
      { gesture: "a.level", action: "next-chord" },
    ]);
    d.handle({ kind: "trigger", gesture: "a.tap" }, "follow", 0);
    d.handle({ kind: "value", gesture: "a.level", value: 0.5 }, "follow", 0);
    expect(triggers).toEqual([]);
    expect(values).toEqual([]);
  });

  it("clamps values to 0..1 and drops NaN", () => {
    const { d, values } = setup([{ gesture: "a.level", action: "volume" }]);
    d.handle({ kind: "value", gesture: "a.level", value: 1.7 }, "auto", 0);
    d.handle({ kind: "value", gesture: "a.level", value: -0.2 }, "auto", 0);
    d.handle({ kind: "value", gesture: "a.level", value: Number.NaN }, "auto", 0);
    expect(values).toEqual([
      ["volume", 1],
      ["volume", 0],
    ]);
  });
});

describe("defaultBindings", () => {
  it("builds bindings from suggestions and skips ones of the wrong kind", () => {
    expect(
      defaultBindings([
        { fullId: "a.swipe", kind: "trigger", suggestedBinding: [{ action: "next-chord", mode: "follow" }, "volume"] },
        { fullId: "a.height", kind: "value", suggestedBinding: ["volume"] },
        { fullId: "a.none", kind: "trigger" },
      ]),
    ).toEqual([
      { gesture: "a.swipe", action: "next-chord", mode: "follow" },
      { gesture: "a.height", action: "volume" },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/plugins/dispatch.test.ts`
Expected: FAIL, `Failed to resolve import "./dispatch"`.

- [ ] **Step 3: Implement the dispatcher**

Create `lib/plugins/dispatch.ts`:

```ts
import {
  TRIGGER_ACTIONS,
  VALUE_ACTIONS,
  type Action,
  type Binding,
  type GestureEvent,
  type Mode,
  type SuggestedBinding,
  type TriggerAction,
  type ValueAction,
} from "./types";

export function isValidBinding(kind: "trigger" | "value", action: Action): boolean {
  const allowed: readonly string[] = kind === "trigger" ? TRIGGER_ACTIONS : VALUE_ACTIONS;
  return allowed.includes(action);
}

export function defaultBindings(
  gestures: { fullId: string; kind: "trigger" | "value"; suggestedBinding?: SuggestedBinding[] }[],
): Binding[] {
  const out: Binding[] = [];
  for (const g of gestures) {
    for (const s of g.suggestedBinding ?? []) {
      const b: Binding =
        typeof s === "string" ? { gesture: g.fullId, action: s } : { gesture: g.fullId, action: s.action, mode: s.mode };
      if (isValidBinding(g.kind, b.action)) out.push(b);
    }
  }
  return out;
}

export type DispatchHandlers = {
  onTrigger: (a: TriggerAction, gesture: string, t: number) => void;
  onValue: (a: ValueAction, v: number, gesture: string) => void;
};

/** Gesture events → actions, through the user's bindings. Debounce is per action. */
export class Dispatcher {
  private list: Binding[] = [];
  private lastFired = new Map<TriggerAction, number>();

  constructor(
    private h: DispatchHandlers,
    private debounceMs = 250,
  ) {}

  setBindings(b: Binding[]) {
    this.list = b;
  }

  bindings(): Binding[] {
    return this.list;
  }

  handle(e: GestureEvent, mode: Mode, t: number) {
    for (const b of this.list) {
      if (b.gesture !== e.gesture || (b.mode && b.mode !== mode) || !isValidBinding(e.kind, b.action)) continue;
      if (e.kind === "trigger") {
        const a = b.action as TriggerAction;
        if (t - (this.lastFired.get(a) ?? -Infinity) < this.debounceMs) continue;
        this.lastFired.set(a, t);
        this.h.onTrigger(a, e.gesture, t);
      } else {
        if (Number.isNaN(e.value)) continue;
        this.h.onValue(b.action as ValueAction, Math.min(1, Math.max(0, e.value)), e.gesture);
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/plugins/dispatch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/plugins/dispatch.ts lib/plugins/dispatch.test.ts
git commit -m "feat(plugins): map gesture events to actions with per-action debounce

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Core gestures as plugin detectors

**Files:**
- Create: `plugins/core/gestures.ts`, `tests/fixtures/hands.ts`
- Test: `plugins/core/gestures.test.ts`

**Interfaces:**
- Consumes: `clamp01`, `handShape`, `pinchRatio`, `VelocityTracker`, `WRIST`, `HandShape`, `Pt` from `lib/gestures.ts`; `GestureDef`, `HandFrame`, `TriggerGestureDef`, `ValueGestureDef` from `lib/plugins/types.ts`.
- Produces: `createCoreGestures(): { gestures: GestureDef[]; right: RightHandTracker }`; `class RightHandTracker { debug: RightHandDebug; step(f: HandFrame): { swipe: boolean; fist: boolean; raise: boolean; lower: boolean } }`; `type RightHandDebug = { present: boolean; shape: HandShape; vy: number; swipeArmed: boolean; raised: boolean }`. Gesture local ids: `swipe-down`, `fist`, `raise`, `lower`, `left-height`, `left-pinch`. Fixture: `hand(opts?: HandOpts): Pt[]`.

- [ ] **Step 1: Write the landmark fixture**

Create `tests/fixtures/hands.ts`:

```ts
import type { Pt } from "@/lib/gestures";

export type HandOpts = {
  x?: number;
  /** wrist height, 0 = top of the screen */
  y?: number;
  shape?: "open" | "closed" | "neutral";
  /** thumb-tip to index-tip distance in palm units */
  pinch?: number;
};

const PALM = 0.1; // wrist → middle knuckle
// fingertip / middle-joint distance from the wrist, chosen to land clearly in each handShape() bucket
const DIST = {
  open: { tip: 0.2, pip: 0.15 },
  closed: { tip: 0.09, pip: 0.12 },
  neutral: { tip: 0.14, pip: 0.12 },
};

/** 21 MediaPipe-style landmarks for a hand pointing up with its wrist at (x, y). */
export function hand({ x = 0.5, y = 0.6, shape = "open", pinch = 1 }: HandOpts = {}): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x, y }));
  pts[9] = { x, y: y - PALM };
  const d = DIST[shape];
  for (const tip of [8, 12, 16, 20]) {
    pts[tip] = { x, y: y - d.tip };
    pts[tip - 2] = { x, y: y - d.pip };
  }
  pts[4] = { x: x + pinch * PALM, y: y - d.tip };
  return pts;
}
```

- [ ] **Step 2: Write the failing tests**

Create `plugins/core/gestures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { TriggerGestureDef, ValueGestureDef } from "@/lib/plugins/types";
import { hand, type HandOpts } from "@/tests/fixtures/hands";
import { createCoreGestures } from "./gestures";

const FRAME_MS = 16;

function rig() {
  const { gestures, right } = createCoreGestures();
  const trigger = (id: string) => gestures.find((g) => g.id === id) as TriggerGestureDef;
  const value = (id: string) => gestures.find((g) => g.id === id) as ValueGestureDef;
  let t = 0;
  /** Advance one frame and return which trigger gestures fired. */
  const frame = (r: HandOpts | null, l: HandOpts | null = null) => {
    t += FRAME_MS;
    const f = { t, right: r ? hand(r) : null, left: l ? hand(l) : null };
    const fired = ["swipe-down", "fist", "raise", "lower"].filter((id) => trigger(id).detect(f));
    return { f, fired };
  };
  return { gestures, right, frame, value };
}

describe("core gestures", () => {
  it("registers six gestures with today's default bindings", () => {
    const { gestures } = rig();
    expect(gestures.map((g) => [g.id, g.kind, g.suggestedBinding])).toEqual([
      ["swipe-down", "trigger", [{ action: "next-chord", mode: "follow" }]],
      ["fist", "trigger", [{ action: "next-chord", mode: "follow" }]],
      ["raise", "trigger", [{ action: "hold", mode: "auto" }]],
      ["lower", "trigger", [{ action: "release", mode: "auto" }]],
      ["left-height", "value", ["volume"]],
      ["left-pinch", "value", ["filter"]],
    ]);
  });

  it("swipe-down fires once per fast downward stroke and re-arms after slowing", () => {
    const { frame } = rig();
    let count = 0;
    const run = (ys: number[]) => ys.forEach((y) => (count += frame({ y }).fired.includes("swipe-down") ? 1 : 0));

    run(Array(6).fill(0.45)); // still
    run([1, 2, 3, 4, 5, 6].map((i) => 0.45 + i * 0.06)); // ~3.75 screen-heights/s down
    expect(count).toBe(1);
    run(Array(10).fill(0.81)); // stop → re-arm
    run([1, 2, 3, 4].map((i) => 0.81 - i * 0.06)); // upward stroke never fires
    expect(count).toBe(1);
    run(Array(10).fill(0.57));
    run([1, 2, 3, 4, 5].map((i) => 0.57 + i * 0.06)); // second stroke
    expect(count).toBe(2);
  });

  it("swipe-down ignores slow drift", () => {
    const { frame } = rig();
    const fired = Array.from({ length: 40 }, (_, i) => frame({ y: 0.45 + i * 0.005 }).fired).flat();
    expect(fired).not.toContain("swipe-down");
  });

  it("fist fires on open → closed, and only again after the hand reopens", () => {
    const { frame } = rig();
    const seq: HandOpts["shape"][] = ["open", "open", "closed", "closed", "neutral", "closed", "open", "closed"];
    const fistFrames = seq.map((shape, i) => (frame({ y: 0.6, shape }).fired.includes("fist") ? i : -1)).filter((i) => i >= 0);
    expect(fistFrames).toEqual([2, 7]);
  });

  it("raise and lower fire on crossing, with a dead zone in between", () => {
    const { frame, right } = rig();
    const ys = [0.6, 0.3, 0.3, 0.45, 0.6, 0.6];
    expect(ys.map((y) => frame({ y }).fired.filter((id) => id === "raise" || id === "lower"))).toEqual([
      [],
      ["raise"],
      [],
      [],
      ["lower"],
      [],
    ]);
    expect(right.debug.raised).toBe(false);
  });

  it("lower fires when the right hand leaves the frame while raised", () => {
    const { frame } = rig();
    frame({ y: 0.6 });
    expect(frame({ y: 0.3 }).fired).toContain("raise");
    expect(frame(null).fired).toEqual(["lower"]);
    expect(frame(null).fired).toEqual([]);
  });

  it("left-height and left-pinch smooth toward the hand and hold when it leaves", () => {
    const { frame, value } = rig();
    const height = value("left-height");
    const pinch = value("left-pinch");
    let last = { h: 0, p: 0 };
    for (let i = 0; i < 20; i++) {
      const { f } = frame(null, { y: 0.15, pinch: 1.4 });
      last = { h: height.detect(f)!, p: pinch.detect(f)! };
    }
    expect(last.h).toBeGreaterThan(0.99);
    expect(last.p).toBeGreaterThan(0.99);

    const { f } = frame(null, null);
    expect(height.detect(f)).toBeNull();
    expect(pinch.detect(f)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- plugins/core/gestures.test.ts`
Expected: FAIL, `Failed to resolve import "./gestures"`.

- [ ] **Step 4: Implement the core gestures**

Create `plugins/core/gestures.ts` (logic moved from `RightHandGestures` / `LeftHandExpression` in `lib/gestures.ts`; debounce now lives in the dispatcher):

```ts
import { clamp01, handShape, pinchRatio, VelocityTracker, WRIST, type HandShape } from "@/lib/gestures";
import type { GestureDef, HandFrame } from "@/lib/plugins/types";

const SWIPE_VY = 1.5; // screen-heights / sec downward
const SWIPE_REARM_VY = 0.4;
const RAISE_Y = 0.38; // wrist above this (screen top = 0) → raised
const LOWER_Y = 0.5;

export type RightHandDebug = { present: boolean; shape: HandShape; vy: number; swipeArmed: boolean; raised: boolean };

type RightStep = { swipe: boolean; fist: boolean; raise: boolean; lower: boolean };
const NONE: RightStep = { swipe: false, fist: false, raise: false, lower: false };

/** Right-hand state shared by the four right-hand detectors; updates once per frame. */
export class RightHandTracker {
  private vel = new VelocityTracker();
  private armed = true;
  private lastShape: HandShape = "neutral";
  private wasOpen = false;
  private raised = false;
  private lastT = Number.NaN;
  private out: RightStep = NONE;
  debug: RightHandDebug = { present: false, shape: "neutral", vy: 0, swipeArmed: true, raised: false };

  step(f: HandFrame): RightStep {
    if (f.t === this.lastT) return this.out;
    this.lastT = f.t;
    const lm = f.right;

    if (!lm) {
      // hand gone: lowering resumes the song, everything else resets
      const out = { ...NONE, lower: this.raised };
      this.vel.reset();
      this.armed = true;
      this.wasOpen = false;
      this.lastShape = "neutral";
      this.raised = false;
      this.debug = { present: false, shape: "neutral", vy: 0, swipeArmed: true, raised: false };
      return (this.out = out);
    }

    const out = { ...NONE };
    const wrist = lm[WRIST];
    this.vel.push(f.t, wrist.y);
    const vy = this.vel.vy();
    const shape = handShape(lm);

    // Swipe: one fast downward stroke; must slow down before it can fire again.
    if (this.armed && vy > SWIPE_VY) {
      this.armed = false;
      out.swipe = true;
    } else if (!this.armed && vy < SWIPE_REARM_VY) {
      this.armed = true;
    }

    // Fist: hand was clearly open, now clearly closed.
    if (shape === "open") this.wasOpen = true;
    if (shape === "closed" && this.lastShape !== "closed" && this.wasOpen) {
      this.wasOpen = false;
      out.fist = true;
    }
    if (shape !== "neutral") this.lastShape = shape;

    if (!this.raised && wrist.y < RAISE_Y) {
      this.raised = true;
      out.raise = true;
    } else if (this.raised && wrist.y > LOWER_Y) {
      this.raised = false;
      out.lower = true;
    }

    this.debug = { present: true, shape, vy, swipeArmed: this.armed, raised: this.raised };
    return (this.out = out);
  }
}

/** Left hand: height → volume, pinch → filter, smoothed. Holds the last value when the hand leaves. */
class LeftHandSmoother {
  volume = 0.75;
  filter = 0.6;
  private lastT = Number.NaN;
  private present = false;

  constructor(private smoothing = 0.3) {}

  step(f: HandFrame): boolean {
    if (f.t === this.lastT) return this.present;
    this.lastT = f.t;
    const lm = f.left;
    this.present = !!lm;
    if (!lm) return false;
    // wrist y 0.15 (high) → 1, 0.85 (low) → 0
    const targetV = clamp01((0.85 - lm[WRIST].y) / 0.7);
    // pinch 0.15 → 0, 1.4 → 1
    const targetF = clamp01((pinchRatio(lm) - 0.15) / 1.25);
    this.volume += (targetV - this.volume) * this.smoothing;
    this.filter += (targetF - this.filter) * this.smoothing;
    return true;
  }
}

export function createCoreGestures(): { gestures: GestureDef[]; right: RightHandTracker } {
  const right = new RightHandTracker();
  const left = new LeftHandSmoother();
  const gestures: GestureDef[] = [
    {
      id: "swipe-down",
      name: "Swipe down",
      hand: "right",
      kind: "trigger",
      suggestedBinding: [{ action: "next-chord", mode: "follow" }],
      detect: (f) => right.step(f).swipe,
    },
    {
      id: "fist",
      name: "Open hand → fist",
      hand: "right",
      kind: "trigger",
      suggestedBinding: [{ action: "next-chord", mode: "follow" }],
      detect: (f) => right.step(f).fist,
    },
    {
      id: "raise",
      name: "Raise hand",
      hand: "right",
      kind: "trigger",
      suggestedBinding: [{ action: "hold", mode: "auto" }],
      detect: (f) => right.step(f).raise,
    },
    {
      id: "lower",
      name: "Lower hand",
      hand: "right",
      kind: "trigger",
      suggestedBinding: [{ action: "release", mode: "auto" }],
      detect: (f) => right.step(f).lower,
    },
    {
      id: "left-height",
      name: "Hand height",
      hand: "left",
      kind: "value",
      suggestedBinding: ["volume"],
      detect: (f) => (left.step(f) ? left.volume : null),
    },
    {
      id: "left-pinch",
      name: "Pinch",
      hand: "left",
      kind: "value",
      suggestedBinding: ["filter"],
      detect: (f) => (left.step(f) ? left.filter : null),
    },
  ];
  return { gestures, right };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- plugins/core/gestures.test.ts`
Expected: PASS (7 tests). If the swipe test fails on counts, print `right.debug.vy` per frame before changing thresholds: the thresholds are copied from the shipped app and must not change in this refactor; adjust the fixture's stroke speed instead.

- [ ] **Step 6: Commit**

```bash
git add plugins/core/gestures.ts plugins/core/gestures.test.ts tests/fixtures/hands.ts
git commit -m "feat(core): express built-in gestures as plugin detectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Instruments and the audio engine

**Files:**
- Create: `plugins/core/instruments.ts`
- Test: `plugins/core/instruments.test.ts`
- Modify: `lib/audio.ts:4-5` (remove presets), `lib/audio.ts:64-204` (replace instruments + engine)

**Interfaces:**
- Consumes: `Instrument`, `InstrumentContext`, `InstrumentDef`, `ValueAction` from `lib/plugins/types.ts`; `Registered<T>` from `lib/plugins/registry.ts`; `Runner` from `lib/plugins/guard.ts`; `voiceChord`, `Voicing` (stay in `lib/audio.ts`).
- Produces: `coreInstruments: InstrumentDef[]` (ids `pad`, `keys`, `pluck`); `diffHeld(held: number[], next: number[]): { release: number[]; attack: number[] }`; `AudioEngine.create(def: Registered<InstrumentDef>, run?: Runner): Promise<AudioEngine>`; `engine.instrumentId: string`; `engine.setInstrument(def: Registered<InstrumentDef>): boolean` (false = new instrument failed, old one kept); `engine.setParam(p: ValueAction, v: number)`; `engine.playChord(name: string)`, `engine.setBpm(bpm: number)`, `engine.outputLatencyMs`, `engine.stop()`. Removed: `PresetName`, `PRESETS`, `setPreset`, `setVolume`, `setFilter`.

- [ ] **Step 1: Write the failing test for the pad crossfade logic**

Create `plugins/core/instruments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coreInstruments, diffHeld } from "./instruments";

describe("diffHeld", () => {
  it("keeps common tones ringing and only moves the voices that change", () => {
    // G major → B major: G (55) and D (62) leave, D# (63) and F# (66) arrive, B (59) stays
    expect(diffHeld([43, 55, 59, 62], [47, 59, 63, 66])).toEqual({ release: [43, 55, 62], attack: [47, 63, 66] });
  });

  it("releases everything when the next chord is empty", () => {
    expect(diffHeld([48, 60], [])).toEqual({ release: [48, 60], attack: [] });
  });
});

describe("coreInstruments", () => {
  it("provides Pad, Keys and Pluck; only Pluck stops on switch", () => {
    expect(coreInstruments.map((i) => [i.id, i.name, i.sustains])).toEqual([
      ["pad", "Pad", true],
      ["keys", "Keys", true],
      ["pluck", "Pluck", false],
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- plugins/core/instruments.test.ts`
Expected: FAIL, `Failed to resolve import "./instruments"`.

- [ ] **Step 3: Implement the core instruments**

Create `plugins/core/instruments.ts` (synth settings copied unchanged from `createSynth` in `lib/audio.ts`):

```ts
import type { Voicing } from "@/lib/audio";
import type { Instrument, InstrumentContext, InstrumentDef } from "@/lib/plugins/types";

/** Notes to release and to attack so common tones keep ringing (pad crossfade). */
export function diffHeld(held: number[], next: number[]) {
  return { release: held.filter((n) => !next.includes(n)), attack: next.filter((n) => !held.includes(n)) };
}

/** The slice of Tone.PolySynth we use, so Synth- and FMSynth-based polys share one type. */
type Poly = {
  maxPolyphony: number;
  connect(node: InstrumentContext["output"]): unknown;
  triggerAttack(freqs: number[], time: number, velocity: number): unknown;
  triggerRelease(freqs: number[], time: number): unknown;
  triggerAttackRelease(freq: number, duration: number, time: number, velocity: number): unknown;
  releaseAll(time?: number): unknown;
  dispose(): unknown;
};

type Style = "crossfade" | "restrike" | "arpeggio";

class CoreInstrument implements Instrument {
  private held: number[] = [];

  constructor(
    private ctx: InstrumentContext,
    private synth: Poly,
    private style: Style,
  ) {
    synth.maxPolyphony = 24;
    synth.connect(ctx.output);
  }

  private hz = (midi: number) => this.ctx.Tone.Frequency(midi, "midi").toFrequency();

  playChord(v: Voicing, now: number) {
    const notes = [v.bass, ...v.upper];
    if (this.style === "crossfade") {
      // Common tones keep ringing; leaving tones release (1.5s) while new ones swell (0.2s) = crossfade.
      const { release, attack } = diffHeld(this.held, notes);
      if (release.length) this.synth.triggerRelease(release.map(this.hz), now);
      if (attack.length) this.synth.triggerAttack(attack.map(this.hz), now, 0.55);
      this.held = notes;
    } else if (this.style === "restrike") {
      if (this.held.length) this.synth.triggerRelease(this.held.map(this.hz), now);
      this.synth.triggerAttack(notes.map(this.hz), now + 0.001, 0.7);
      this.held = notes;
    } else {
      // Arpeggiate up the voicing in eighth notes, then the top note an octave up.
      const step = 60 / this.ctx.bpm() / 2;
      const seq = [...notes, notes[notes.length - 1] + 12].slice(0, 6);
      seq.forEach((n, i) => this.synth.triggerAttackRelease(this.hz(n), step * 0.9, now + i * step, i === 0 ? 0.8 : 0.6));
      this.held = [];
    }
  }

  release(now: number) {
    this.synth.releaseAll(now);
    this.held = [];
  }

  setParam() {
    // core sounds have no macros; volume and filter are handled by the engine
  }

  dispose() {
    this.synth.dispose();
  }
}

export const coreInstruments: InstrumentDef[] = [
  {
    id: "pad",
    name: "Pad",
    sustains: true,
    create: (ctx) =>
      new CoreInstrument(
        ctx,
        new ctx.Tone.PolySynth(ctx.Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 3, spread: 28 },
          envelope: { attack: 0.2, decay: 0.4, sustain: 0.85, release: 1.5 },
          volume: -14,
        }),
        "crossfade",
      ),
  },
  {
    id: "keys",
    name: "Keys",
    sustains: true,
    create: (ctx) =>
      new CoreInstrument(
        ctx,
        new ctx.Tone.PolySynth(ctx.Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 2.2,
          oscillator: { type: "sine" },
          modulation: { type: "sine" },
          envelope: { attack: 0.004, decay: 1.6, sustain: 0.3, release: 1.3 },
          modulationEnvelope: { attack: 0.002, decay: 0.6, sustain: 0.1, release: 0.8 },
          volume: -8,
        }),
        "restrike",
      ),
  },
  {
    id: "pluck",
    name: "Pluck",
    sustains: false,
    create: (ctx) =>
      new CoreInstrument(
        ctx,
        new ctx.Tone.PolySynth(ctx.Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 2, spread: 12 },
          envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.5 },
          volume: -12,
        }),
        "arpeggio",
      ),
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- plugins/core/instruments.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Make the engine delegate to an Instrument**

In `lib/audio.ts`:

1. Change the imports at the top and delete lines 4-5 (`PresetName`, `PRESETS`) and the `hz` helper (now inside the instrument):

```ts
import * as Tone from "tone";
import type { Runner } from "./plugins/guard";
import type { Registered } from "./plugins/registry";
import type { Instrument, InstrumentContext, InstrumentDef, ValueAction } from "./plugins/types";
import { parseChord, type ParsedChord } from "./songs";
```

2. Replace everything from `// ---------- instruments ----------` (line 64) to the end of the file with:

```ts
// ---------- engine ----------

const direct: Runner = (pluginId, key, fn) => fn();

export class AudioEngine {
  private filter: Tone.Filter;
  private chorus: Tone.Chorus;
  private reverb: Tone.Reverb;
  private master: Tone.Gain;
  private limiter: Tone.Limiter;
  private instrument: Instrument;
  private def: Registered<InstrumentDef>;
  private prevUpper: number[] | null = null;
  private current: ParsedChord | null = null;
  private bpm = 90;

  private constructor(
    def: Registered<InstrumentDef>,
    private run: Runner,
  ) {
    this.limiter = new Tone.Limiter(-1).toDestination();
    this.master = new Tone.Gain(0.56).connect(this.limiter);
    this.reverb = new Tone.Reverb({ decay: 4.5, preDelay: 0.02, wet: 0.3 }).connect(this.master);
    this.chorus = new Tone.Chorus({ frequency: 0.5, delayTime: 3.5, depth: 0.5, wet: 0.35 })
      .connect(this.reverb)
      .start();
    this.filter = new Tone.Filter({ type: "lowpass", frequency: 2400, rolloff: -24, Q: 0.8 }).connect(
      this.chorus,
    );
    const inst = this.make(def);
    if (!inst) throw new Error(`Instrument "${def.name}" failed to load`);
    this.def = def;
    this.instrument = inst;
  }

  /** Must be called from a user gesture (autoplay rules). */
  static async create(def: Registered<InstrumentDef>, run: Runner = direct): Promise<AudioEngine> {
    // lookAhead 0 = trigger immediately instead of Tone's default 100ms scheduling buffer
    Tone.setContext(new Tone.Context({ latencyHint: "interactive", lookAhead: 0 }));
    await Tone.start();
    const engine = new AudioEngine(def, run);
    await engine.reverb.ready;
    return engine;
  }

  get instrumentId(): string {
    return this.def.fullId;
  }

  /** Hardware + browser output buffering, in ms (what we can't shave off in JS). */
  get outputLatencyMs(): number {
    const raw = Tone.getContext().rawContext as unknown as { baseLatency?: number; outputLatency?: number };
    return ((raw.baseLatency ?? 0) + (raw.outputLatency ?? 0)) * 1000;
  }

  setBpm(bpm: number) {
    this.bpm = bpm;
  }

  /** volume: 0..1 → gain (perceptual curve); filter: 0..1 → 180 Hz .. 9 kHz exponential; all → instrument. */
  setParam(p: ValueAction, v: number) {
    if (p === "volume") this.master.gain.rampTo(v * v * 0.9, 0.05);
    else if (p === "filter") this.filter.frequency.rampTo(180 * Math.pow(50, v), 0.05);
    const { def, instrument } = this;
    this.run(def.pluginId, `param:${def.fullId}`, () => instrument.setParam(p, v), undefined);
  }

  playChord(name: string) {
    const chord = parseChord(name);
    if (!chord) return;
    const voicing = voiceChord(chord, this.prevUpper);
    this.prevUpper = voicing.upper;
    this.current = chord;
    this.sound(voicing);
  }

  private sound(v: Voicing) {
    const { def, instrument } = this;
    this.run(def.pluginId, `play:${def.fullId}`, () => instrument.playChord(v, Tone.now()), undefined);
  }

  private make(def: Registered<InstrumentDef>): Instrument | null {
    const ctx: InstrumentContext = { Tone, output: this.filter, bpm: () => this.bpm };
    return this.run(def.pluginId, `create:${def.fullId}`, () => def.create(ctx), null);
  }

  /** Switch sound. Returns false (and keeps the old instrument) if the new one fails to load. */
  setInstrument(def: Registered<InstrumentDef>): boolean {
    if (def.fullId === this.def.fullId) return true;
    const next = this.make(def);
    if (!next) return false;
    const { def: oldDef, instrument: old } = this;
    this.run(oldDef.pluginId, `play:${oldDef.fullId}`, () => old.release(Tone.now()), undefined);
    setTimeout(() => this.run(oldDef.pluginId, `dispose:${oldDef.fullId}`, () => old.dispose(), undefined), 2500);
    this.def = def;
    this.instrument = next;
    // keep the current chord sounding through the switch (pads/keys); old voices fade out
    if (this.current && def.sustains) this.sound(voiceChord(this.current, this.prevUpper));
    return true;
  }

  stop() {
    const { def, instrument } = this;
    this.run(def.pluginId, `play:${def.fullId}`, () => instrument.release(Tone.now()), undefined);
  }
}
```

The `voiceChord` function and the voicing helpers above line 64 stay exactly as they are.

- [ ] **Step 6: Run tests and typecheck the engine**

Run: `npm test && npm run typecheck 2>&1 | grep -v "components/" | head`
Expected: tests PASS; the only type errors are in `components/` (fixed in Task 6), none in `lib/` or `plugins/`.

- [ ] **Step 7: Commit**

```bash
git add plugins/core/instruments.ts plugins/core/instruments.test.ts lib/audio.ts
git commit -m "feat(core): move Pad/Keys/Pluck into plugin instruments

AudioEngine keeps voice-leading and the master chain and delegates sound
to an Instrument, guarded by the plugin Runner.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The app does not compile again until Task 6; this is the only intermediate commit where `npm run build` fails. If your workflow requires a green build per commit, squash Tasks 5 and 6 into one commit.)

---

### Task 6: Core plugin assembly and app wiring

**Files:**
- Create: `plugins/core/vivomusicano.plugin.json`, `plugins/core/visuals.ts`, `plugins/core/index.ts`, `plugins/index.ts`, `lib/plugins/runtime.ts`
- Test: `plugins/core/index.test.ts`
- Modify: `lib/gestures.ts:79-176`, `lib/vision.ts:57`, `components/Stage.tsx`, `components/Controls.tsx`
- Rewrite: `components/GestureSynth.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `registry` (app singleton with built-ins installed) from `lib/plugins/runtime.ts`; `BUILTIN_PLUGINS: PluginModule[]` from `plugins/index.ts`; default export `PluginModule` and live export `coreRight: RightHandTracker | null` from `plugins/core/index.ts`; `CameraFrame` type and `onDraw` prop on `Stage`; `TopBar` props `instruments: { id: string; name: string }[]`, `instrument: string`, `onInstrument: (id: string) => void`.

- [ ] **Step 1: Write the failing core-plugin test**

Create `plugins/core/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultBindings } from "@/lib/plugins/dispatch";
import { Registry } from "@/lib/plugins/registry";
import core from "./index";

describe("core plugin", () => {
  it("contributes today's instruments, gestures, skeleton and songs", () => {
    const r = new Registry();
    r.add(core);
    expect(r.instruments().map((i) => i.fullId)).toEqual(["core.pad", "core.keys", "core.pluck"]);
    expect(r.visuals().map((v) => v.fullId)).toEqual(["core.skeleton"]);
    expect(r.songs().map((s) => s.id)).toEqual(["slow-burn", "four-chords", "minor-lift"]);
  });

  it("binds gestures exactly like the pre-plugin app", () => {
    const r = new Registry();
    r.add(core);
    expect(defaultBindings(r.gestures())).toEqual([
      { gesture: "core.swipe-down", action: "next-chord", mode: "follow" },
      { gesture: "core.fist", action: "next-chord", mode: "follow" },
      { gesture: "core.raise", action: "hold", mode: "auto" },
      { gesture: "core.lower", action: "release", mode: "auto" },
      { gesture: "core.left-height", action: "volume" },
      { gesture: "core.left-pinch", action: "filter" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- plugins/core/index.test.ts`
Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 3: Create the core manifest, visual and plugin**

Create `plugins/core/vivomusicano.plugin.json`:

```json
{
  "id": "core",
  "name": "Vivomusicano Core",
  "version": "1.0.0",
  "author": "Lameda12",
  "description": "Built-in sounds (Pad, Keys, Pluck), starter songs, swipe/fist/raise gestures, left-hand volume and filter, and the hand skeleton.",
  "apiVersion": 1,
  "tier": "community",
  "main": "index.ts"
}
```

Create `plugins/core/visuals.ts` (moved from `skeleton()` in `components/Stage.tsx`; connections copied from MediaPipe's `HAND_CONNECTIONS` so tests don't load the WASM package):

```ts
import type { Pt } from "@/lib/gestures";
import type { VisualDef } from "@/lib/plugins/types";

const ACCENT = "#ff4d1f";

// MediaPipe hand topology: thumb, index, middle, ring, pinky, palm
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function skeleton(
  ctx: CanvasRenderingContext2D,
  lm: Pt[],
  w: number,
  h: number,
  color: string,
  width: number,
  pulse: number,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [start, end] of HAND_CONNECTIONS) {
    ctx.moveTo(lm[start].x * w, lm[start].y * h);
    ctx.lineTo(lm[end].x * w, lm[end].y * h);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, width * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  if (pulse > 0) {
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(lm[0].x * w, lm[0].y * h, 30 + (1 - pulse) * 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

export const skeletonVisual: VisualDef = {
  id: "skeleton",
  name: "Hand skeleton",
  draw(ctx, f, s, { w, h }) {
    const pulse = Math.max(0, 1 - (f.t - s.lastTriggerAt) / 350);
    if (f.right) skeleton(ctx, f.right, w, h, ACCENT, 3.5, pulse);
    if (f.left) skeleton(ctx, f.left, w, h, "rgba(255,255,255,0.85)", 2.5, 0);
  },
};
```

Create `plugins/core/index.ts`:

```ts
import { definePlugin, type PluginManifest } from "@/lib/plugins/types";
import { PRESET_SONGS } from "@/lib/songs";
import { createCoreGestures, type RightHandTracker } from "./gestures";
import { coreInstruments } from "./instruments";
import manifest from "./vivomusicano.plugin.json";
import { skeletonVisual } from "./visuals";

/** The active core right-hand tracker, read by the debug overlay. */
export let coreRight: RightHandTracker | null = null;

export default definePlugin({
  manifest: manifest as PluginManifest,
  activate(api) {
    const { gestures, right } = createCoreGestures();
    coreRight = right;
    for (const g of gestures) api.registerGesture(g);
    for (const i of coreInstruments) api.registerInstrument(i);
    api.registerVisual(skeletonVisual);
    api.registerSongPack({ id: "starter", name: "Starter songs", songs: PRESET_SONGS });
  },
});
```

Create `plugins/index.ts`:

```ts
import type { PluginModule } from "@/lib/plugins/types";
import core from "./core";

/** Plugins bundled with the app, in load order. */
export const BUILTIN_PLUGINS: PluginModule[] = [core];
```

Create `lib/plugins/runtime.ts`:

```ts
import { BUILTIN_PLUGINS } from "@/plugins";
import { Registry } from "./registry";

/** The app's plugin registry, with bundled plugins installed. */
export const registry = new Registry();
for (const p of BUILTIN_PLUGINS) registry.add(p);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- plugins/core/index.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Remove the moved code from lib**

In `lib/gestures.ts`, delete `Debouncer`, `RightHandState`, the four `SWIPE_*`/`RAISE_Y`/`LOWER_Y` constants, `RightHandGestures`, `Expression` and `LeftHandExpression` (lines 79-176). Keep everything above line 79.

In `lib/vision.ts`, delete line 57 (`export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;`).

- [ ] **Step 6: Let Stage draw through a callback**

In `components/Stage.tsx`:

1. Line 3: `import { useEffect, useRef, type ReactNode } from "react";` (`RefObject` is no longer used).
2. Line 5: `import { assignHands, createHandLandmarker, type Delegate } from "@/lib/vision";`
3. Rename the exported type `HandFrame` (lines 9-16) to `CameraFrame`.
4. Delete `const ACCENT = "#ff4d1f";` (line 24).
5. Replace the props type and signature (lines 27-37) with:

```tsx
type StageProps = {
  active: boolean;
  swapHands: boolean;
  onFrame: (f: CameraFrame) => void;
  onStatus: (s: VisionStatus) => void;
  /** draw overlays for this frame; the canvas is already cleared and sized to the video */
  onDraw: (ctx: CanvasRenderingContext2D, hands: { right: Pt[] | null; left: Pt[] | null }, w: number, h: number) => void;
  children?: ReactNode;
};

export function Stage({ active, swapHands, onFrame, onStatus, onDraw, children }: StageProps) {
```

6. Replace `const onStatusRef = useRef(onStatus);` block with refs for all three callbacks:

```tsx
  const onFrameRef = useRef(onFrame);
  const onStatusRef = useRef(onStatus);
  const onDrawRef = useRef(onDraw);
  const swapRef = useRef(swapHands);

  useEffect(() => {
    onFrameRef.current = onFrame;
    onStatusRef.current = onStatus;
    onDrawRef.current = onDraw;
    swapRef.current = swapHands;
  });
```

7. Replace the body of `draw()` after `ctx.clearRect(0, 0, w, h);` (the `pulse` line and two `skeleton(...)` calls) with:

```tsx
      onDrawRef.current(ctx, { right, left }, w, h);
```

8. Change the effect dependency list `}, [active, lastAdvanceAt]);` to `}, [active]);`.
9. Delete the `skeleton()` function (lines 207-239).

- [ ] **Step 7: Read instruments from the registry in Controls**

In `components/Controls.tsx`:

1. Replace line 5 (`import { PRESETS, type PresetName } from "@/lib/audio";`) with `import type { Mode } from "@/lib/plugins/types";`
2. Replace line 10 (`export type Mode = "follow" | "auto";`) with `export type { Mode };`
3. In `TopBarProps`, replace `preset: PresetName;` and `onPreset: (p: PresetName) => void;` with:

```tsx
  instruments: { id: string; name: string }[];
  instrument: string;
  onInstrument: (id: string) => void;
```

4. Replace the "Sound preset" `Segmented` (lines 105-110) with:

```tsx
      <Segmented
        label="Sound"
        value={p.instrument}
        onChange={p.onInstrument}
        options={p.instruments.map((x) => ({ value: x.id, label: x.name.toUpperCase() }))}
      />
```

- [ ] **Step 8: Rewrite GestureSynth on the registry**

Replace `components/GestureSynth.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AudioEngine } from "@/lib/audio";
import type { Pt } from "@/lib/gestures";
import { defaultBindings, Dispatcher } from "@/lib/plugins/dispatch";
import { Guard } from "@/lib/plugins/guard";
import { registry } from "@/lib/plugins/runtime";
import type { HandFrame, Mode, TriggerAction, ValueAction, VisualState } from "@/lib/plugins/types";
import { loadCustomSongs, saveCustomSongs, type Song } from "@/lib/songs";
import { coreRight } from "@/plugins/core";
import type { RightHandDebug } from "@/plugins/core/gestures";
import { Meters, SongEditor, TopBar } from "./Controls";
import { ChordDisplay, Stage, type CameraFrame, type VisionStatus } from "./Stage";
import { Wordmark } from "./Wordmark";

type Stats = {
  inferenceMs: number;
  fps: number;
  skipped: number;
  /** frame inference start → synth triggered */
  processMs: number | null;
  outputMs: number;
  lastSource: string;
  right: RightHandDebug | null;
  slow: { key: string; avgMs: number }[];
};

type Handlers = {
  trigger: (a: TriggerAction, gesture: string, t: number) => void;
  value: (a: ValueAction, v: number) => void;
  switchInstrument: (id: string) => void;
};

const UI_INTERVAL_MS = 50;
const NOTICE_MS = 4000;
const FALLBACK_INSTRUMENT = "core.pad";

const subscribePlugins = (fn: () => void) => registry.subscribe(fn);
const pluginsVersion = () => registry.version;

export default function GestureSynth() {
  // re-render when plugins change (instrument list, songs)
  useSyncExternalStore(subscribePlugins, pluginsVersion, pluginsVersion);
  const builtinSongs = registry.songs();
  const [customSongs, setCustomSongs] = useState<Song[]>([]);
  const songs = [...builtinSongs, ...customSongs];

  const [songId, setSongId] = useState(builtinSongs[0].id);
  const [mode, setMode] = useState<Mode>("follow");
  const [instrumentId, setInstrumentId] = useState(FALLBACK_INSTRUMENT);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [vision, setVision] = useState<VisionStatus>({ state: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [debug, setDebug] = useState(false);
  const [swapHands, setSwapHands] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ui, setUi] = useState({ volume: 0.75, filter: 0.6, leftLive: false, beat: 0, held: false });
  const [stats, setStats] = useState<Stats | null>(null);

  const song = songs.find((s) => s.id === songId) ?? songs[0];

  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef(song);
  const modeRef = useRef(mode);
  const indexRef = useRef(0);
  const autoRef = useRef({ phase: 0, held: false });
  const lastAdvanceAt = useRef(-Infinity);
  const statsRef = useRef<Stats>({
    inferenceMs: 0, fps: 0, skipped: 0, processMs: null, outputMs: 0, lastSource: "—", right: null, slow: [],
  });
  const exprRef = useRef({ volume: 0.75, filter: 0.6, leftLive: false });
  const handlersRef = useRef<Handlers | null>(null);

  const [guard] = useState(
    () =>
      new Guard({
        protectedIds: ["core"],
        onDisable: (pluginId) => {
          const name = registry.plugins().find((p) => p.manifest.id === pluginId)?.manifest.name ?? pluginId;
          registry.setEnabled(pluginId, false);
          setNotice(`${name} crashed and was turned off.`);
        },
      }),
  );
  const [dispatcher] = useState(
    () =>
      new Dispatcher({
        onTrigger: (a, g, t) => handlersRef.current?.trigger(a, g, t),
        onValue: (a, v) => handlersRef.current?.value(a, v),
      }),
  );

  useEffect(() => {
    songRef.current = song;
    modeRef.current = mode;
  });

  // custom songs from localStorage (client only)
  useEffect(() => {
    const custom = loadCustomSongs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
    if (custom.length) setCustomSongs(custom);
  }, []);

  // bindings follow the enabled gestures; a disabled instrument falls back to the core pad
  useEffect(() => {
    const sync = () => {
      dispatcher.setBindings(defaultBindings(registry.gestures()));
      const engine = engineRef.current;
      if (engine && !registry.instrument(engine.instrumentId)) handlersRef.current?.switchInstrument(FALLBACK_INSTRUMENT);
    };
    sync();
    return registry.subscribe(sync);
  }, [dispatcher]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  /** Step through the song by `delta` chords (wraps), counting it as a trigger. */
  const move = useCallback((delta: number, source: string, t0?: number) => {
    const s = songRef.current;
    const n = s.chords.length;
    const next = (((indexRef.current + delta) % n) + n) % n;
    indexRef.current = next;
    engineRef.current?.playChord(s.chords[next]);
    const now = performance.now();
    lastAdvanceAt.current = now;
    statsRef.current.lastSource = source;
    statsRef.current.processMs = t0 !== undefined ? now - t0 : null;
    setIndex(next);
    setFlashKey((k) => k + 1);
  }, []);

  /** Jump to a chord without counting it as a gesture (song change / restart). */
  const jumpTo = useCallback((i: number) => {
    indexRef.current = i;
    autoRef.current.phase = 0;
    engineRef.current?.playChord(songRef.current.chords[i]);
    setIndex(i);
    setFlashKey((k) => k + 1);
  }, []);

  // ---- per camera frame: detectors → dispatcher → actions (inside Stage's rAF loop, no React in the hot path) ----
  const lastFrameT = useRef(0);
  const onFrame = useCallback(
    (f: CameraFrame) => {
      const frame: HandFrame = { t: f.t, right: f.right, left: f.left };
      const mode = modeRef.current;
      for (const g of registry.gestures()) {
        const key = `detect:${g.fullId}`;
        if (g.kind === "trigger") {
          if (guard.run(g.pluginId, key, () => g.detect(frame), false)) {
            dispatcher.handle({ kind: "trigger", gesture: g.fullId }, mode, f.t);
          }
        } else {
          const v = guard.run(g.pluginId, key, () => g.detect(frame), null);
          if (v !== null) dispatcher.handle({ kind: "value", gesture: g.fullId, value: v }, mode, f.t);
        }
      }
      exprRef.current.leftLive = !!f.left;

      const st = statsRef.current;
      const dt = f.t - lastFrameT.current;
      lastFrameT.current = f.t;
      st.fps = dt > 0 ? st.fps * 0.9 + (1000 / dt) * 0.1 : st.fps;
      st.inferenceMs = st.inferenceMs * 0.8 + f.inferenceMs * 0.2;
      st.skipped = f.skipped;
      st.right = coreRight ? { ...coreRight.debug } : null;
    },
    [guard, dispatcher],
  );

  const onDraw = useCallback(
    (ctx: CanvasRenderingContext2D, hands: { right: Pt[] | null; left: Pt[] | null }, w: number, h: number) => {
      const frame: HandFrame = { t: performance.now(), ...hands };
      const x = exprRef.current;
      const state: VisualState = {
        lastTriggerAt: lastAdvanceAt.current,
        held: autoRef.current.held,
        volume: x.volume,
        filter: x.filter,
      };
      for (const v of registry.visuals()) {
        ctx.save();
        guard.run(v.pluginId, `draw:${v.fullId}`, () => v.draw(ctx, frame, state, { w, h }), undefined);
        ctx.restore();
      }
    },
    [guard],
  );

  // ---- clock: auto-mode advance + throttled UI refresh ----
  useEffect(() => {
    if (!started) return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const a = autoRef.current;
      const s = songRef.current;
      const dur = (s.beatsPerChord * 60) / s.bpm;
      if (modeRef.current === "auto" && !a.held) {
        a.phase += Math.min(dt, 0.1);
        if (a.phase >= dur) {
          a.phase -= dur;
          move(1, "auto");
        }
      }
      if (now - lastUi > UI_INTERVAL_MS) {
        lastUi = now;
        const x = exprRef.current;
        setUi({ volume: x.volume, filter: x.filter, leftLive: x.leftLive, beat: Math.min(1, a.phase / dur), held: a.held });
        if (engineRef.current) statsRef.current.outputMs = engineRef.current.outputLatencyMs;
        statsRef.current.slow = guard.slow();
        setStats({ ...statsRef.current });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, move, guard]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (editing || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "d") setDebug((v) => !v);
      else if (k === "h") setSwapHands((v) => !v);
      else if (k === "m") changeMode(modeRef.current === "follow" ? "auto" : "follow");
      else if ((e.key === " " || e.key === "ArrowRight") && engineRef.current) {
        e.preventDefault();
        autoRef.current.phase = 0;
        move(1, "key", performance.now());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- actions (gestures reach these through the dispatcher) ----
  useEffect(() => {
    handlersRef.current = {
      trigger(a, gesture, t) {
        switch (a) {
          case "next-chord":
          case "prev-chord":
            autoRef.current.phase = 0;
            move(a === "next-chord" ? 1 : -1, gesture, t);
            break;
          case "hold":
            autoRef.current.held = true;
            break;
          case "release":
            autoRef.current.held = false;
            break;
          case "next-instrument": {
            const list = registry.instruments();
            const i = list.findIndex((x) => x.fullId === (engineRef.current?.instrumentId ?? instrumentId));
            changeInstrument(list[(i + 1) % list.length].fullId);
            break;
          }
          case "toggle-mode":
            changeMode(modeRef.current === "follow" ? "auto" : "follow");
            break;
        }
      },
      value(a, v) {
        engineRef.current?.setParam(a, v);
        if (a === "volume") exprRef.current.volume = v;
        else if (a === "filter") exprRef.current.filter = v;
      },
      switchInstrument: changeInstrument,
    };
  });

  async function start() {
    if (starting || started) return;
    setStarting(true);
    try {
      const def = registry.instrument(instrumentId) ?? registry.instrument(FALLBACK_INSTRUMENT);
      if (!def) throw new Error("No instruments available");
      const engine = await AudioEngine.create(def, guard.run);
      engine.setBpm(song.bpm);
      engine.setParam("volume", exprRef.current.volume);
      engine.setParam("filter", exprRef.current.filter);
      engineRef.current = engine;
      indexRef.current = 0;
      engine.playChord(song.chords[0]);
      setInstrumentId(def.fullId);
      setIndex(0);
      setStarted(true);
    } catch (err) {
      console.error(err);
      setVision({ state: "error", message: "Audio failed to start. Reload and press Start again." });
    } finally {
      setStarting(false);
    }
  }

  function changeMode(m: Mode) {
    autoRef.current.phase = 0;
    // entering Auto with the hand already up holds right away, as before the plugin system
    const raiseHolds = dispatcher.bindings().some((b) => b.gesture === "core.raise" && b.action === "hold");
    autoRef.current.held = m === "auto" && raiseHolds && !!coreRight?.debug.raised;
    setMode(m);
  }

  function changeSong(id: string) {
    const s = songs.find((x) => x.id === id);
    if (s) changeSongTo(s);
  }

  function changeInstrument(id: string) {
    const def = registry.instrument(id) ?? registry.instrument(FALLBACK_INSTRUMENT);
    if (!def) return;
    const engine = engineRef.current;
    if (engine && !engine.setInstrument(def)) {
      setNotice(`${def.name} failed to load. Keeping the current sound.`);
      return;
    }
    setInstrumentId(def.fullId);
  }

  function saveSong(s: Song) {
    const next = [...customSongs, s];
    setCustomSongs(next);
    saveCustomSongs(next);
    setEditing(false);
    changeSongTo(s);
  }

  function deleteSong(id: string) {
    const next = customSongs.filter((s) => s.id !== id);
    setCustomSongs(next);
    saveCustomSongs(next);
    changeSongTo(builtinSongs[0] ?? next[0]);
  }

  function changeSongTo(s: Song) {
    setSongId(s.id);
    songRef.current = s;
    engineRef.current?.setBpm(s.bpm);
    if (engineRef.current) jumpTo(0);
    else setIndex(0);
  }

  const delegate = vision.state === "ready" ? `${vision.delegate} TRACKING` : null;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-stage text-white select-none">
      <Stage active={started} swapHands={swapHands} onFrame={onFrame} onStatus={setVision} onDraw={onDraw}>
        <ChordDisplay
          chords={song.chords}
          index={Math.min(index, song.chords.length - 1)}
          flashKey={flashKey}
          mode={mode}
          beat={ui.beat}
          held={ui.held}
        />
      </Stage>

      <TopBar
        mode={mode}
        onMode={changeMode}
        songs={songs}
        songId={song.id}
        onSong={changeSong}
        instruments={registry.instruments().map((i) => ({ id: i.fullId, name: i.name }))}
        instrument={instrumentId}
        onInstrument={changeInstrument}
        onEdit={() => setEditing(true)}
        onDeleteSong={deleteSong}
        delegate={delegate}
      />

      {started && <Meters volume={ui.volume} filter={ui.filter} live={ui.leftLive} />}

      {started && (
        <div className="pointer-events-none absolute bottom-20 left-4 hidden font-mono text-[11px] leading-5 tracking-wider text-white/45 sm:left-[8vw] sm:block">
          {mode === "follow" ? (
            <div><span className="text-accent">R</span> SWIPE DOWN / CLOSE FIST → NEXT CHORD</div>
          ) : (
            <div><span className="text-accent">R</span> RAISE → HOLD · LOWER → RESUME</div>
          )}
          <div><span className="text-white/80">L</span> HEIGHT → VOLUME · PINCH → FILTER</div>
        </div>
      )}

      {vision.state === "loading" && (
        <div className="absolute left-1/2 top-40 z-30 lg:top-20 -translate-x-1/2 font-mono text-xs tracking-widest text-white/70">
          {vision.message.toUpperCase()}
        </div>
      )}
      {(vision.state === "error" || notice) && (
        <div role="alert" className="absolute left-1/2 top-40 z-30 lg:top-20 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 border-l-4 border-accent bg-black/80 px-4 py-3 font-mono text-xs leading-5 text-white">
          {vision.state === "error" ? vision.message : notice}
        </div>
      )}

      {!started && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-stage/85 px-4 text-center backdrop-blur-sm">
          <h1 className="leading-none">
            <Wordmark className="text-[clamp(2.75rem,10vw,8rem)]" />
          </h1>
          <p className="mt-4 max-w-md font-mono text-xs leading-6 tracking-wider text-white/60">
            A GESTURE SYNTH THAT PLAYS ALONG. YOUR RIGHT HAND MOVES THE SONG FORWARD, YOUR LEFT HAND SHAPES THE SOUND.
          </p>
          <button
            onClick={start}
            disabled={starting}
            className="mt-10 bg-accent px-12 py-4 font-display text-3xl tracking-wider text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {starting ? "WARMING UP…" : "START"}
          </button>
          <p className="mt-6 font-mono text-[10px] tracking-[0.3em] text-white/35">
            CAMERA + AUDIO · SPACE = NEXT · D = DEBUG · H = SWAP HANDS
          </p>
        </div>
      )}

      {editing && <SongEditor onSave={saveSong} onClose={() => setEditing(false)} />}

      {debug && stats && <DebugOverlay stats={stats} mode={mode} swap={swapHands} delegate={delegate} />}
    </main>
  );
}

function DebugOverlay({ stats, mode, swap, delegate }: { stats: Stats; mode: Mode; swap: boolean; delegate: string | null }) {
  const r = stats.right;
  const total = stats.processMs !== null ? stats.processMs + stats.outputMs : null;
  const row = (k: string, v: string, warn = false) => (
    <div key={k} className="flex justify-between gap-6">
      <span className="truncate text-white/45">{k}</span>
      <span className={warn ? "text-accent" : "text-white"}>{v}</span>
    </div>
  );
  return (
    <div className="absolute bottom-24 right-4 z-30 w-64 border border-white/15 bg-black/85 p-3 font-mono text-[11px] leading-5 sm:right-[4vw]">
      <div className="mb-1 tracking-[0.3em] text-accent">DEBUG</div>
      {row("tracking", delegate ?? "off")}
      {row("detect fps", stats.fps.toFixed(0))}
      {row("inference", `${stats.inferenceMs.toFixed(1)} ms`, stats.inferenceMs > 28)}
      {row("frames skipped", String(stats.skipped))}
      {row("gesture→trigger", stats.processMs !== null ? `${stats.processMs.toFixed(1)} ms` : "—")}
      {row("audio output", `${stats.outputMs.toFixed(1)} ms`)}
      {row("total (excl. camera)", total !== null ? `${total.toFixed(1)} ms` : "—", total !== null && total > 50)}
      {row("last trigger", stats.lastSource)}
      <div className="my-1 border-t border-white/10" />
      {row("mode", mode)}
      {row("right hand", r?.present ? r.shape : "—")}
      {row("wrist vy", r ? r.vy.toFixed(2) : "—", !!r && r.vy > 1.5)}
      {row("swipe armed", r ? (r.swipeArmed ? "yes" : "no") : "—")}
      {row("raised", r?.raised ? "yes" : "no")}
      {row("hands swapped", swap ? "yes" : "no")}
      {stats.slow.length > 0 && <div className="my-1 border-t border-white/10" />}
      {stats.slow.map((s) => row(`⚠ ${s.key}`, `${s.avgMs.toFixed(1)} ms`, true))}
    </div>
  );
}
```

- [ ] **Step 9: Run every automated check**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all tests PASS (32 total); typecheck and lint print nothing; build ends with `✓ Generating static pages`.

- [ ] **Step 10: Manual verification with a webcam (required)**

Run `npm run dev`, open http://localhost:3000 in Chrome, press START, press `D`, and check each line:

1. Follow mode: swipe down advances once per stroke; open hand → fist advances once; a quick swipe ending in a fist advances **once**.
2. Left hand up/down moves the VOL meter; pinch moves FILT; dropping the left hand out of frame holds both meters where they were.
3. `M` → Auto: chords advance on the beat; raise right hand → HOLD lights and the beat bar pauses; lower → resumes; raise then move the hand out of frame → resumes.
4. With the right hand already raised, press `M` to enter Auto → HOLD lights immediately.
5. Click PAD / KEYS / PLUCK during a chord: pad and keys keep the chord sounding through the switch; pluck waits for the next advance.
6. `Space` and `→` still advance; `H` still swaps hands; the skeleton and wrist pulse still draw.
7. `D` overlay: `gesture→trigger` is within 1 ms of the Task 1 baseline; `last trigger` shows ids like `core.swipe-down`; no ⚠ rows.
8. Review Focus 5: temporarily append `{ id: "broken", name: "Broken", sustains: true, create: () => { throw new Error("x"); } }` to `coreInstruments` in `plugins/core/instruments.ts`, reload, and click BROKEN mid-song. The previous sound keeps playing and the notice "Broken failed to load. Keeping the current sound." appears. Remove the temporary instrument, then re-run `npm test`.

If any check fails, fix it before committing; do not adjust thresholds in `plugins/core/gestures.ts`.

- [ ] **Step 11: Commit**

```bash
git add -A lib plugins components
git commit -m "feat(core): run built-in features as the core plugin

GestureSynth now runs every enabled gesture detector through the Guard,
dispatches events through mode-aware bindings, draws plugin visuals, and
reads songs and instruments from the registry. Behavior is unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Update the contributor map**

In `CONTRIBUTING.md`, replace the "Map of the code" table with:

```markdown
| Path | What lives there |
|---|---|
| `lib/plugins/` | Plugin contract (`types.ts`), registry, guard, dispatcher |
| `plugins/core/` | Built-in gestures, instruments (Pad/Keys/Pluck), skeleton visual, starter songs |
| `lib/gestures.ts` | Hand math helpers: pinch, openness, hand shape, velocity |
| `lib/audio.ts` | Tone.js master chain and voice-leading; delegates sound to an instrument |
| `lib/songs.ts` | Song model, chord parser, localStorage |
| `lib/vision.ts` | HandLandmarker loader (GPU, then CPU fallback) |
| `components/` | Stage (camera + canvas), Controls, GestureSynth (wires frames → plugins → audio) |
```

Add under "Before you open a PR": `npm test` before `npm run typecheck`.

In `README.md` "Layout" section, replace the code block with the same paths.

```bash
git add CONTRIBUTING.md README.md
git commit -m "docs: update code map for the plugin registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After this plan

Open the PR "Plugin system part 1: core refactor" with the baseline and after latency numbers from Task 1 and Task 6. Once merged, write plan 2 (code plugins, Plugins panel, CSP, `strings` example) and plan 3 (JSON packs, share links, import, Discover catalog, scaffold, docs) against the merged code.

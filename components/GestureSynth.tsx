"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine, type PresetName } from "@/lib/audio";
import { LeftHandExpression, RightHandGestures, type RightHandState } from "@/lib/gestures";
import { loadCustomSongs, PRESET_SONGS, saveCustomSongs, type Song } from "@/lib/songs";
import { ChordDisplay, Stage, type HandFrame, type VisionStatus } from "./Stage";
import { Meters, SongEditor, TopBar, type Mode } from "./Controls";
import { Wordmark } from "./Wordmark";

type Stats = {
  inferenceMs: number;
  fps: number;
  skipped: number;
  /** frame inference start → synth triggered */
  processMs: number | null;
  outputMs: number;
  lastSource: string;
  right: RightHandState | null;
};

const UI_INTERVAL_MS = 50;

export default function GestureSynth() {
  const [songs, setSongs] = useState<Song[]>(PRESET_SONGS);
  const [songId, setSongId] = useState(PRESET_SONGS[0].id);
  const [mode, setMode] = useState<Mode>("follow");
  const [preset, setPreset] = useState<PresetName>("Pad");
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [vision, setVision] = useState<VisionStatus>({ state: "idle" });
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
  const rightRef = useRef(new RightHandGestures());
  const leftRef = useRef(new LeftHandExpression());
  const autoRef = useRef({ phase: 0, held: false });
  const lastAdvanceAt = useRef(-Infinity);
  const statsRef = useRef<Stats>({
    inferenceMs: 0, fps: 0, skipped: 0, processMs: null, outputMs: 0, lastSource: "—", right: null,
  });
  const exprRef = useRef({ volume: 0.75, filter: 0.6, leftLive: false });

  useEffect(() => {
    songRef.current = song;
    modeRef.current = mode;
  });

  // custom songs from localStorage (client only)
  useEffect(() => {
    const custom = loadCustomSongs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
    if (custom.length) setSongs([...PRESET_SONGS, ...custom]);
  }, []);

  const advance = useCallback((source: string, t0?: number) => {
    const s = songRef.current;
    const next = (indexRef.current + 1) % s.chords.length;
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

  // ---- per camera frame: gestures → sound (runs inside Stage's rAF loop, no React in the hot path) ----
  const lastFrameT = useRef(0);
  const onFrame = useCallback(
    (f: HandFrame) => {
      const r = rightRef.current.update(f.right, f.t);
      const e = leftRef.current.update(f.left);
      const engine = engineRef.current;
      if (engine && e.present) {
        engine.setVolume(e.volume);
        engine.setFilter(e.filter);
      }
      exprRef.current = { volume: e.volume, filter: e.filter, leftLive: e.present };

      if (modeRef.current === "follow") {
        if (r.advance) advance(r.advance, f.t);
      } else {
        autoRef.current.held = r.raised;
      }

      const st = statsRef.current;
      const dt = f.t - lastFrameT.current;
      lastFrameT.current = f.t;
      st.fps = dt > 0 ? st.fps * 0.9 + (1000 / dt) * 0.1 : st.fps;
      st.inferenceMs = st.inferenceMs * 0.8 + f.inferenceMs * 0.2;
      st.skipped = f.skipped;
      st.right = r;
    },
    [advance],
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
          advance("auto");
        }
      }
      if (now - lastUi > UI_INTERVAL_MS) {
        lastUi = now;
        const x = exprRef.current;
        setUi({ volume: x.volume, filter: x.filter, leftLive: x.leftLive, beat: Math.min(1, a.phase / dur), held: a.held });
        if (engineRef.current) statsRef.current.outputMs = engineRef.current.outputLatencyMs;
        setStats({ ...statsRef.current });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, advance]);

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
        advance("key", performance.now());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function start() {
    if (starting || started) return;
    setStarting(true);
    try {
      const engine = await AudioEngine.create(preset);
      engine.setBpm(song.bpm);
      engine.setVolume(exprRef.current.volume);
      engine.setFilter(exprRef.current.filter);
      engineRef.current = engine;
      indexRef.current = 0;
      engine.playChord(song.chords[0]);
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
    autoRef.current.held = false;
    setMode(m);
  }

  function changeSong(id: string) {
    const s = songs.find((x) => x.id === id);
    if (s) changeSongTo(s);
  }

  function changePreset(p: PresetName) {
    setPreset(p);
    engineRef.current?.setPreset(p);
  }

  function saveSong(s: Song) {
    const next = [...songs, s];
    setSongs(next);
    saveCustomSongs(next);
    setEditing(false);
    changeSongTo(s);
  }

  function deleteSong(id: string) {
    const next = songs.filter((s) => s.id !== id);
    setSongs(next);
    saveCustomSongs(next);
    changeSongTo(next[0]);
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
      <Stage
        active={started}
        swapHands={swapHands}
        onFrame={onFrame}
        onStatus={setVision}
        lastAdvanceAt={lastAdvanceAt}
      >
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
        preset={preset}
        onPreset={changePreset}
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
      {vision.state === "error" && (
        <div role="alert" className="absolute left-1/2 top-40 z-30 lg:top-20 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 border-l-4 border-accent bg-black/80 px-4 py-3 font-mono text-xs leading-5 text-white">
          {vision.message}
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
    <div className="flex justify-between gap-6">
      <span className="text-white/45">{k}</span>
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
    </div>
  );
}

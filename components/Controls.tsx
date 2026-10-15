"use client";

import { useState } from "react";
import { PRESETS, type PresetName } from "@/lib/audio";
import { parseProgression, type Song } from "@/lib/songs";

export type Mode = "follow" | "auto";

type TopBarProps = {
  mode: Mode;
  onMode: (m: Mode) => void;
  songs: Song[];
  songId: string;
  onSong: (id: string) => void;
  preset: PresetName;
  onPreset: (p: PresetName) => void;
  onEdit: () => void;
  onDeleteSong: (id: string) => void;
  delegate: string | null;
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex border border-white/20">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 font-mono text-xs tracking-widest transition-colors ${
            value === o.value ? "bg-accent text-black" : "text-white/70 hover:bg-white/10 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TopBar(p: TopBarProps) {
  const song = p.songs.find((s) => s.id === p.songId);
  return (
    <header className="absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-3 px-4 py-4 sm:px-[8vw]">
      <div className="mr-auto flex items-baseline gap-3">
        <span className="font-display text-3xl tracking-wide text-white">
          VIVO<span className="text-accent">.</span>
        </span>
        {p.delegate && <span className="font-mono text-[10px] tracking-widest text-white/40">{p.delegate}</span>}
      </div>

      <Segmented
        label="Playback mode"
        value={p.mode}
        onChange={p.onMode}
        options={[
          { value: "follow", label: "FOLLOW" },
          { value: "auto", label: "AUTO" },
        ]}
      />

      <div className="flex items-center border border-white/20">
        <select
          aria-label="Song"
          value={p.songId}
          onChange={(e) => p.onSong(e.target.value)}
          className="max-w-44 cursor-pointer appearance-none bg-transparent px-3 py-1.5 font-mono text-xs tracking-wider text-white outline-none"
        >
          {p.songs.map((s) => (
            <option key={s.id} value={s.id} className="bg-stage">
              {s.name.toUpperCase()} · {s.bpm}
            </option>
          ))}
        </select>
        {song?.custom && (
          <button
            onClick={() => p.onDeleteSong(song.id)}
            className="border-l border-white/20 px-2 py-1.5 font-mono text-xs text-white/50 hover:text-accent"
            title="Delete this song"
          >
            ✕
          </button>
        )}
        <button
          onClick={p.onEdit}
          className="border-l border-white/20 px-3 py-1.5 font-mono text-xs tracking-widest text-white/70 hover:bg-white/10 hover:text-white"
        >
          + NEW
        </button>
      </div>

      <Segmented
        label="Sound preset"
        value={p.preset}
        onChange={p.onPreset}
        options={PRESETS.map((x) => ({ value: x, label: x.toUpperCase() }))}
      />
    </header>
  );
}

// ---------- meters ----------

function Meter({ label, value, readout, live }: { label: string; value: number; readout: string; live: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-mono text-[10px] text-white/70">{readout}</div>
      <div className="relative h-40 w-3 bg-white/10">
        <div
          className={`absolute inset-x-0 bottom-0 transition-[height] duration-75 ${live ? "bg-accent" : "bg-white/35"}`}
          style={{ height: `${value * 100}%` }}
        />
      </div>
      <div className="font-mono text-[10px] tracking-[0.25em] text-white/50">{label}</div>
    </div>
  );
}

export function Meters({ volume, filter, live }: { volume: number; filter: number; live: boolean }) {
  const hz = 180 * Math.pow(50, filter);
  return (
    <div className="absolute right-4 top-[18vh] z-10 flex gap-5 sm:right-[4vw]">
      <Meter label="VOL" value={volume} readout={`${Math.round(volume * 100)}`} live={live} />
      <Meter label="FILT" value={filter} readout={hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`} live={live} />
    </div>
  );
}

// ---------- song editor ----------

export function SongEditor({ onSave, onClose }: { onSave: (s: Song) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [prog, setProg] = useState("");
  const [bpm, setBpm] = useState(90);
  const [beats, setBeats] = useState(4);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseProgression(prog);
    if ("error" in parsed) return setError(parsed.error);
    if (!(bpm >= 30 && bpm <= 240)) return setError("BPM must be 30–240");
    onSave({
      id: `custom-${Date.now()}`,
      name: name.trim() || parsed.chords.join(" "),
      bpm,
      beatsPerChord: beats,
      chords: parsed.chords,
      custom: true,
    });
  }

  const field = "w-full border border-white/20 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none focus:border-accent";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border border-white/15 bg-stage p-6"
      >
        <h2 className="font-display text-4xl text-white">
          NEW SONG<span className="text-accent">.</span>
        </h2>
        <label className="mt-5 block font-mono text-[10px] tracking-[0.3em] text-white/50">PROGRESSION</label>
        <input autoFocus className={field} placeholder="G B C Cm" value={prog} onChange={(e) => setProg(e.target.value)} />
        <label className="mt-4 block font-mono text-[10px] tracking-[0.3em] text-white/50">NAME</label>
        <input className={field} placeholder="Untitled" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="mt-4 flex gap-3">
          <div className="flex-1">
            <label className="block font-mono text-[10px] tracking-[0.3em] text-white/50">BPM</label>
            <input type="number" className={field} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
          </div>
          <div className="flex-1">
            <label className="block font-mono text-[10px] tracking-[0.3em] text-white/50">BEATS / CHORD</label>
            <input
              type="number"
              min={1}
              max={16}
              className={field}
              value={beats}
              onChange={(e) => setBeats(Math.max(1, Math.min(16, Number(e.target.value) || 4)))}
            />
          </div>
        </div>
        {error && <p className="mt-3 font-mono text-xs text-accent">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 font-mono text-xs tracking-widest text-white/60 hover:text-white">
            CANCEL
          </button>
          <button type="submit" className="bg-accent px-5 py-2 font-mono text-xs font-bold tracking-widest text-black hover:brightness-110">
            SAVE
          </button>
        </div>
      </form>
    </div>
  );
}

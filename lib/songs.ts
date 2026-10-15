export type Song = {
  id: string;
  name: string;
  bpm: number;
  beatsPerChord: number;
  chords: string[];
  custom?: boolean;
};

export const PRESET_SONGS: Song[] = [
  { id: "slow-burn", name: "Slow Burn", bpm: 92, beatsPerChord: 4, chords: ["G", "B", "C", "Cm"] },
  { id: "four-chords", name: "Four Chords", bpm: 100, beatsPerChord: 4, chords: ["C", "G", "Am", "F"] },
  { id: "minor-lift", name: "Minor Lift", bpm: 84, beatsPerChord: 4, chords: ["Am", "F", "C", "G"] },
];

// ---------- chord parsing ----------

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// interval sets relative to root, longest suffixes first so "maj7" wins over "m"
const QUALITIES: [string, number[]][] = [
  ["maj9", [0, 4, 7, 11, 14]],
  ["maj7", [0, 4, 7, 11]],
  ["M7", [0, 4, 7, 11]],
  ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["add9", [0, 4, 7, 14]],
  ["madd9", [0, 3, 7, 14]],
  ["sus2", [0, 2, 7]],
  ["sus4", [0, 5, 7]],
  ["sus", [0, 5, 7]],
  ["min7", [0, 3, 7, 10]],
  ["min", [0, 3, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["m9", [0, 3, 7, 10, 14]],
  ["m7", [0, 3, 7, 10]],
  ["m6", [0, 3, 7, 9]],
  ["+", [0, 4, 8]],
  ["9", [0, 4, 7, 10, 14]],
  ["7", [0, 4, 7, 10]],
  ["6", [0, 4, 7, 9]],
  ["5", [0, 7]],
  ["m", [0, 3, 7]],
  ["", [0, 4, 7]],
];

export type ParsedChord = {
  name: string;
  root: number; // pitch class 0-11
  bass: number; // pitch class of bass (slash chords)
  intervals: number[];
  rootLabel: string;
  quality: string;
};

const CHORD_RE = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/;

function pc(letter: string, acc: string): number {
  return (NOTE_PC[letter] + (acc === "#" ? 1 : acc === "b" ? -1 : 0) + 12) % 12;
}

export function parseChord(raw: string): ParsedChord | null {
  const name = raw.trim();
  const m = CHORD_RE.exec(name);
  if (!m) return null;
  const [, letter, acc, rest, bassLetter, bassAcc] = m;
  const q = QUALITIES.find(([suffix]) => suffix === rest);
  if (!q) return null;
  const root = pc(letter, acc);
  return {
    name,
    root,
    bass: bassLetter ? pc(bassLetter, bassAcc) : root,
    intervals: q[1],
    rootLabel: letter + acc,
    quality: rest + (bassLetter ? `/${bassLetter}${bassAcc}` : ""),
  };
}

/** Parse "G B C Cm" (spaces, commas, pipes or dashes). Returns chords or the first bad token. */
export function parseProgression(text: string): { chords: string[] } | { error: string } {
  const tokens = text.split(/[\s,|]+|\s-\s/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return { error: "Enter at least one chord" };
  for (const t of tokens) if (!parseChord(t)) return { error: `Can't read chord "${t}"` };
  return { chords: tokens };
}

// ---------- persistence ----------

const STORAGE_KEY = "vivo.songs.v1";

export function loadCustomSongs(): Song[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (s): s is Song =>
        s && typeof s.name === "string" && typeof s.bpm === "number" && Array.isArray(s.chords),
    ).map((s) => ({ ...s, custom: true }));
  } catch {
    return [];
  }
}

export function saveCustomSongs(songs: Song[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(songs.filter((s) => s.custom)));
    return true;
  } catch {
    return false;
  }
}

// Pure hand-gesture math on MediaPipe normalized landmarks (x,y in 0..1, y down).

export type Pt = { x: number; y: number; z?: number };

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Wrist→middle-knuckle length: scale reference so metrics are distance-invariant. */
export const palmSize = (lm: Pt[]) => Math.max(dist(lm[WRIST], lm[MIDDLE_MCP]), 1e-4);

/** Thumb-tip to index-tip distance in palm units (~0.1 pinched, ~1.3+ wide). */
export const pinchRatio = (lm: Pt[]) => dist(lm[THUMB_TIP], lm[INDEX_TIP]) / palmSize(lm);

/** Mean fingertip-to-wrist distance in palm units (~1.9 open, ~1.0 fist). */
export function openness(lm: Pt[]): number {
  const p = palmSize(lm);
  let s = 0;
  for (const t of TIPS) s += dist(lm[t], lm[WRIST]);
  return s / TIPS.length / p;
}

/** Count fingers whose tip is farther from the wrist than its PIP joint (orientation-robust). */
export function extendedFingers(lm: Pt[]): number {
  let n = 0;
  for (let i = 0; i < TIPS.length; i++) {
    if (dist(lm[TIPS[i]], lm[WRIST]) > dist(lm[PIPS[i]], lm[WRIST]) * 1.08) n++;
  }
  return n;
}

export type HandShape = "open" | "closed" | "neutral";

export function handShape(lm: Pt[]): HandShape {
  const ext = extendedFingers(lm);
  const o = openness(lm);
  if (ext >= 4 && o > 1.5) return "open";
  if (ext <= 1 && o < 1.35) return "closed";
  return "neutral";
}

/** Vertical velocity (screen-heights/sec, + = down) via least squares over a short window. */
export class VelocityTracker {
  private samples: { t: number; y: number }[] = [];
  constructor(private windowMs = 90) {}

  push(t: number, y: number) {
    this.samples.push({ t, y });
    while (this.samples.length > 2 && t - this.samples[0].t > this.windowMs) this.samples.shift();
  }

  reset() {
    this.samples = [];
  }

  vy(): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const t0 = s[0].t;
    let mt = 0, my = 0;
    for (const p of s) { mt += p.t - t0; my += p.y; }
    mt /= s.length; my /= s.length;
    let num = 0, den = 0;
    for (const p of s) {
      const dt = p.t - t0 - mt;
      num += dt * (p.y - my);
      den += dt * dt;
    }
    return den > 0 ? (num / den) * 1000 : 0;
  }
}

/** Lets one event through per `ms`. */
export class Debouncer {
  private last = -Infinity;
  constructor(public ms = 250) {}
  fire(now: number): boolean {
    if (now - this.last < this.ms) return false;
    this.last = now;
    return true;
  }
}

export type RightHandState = {
  present: boolean;
  shape: HandShape;
  vy: number;
  swipeArmed: boolean;
  raised: boolean;
  /** which gesture fired this frame, if any (after debounce) */
  advance: "swipe" | "fist" | null;
};

const SWIPE_VY = 1.5; // screen-heights / sec downward
const SWIPE_REARM_VY = 0.4;
const RAISE_Y = 0.38; // wrist above this (screen top = 0) → raised
const LOWER_Y = 0.5;

/** Right hand: downward swipe OR open→fist = advance. Also tracks raised/lowered for auto mode. */
export class RightHandGestures {
  private vel = new VelocityTracker();
  private debounce = new Debouncer(250);
  private armed = true;
  private lastShape: HandShape = "neutral";
  private wasOpen = false;
  private raised = false;

  update(lm: Pt[] | null, now: number): RightHandState {
    if (!lm) {
      this.vel.reset();
      this.armed = true;
      this.wasOpen = false;
      this.lastShape = "neutral";
      this.raised = false;
      return { present: false, shape: "neutral", vy: 0, swipeArmed: true, raised: false, advance: null };
    }

    const wrist = lm[WRIST];
    this.vel.push(now, wrist.y);
    const vy = this.vel.vy();
    const shape = handShape(lm);

    let advance: RightHandState["advance"] = null;

    // Swipe: one fast downward stroke; must slow down before it can fire again.
    if (this.armed && vy > SWIPE_VY) {
      this.armed = false;
      if (this.debounce.fire(now)) advance = "swipe";
    } else if (!this.armed && vy < SWIPE_REARM_VY) {
      this.armed = true;
    }

    // Fist: hand was clearly open, now clearly closed.
    if (shape === "open") this.wasOpen = true;
    if (shape === "closed" && this.lastShape !== "closed" && this.wasOpen) {
      this.wasOpen = false;
      if (!advance && this.debounce.fire(now)) advance = "fist";
    }
    if (shape !== "neutral") this.lastShape = shape;

    if (wrist.y < RAISE_Y) this.raised = true;
    else if (wrist.y > LOWER_Y) this.raised = false;

    return { present: true, shape, vy, swipeArmed: this.armed, raised: this.raised, advance };
  }
}

export type Expression = { volume: number; filter: number; present: boolean };

/** Left hand: height → volume, pinch → filter. Smoothed; holds last value when hand leaves. */
export class LeftHandExpression {
  private v = 0.75;
  private f = 0.6;
  constructor(private smoothing = 0.3) {}

  update(lm: Pt[] | null): Expression {
    if (!lm) return { volume: this.v, filter: this.f, present: false };
    // wrist y 0.15 (high) → 1, 0.85 (low) → 0
    const targetV = clamp01((0.85 - lm[WRIST].y) / 0.7);
    // pinch 0.15 → 0, 1.4 → 1
    const targetF = clamp01((pinchRatio(lm) - 0.15) / 1.25);
    this.v += (targetV - this.v) * this.smoothing;
    this.f += (targetF - this.f) * this.smoothing;
    return { volume: this.v, filter: this.f, present: true };
  }

  get values() {
    return { volume: this.v, filter: this.f };
  }
}

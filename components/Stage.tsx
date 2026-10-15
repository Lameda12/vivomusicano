"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { assignHands, createHandLandmarker, HAND_CONNECTIONS, type Delegate } from "@/lib/vision";
import type { Pt } from "@/lib/gestures";
import { parseChord } from "@/lib/songs";

export type HandFrame = {
  right: Pt[] | null;
  left: Pt[] | null;
  /** performance.now() when this frame's inference started */
  t: number;
  inferenceMs: number;
  skipped: number;
};

export type VisionStatus =
  | { state: "idle" }
  | { state: "loading"; message: string }
  | { state: "ready"; delegate: Delegate }
  | { state: "error"; message: string };

const ACCENT = "#ff4d1f";
const FRAME_BUDGET_MS = 28;

type StageProps = {
  active: boolean;
  swapHands: boolean;
  onFrame: (f: HandFrame) => void;
  onStatus: (s: VisionStatus) => void;
  /** performance.now() of last chord advance, for the wrist pulse */
  lastAdvanceAt: RefObject<number>;
  children?: ReactNode;
};

export function Stage({ active, swapHands, onFrame, onStatus, lastAdvanceAt, children }: StageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  const onStatusRef = useRef(onStatus);
  const swapRef = useRef(swapHands);

  useEffect(() => {
    onFrameRef.current = onFrame;
    onStatusRef.current = onStatus;
    swapRef.current = swapHands;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;
    let recovering = false;
    let delegate: Delegate = "GPU";
    // CPU without any WebGL can't upload <video> textures: feed ImageData from a 2D canvas instead
    let useImageData = false;
    let grab: CanvasRenderingContext2D | null = null;

    const status = (s: VisionStatus) => !cancelled && onStatusRef.current(s);

    async function boot() {
      const video = videoRef.current!;
      status({ state: "loading", message: "Requesting camera…" });
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
        });
      } catch (err) {
        const name = (err as DOMException)?.name;
        status({
          state: "error",
          message:
            name === "NotAllowedError" || name === "SecurityError"
              ? "Camera access was denied. Allow the camera for this site and reload — meanwhile SPACE advances chords."
              : name === "NotFoundError" || name === "OverconstrainedError"
                ? "No camera found. Plug one in and reload — meanwhile SPACE advances chords."
                : `Camera unavailable (${name ?? "unknown error"}). SPACE still advances chords.`,
        });
        return;
      }
      if (cancelled) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});

      status({ state: "loading", message: "Loading hand tracking…" });
      try {
        const made = await createHandLandmarker("GPU");
        if (cancelled) return made.landmarker.close();
        landmarker = made.landmarker;
        delegate = made.delegate;
        status({ state: "ready", delegate: made.delegate });
      } catch (err) {
        console.error(err);
        status({ state: "error", message: "Hand tracking failed to load (WebGL/WASM). SPACE still advances chords." });
        return;
      }
      raf = requestAnimationFrame(loop);
    }

    let lastVideoTime = -1;
    let skipBudget = 0;
    let skipped = 0;

    function loop() {
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      if (!video || !landmarker || recovering || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return; // no new camera frame yet
      lastVideoTime = video.currentTime;
      if (skipBudget > 0) {
        // inference fell behind: drop this frame so we always work on the freshest one
        skipBudget--;
        skipped++;
        return;
      }

      const t0 = performance.now();
      let res;
      try {
        res = landmarker.detectForVideo(useImageData ? frameData(video) : video, t0);
      } catch (err) {
        if (delegate === "GPU") {
          console.warn("[vision] GPU inference failed, switching to CPU", err);
          recovering = true;
          landmarker.close();
          landmarker = null;
          createHandLandmarker("CPU")
            .then((m) => {
              if (cancelled) return m.landmarker.close();
              landmarker = m.landmarker;
              delegate = "CPU";
              recovering = false;
              status({ state: "ready", delegate: "CPU" });
            })
            .catch(() => status({ state: "error", message: "Hand tracking crashed. SPACE still advances chords." }));
        } else if (!useImageData) {
          console.warn("[vision] CPU video input failed, retrying with ImageData", err);
          useImageData = true;
        } else {
          console.error("[vision] hand tracking unavailable", err);
          landmarker.close();
          landmarker = null;
          status({ state: "error", message: "Hand tracking isn't supported in this browser. SPACE still advances chords." });
        }
        return;
      }
      const inferenceMs = performance.now() - t0;
      skipBudget = inferenceMs > FRAME_BUDGET_MS ? Math.min(3, Math.floor(inferenceMs / FRAME_BUDGET_MS)) : 0;

      const hands = assignHands(res, swapRef.current);
      onFrameRef.current({ ...hands, t: t0, inferenceMs, skipped });
      draw(video, hands.right, hands.left);
    }

    function frameData(video: HTMLVideoElement): ImageData {
      if (!grab) {
        const c = document.createElement("canvas");
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        grab = c.getContext("2d", { willReadFrequently: true })!;
      }
      grab.drawImage(video, 0, 0);
      return grab.getImageData(0, 0, grab.canvas.width, grab.canvas.height);
    }

    function draw(video: HTMLVideoElement, right: Pt[] | null, left: Pt[] | null) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d")!;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const pulse = Math.max(0, 1 - (performance.now() - lastAdvanceAt.current) / 350);
      if (right) skeleton(ctx, right, w, h, ACCENT, 3.5, pulse);
      if (left) skeleton(ctx, left, w, h, "rgba(255,255,255,0.85)", 2.5, 0);
    }

    boot();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, [active, lastAdvanceAt]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-stage">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover [filter:grayscale(1)_contrast(1.15)_brightness(0.42)]"
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(5,5,7,0.85)_100%)]" />
      {children}
    </div>
  );
}

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
  for (const { start, end } of HAND_CONNECTIONS) {
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

// ---------- chord display ----------

export function ChordName({ name, className = "" }: { name: string; className?: string }) {
  const c = parseChord(name);
  if (!c) return <span className={className}>{name}</span>;
  return (
    <span className={className}>
      {c.rootLabel}
      {c.quality && <span className="text-accent text-[0.42em] align-top leading-none">{c.quality}</span>}
    </span>
  );
}

type ChordDisplayProps = {
  chords: string[];
  index: number;
  flashKey: number;
  mode: "follow" | "auto";
  beat: number; // 0..1 within current chord (auto mode)
  held: boolean;
};

export function ChordDisplay({ chords, index, flashKey, mode, beat, held }: ChordDisplayProps) {
  const current = chords[index] ?? "";
  const next = chords[(index + 1) % chords.length] ?? "";
  return (
    <>
      <div key={flashKey} className="pointer-events-none absolute inset-0 animate-flash" />
      <div className="pointer-events-none absolute inset-x-0 top-[14vh] flex flex-col items-center px-4 sm:items-start sm:pl-[8vw]">
        <div className="font-mono text-xs tracking-[0.35em] text-white/50">
          NOW · {index + 1}/{chords.length}
          {mode === "auto" && held && <span className="ml-3 text-accent">HOLD</span>}
        </div>
        <ChordName
          key={flashKey}
          name={current}
          className="animate-chord-in mt-4 font-display text-[clamp(8rem,30vw,26rem)] leading-[0.9] text-white drop-shadow-[0_0_40px_rgba(0,0,0,0.6)]"
        />
        <div className="mt-6 flex items-baseline gap-4">
          <span className="font-mono text-xs tracking-[0.35em] text-white/50">NEXT →</span>
          <ChordName name={next} className="font-display text-6xl text-transparent [-webkit-text-stroke:1.5px_rgba(255,255,255,0.75)]" />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-4 bottom-6 sm:inset-x-[8vw]">
        <div className="flex gap-1.5">
          {chords.map((c, i) => (
            <div key={i} className="min-w-0 flex-1">
              <div className="relative h-2 overflow-hidden bg-white/12">
                <div
                  className="absolute inset-y-0 left-0 bg-accent transition-[width] duration-75"
                  style={{
                    width: i < index ? "100%" : i > index ? "0%" : mode === "auto" ? `${beat * 100}%` : "100%",
                    opacity: i < index ? 0.35 : 1,
                  }}
                />
              </div>
              <div className={`mt-2 truncate font-mono text-xs ${i === index ? "text-white" : "text-white/40"}`}>{c}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

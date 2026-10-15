import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { Pt } from "./gestures";

export type Delegate = "GPU" | "CPU";

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/hand_landmarker.task";

export async function createHandLandmarker(
  delegate: Delegate,
): Promise<{ landmarker: HandLandmarker; delegate: Delegate }> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const make = (d: Delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: d },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  if (delegate === "GPU") {
    try {
      return { landmarker: await make("GPU"), delegate: "GPU" };
    } catch (err) {
      console.warn("[vision] GPU delegate failed, falling back to CPU", err);
    }
  }
  return { landmarker: await make("CPU"), delegate: "CPU" };
}

export type Hands = { right: Pt[] | null; left: Pt[] | null };

/**
 * We feed raw (unmirrored) camera frames. MediaPipe labels handedness assuming a mirrored
 * selfie image, so on raw frames its "Left" is the performer's right hand. `swap` flips it
 * for cameras/drivers that already mirror.
 */
export function assignHands(res: HandLandmarkerResult, swap: boolean): Hands {
  const hands = res.landmarks.map((lm, i) => ({
    lm: lm as Pt[],
    isRight: (res.handedness[i]?.[0]?.categoryName === "Left") !== swap,
  }));
  if (hands.length === 2 && hands[0].isRight === hands[1].isRight) {
    // classifier disagrees with itself: fall back to position (raw frame: performer's right = smaller x)
    const [a, b] = hands;
    const aIsRight = (a.lm[0].x < b.lm[0].x) !== swap;
    a.isRight = aIsRight;
    b.isRight = !aIsRight;
  }
  return {
    right: hands.find((h) => h.isRight)?.lm ?? null,
    left: hands.find((h) => !h.isRight)?.lm ?? null,
  };
}

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;

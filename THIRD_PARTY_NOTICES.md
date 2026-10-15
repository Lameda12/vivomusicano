# Third-party notices

Vivomusicano is built on these open-source projects. Each one keeps its own license.

| Component | Use | License |
|---|---|---|
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (`@mediapipe/tasks-vision`) | Hand tracking runtime (WASM) | Apache 2.0 |
| MediaPipe Hand Landmarker model (`hand_landmarker.task`) | Hand landmark model, downloaded at build time | Apache 2.0, see the [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf) |
| [Tone.js](https://github.com/Tonejs/Tone.js) | Audio synthesis and scheduling | MIT |
| [Next.js](https://github.com/vercel/next.js) | App framework | MIT |
| [React](https://github.com/facebook/react) | UI | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | Styling | MIT |
| [Anton](https://fonts.google.com/specimen/Anton), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | Fonts, self-hosted at build time via `next/font` | SIL Open Font License 1.1 |

The full license texts ship with each package in `node_modules/`.

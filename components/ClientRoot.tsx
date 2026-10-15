"use client";

import dynamic from "next/dynamic";

// Camera, WebAudio and MediaPipe are browser-only: skip prerendering entirely.
const GestureSynth = dynamic(() => import("./GestureSynth"), {
  ssr: false,
  loading: () => <main className="h-dvh w-full bg-stage" />,
});

export default function ClientRoot() {
  return <GestureSynth />;
}

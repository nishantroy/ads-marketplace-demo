"use client";

import dynamic from "next/dynamic";

// No SSR: the current stage lives in the URL and is read from window.location on first render, so
// server and client would otherwise disagree about the initial markup.
const SimulatorPreview = dynamic(() => import("../components/simulator/simulator-preview").then(module => module.SimulatorPreview), { ssr: false });

export default function Home() {
  return <SimulatorPreview />;
}

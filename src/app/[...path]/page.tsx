"use client";

import dynamic from "next/dynamic";

// Catches every path other than "/" (e.g. /pacing-off, /explore) so a hard reload or a pasted link still
// serves the app shell; the shell itself reads window.location to restore the right guided stage.
// The path segments themselves are unused here on purpose.
const SimulatorPreview = dynamic(() => import("../../components/simulator/simulator-preview").then(module => module.SimulatorPreview), { ssr: false });

export default function CatchAll() {
  return <SimulatorPreview />;
}

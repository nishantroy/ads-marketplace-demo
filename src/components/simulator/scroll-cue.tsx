"use client";

import { useEffect, useState } from "react";

/** Shows only while there is unseen document content below the viewport. */
export function ScrollCue() {
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const documentHeight = document.documentElement.scrollHeight;
      const atBottom = window.scrollY + window.innerHeight >= documentHeight - 2;
      setHasMoreBelow(documentHeight > window.innerHeight + 2 && !atBottom);
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setReducedMotion(motionQuery.matches);
    const observer = new ResizeObserver(scheduleUpdate);

    observer.observe(document.documentElement);
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    motionQuery.addEventListener("change", updateMotionPreference);
    scheduleUpdate();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      motionQuery.removeEventListener("change", updateMotionPreference);
    };
  }, []);

  if (!hasMoreBelow) return null;

  return <button className="scroll-cue" onClick={() => window.scrollBy({
    top: Math.max(window.innerHeight * 0.7, 240),
    behavior: reducedMotion ? "auto" : "smooth",
  })}>
    <span aria-hidden="true">↓</span> Scroll for more
  </button>;
}

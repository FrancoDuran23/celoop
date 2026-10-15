"use client";
// Shared by the self-playing pieces of the landing: run only while on screen, pause on demand,
// and start still when the visitor asked for reduced motion.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const MOTION = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(MOTION);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function useAutoplay<T extends HTMLElement>() {
  const still = useSyncExternalStore(subscribe, () => window.matchMedia(MOTION).matches, () => false);
  const [userPlaying, setUserPlaying] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const playing = userPlaying ?? !still;
  return {
    ref,
    playing,
    /** Reduced motion and the visitor hasn't pressed play yet: show a finished, still state. */
    frozen: still && userPlaying === null,
    running: playing && visible,
    toggle: () => setUserPlaying(!playing),
  };
}

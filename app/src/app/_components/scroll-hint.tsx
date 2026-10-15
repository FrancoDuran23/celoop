"use client";
// "Scroll to learn more" under the opening picture; it goes away as soon as the page moves.
import { useEffect, useState } from "react";

export function ScrollHint() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const update = () => setGone(window.scrollY > 40);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <p className={`scroll-hint ${gone ? "is-gone" : ""}`} aria-hidden="true">
      <span className="scroll-hint-arrow">↓</span> Scroll to learn more
    </p>
  );
}

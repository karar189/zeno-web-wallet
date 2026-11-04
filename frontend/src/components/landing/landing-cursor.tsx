"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type CursorMode = "idle" | "invert";

function isInvertTarget(el: Element | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  return Boolean(
    el.closest(
      "a, button, [role='button'], .primary-action, .text-link, .landing-module, .hero__cta, .hero__logo, .hero__nav a, summary",
    ),
  );
}

export function LandingCursor() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<CursorMode>("idle");
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    setReady(true);
    document.documentElement.classList.add("landing-cursor-on");

    const onMove = (event: PointerEvent) => {
      setPos({ x: event.clientX, y: event.clientY });
      setVisible(true);
      setMode(isInvertTarget(event.target as Element | null) ? "invert" : "idle");
    };
    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    document.documentElement.addEventListener("mouseenter", onEnter);

    return () => {
      document.documentElement.classList.remove("landing-cursor-on");
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.documentElement.removeEventListener("mouseenter", onEnter);
    };
  }, []);

  if (!ready) return null;

  return createPortal(
    <div
      className={`landing-cursor${mode === "invert" ? " is-invert" : ""}${visible ? " is-visible" : ""}`}
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      aria-hidden="true"
    />,
    document.body,
  );
}

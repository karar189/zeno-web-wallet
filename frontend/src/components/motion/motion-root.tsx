"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

export const softEase = [0.22, 1, 0.36, 1] as [number, number, number, number];

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

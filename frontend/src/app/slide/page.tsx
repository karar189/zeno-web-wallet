import { SlideDeck } from "@/components/slides/slide-deck";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zeno Wallet · Slides",
  description: "Problem, solution, architecture, live demo and roadmap.",
};

export default function SlidePage() {
  return <SlideDeck />;
}

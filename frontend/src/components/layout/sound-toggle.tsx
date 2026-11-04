"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  isSoundEnabled,
  playSound,
  setSoundEnabled,
  subscribeSound,
} from "@/lib/sound";
import { cn } from "@/lib/utils";

export function SoundToggle({ className }: { className?: string }) {
  const enabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => true);

  return (
    <button
      type="button"
      aria-label="Interface sounds"
      aria-pressed={enabled}
      title={enabled ? "Mute interface sounds" : "Enable interface sounds"}
      onClick={() => {
        const next = !isSoundEnabled();
        setSoundEnabled(next);
        if (next) {
          playSound("success");
        }
      }}
      className={cn(
        "grid size-9 place-items-center rounded-full border border-cream/15 bg-ink text-cream/75 transition-colors hover:border-brass/40 hover:text-brass focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass",
        className,
      )}
    >
      {enabled ? (
        <Volume2 className="size-4" strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <VolumeX className="size-4" strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}

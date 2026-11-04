"use client";

import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  ArrowUpRight,
  LayoutGrid,
  Plus,
  QrCode,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const primaryActions = [
  { href: "/dashboard?wallet=1", label: "Fund", icon: Plus },
  { href: "/pay/send", label: "Send", icon: ArrowUpRight },
  { href: "/dashboard?wallet=1&view=receive", label: "Receive", icon: QrCode },
] as const;

const moreLinks = [
  { href: "/swap", label: "Trade", icon: ArrowLeftRight },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function QuickActionsRow() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="mx-auto mt-9 grid w-full max-w-[320px] grid-cols-4 gap-0 border border-[rgba(244,241,234,0.22)]">
      {primaryActions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.href}
            href={action.href}
            data-sound="nav"
            className="flex flex-col items-center gap-2 border-r border-[rgba(244,241,234,0.22)] bg-[#0a0a0a] px-2 py-3 text-center transition-colors hover:bg-[#100e0c]"
          >
            <span className="grid size-9 place-items-center border border-[rgba(244,241,234,0.22)] text-[#ffc14a]">
              <Icon className="size-[16px]" strokeWidth={1.5} />
            </span>
            <span className="text-[10px] tracking-[0.12em] text-[#8c8c8c] uppercase">
              {action.label}
            </span>
          </Link>
        );
      })}

      <div ref={rootRef} className="relative flex flex-col items-center bg-[#0a0a0a]">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
          className="icon-hit flex h-auto min-h-0 w-full flex-col items-center gap-2 px-2 py-3"
        >
          <span
            className={cn(
              "grid size-9 place-items-center border border-[rgba(244,241,234,0.22)] text-[#ffc14a]",
              open && "border-[#ffc14a]",
            )}
          >
            <LayoutGrid className="size-[16px]" strokeWidth={1.5} />
          </span>
          <span className="text-[10px] tracking-[0.12em] text-[#8c8c8c] uppercase">
            More
          </span>
        </button>

        {open ? (
          <div
            role="menu"
            className="absolute top-full z-20 mt-2 w-40 overflow-hidden border border-[rgba(244,241,234,0.22)] bg-[#0a0a0a] py-1 shadow-[0_16px_40px_rgb(0_0_0/0.55)]"
          >
            {moreLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  data-sound="nav"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-[11px] tracking-[0.1em] text-[#f7f4ef] uppercase hover:bg-[#100e0c]"
                >
                  <Icon className="size-4 text-[#ffc14a]" strokeWidth={1.6} />
                  {link.label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

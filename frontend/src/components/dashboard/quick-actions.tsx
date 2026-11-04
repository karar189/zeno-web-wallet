"use client";

import { softEase } from "@/components/motion/motion-root";
import { ArrowLeftRight, QrCode, Send, Wallet } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

const actions = [
  { label: "Send", href: "/pay/send", icon: Send },
  { label: "Receive", href: "/dashboard?wallet=1&view=receive", icon: QrCode },
  { label: "Routes", href: "/swap", icon: ArrowLeftRight },
  { label: "Wallet", href: "/dashboard?wallet=1", icon: Wallet },
] as const;

const MotionLink = motion.create(Link);

export function QuickActions() {
  return (
    <section
      aria-label="Quick actions"
      className="mt-4 grid grid-cols-2 border border-[rgba(244,241,234,0.22)] sm:grid-cols-4"
    >
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <MotionLink
            key={action.href}
            href={action.href}
            data-sound="tap"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 * index, ease: softEase }}
            className="group flex min-h-[4.75rem] flex-col items-center justify-center gap-2 border-[rgba(244,241,234,0.22)] bg-[#0a0a0a] px-2 py-3 text-center transition-colors hover:bg-[#100e0c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ffc14a] max-sm:odd:border-r sm:border-r sm:last:border-r-0 max-sm:[&:nth-child(-n+2)]:border-b"
          >
            <span className="grid size-9 place-items-center border border-[rgba(244,241,234,0.22)] text-[#ffc14a] transition-colors group-hover:border-[#ffc14a]">
              <Icon className="size-4" strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className="text-[10px] tracking-[0.14em] text-[#8c8c8c] uppercase transition-colors group-hover:text-[#f7f4ef]">
              {action.label}
            </span>
          </MotionLink>
        );
      })}
    </section>
  );
}

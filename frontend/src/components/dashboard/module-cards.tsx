"use client";

import { softEase } from "@/components/motion/motion-root";
import { motion } from "framer-motion";
import { ArrowUpRight, Eye, ShieldCheck, Sparkles, Waypoints } from "lucide-react";
import Link from "next/link";

const MotionLink = motion.create(Link);

const modules = [
  {
    label: "Payments",
    title: "Shielded payments",
    description:
      "Request, review, and authorize a shielded send, with stage-level timing.",
    href: "/pay",
    icon: ShieldCheck,
    tag: "Demo flow",
  },
  {
    label: "Routes",
    title: "Zeno Wallet Routes",
    description: "Compare supported ZEC exit routes, fees, and trust assumptions.",
    href: "/swap",
    icon: Waypoints,
    tag: "Preview",
  },
  {
    label: "Evidence",
    title: "Zeno Wallet Privacy Guard",
    description: "Evidence-based leakage analysis before you authorize a move.",
    href: "/swap",
    icon: Eye,
    tag: "Preview",
  },
  {
    label: "Insight",
    title: "Zeno Wallet Intelligence",
    description: "Liquidity, execution cost, and route dependency insights.",
    href: "/intelligence",
    icon: Sparkles,
    tag: "Preview",
  },
] as const;

export function ModuleCards() {
  return (
    <div className="grid grid-cols-1 border border-[rgba(244,241,234,0.22)] md:grid-cols-2">
      {modules.map((mod, index) => {
        const Icon = mod.icon;
        const lastCol = index % 2 === 1;
        const lastRow = index >= modules.length - 2;
        return (
          <motion.article
            key={mod.title}
            className={[
              "h-full",
              !lastCol ? "md:border-r md:border-[rgba(244,241,234,0.22)]" : "",
              !lastRow ? "border-b border-[rgba(244,241,234,0.22)]" : "max-md:border-b max-md:border-[rgba(244,241,234,0.22)]",
              index === modules.length - 1 ? "max-md:border-b-0" : "",
            ].join(" ")}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: index * 0.06, ease: softEase }}
          >
            <MotionLink
              href={mod.href}
              data-sound="nav"
              transition={{ duration: 0.18, ease: softEase }}
              className="group flex h-full min-h-0 flex-col bg-[#0a0a0a] p-6 transition-colors hover:bg-[#100e0c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ffc14a]"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center border border-[rgba(244,241,234,0.22)] text-[#ffc14a] transition-colors group-hover:border-[#ffc14a]">
                  <Icon className="size-[18px]" strokeWidth={1.5} aria-hidden="true" />
                </span>
                <span className="border border-[rgba(244,241,234,0.22)] px-2.5 py-1 text-[9px] tracking-[0.16em] text-[#8c8c8c] uppercase">
                  {mod.tag}
                </span>
              </div>

              <p className="desk-kicker mt-6">{mod.label}</p>
              <h2 className="mt-3 text-xl leading-snug tracking-[0.03em] text-[#f7f4ef] uppercase sm:text-[1.35rem]">
                {mod.title}
              </h2>
              <p className="mt-3 font-[var(--font-landing-sans),sans-serif] text-[15px] leading-relaxed tracking-normal text-[#c9c4ba] normal-case">
                {mod.description}
              </p>

              <span className="mt-auto flex items-center gap-2 pt-6 text-[11px] tracking-[0.14em] text-[#f7f4ef] uppercase transition-colors group-hover:text-[#ffc14a]">
                Open
                <ArrowUpRight
                  className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </span>
            </MotionLink>
          </motion.article>
        );
      })}
    </div>
  );
}

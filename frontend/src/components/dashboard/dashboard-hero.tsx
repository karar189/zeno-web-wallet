"use client";

import { softEase } from "@/components/motion/motion-root";
import { motion } from "framer-motion";
import { ArrowUpRight, Lock } from "lucide-react";
import Link from "next/link";

const statusRows = [
  { label: "Seed", value: "24 words · encrypted locally" },
  { label: "Network", value: "Zcash testnet · demo" },
  { label: "Broadcast", value: "Not enabled yet" },
] as const;

export function DashboardHero() {
  return (
    <section className="border border-[rgba(244,241,234,0.22)] bg-[#0a0a0a]">
      <div className="grid items-stretch gap-0 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="border-b border-[rgba(244,241,234,0.22)] p-6 sm:p-8 lg:border-r lg:border-b-0">
          <p className="desk-kicker">The desk · Zcash privacy track</p>
          <h1 className="mt-5 text-[clamp(2rem,4.5vw,3.1rem)] leading-[1.08] font-normal tracking-[0.02em] text-[#f7f4ef] uppercase">
            Private money.
            <br />
            <span className="text-[#8c8c8c]">Smarter routes.</span>
          </h1>
          <p className="mt-5 max-w-xl font-[var(--font-landing-sans),sans-serif] text-sm leading-relaxed tracking-normal text-[#c9c4ba] normal-case sm:text-[15px]">
            Compare ZEC exit routes, inspect privacy evidence, and review trust
            assumptions before you authorize a move. Live and mock figures are
            labelled on every screen.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href="/pay" data-sound="nav" className="primary-action">
              Open shielded pay
              <ArrowUpRight className="size-4" strokeWidth={1.7} />
            </Link>
            <Link href="/swap" data-sound="nav" className="secondary-action">
              Compare routes
            </Link>
          </div>

          <p className="mt-6 inline-flex items-center gap-2 border border-[rgba(244,241,234,0.22)] px-3 py-2 text-[10px] tracking-[0.16em] text-[#8c8c8c] uppercase">
            <Lock className="size-3 text-[#ffc14a]" strokeWidth={1.6} aria-hidden="true" />
            Demo ledger · no real send
          </p>
        </div>

        <motion.aside
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: softEase }}
          className="relative overflow-hidden p-6 sm:p-8"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-32deg, transparent 0 5px, rgba(255,193,74,0.1) 5px 6px)",
            }}
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="desk-kicker">Shield status</p>
                <p className="mt-3 text-xl leading-snug tracking-[0.03em] text-[#f7f4ef] uppercase sm:text-2xl">
                  Keys stay on this device.
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 border border-[#ffc14a]/50 px-2.5 py-1 text-[9px] tracking-[0.16em] text-[#ffc14a] uppercase">
                <span className="size-1.5 bg-[#ffc14a]" aria-hidden="true" />
                Private
              </span>
            </div>

            <dl className="mt-6 space-y-0 font-[var(--font-landing-sans),sans-serif] text-sm tracking-normal normal-case">
              {statusRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 border-t border-[rgba(244,241,234,0.22)] py-3"
                >
                  <dt className="text-xs tracking-[0.12em] text-[#8c8c8c] uppercase">
                    {row.label}
                  </dt>
                  <dd className="text-right text-[#f7f4ef]/90">{row.value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-5 font-[var(--font-landing-sans),sans-serif] text-sm leading-relaxed tracking-normal text-[#c9c4ba] normal-case">
              No server custody. The seed never leaves this browser, and broadcast
              stays disabled until a verified wallet library is connected.
            </p>

            <Link
              href="/wallet"
              data-sound="tap"
              className="group mt-5 inline-flex items-center gap-2 text-[11px] tracking-[0.14em] text-[#ffc14a] uppercase transition-colors hover:text-[#f7f4ef]"
            >
              Open wallet
              <ArrowUpRight
                className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={1.7}
                aria-hidden="true"
              />
            </Link>
          </div>
        </motion.aside>
      </div>
    </section>
  );
}

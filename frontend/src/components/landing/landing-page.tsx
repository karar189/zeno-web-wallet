"use client";

import { ZenoMark } from "@/components/brand/zeno-mark";
import { EncryptionBeam } from "@/components/landing/encryption-beam";
import { LandingCursor } from "@/components/landing/landing-cursor";
import { Magnetic, Marquee, ScrambleText, ScrollProgress } from "@/components/landing/landing-fx";
import {
  Architecture,
  FeatureBento,
  HeroLede,
  HowItWorks,
  InstantSyncSection,
  LedgerSection,
  Roadmap,
} from "@/components/landing/landing-sections";
import "@/components/landing/landing-sections.css";
import { softEase } from "@/components/motion/motion-root";
import Hero62 from "@/components/originkit/hero-62";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const TICKER_A = [
  "Shielded by default",
  "Signed on your machine",
  "Pay alice.zcash",
  "Viewing-key audits",
  "Opens instantly",
  "Privacy review before every payment",
] as const;
const TICKER_B = [
  "Orchard",
  "Unified addresses",
  "ZIP 317 fees",
  "Loopback only",
  "Ironwood ready",
  "No seed leaves the machine",
] as const;

const rise = {
  hidden: { opacity: 0, y: 32 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: softEase } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.04 } },
};

const examples = {
  shielded: {
    label: "Shielded payment",
    status: "Shielded on-chain",
    rows: [
      ["Recipient & amount", "Hidden on-chain"],
      ["Swap provider", "Not involved"],
      ["Network metadata", "May be observable"],
    ],
    detail:
      "Shielded transfers protect payment details on-chain. Your network connection can still reveal metadata.",
  },
  route: {
    label: "Cross-chain route",
    status: "Public boundary",
    rows: [
      ["ZEC deposit", "Transparent address"],
      ["Swap provider", "Sees swap details"],
      ["Destination chain", "Public activity"],
    ],
    detail:
      "A cross-chain route has different privacy boundaries. Zeno shows you these before you ever use one; swaps are not part of this testnet build.",
  },
} as const;

export function LandingPage() {
  const [mode, setMode] = useState<keyof typeof examples>("shielded");
  const example = examples[mode];
  return (
    <div className="zeno-landing" id="top">
      <ScrollProgress />
      <LandingCursor />
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <main id="landing-main">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: softEase }}
        >
          <div className="hero-wrap">
            <Hero62 />
            <HeroLede />
          </div>
        </motion.div>

        <Marquee items={TICKER_A} />

        <LedgerSection />

        <EncryptionBeam />

        <motion.section
          id="privacy"
          className="landing-privacy"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger}
        >
          <motion.div className="section-copy" variants={rise}>
            <span className="instrument-label">Understand before you authorize</span>
            <h2>
              Privacy isn’t a badge.
              <br />
              <span>It’s what others can see.</span>
            </h2>
            <p>
              A private payment and a cross-chain swap expose different
              information. Know the difference before you approve.
            </p>
            <a href="/pay/send" className="text-link">
              Prepare a payment <ArrowUpRight size={17} />
            </a>
          </motion.div>
          <motion.div className="privacy-demo" variants={rise}>
            <div className="demo-heading">
              <span className="instrument-label">Visibility preview</span>
              <span>Illustration</span>
            </div>
            <div className="demo-toggle" role="group" aria-label="Compare payment privacy">
              {(Object.keys(examples) as (keyof typeof examples)[]).map((key) => (
                <button key={key} onClick={() => setMode(key)} aria-pressed={mode === key}>
                  {examples[key].label}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                aria-live="polite"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: softEase }}
              >
                <div className={`demo-status ${mode}`}>
                  <span className="status-dot" />
                  {example.status}
                </div>
                <dl>
                  {example.rows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>{example.detail}</p>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.section>

        <HowItWorks />

        <InstantSyncSection />

        <FeatureBento />

        <Marquee items={TICKER_B} reverse />

        <Architecture />

        <Roadmap />

        <motion.section
          className="landing-close"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
          variants={stagger}
        >
          <motion.span className="instrument-label" variants={rise}>
            Your next move
          </motion.span>
          <motion.h2 variants={rise}>
            <ScrambleText text="Make it deliberate." duration={1100} />
          </motion.h2>
          <motion.div variants={rise}>
            <Magnetic>
              <Link href="/dashboard" className="solid-action is-large">
                Open your wallet <ArrowUpRight size={20} />
              </Link>
            </Magnetic>
          </motion.div>
          <motion.p variants={rise}>
            Zcash testnet. Funds have no monetary value.
          </motion.p>
        </motion.section>
      </main>
      <motion.footer
        className="landing-footer"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: softEase }}
      >
        <Link href="/" className="landing-footer-logo" aria-label="Zeno Wallet home">
          <ZenoMark />
        </Link>
        <span>Private money. Informed moves.</span>
        <span className="landing-footer-credit">
          Built for the Free Society Hackathon, India ·{" "}
          <a href="https://github.com/karar189/zeno" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </span>
        <a href="#top">Back to top ↑</a>
      </motion.footer>
    </div>
  );
}

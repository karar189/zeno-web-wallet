"use client";

import { ZenoMark } from "@/components/brand/zeno-mark";
import { ScrambleText } from "@/components/landing/landing-fx";
import { softEase } from "@/components/motion/motion-root";
import ChromaticDrift from "@/components/originkit/ui/hero-62/chromatic-drift";
import { GRID_ROWS, GRID_SKIP, T, gridSvg } from "@/components/originkit/ui/hero-62/hero-62-hero";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, Maximize2, Play } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import "./slide-deck.css";

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: softEase } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

/* ───────────────────────── 00 Cover (landing hero) ───────────────────────── */

// Same tile band and Chromatic Drift as the landing hero, sized by aspect ratio instead of a ResizeObserver.
const COVER_VIEW = `0 ${GRID_SKIP * T} ${12 * T} ${GRID_ROWS * T}`;
const COVER_GRID = gridSvg("#8a8a8a", false, GRID_SKIP + GRID_ROWS);
const COVER_MASK = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${COVER_VIEW}">${gridSvg("#fff", true, GRID_SKIP + GRID_ROWS)}</svg>`,
)}")`;

function CoverSlide() {
  return (
    <>
      <motion.div className="cv-top" variants={rise}>
        <span>Free Society Hack 2026 · Mumbai</span>
        <span className="cv-mark">
          <ZenoMark />
        </span>
        <span>Privacy track · Zcash testnet</span>
      </motion.div>

      <h1 className="cv-title">
        <motion.span variants={rise}>Shielded ZEC.</motion.span>
        <motion.span variants={rise}>Opens instantly.</motion.span>
        <motion.span variants={rise}>Keys stay home.</motion.span>
      </h1>

      <motion.div className="cv-lede" variants={rise}>
        <p>
          The instant shielded Zcash wallet. It shows you <em>exactly what others can see</em>{" "}
          before you pay, and signs on your own machine.
        </p>
        <span className="cv-by">[ Sweta Karar · ArcGenesis Labs ]</span>
      </motion.div>

      <div className="cv-band" aria-hidden="true">
        <div className="cv-drift" style={{ WebkitMaskImage: COVER_MASK, maskImage: COVER_MASK }}>
          <ChromaticDrift
            speed={30}
            background="#140E08"
            baseColor="#E8941A"
            accentColor="#FF7A18"
            advanced={{
              driftPct: 24,
              wobbleRate: 300,
              pink: "#FFE566",
              lilac: "#FFC14A",
              coral: "#FF8C2A",
              maroon: "#8C2E08",
              indigo: "#3D1A08",
              violet: "#FFB020",
              botLight: "#FFF1B8",
              botBlue: "#FFD56A",
              botEmber: "#F06A12",
              botRed: "#C2410C",
              botWine: "#4A1C08",
              botPurple: "#E8941A",
              topTint: "#FFB000",
              floorColor: "#6B2408",
            }}
          />
        </div>
        <svg
          className="cv-grid"
          viewBox={COVER_VIEW}
          preserveAspectRatio="xMinYMin meet"
          dangerouslySetInnerHTML={{ __html: COVER_GRID }}
        />
      </div>
    </>
  );
}

/* ───────────────────────── 01 Problem ───────────────────────── */

function ProblemSlide() {
  return (
    <>
      <motion.span className="sd-label" variants={rise}>
        01 · The problem
      </motion.span>
      <motion.h1 variants={rise}>
        NU7 makes Zcash 3× faster.
        <br />
        <span>Private wallets get 3× slower.</span>
      </motion.h1>

      <motion.div className="sd-stats" variants={rise}>
        <div>
          <strong>
            75s <i>→</i> 25s
          </strong>
          <small>Block time after NU7</small>
        </div>
        <div>
          <strong>3×</strong>
          <small>More blocks every wallet must scan</small>
        </div>
        <div>
          <strong>Every block</strong>
          <small>Trial-decrypted on your own device</small>
        </div>
      </motion.div>

      <motion.div className="sd-cards" variants={stagger}>
        <ProblemCard index="A" title="Sync falls behind">
          A shielded wallet has to look at every block to find its notes. Three times the
          blocks means the wallet you open is three times further behind.
        </ProblemCard>
        <ProblemCard index="B" title="Fast sync = trust a server">
          Hosted scanners fix the speed by taking your viewing key: every shielded payment
          you ever made, readable by whoever runs the box.
        </ProblemCard>
        <ProblemCard index="C" title="Metadata still leaks">
          lightwalletd sees your IP and timing. Swaps cross a public boundary. Users are
          rarely shown either before they approve.
        </ProblemCard>
      </motion.div>
    </>
  );
}

function ProblemCard({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <motion.article className="sd-card" variants={rise}>
      <span className="sd-index">{index}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </motion.article>
  );
}

/* ───────────────────────── 02 Solution ───────────────────────── */

const PILLARS = [
  {
    tag: "TEE",
    title: "Attested Instant Sync",
    what: "Scanning runs inside an AWS Nitro Enclave. Your browser checks a fresh attestation against our reproducible build, then seals the viewing key to a key that only exists in that enclave.",
    why: "Fast sync without blind trust: the server operator only ever holds ciphertext.",
  },
  {
    tag: "Local",
    title: "Keys stay home",
    what: "The seed is decrypted, proofs are built and transactions are signed by a wallet service bound to 127.0.0.1 on your machine.",
    why: "Nothing that can spend your money ever leaves your computer.",
  },
  {
    tag: "Nym",
    title: "Mixnet for the network",
    what: "Wallet traffic to lightwalletd is routed through the Nym mixnet.",
    why: "The server can’t tie your IP address to your wallet or your payments.",
  },
  {
    tag: "Review",
    title: "Privacy review, every payment",
    what: "Before you approve, Zeno shows who can see what: shielded transfer, swap provider, destination chain.",
    why: "People decide with facts, not with a “private” badge.",
  },
] as const;

function SolutionSlide() {
  return (
    <>
      <motion.span className="sd-label" variants={rise}>
        02 · The solution
      </motion.span>
      <motion.h1 variants={rise}>
        Speed without trust.
        <br />
        <span>Zeno verifies first, then shares.</span>
      </motion.h1>

      <motion.div className="sd-pillars" variants={stagger}>
        {PILLARS.map((p, i) => (
          <motion.article key={p.title} className="sd-pillar" variants={rise}>
            <header>
              <span className="sd-index">0{i + 1}</span>
              <span className={`sd-tag${i === 0 ? " is-hot" : ""}`}>{p.tag}</span>
            </header>
            <h3>{p.title}</h3>
            <p>{p.what}</p>
            <p className="sd-why">
              <b>Why it matters</b>
              {p.why}
            </p>
          </motion.article>
        ))}
      </motion.div>

      <motion.p className="sd-foot" variants={rise}>
        <b>Why the architecture matters:</b> every part sees only what it needs. The one part
        that sees more, the sync enclave, has to prove exactly what code it runs before it gets
        anything.
      </motion.p>
    </>
  );
}

/* ───────────────────────── 03 Architecture ───────────────────────── */

function Block({
  index,
  name,
  where,
  sees,
  tone = "remote",
  badge,
  className = "",
}: {
  index: string;
  name: string;
  where: string;
  sees: string;
  tone?: "local" | "remote" | "tee";
  badge?: string;
  className?: string;
}) {
  return (
    <motion.div className={`df-block is-${tone} ${className}`} variants={rise}>
      <div className="df-block-top">
        <span className="sd-index">{index}</span>
        {badge ? <span className={`sd-tag${tone === "tee" ? " is-hot" : ""}`}>{badge}</span> : null}
      </div>
      <strong>{name}</strong>
      <small>{where}</small>
      <p>{sees}</p>
    </motion.div>
  );
}

function Flow({
  label,
  back,
  tone = "plain",
  className = "",
}: {
  label: string;
  back?: string;
  tone?: "plain" | "sealed";
  className?: string;
}) {
  return (
    <motion.div className={`df-flow is-${tone} ${className}`} variants={rise} aria-hidden="true">
      <span className="df-flow-label">{label}</span>
      <span className="df-line">
        <i />
      </span>
      {back ? (
        <>
          <span className="df-line is-back">
            <i />
          </span>
          <span className="df-flow-label is-back">{back}</span>
        </>
      ) : null}
    </motion.div>
  );
}

function ArchitectureSlide() {
  return (
    <>
      <motion.span className="sd-label" variants={rise}>
        03 · Architecture · data flow
      </motion.span>
      <motion.h1 variants={rise} className="is-compact">
        Who sees what.
      </motion.h1>

      <motion.div className="df" variants={stagger}>
        <div className="df-zone is-local" aria-hidden="true">
          <span>Your machine</span>
        </div>
        <div className="df-zone is-remote" aria-hidden="true">
          <span>The internet</span>
        </div>

        <span className="df-row-label df-r1">Pay</span>
        <span className="df-row-label df-r3">Sync</span>

        <Block
          className="df-ui"
          tone="local"
          index="01"
          name="Zeno UI"
          where="Your browser"
          sees="Shows balances, runs the privacy review, verifies the enclave"
        />
        <Flow className="df-a1" label="payment intent" />
        <Block
          className="df-svc"
          tone="local"
          index="02"
          name="Wallet service"
          where="127.0.0.1 only"
          sees="Holds the seed, builds proofs, signs"
          badge="Keys"
        />
        <Flow className="df-a2" label={"signed\nshielded tx"} />
        <Block
          className="df-nym"
          index="03"
          name="Nym mixnet"
          where="SOCKS5 proxy"
          sees="Hides your IP and timing"
          badge="Nym"
        />
        <Flow className="df-a3" label="no IP" />
        <Block
          className="df-lwd"
          index="04"
          name="lightwalletd"
          where="Remote server"
          sees="Signed bytes only, never keys"
        />
        <Flow className="df-a4" label="broadcast" />
        <Block
          className="df-chain"
          index="05"
          name="Zcash network"
          where="Public chain"
          sees="That a shielded tx happened, and the fee"
        />

        <motion.div className="df-down" variants={rise} aria-hidden="true">
          <span className="df-vline">
            <i />
          </span>
          <span className="df-flow-label">compact blocks</span>
        </motion.div>

        <Flow
          className="df-a5"
          tone="sealed"
          label="① verify attestation  ② sealed viewing key"
          back="③ encrypted balance & history"
        />
        <Block
          className="df-tee"
          tone="tee"
          index="06"
          name="Instant Sync enclave"
          where="AWS Nitro Enclave · opt-in"
          sees="Scans blocks with your viewing key, in sealed memory"
          badge="TEE"
        />
        <motion.div className="df-host" variants={rise}>
          <b>Host &amp; AWS</b>
          <span>See ciphertext only. No spending key, ever.</span>
        </motion.div>
      </motion.div>

      <motion.div className="df-legend" variants={rise}>
        <span>
          <i className="is-local" /> Stays on your device
        </span>
        <span>
          <i className="is-sealed" /> Encrypted end to end to the enclave
        </span>
        <span>
          <i className="is-remote" /> Public or untrusted
        </span>
      </motion.div>
    </>
  );
}

/* ───────────────────────── 04 Live demo ───────────────────────── */

const DEMO_VIDEO_URL = "https://youtu.be/7cVKc9kGye4";

function DemoSlide() {
  return (
    <div className="sd-demo">
      <motion.span className="sd-label" variants={rise}>
        04 · Live demo
      </motion.span>
      <motion.h1 variants={rise} className="is-huge">
        <ScrambleText text="Live demo." duration={1100} />
      </motion.h1>
      <motion.p variants={rise}>Zcash testnet · real shielded transactions</motion.p>
      <motion.a
        className="sd-video"
        href={DEMO_VIDEO_URL}
        target="_blank"
        rel="noopener noreferrer"
        variants={rise}
      >
        <span className="sd-video-play" aria-hidden="true">
          <Play size={14} fill="currentColor" />
        </span>
        <span className="sd-video-text">
          <b>Watch the recorded demo</b>
          <small>youtu.be/7cVKc9kGye4</small>
        </span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </motion.a>
    </div>
  );
}

/* ───────────────────────── 05 Roadmap ───────────────────────── */

const STAGES = [
  {
    when: "Next",
    status: "In progress",
    title: "Attested launch",
    items: [
      "First attested enclave deployment, PCRs published",
      "Nym path tested on the live mixnet",
      "Security audit and response padding",
    ],
    learns: "Your history, but only inside a verified enclave",
  },
  {
    when: "Then",
    status: "Planned",
    title: "Share less, spend fast",
    items: [
      "Incoming-only key mode: the server can’t see spends",
      "PCZT spending: the server builds the tx, your device proves and signs",
    ],
    learns: "Incoming payments only",
  },
  {
    when: "Scale",
    status: "Planned",
    title: "Every Zcash wallet",
    items: ["Open-source Instant Sync SDK for other wallets", "Mainnet beta"],
    learns: "The same guarantees, in any wallet",
  },
  {
    when: "End state",
    status: "Tachyon",
    title: "Oblivious sync",
    items: [
      "When Tachyon ships, the server syncs blind",
      "It never learns which notes are yours",
    ],
    learns: "Nothing about your notes",
  },
] as const;

function RoadmapSlide() {
  return (
    <>
      <motion.span className="sd-label" variants={rise}>
        05 · Roadmap
      </motion.span>
      <motion.h1 variants={rise}>
        Instant today.
        <br />
        <span>Trustless next.</span>
      </motion.h1>

      <motion.div className="rm" variants={stagger}>
        {STAGES.map((s, i) => (
          <motion.div key={s.title} className={`rm-stage${i === STAGES.length - 1 ? " is-end" : ""}`} variants={rise}>
            <div className="rm-track" aria-hidden="true">
              <span className="rm-dot" />
              <span className="rm-when">{s.when}</span>
            </div>
            <article className="rm-card">
              <header>
                <span className="sd-index">0{i + 1}</span>
                <span className={`sd-tag${i === STAGES.length - 1 ? " is-hot" : ""}`}>{s.status}</span>
              </header>
              <h3>{s.title}</h3>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="sd-why">
                <b>Sync server learns</b>
                {s.learns}
              </p>
            </article>
          </motion.div>
        ))}
      </motion.div>

      <motion.p className="sd-foot" variants={rise}>
        <b>One rule never changes:</b> spending keys stay on your device, at every stage.
      </motion.p>
    </>
  );
}

/* ───────────────────────── Deck ───────────────────────── */

const SLIDES = [
  { key: "cover", title: "Zeno", Body: CoverSlide },
  { key: "problem", title: "Problem", Body: ProblemSlide },
  { key: "solution", title: "Solution", Body: SolutionSlide },
  { key: "architecture", title: "Architecture", Body: ArchitectureSlide },
  { key: "demo", title: "Live demo", Body: DemoSlide },
  { key: "roadmap", title: "Roadmap", Body: RoadmapSlide },
] as const;

function indexFromHash(): number {
  if (typeof window === "undefined") return 0;
  const n = Number.parseInt(window.location.hash.replace("#", ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= SLIDES.length ? n - 1 : 0;
}

export function SlideDeck() {
  // null until the hash is read, so /slide#3 opens on slide 3 without flashing slide 1.
  const [index, setIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    const sync = () => setIndex(indexFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(SLIDES.length - 1, next));
    setIndex((current) => {
      setDirection(clamped >= (current ?? 0) ? 1 : -1);
      return clamped;
    });
    window.history.replaceState(null, "", `#${clamped + 1}`);
  }, []);

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }, []);

  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Let Enter/Space activate a focused link or button (e.g. the demo video) instead of advancing.
      if ((event.key === "Enter" || event.key === " ") && (event.target as HTMLElement).closest?.("a, button")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(event.key)) {
        event.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === "Home") go(0);
      else if (event.key === "End") go(SLIDES.length - 1);
      else if (event.key === "f" || event.key === "F") fullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, fullscreen]);

  if (index === null) return <div className="slide-deck" />;
  const slide = SLIDES[index];
  const Body = slide.Body;

  return (
    <div className="slide-deck">
      <div className="sd-stage">
        <div className="sd-progress" style={{ transform: `scaleX(${(index + 1) / SLIDES.length})` }} />
        <AnimatePresence mode="wait" custom={direction}>
          <motion.section
            key={slide.key}
            className={`sd-slide is-${slide.key}`}
            aria-label={`${slide.title}, slide ${index + 1} of ${SLIDES.length}`}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, x: -40 * direction, transition: { duration: 0.3, ease: softEase } }}
            variants={stagger}
          >
            <Body />
          </motion.section>
        </AnimatePresence>

        <footer className="sd-bar">
          <span className="sd-brand">
            <ZenoMark />
          </span>
          <nav className="sd-dots" aria-label="Slides">
            {SLIDES.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-current={i === index ? "step" : undefined}
                onClick={() => go(i)}
              >
                <span>0{i}</span>
                {s.title}
              </button>
            ))}
          </nav>
          <span className="sd-controls">
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous slide">
              <ArrowLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              disabled={index === SLIDES.length - 1}
              aria-label="Next slide"
            >
              <ArrowRight size={14} />
            </button>
            <button type="button" onClick={fullscreen} aria-label="Toggle full screen (F)">
              <Maximize2 size={13} />
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}

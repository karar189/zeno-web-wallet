"use client";

import { Magnetic, ScrambleText, SpotlightCard } from "@/components/landing/landing-fx";
import { softEase } from "@/components/motion/motion-root";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  ArrowUpRight,
  AtSign,
  Check,
  Eye,
  KeyRound,
  LockKeyhole,
  Radio,
  Route,
  Shield,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const rise = {
  hidden: { opacity: 0, y: 36 },
  show: { opacity: 1, y: 0, transition: { duration: 0.75, ease: softEase } },
};
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

/* Deterministic pseudo-ciphertext so server and client render the same thing. */
function cipher(seed: string, length: number): string {
  const hex = "0123456789abcdef";
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let out = "";
  for (let i = 0; i < length; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    out += hex[(h >>> 0) % 16];
  }
  return out;
}

/* ───────────────────────── Hero lede (sits under the hero) ───────────────────────── */

export function HeroLede() {
  return (
    <motion.div
      className="hero-lede"
      initial="hidden"
      animate="show"
      variants={stagger}
    >
      <motion.p variants={rise}>
        A Zcash wallet that shows you <em>exactly what others can see</em> before
        you pay. Shielded by default. Signed on your machine. Opens instantly.
      </motion.p>
      <motion.div className="hero-lede-actions" variants={rise}>
        <Magnetic>
          <Link href="/dashboard" className="solid-action">
            Open wallet <ArrowUpRight size={18} />
          </Link>
        </Magnetic>
        <a href="#how" className="ghost-action">
          See how it works
        </a>
      </motion.div>
    </motion.div>
  );
}

/* ───────────────────────── 1. The public ledger problem ───────────────────────── */

const LEDGER = [
  { from: "t1Rv7…kQ2m", to: "t1Hc4…9xPa", amount: "12.40 ZEC", memo: "rent — flat 3B" },
  { from: "t1Hc4…9xPa", to: "t1Lm2…a8Vd", amount: "0.85 ZEC", memo: "clinic visit" },
  { from: "t3Pq9…eW1z", to: "t1Rv7…kQ2m", amount: "250.00 ZEC", memo: "salary — oct" },
  { from: "t1Lm2…a8Vd", to: "t1Zt6…c3Nb", amount: "3.10 ZEC", memo: "donation" },
  { from: "t1Zt6…c3Nb", to: "t3Pq9…eW1z", amount: "41.75 ZEC", memo: "invoice #2207" },
  { from: "t1Rv7…kQ2m", to: "t1Bf8…u5Ks", amount: "0.20 ZEC", memo: "coffee" },
] as const;

export function LedgerSection() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.75", "end 0.55"] });
  const [scrolled, setShielded] = useState(0);
  const shielded = reduce ? LEDGER.length : scrolled;
  const sweep = useTransform(scrollYProgress, [0.1, 0.85], ["0%", "100%"]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    const next = Math.max(0, Math.min(LEDGER.length, Math.floor(((p - 0.1) / 0.75) * (LEDGER.length + 0.5))));
    setShielded(next);
  });
  return (
    <section ref={ref} id="problem" className="landing-ledger">
      <motion.div
        className="ledger-copy"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger}
      >
        <motion.span className="instrument-label" variants={rise}>
          The problem
        </motion.span>
        <motion.h2 variants={rise}>
          On a public chain,
          <br />
          <span>every payment is a postcard.</span>
        </motion.h2>
        <motion.p variants={rise}>
          Who paid whom, how much, and how often stays on a public record forever.
          Your landlord, your doctor, your salary. Shielded Zcash encrypts the
          sender, recipient, amount, and memo. Scroll to shield the ledger.
        </motion.p>
        <motion.div className="ledger-counter" variants={rise}>
          <span className="ledger-counter-num">
            {String(shielded).padStart(2, "0")}
            <small>/{String(LEDGER.length).padStart(2, "0")}</small>
          </span>
          <span className="instrument-label">payments shielded</span>
        </motion.div>
      </motion.div>

      <div className="ledger-table" role="table" aria-label="Illustrative public ledger">
        <div className="ledger-head" role="row">
          <span role="columnheader">From</span>
          <span role="columnheader">To</span>
          <span role="columnheader">Amount</span>
          <span role="columnheader">Memo</span>
        </div>
        {LEDGER.map((row, i) => {
          const hidden = i < shielded;
          const key = `${row.from}${row.to}${row.amount}`;
          return (
            <div key={key} className={`ledger-row${hidden ? " is-shielded" : ""}`} role="row">
              {(["from", "to", "amount", "memo"] as const).map((field, j) => (
                <span key={field} role="cell" className="ledger-cell">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={hidden ? "c" : "p"}
                      initial={{ opacity: 0, filter: "blur(6px)" }}
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      exit={{ opacity: 0, filter: "blur(6px)" }}
                      transition={{ duration: 0.35, delay: j * 0.04 }}
                    >
                      {hidden ? cipher(key + field, field === "memo" ? 14 : 10) : row[field]}
                    </motion.span>
                  </AnimatePresence>
                </span>
              ))}
              <span className="ledger-lock" aria-hidden="true">
                {hidden ? <LockKeyhole size={13} /> : <Eye size={13} />}
              </span>
            </div>
          );
        })}
        <motion.div className="ledger-sweep" style={{ height: sweep }} aria-hidden="true" />
        <span className="ledger-note">Illustration. Addresses and amounts are made up.</span>
      </div>
    </section>
  );
}

/* ───────────────────────── 2. How it works (sticky device) ───────────────────────── */

const STEPS = [
  {
    key: "vault",
    label: "01 / Create",
    title: "Lock your keys at home.",
    body:
      "Create a wallet and set a password. The seed is encrypted into a vault in your browser and only decrypted by the wallet service on this machine while unlocked.",
  },
  {
    key: "fund",
    label: "02 / Fund",
    title: "Receive to a shielded address.",
    body:
      "Your default address is a shielded unified address. Fund it from the testnet faucet, or pay in to it by Zcash name. A transparent address exists, and it is labeled public.",
  },
  {
    key: "review",
    label: "03 / Review",
    title: "See what leaks before you sign.",
    body:
      "Every payment gets a privacy review: shielded receiver, swap provider involvement, fee, and what your network connection can still reveal. Requirements are checked again at approval.",
  },
  {
    key: "send",
    label: "04 / Approve",
    title: "Prove, sign, broadcast. Locally.",
    body:
      "The wallet service builds the proof and signs on your machine, then hands the bytes to lightwalletd. Acceptance and confirmation are tracked separately, so you never mistake one for the other.",
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function DeviceScreen({ step }: { step: StepKey }) {
  if (step === "vault") {
    return (
      <div className="screen screen-vault">
        <span className="screen-label">Recovery phrase</span>
        <div className="seed-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i }}
            >
              <small>{i + 1}</small>
              {cipher(`w${i}`, 5)}
            </motion.span>
          ))}
        </div>
        <div className="screen-field">
          <KeyRound size={14} /> ••••••••••••
        </div>
        <motion.div
          className="screen-pill is-good"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.6, type: "spring", stiffness: 300, damping: 18 }}
        >
          <LockKeyhole size={13} /> Vault encrypted
        </motion.div>
      </div>
    );
  }
  if (step === "fund") {
    return (
      <div className="screen screen-fund">
        <span className="screen-label">Shielded address</span>
        <div className="fake-qr" aria-hidden="true">
          {Array.from({ length: 121 }, (_, i) => {
            const on = parseInt(cipher(`q${i}`, 1), 16) > 6;
            const corner =
              (i % 11 < 3 && Math.floor(i / 11) < 3) ||
              (i % 11 > 7 && Math.floor(i / 11) < 3) ||
              (i % 11 < 3 && Math.floor(i / 11) > 7);
            return (
              <motion.i
                key={i}
                className={on || corner ? "on" : ""}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: (i % 11) * 0.02 + Math.floor(i / 11) * 0.02 }}
              />
            );
          })}
        </div>
        <code className="screen-addr">utest1{cipher("addr", 18)}…</code>
        <motion.div
          className="screen-balance"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          <span>Incoming</span>
          <strong>+1.0000 TAZ</strong>
        </motion.div>
      </div>
    );
  }
  if (step === "review") {
    const checks = [
      { label: "Shielded receiver", value: "Required", ok: true },
      { label: "Swap provider", value: "Not involved", ok: true },
      { label: "Fee (ZIP 317)", value: "0.0001", ok: true },
      { label: "Network metadata", value: "May be visible", ok: false },
    ];
    return (
      <div className="screen screen-review">
        <span className="screen-label">Privacy review</span>
        <div className="review-to">
          <AtSign size={14} /> alice.zcash <span>→ u1…</span>
        </div>
        <ul>
          {checks.map((c, i) => (
            <motion.li
              key={c.label}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.12 * i, ease: softEase }}
              className={c.ok ? "" : "is-warn"}
            >
              {c.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
              <span>{c.label}</span>
              <b>{c.value}</b>
            </motion.li>
          ))}
        </ul>
        <div className="screen-cta">Approve payment</div>
      </div>
    );
  }
  const stages = ["Prepare", "Prove", "Sign", "Broadcast"];
  return (
    <div className="screen screen-send">
      <span className="screen-label">Sending 0.5 TAZ</span>
      <ol>
        {stages.map((s, i) => (
          <motion.li
            key={s}
            initial={{ opacity: 0.25 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 * i }}
          >
            <motion.span
              className="stage-dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.35 * i + 0.1, type: "spring", stiffness: 380, damping: 16 }}
            >
              <Check size={11} />
            </motion.span>
            {s}
            <small>on this machine{i === 3 ? " → lightwalletd" : ""}</small>
          </motion.li>
        ))}
      </ol>
      <motion.code
        className="screen-addr"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5 }}
      >
        txid {cipher("txid", 20)}…
      </motion.code>
      <motion.div
        className="screen-pill"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.7 }}
      >
        <Radio size={13} /> Accepted · awaiting confirmation
      </motion.div>
    </div>
  );
}

export function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const fill = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length))));
  });

  return (
    <section ref={ref} id="how" className="landing-how" style={{ ["--steps" as string]: STEPS.length }}>
      <div className="how-sticky">
        <div className="how-copy">
          <span className="instrument-label">How it works</span>
          <h2>
            Four steps.
            <br />
            <span>Zero guesswork.</span>
          </h2>
          <div className="how-rail" aria-hidden="true">
            <motion.span style={{ height: fill }} />
          </div>
          <ol className="how-steps">
            {STEPS.map((s, i) => (
              <li key={s.key} className={i === active ? "is-active" : i < active ? "is-done" : ""}>
                <span className="how-step-label">{s.label}</span>
                <h3>{s.title}</h3>
                <AnimatePresence initial={false}>
                  {i === active && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.45, ease: softEase }}
                    >
                      {s.body}
                    </motion.p>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ol>
        </div>
        <div className="how-device-wrap">
          <div className="how-glow" aria-hidden="true" />
          <div className="how-device">
            <div className="device-notch" aria-hidden="true" />
            <div className="device-bar">
              <span>ZENO</span>
              <span className="device-net">
                <i /> testnet
              </span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={STEPS[active].key}
                className="device-body"
                initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -24, filter: "blur(8px)" }}
                transition={{ duration: 0.45, ease: softEase }}
              >
                <DeviceScreen step={STEPS[active].key} />
              </motion.div>
            </AnimatePresence>
          </div>
          <span className="how-device-caption">Illustration of the app flow</span>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Instant Sync race ───────────────────────── */

const LOCAL_MS = 6000; // illustrative; real catch-up depends on how far behind the wallet is

export function InstantSyncSection() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setStarted(true);
        io.disconnect();
      }
    }, { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const ms = reduce ? LOCAL_MS : performance.now() - t0;
      setElapsed(Math.min(ms, LOCAL_MS));
      if (ms >= LOCAL_MS) window.clearInterval(id);
    }, 50);
    return () => window.clearInterval(id);
  }, [started, run, reduce]);

  const localDone = elapsed >= LOCAL_MS;
  const pct = Math.round((elapsed / LOCAL_MS) * 100);

  return (
    <section ref={ref} id="instant" className="landing-instant">
      <motion.div
        className="instant-head"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger}
      >
        <motion.span className="instrument-label" variants={rise}>
          Instant Sync · opt-in
        </motion.span>
        <motion.h2 variants={rise}>
          Shielded wallets are slow to open.
          <br />
          <span>Zeno isn&apos;t.</span>
        </motion.h2>
        <motion.p variants={rise}>
          A light wallet has to scan the chain before it can show a balance. With Instant Sync
          on, a server keeps your viewing key synced, so the wallet opens with your balance already
          there. Your spending key never leaves your machine, and local sync still decides what you
          can spend.
        </motion.p>
      </motion.div>

      <div className="instant-race">
        <div className={`race-card${localDone ? " is-done" : ""}`}>
          <div className="race-top">
            <span>Instant Sync off</span>
            <span className="race-time">{(elapsed / 1000).toFixed(1)}s</span>
          </div>
          <div className="race-balance">
            {localDone ? "0.78975" : cipher(`l${Math.floor(elapsed / 120)}`, 7)}
            <small>TAZ</small>
          </div>
          <div className="race-progress" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="race-note">
            {localDone ? "Synced · local" : `Scanning compact blocks… ${pct}%`}
          </p>
        </div>

        <div className="race-card is-instant is-done">
          <div className="race-top">
            <span>Instant Sync on</span>
            <span className="race-time">0.0s</span>
          </div>
          <div className="race-balance">
            0.78975<small>TAZ</small>
          </div>
          <div className="race-ironwood">
            <span>Ironwood</span>
            <b>0.78975</b>
          </div>
          <p className="race-note is-good">
            Synced in 0.0s · instant {localDone ? "· verified locally" : "· verifying locally…"}
          </p>
        </div>
      </div>

      <div className="instant-foot">
        <button
          type="button"
          className="ghost-action"
          onClick={() => {
            setElapsed(0);
            setRun((n) => n + 1);
          }}
        >
          Replay
        </button>
        <dl className="instant-facts">
          <div>
            <dt>41.7 s</dt>
            <dd>first server sync, demo wallet, testnet</dd>
          </div>
          <div>
            <dt>~2 ms</dt>
            <dd>to read cached state after that</dd>
          </div>
          <div>
            <dt>0</dt>
            <dd>spending keys on the server</dd>
          </div>
        </dl>
        <span className="instant-caption">
          Race is an illustration. Measured numbers are from the demo wallet on public testnet.
        </span>
      </div>
    </section>
  );
}

/* ───────────────────────── 3. Feature bento ───────────────────────── */

function NameVisual() {
  const reduce = useReducedMotion();
  const full = "alice.zcash";
  const [n, setN] = useState(reduce ? full.length : 0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setN((v) => (v >= full.length + 8 ? 0 : v + 1)), 140);
    return () => clearInterval(id);
  }, [reduce]);
  const typed = full.slice(0, Math.min(n, full.length));
  const resolved = n >= full.length + 1;
  return (
    <div className="viz-name">
      <div className="viz-input">
        <AtSign size={14} />
        {typed}
        <span className="caret" />
      </div>
      <div className={`viz-resolve${resolved ? " is-on" : ""}`}>
        <Check size={12} /> u1{cipher("alice", 10)}…
      </div>
    </div>
  );
}

function ShieldVisual() {
  return (
    <div className="viz-shield" aria-hidden="true">
      <div className="pool is-public">
        <span>tm…</span>
        <small>public</small>
      </div>
      <div className="pool-flow">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.45}s` }} />
        ))}
      </div>
      <div className="pool is-private">
        <Shield size={16} />
        <small>orchard</small>
      </div>
    </div>
  );
}

function InstantVisual() {
  return (
    <div className="viz-instant" aria-hidden="true">
      <div className="instant-row">
        <span>Local scan</span>
        <i className="instant-bar is-local" />
      </div>
      <div className="instant-row">
        <span>Instant Sync</span>
        <i className="instant-bar is-instant" />
        <b>0.0s</b>
      </div>
    </div>
  );
}

function AuditVisual() {
  return (
    <div className="viz-audit" aria-hidden="true">
      <div className="audit-key">
        <KeyRound size={15} /> uviewtest1{cipher("ufvk", 8)}…
      </div>
      <div className="audit-scan">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i}>
            <Eye size={11} /> note {cipher(`n${i}`, 6)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ExtensionVisual() {
  return (
    <div className="viz-ext" aria-hidden="true">
      <div className="ext-bar">
        <i />
        <i />
        <i />
        <span className="ext-icon">Z</span>
      </div>
      <div className="ext-pop">
        <small>Shielded</small>
        <strong>0.78975</strong>
        <span>Send · Receive · Shield</span>
      </div>
    </div>
  );
}

function VaultVisual() {
  return (
    <div className="viz-vault" aria-hidden="true">
      <div className="vault-rain">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.6}s` }}>
            {cipher(`v${i}`, 24)}
          </span>
        ))}
      </div>
      <LockKeyhole size={34} strokeWidth={1.2} />
    </div>
  );
}

const FEATURES = [
  {
    key: "name",
    span: "wide",
    label: "Pay by name",
    title: "Send to alice.zcash.",
    body: "Zcash names resolve through the ZNS indexer, then go through the same privacy review as any address.",
    href: "/pay/send",
    cta: "Send ZEC",
    Visual: NameVisual,
  },
  {
    key: "shield",
    span: "",
    label: "Shield / unshield",
    title: "Move funds out of public view.",
    body: "Sweep transparent UTXOs into Orchard from the overview.",
    href: "/dashboard",
    cta: "Overview",
    Visual: ShieldVisual,
  },
  {
    key: "instant",
    span: "",
    label: "Instant Sync · opt-in",
    title: "Opens in a blink.",
    body: "A sync server keeps your viewing key synced, so balance and history show the moment you open. Local sync still decides what you can spend.",
    href: "/settings",
    cta: "Turn it on",
    Visual: InstantVisual,
  },
  {
    key: "audit",
    span: "",
    label: "Disclosure",
    title: "Share sight. Keep control.",
    body: "Export a viewing key for one dedicated account. The auditor scans read-only.",
    href: "/audit",
    cta: "Open auditor",
    Visual: AuditVisual,
  },
  {
    key: "ext",
    span: "",
    label: "Extension",
    title: "Wallet in your toolbar.",
    body: "The same wallet runs as a browser popup and as the full dashboard, like MetaMask.",
    href: "/dashboard",
    cta: "Open wallet",
    Visual: ExtensionVisual,
  },
  {
    key: "vault",
    span: "wide",
    label: "Local custody",
    title: "Your seed never leaves the machine.",
    body: "An encrypted vault in the browser, decrypted only by a loopback wallet service that refuses foreign origins.",
    href: "/settings/backup-wallet",
    cta: "Back up wallet",
    Visual: VaultVisual,
  },
] as const;

export function FeatureBento() {
  return (
    <section id="inside" className="landing-bento">
      <motion.div
        className="modules-heading"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger}
      >
        <motion.span className="instrument-label" variants={rise}>
          Inside Zeno
        </motion.span>
        <motion.h2 variants={rise}>
          A little less guesswork.
          <br />A lot more control.
        </motion.h2>
      </motion.div>
      <motion.div
        className="bento-grid"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.1 }}
        variants={stagger}
      >
        {FEATURES.map(({ key, span, label, title, body, href, cta, Visual }) => (
          <motion.div key={key} variants={rise} className={`bento-cell ${span}`}>
            <SpotlightCard className="bento-card">
              <div className="bento-visual">
                <Visual />
              </div>
              <span className="instrument-label">{label}</span>
              <h3>{title}</h3>
              <p>{body}</p>
              <Link href={href} className="module-link">
                {cta} <ArrowUpRight size={18} />
              </Link>
            </SpotlightCard>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

/* ───────────────────────── 4. Architecture ───────────────────────── */

const NODES = [
  {
    key: "ui",
    name: "Zeno UI",
    where: "Your browser",
    sees: ["Your balances and addresses", "An encrypted seed vault"],
    never: ["Your seed in plain text, once locked"],
  },
  {
    key: "svc",
    name: "Wallet service",
    where: "127.0.0.1 only",
    sees: ["The decrypted seed while unlocked", "Builds proofs and signs"],
    never: ["Requests from a non-loopback host", "Any origin except this app"],
  },
  {
    key: "lwd",
    name: "lightwalletd",
    where: "Remote server",
    sees: ["Your IP address and timing", "Signed transaction bytes"],
    never: ["Your keys", "Shielded amounts or recipients"],
  },
  {
    key: "sync",
    name: "Instant Sync",
    where: "Optional · off by default",
    sees: ["Your viewing key: all shielded activity of the account", "Your IP when the app fetches state"],
    never: ["Your spending key or seed", "Anything at all while the toggle is off"],
  },
  {
    key: "chain",
    name: "Zcash network",
    where: "Public chain",
    sees: ["That a shielded transaction happened", "The fee"],
    never: ["Sender, recipient, amount, or memo of a fully shielded payment"],
  },
] as const;

export function Architecture() {
  const [active, setActive] = useState(1);
  const node = NODES[active];
  return (
    <section id="security" className="landing-arch">
      <motion.div
        className="arch-head"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger}
      >
        <motion.span className="instrument-label" variants={rise}>
          Architecture
        </motion.span>
        <motion.h2 variants={rise}>
          Built so your keys
          <br />
          <span>stay home.</span>
        </motion.h2>
        <motion.p variants={rise}>
          Select a hop to see what it can and cannot see.
        </motion.p>
      </motion.div>

      <div className="arch-diagram">
        <div className="arch-line" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${i * 1.1}s` }} />
          ))}
        </div>
        <div className="arch-nodes" role="tablist" aria-label="Payment path">
          {NODES.map((n, i) => (
            <button
              key={n.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`arch-node${i === active ? " is-active" : ""}${i < 2 ? " is-local" : ""}`}
              onClick={() => setActive(i)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
            >
              <span className="arch-index">0{i + 1}</span>
              <strong>{n.name}</strong>
              <small>{n.where}</small>
            </button>
          ))}
        </div>
        <div className="arch-boundary" aria-hidden="true">
          <span>Your machine</span>
          <span>The internet</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={node.key}
          className="arch-detail"
          role="tabpanel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease: softEase }}
        >
          <div>
            <span className="instrument-label">Sees</span>
            <ul>
              {node.sees.map((s) => (
                <li key={s}>
                  <Eye size={14} /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="instrument-label is-muted">Never sees</span>
            <ul>
              {node.never.map((s) => (
                <li key={s}>
                  <LockKeyhole size={14} /> {s}
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/* ───────────────────────── 5. Status / roadmap ───────────────────────── */

const LIVE = [
  "Shielded sends on testnet, Ironwood (NU7) notes",
  "Privacy review before every payment",
  "Pay by Zcash name",
  "Faucet funding, shield and unshield",
  "Viewing-key export and read-only auditor",
  "Instant Sync: 41.7 s first sync, ~2 ms cached reads",
];
const NEXT = [
  "Instant Sync inside a Nitro Enclave, with attestation",
  "IVK-only mode: receive-only visibility",
  "Nym for lightwalletd traffic",
  "Send and review inside the extension popup",
  "Viewing-key export to an accountant-ready CSV",
];

export function Roadmap() {
  return (
    <section id="status" className="landing-roadmap">
      <motion.div
        className="roadmap-head"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger}
      >
        <motion.span className="instrument-label" variants={rise}>
          Honest status
        </motion.span>
        <motion.h2 variants={rise}>
          <ScrambleText text="What works today." />
        </motion.h2>
      </motion.div>
      <div className="roadmap-cols">
        {[
          { title: "Live on testnet", items: LIVE, live: true },
          { title: "Next", items: NEXT, live: false },
        ].map((col) => (
          <motion.ul
            key={col.title}
            className={`roadmap-col${col.live ? " is-live" : ""}`}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger}
          >
            <motion.li className="roadmap-col-title" variants={rise}>
              <span className="status-dot" /> {col.title}
            </motion.li>
            {col.items.map((item, i) => (
              <motion.li key={item} variants={rise}>
                <span className="roadmap-n">{String(i + 1).padStart(2, "0")}</span>
                {item}
                {col.live ? <Check size={15} /> : <Route size={15} />}
              </motion.li>
            ))}
          </motion.ul>
        ))}
      </div>
    </section>
  );
}

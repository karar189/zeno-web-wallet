"use client";

import { softEase } from "@/components/motion/motion-root";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";

const PHRASES = [
  "Send 2.5 ZEC to alice.zcash",
  "Memo: rent for March",
  "Recipient u1qz8…m4k",
  "Amount 0.42 ZEC",
  "Memo: clinic visit",
];
const TEXT = `${PHRASES.join("   ·   ")}   ·   `;
const GLYPHS = "0123456789abcdef#%&*+=/<>$@";

/* Deterministic glyph per index so the cipher track lines up with the plain track. */
function cipherOf(text: string, salt: number): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      out += " ";
      continue;
    }
    const h = Math.imul(i + 1, 2654435761) ^ Math.imul(salt + 7, 40503);
    out += GLYPHS[(h >>> 0) % GLYPHS.length];
  }
  return out;
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number };

export function EncryptionBeam() {
  const reduce = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const plainRef = useRef<HTMLDivElement>(null);
  const cipherRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const plain = plainRef.current;
    const cipher = cipherRef.current;
    const canvas = canvasRef.current;
    if (!stage || !plain || !cipher || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = stage.clientWidth;
      h = stage.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    // Ambient star dust, fixed positions.
    const stars = Array.from({ length: 70 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.1 + 0.3,
      a: Math.random() * 0.5 + 0.15,
      tw: Math.random() * Math.PI * 2,
    }));
    const particles: Particle[] = [];

    let offset = 0;
    let salt = 0;
    let lastSalt = 0;
    let visible = true;
    let frame = 0;
    let last = performance.now();
    const speed = 70; // px per second

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(stage);

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;

      // Move both tracks together. Width of one copy = half the track.
      const loop = plain.scrollWidth / 2;
      if (!reduce) offset = (offset + speed * dt) % loop;
      const x = -loop + offset;
      plain.style.transform = `translate3d(${x}px,-50%,0)`;
      cipher.style.transform = `translate3d(${x}px,-50%,0)`;

      // Re-scramble the ciphertext a few times per second.
      if (!reduce && now - lastSalt > 140) {
        lastSalt = now;
        salt++;
        cipher.textContent = cipherOf(TEXT + TEXT, salt);
      }

      ctx.clearRect(0, 0, w, h);
      const beamX = w / 2;

      for (const s of stars) {
        const a = s.a * (0.6 + 0.4 * Math.sin(now / 900 + s.tw));
        ctx.fillStyle = `rgba(255, 214, 140, ${a})`;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduce) {
        for (let i = 0; i < 4; i++) {
          particles.push({
            x: beamX + (Math.random() - 0.3) * 6,
            y: h / 2 + (Math.random() - 0.5) * h * 0.22,
            vx: 20 + Math.random() * 90,
            vy: (Math.random() - 0.5) * 40,
            life: 0,
            max: 0.8 + Math.random() * 1.6,
            r: Math.random() * 1.4 + 0.4,
          });
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life > p.max) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy *= 0.985;
        const a = 1 - p.life / p.max;
        ctx.fillStyle = `rgba(255, 196, 110, ${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, [reduce]);

  return (
    <section className="landing-encrypt" aria-labelledby="encrypt-title">
      <motion.div
        className="encrypt-capsule-ring"
        initial={{ opacity: 0, scale: 0.96 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 1, ease: softEase }}
      >
        <div ref={stageRef} className="encrypt-capsule" aria-hidden="true">
          <canvas ref={canvasRef} className="encrypt-canvas" />
          <div className="encrypt-lane is-plain">
            <div ref={plainRef} className="encrypt-track">
              {TEXT + TEXT}
            </div>
          </div>
          <div className="encrypt-lane is-cipher">
            <div ref={cipherRef} className="encrypt-track">
              {cipherOf(TEXT + TEXT, 0)}
            </div>
          </div>
          <div className="encrypt-beam">
            <span className="beam-core" />
            <span className="beam-flare" />
          </div>
        </div>
      </motion.div>

      <motion.div
        className="encrypt-copy"
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 0.8, ease: softEase, delay: 0.15 }}
      >
        <span className="encrypt-chip">Shielded by default</span>
        <h2 id="encrypt-title">
          Your payment.
          <br />
          Encrypted.
        </h2>
        <p>
          Recipient, amount and memo go in readable and come out as ciphertext on
          chain. Only the sender, the recipient, and anyone holding a viewing key
          can read them back.
        </p>
      </motion.div>
    </section>
  );
}

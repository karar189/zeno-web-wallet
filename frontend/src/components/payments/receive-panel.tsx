"use client";

import { PaymentQr } from "@/components/payments/payment-qr";
import { getWalletAddress } from "@/features/faucet/client";
import { usePreferredNetwork } from "@/features/network/use-preferred-network";
import { encodePaymentUri, validatePaymentRequest } from "@/features/payments/payment-request";
import { playSound } from "@/lib/sound";
import { Check, CircleHelp, Copy, Download, LoaderCircle, Share } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

function shortAddress(value: string) {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

export function ReceivePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { mainnetPreview, network } = usePreferredNetwork();
  const [address, setAddress] = useState<string | null>(null);
  const [transparentAddress, setTransparentAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState<"shielded" | "transparent" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (mainnetPreview) {
      setAddress(null);
      setTransparentAddress(null);
      setLoading(false);
      setError("Mainnet preview hides testnet receive addresses.");
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    void getWalletAddress()
      .then((result) => {
        if (!cancelled) {
          setAddress(result.address);
          setTransparentAddress(result.transparentAddress ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAddress(null);
          setTransparentAddress(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mainnetPreview, network]);

  const request = useMemo(() => {
    if (!address) {
      return null;
    }
    const validated = validatePaymentRequest({
      recipient: address,
      amountZec: amount.trim().length === 0 ? null : amount.trim(),
    });
    if (!validated.ok) {
      return { ok: false as const, reason: validated.reason };
    }
    return { ok: true as const, uri: encodePaymentUri(validated.request), address };
  }, [address, amount]);

  async function copyValue(value: string, kind: "shielded" | "transparent") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setError(null);
      playSound("copy");
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Clipboard access failed.");
      playSound("error");
    }
  }

  async function copyAddress() {
    if (!address) {
      return;
    }
    await copyValue(address, "shielded");
  }

  function saveQr() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "zeno-zec-qr.png";
    link.click();
    playSound("tap");
  }

  async function share() {
    if (!request?.ok) {
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: "Receive ZEC", text: request.uri });
        return;
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") {
          return;
        }
      }
    }
    await copyAddress();
  }

  return (
    <div className="flex min-h-full flex-1 flex-col px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1.25rem)] lg:pt-8">
      <header className="flex h-10 items-center justify-between">
        <Link
          href="/dashboard"
          data-sound="nav"
          aria-label="Back"
          className="grid size-8 place-items-center text-[#D0D4D1]"
        >
          <span className="text-xl leading-none">‹</span>
        </Link>
        <button
          type="button"
          aria-label="About receive"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
          className="icon-hit grid size-8 place-items-center rounded-full bg-[#1A1F1C] text-[#D0D4D1]"
        >
          <CircleHelp className="size-4" strokeWidth={1.7} />
        </button>
      </header>

      <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-white">Receive</h1>

      {helpOpen ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-[#141816] p-3 text-[12px] leading-relaxed text-[#8B928E]">
          <p>
            The primary QR is your shielded testnet address (`utest1…`). Faucet
            funding uses this address. An optional transparent (`tm…`) address
            is public on-chain — use it only when you need transparent receive.
          </p>
          <label className="mt-3 block text-[#F5F7F5]">
            Amount (optional)
            <input
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="ZEC"
              className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-transparent px-3 text-sm text-white outline-none"
            />
          </label>
        </div>
      ) : null}

      <div className="mt-5 inline-flex w-fit items-center gap-2 rounded-full bg-[#161A18] py-1.5 pr-3.5 pl-1.5">
        <span className="grid size-6 overflow-hidden rounded-full">
          <Image
            src="/logos/zcash-coingecko.png"
            alt=""
            width={24}
            height={24}
            className="size-6 scale-[1.35] object-cover"
          />
        </span>
        <span className="text-[14px] font-medium text-white">Zcash</span>
        <span className="text-[13px] text-[#8B928E]">ZEC</span>
      </div>

      <div className="mt-8 flex flex-1 flex-col items-center">
        {loading ? (
          <LoaderCircle className="mt-16 size-5 animate-spin text-[#8B928E]" strokeWidth={1.6} />
        ) : request?.ok ? (
          <>
            <PaymentQr value={request.uri} canvasRef={canvasRef} />
            <button
              type="button"
              onClick={saveQr}
              className="icon-hit mt-4 inline-flex h-auto min-h-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 py-1.5 text-[13px] font-medium text-[#E7EBE8]"
            >
              Save QR
              <Download className="size-3.5" strokeWidth={1.8} />
            </button>
          </>
        ) : (
          <p className="mt-16 max-w-[16rem] text-center text-sm text-[#8B928E]">
            {request?.reason ?? "Start the wallet service to show your receive address."}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!address}
        onClick={() => void copyAddress()}
        className="icon-hit mt-6 flex h-auto min-h-0 w-full items-center justify-between rounded-full bg-[#161A18] px-4 py-3.5 text-left disabled:opacity-40"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-medium tracking-wide text-[#8B928E] uppercase">
            Shielded (default)
          </span>
          <span className="font-mono text-[15px] text-white">
            {address ? shortAddress(address) : "Address unavailable"}
          </span>
        </span>
        {copied === "shielded" ? (
          <Check className="size-4 shrink-0 text-[#3DDC97]" strokeWidth={1.8} />
        ) : (
          <Copy className="size-4 shrink-0 text-[#C9CFCB]" strokeWidth={1.7} />
        )}
      </button>
      {error ? <p className="mt-2 text-center text-[12px] text-[#E7A598]">{error}</p> : null}

      <button
        type="button"
        disabled={!request?.ok}
        onClick={() => void share()}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-[#050506] disabled:opacity-40"
      >
        Share
        <Share className="size-4" strokeWidth={1.8} />
      </button>

      {transparentAddress ? (
        <div className="mt-6 rounded-2xl border border-[#E7A598]/25 bg-[#1A1412] p-4">
          <p className="text-[12px] font-medium tracking-wide text-[#E7A598] uppercase">
            Transparent (public) testnet
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-[#A89B96]">
            Amounts sent here are visible on-chain. Prefer the shielded address
            above unless a peer requires a transparent address.
          </p>
          <button
            type="button"
            onClick={() => void copyValue(transparentAddress, "transparent")}
            className="icon-hit mt-3 flex h-auto min-h-0 w-full items-center justify-between rounded-full bg-black/30 px-4 py-3 text-left"
          >
            <span className="font-mono text-[14px] text-[#F5EDE9]">
              {shortAddress(transparentAddress)}
            </span>
            {copied === "transparent" ? (
              <Check className="size-4 shrink-0 text-[#3DDC97]" strokeWidth={1.8} />
            ) : (
              <Copy className="size-4 shrink-0 text-[#C9CFCB]" strokeWidth={1.7} />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}

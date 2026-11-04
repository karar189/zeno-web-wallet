"use client";

import { logoutLiveWallet } from "@/features/session/store";
import { WalletSessionError } from "@/features/session/client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";


export function ProfileScreen() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function logout(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await logoutLiveWallet();
    } catch (caught) {
      setError(
        caught instanceof WalletSessionError || caught instanceof Error
          ? caught.message
          : "The wallet stayed unlocked.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="wallet-card flex flex-col items-center px-6 py-9 text-center">
        <span
          aria-hidden="true"
          className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-orange-300/50 via-[#1A1228] to-orange-700/55 ring-2 ring-white/[0.08]"
        >
          <span className="text-2xl font-semibold text-white">ZT</span>
        </span>
        <h2 className="mt-4 text-lg font-semibold text-cream">Zeno Wallet</h2>
        <p className="mt-1 text-sm text-cream/45">Zcash testnet · Shielded</p>
      </div>

      <section className="wallet-card-flat overflow-hidden">
        <Link
          href="/wallet"
          data-sound="nav"
          className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03]"
        >
          <span className="text-sm font-medium text-cream">Fund & balance</span>
          <ChevronRight className="size-4 text-cream/35" strokeWidth={1.6} />
        </Link>
        <Link
          href="/activity"
          data-sound="nav"
          className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3.5 transition-colors hover:bg-white/[0.03]"
        >
          <span className="text-sm font-medium text-cream">Notifications & activity</span>
          <ChevronRight className="size-4 text-cream/35" strokeWidth={1.6} />
        </Link>
      </section>

      <form className="space-y-3" onSubmit={(event) => void logout(event)}>
        <p className="text-sm leading-relaxed text-[#858D89]">
          Log out takes the seed out of memory. This browser keeps the encrypted wallet, and another browser cannot open it.
        </p>
        {error ? <p className="text-sm text-[#E24B4B]">{error}</p> : null}
        <button
          type="submit"
          data-sound="tap"
          disabled={pending}
          className="flex h-12 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-[#050506] disabled:opacity-40"
        >
          {pending ? "Locking" : "Log out"}
        </button>
      </form>
    </div>
  );
}

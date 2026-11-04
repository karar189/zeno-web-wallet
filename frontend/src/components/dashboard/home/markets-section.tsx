"use client";

import { cn } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const tabs = ["Watchlists", "Top Gainers", "Top Losers"] as const;

export function MarketsSection() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Watchlists");

  return (
    <section aria-label="Markets" className="mt-7">
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold tracking-tight text-[#F5F7F5]">Markets</h2>
        <Link href="/swap" data-sound="nav" className="text-[13px] font-medium text-[#8A908C]">
          View all
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "icon-hit h-auto min-h-0 shrink-0 px-0 text-[13px] font-medium",
              activeTab === tab ? "text-[#F5F7F5]" : "text-[#6F7773]",
            )}
          >
            {tab}
          </button>
        ))}
        <span className="ml-auto grid size-7 place-items-center text-[#6F7773]">
          <SlidersHorizontal className="size-3.5" strokeWidth={1.6} />
        </span>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full">
            <Image
              src="/logos/zcash-coingecko.png"
              alt=""
              width={32}
              height={32}
              className="size-8 scale-[1.35] object-cover"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-tight text-[#F5F7F5]">Zcash</p>
            <p className="text-[12px] leading-tight text-[#6F7773]">ZEC</p>
          </div>
          <div className="text-right">
            <p className="text-[14px] font-medium leading-tight text-[#F5F7F5]">Testnet</p>
            <p className="text-[12px] leading-tight text-[#6F7773]">No live price</p>
          </div>
        </div>
      </div>
    </section>
  );
}

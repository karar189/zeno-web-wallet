import Image from "next/image";
import Link from "next/link";

type AssetListProps = {
  balanceDisplay: string | null;
  loading: boolean;
};

export function AssetList({ balanceDisplay, loading }: AssetListProps) {
  return (
    <section aria-label="Assets" className="-mt-px">
      <Link
        href="/wallet"
        data-sound="nav"
        className="relative z-10 mx-auto flex h-[68px] w-[92%] items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 text-[#F5F7F5] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-1/2 h-[70%] w-[62%] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,176,40,0.42),rgba(210,120,16,0.14)_42%,transparent_72%)]"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-[22%] h-px w-[56%] bg-gradient-to-r from-transparent via-[#FFC14A]/55 to-transparent"
        />
        <span className="relative grid size-8 shrink-0 overflow-hidden rounded-full">
          <Image
            src="/logos/zcash-coingecko.png"
            alt=""
            width={32}
            height={32}
            className="size-8 scale-[1.35] object-cover"
          />
        </span>
        <span className="relative min-w-0 flex-1 truncate text-[15px] font-medium">Zcash</span>
        <span className="wallet-tabular relative text-[15px] font-medium">
          {loading ? "—" : balanceDisplay ?? "—"}
        </span>
      </Link>

      <Link
        href="/activity"
        data-sound="nav"
        className="relative z-0 mx-auto -mt-2 flex h-[56px] w-[78%] items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-[#6A62C8]/50 via-[#2C2850]/32 to-[#121018]/18 px-3.5 pt-2 text-[#F4F2FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-md"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-[68%] bg-[radial-gradient(ellipse_at_0%_50%,rgba(140,120,255,0.45),transparent_72%)]"
        />
        <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-[#E4DEFF]">
          A
        </span>
        <span className="relative min-w-0 flex-1 truncate text-[14px] font-medium">Activity</span>
        <span className="relative text-[14px] font-medium">View</span>
      </Link>
    </section>
  );
}

import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

/** Logical viewport inside the bezel (desktop preview). */
const PHONE_WIDTH_PX = 430;
const PHONE_HEIGHT_PX = 920;

type IPhoneMockupProps = {
  children: ReactNode;
};

/**
 * Full-screen on real phones; fixed-size centered device on large viewports.
 */
export function IPhoneMockup({ children }: IPhoneMockupProps) {
  return (
    <div className="relative min-h-svh w-full bg-ink lg:flex lg:min-h-svh lg:items-center lg:justify-center lg:overflow-hidden lg:bg-[#071018] lg:p-8">
      <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden="true">
        <Image
          src="/landing-hero.jpg"
          alt=""
          fill
          priority
          unoptimized
          sizes="100vw"
          className="object-cover object-[center_38%] contrast-[0.9] brightness-[1.03]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,16,24,0.18),transparent_28%,transparent_62%,rgba(7,16,24,0.28))]" />
      </div>
      <div
        className="relative z-10 mx-auto flex w-full min-h-svh shrink-0 flex-col max-lg:min-h-svh lg:h-[var(--phone-h)] lg:min-h-[var(--phone-h)] lg:max-h-[var(--phone-h)] lg:w-[var(--phone-w)] lg:rounded-[3.25rem] lg:border-[12px] lg:border-[#1c1c1e] lg:bg-[#1c1c1e] lg:shadow-[0_48px_120px_-24px_rgba(0,0,0,0.85),inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        style={
          {
            "--phone-w": `${PHONE_WIDTH_PX}px`,
            "--phone-h": `${PHONE_HEIGHT_PX}px`,
          } as CSSProperties
        }
        aria-label="iPhone preview"
      >
        <span
          className="pointer-events-none absolute top-[28%] -left-[14px] hidden h-11 w-[3px] rounded-l-sm bg-[#2a2a2c] lg:block"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute top-[38%] -left-[14px] hidden h-16 w-[3px] rounded-l-sm bg-[#2a2a2c] lg:block"
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute top-[34%] -right-[14px] hidden h-[4.5rem] w-[3px] rounded-r-sm bg-[#2a2a2c] lg:block"
          aria-hidden="true"
        />

        <div
          className="pointer-events-none absolute top-3.5 left-1/2 z-[70] hidden h-[28px] w-[118px] -translate-x-1/2 rounded-full bg-black lg:block"
          aria-hidden="true"
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-ink max-lg:min-h-svh lg:h-full lg:rounded-[2.5rem]">
          {children}
        </div>

        <div
          className="pointer-events-none absolute bottom-2.5 left-1/2 z-[70] hidden h-1 w-[128px] -translate-x-1/2 rounded-full bg-cream/35 lg:block"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

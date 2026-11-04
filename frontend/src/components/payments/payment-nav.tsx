"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/pay/send", label: "Send" },
  { href: "/dashboard?wallet=1&view=receive", label: "Receive" },
  { href: "/pay/lab", label: "Lab" },
] as const;

export function PaymentNav() {
  const pathname = usePathname();

  return (
    <nav
      className="payment-nav mb-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-[rgba(244,241,234,0.22)] pb-4 text-[11px] tracking-[0.16em] uppercase"
      aria-label="Shielded payments"
    >
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            data-sound="nav"
            className={cn(
              "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ffc14a]",
              active ? "text-[#ffc14a]" : "text-[#8c8c8c] hover:text-[#f7f4ef]",
            )}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

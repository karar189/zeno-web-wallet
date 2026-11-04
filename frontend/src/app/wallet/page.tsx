import { redirect } from "next/navigation";

/** Wallet lives in the header popup; keep this path as a deep-link into it. */
export default function WalletPage() {
  redirect("/dashboard?wallet=1");
}

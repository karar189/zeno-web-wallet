import { redirect } from "next/navigation";

/** Receive lives inside the wallet popup. */
export default function ReceivePage() {
  redirect("/dashboard?wallet=1&view=receive");
}

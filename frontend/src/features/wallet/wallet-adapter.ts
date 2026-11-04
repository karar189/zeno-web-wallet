import { DemoWalletAdapter } from "@/features/wallet/demo-wallet";

let adapter = new DemoWalletAdapter();

export function getWalletAdapter(): DemoWalletAdapter {
  return adapter;
}

export function setWalletAdapterForTests(next: DemoWalletAdapter): void {
  adapter = next;
}

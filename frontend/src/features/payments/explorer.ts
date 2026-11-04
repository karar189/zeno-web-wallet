export type ExplorerNetwork = "testnet" | "mainnet";

const BASE: Record<ExplorerNetwork, string> = {
  testnet: "https://testnet.zcashblockexplorer.com",
  mainnet: "https://mainnet.zcashblockexplorer.com",
};

export function explorerBase(network: ExplorerNetwork = "testnet"): string {
  return BASE[network];
}

export function transactionExplorerUrl(
  txid: string,
  network: ExplorerNetwork = "testnet",
): string {
  return `${BASE[network]}/transactions/${txid}`;
}

export function blockExplorerUrl(
  hashOrHeight: string | number,
  network: ExplorerNetwork = "testnet",
): string {
  return `${BASE[network]}/blocks/${hashOrHeight}`;
}

export function looksLikeTxid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
}

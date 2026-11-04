export type ExplorerNetwork = "testnet" | "mainnet";

// zcashblockexplorer.com no longer resolves; Cipherscan serves both networks.
const BASE: Record<ExplorerNetwork, string> = {
  testnet: "https://testnet.cipherscan.app",
  mainnet: "https://cipherscan.app",
};

export function explorerBase(network: ExplorerNetwork = "testnet"): string {
  return BASE[network];
}

export function transactionExplorerUrl(
  txid: string,
  network: ExplorerNetwork = "testnet",
): string {
  return `${BASE[network]}/tx/${txid}`;
}

export function blockExplorerUrl(
  hashOrHeight: string | number,
  network: ExplorerNetwork = "testnet",
): string {
  return `${BASE[network]}/block/${hashOrHeight}`;
}

const DEAD_EXPLORER =
  /^https:\/\/(testnet|mainnet)\.zcashblockexplorer\.com\/(transactions|blocks)\/([^/?#]+)/;

/**
 * Payment records saved before the explorer moved (and older wallet-service builds) still carry
 * zcashblockexplorer.com links. Rewrite them to the current explorer, keeping their network.
 */
export function currentExplorerUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = DEAD_EXPLORER.exec(url);
  if (!match) return url;
  const [, network, kind, id] = match;
  return kind === "transactions"
    ? transactionExplorerUrl(id, network as ExplorerNetwork)
    : blockExplorerUrl(id, network as ExplorerNetwork);
}

export function looksLikeTxid(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{64}$/.test(value);
}

export const DISCLOSURE_SCOPE_WARNING =
  "A viewing key shows the dedicated disclosure account's transaction history, including transaction ids, block heights, incoming amounts, memos, and receiving addresses, plus outgoing recipient addresses, amounts, and memos. It cannot sign or spend, and it does not reveal the primary account.";

export const DISCLOSURE_IRREVERSIBLE_WARNING =
  "A viewing key is a bearer capability. Sharing it cannot be reliably revoked: deleting the account here or closing this page does not invalidate copies that already left this device.";

export const DISCLOSURE_PRIMARY_WARNING =
  "Only the dedicated account is disclosed. The primary account's viewing key, spending keys, and recovery phrase stay inside the wallet service.";

export const DISCLOSURE_SENDER_WARNING =
  "A viewing key does not prove who sent a payment, does not prove a transaction is legitimate, and does not identify the sender's real-world identity.";

export const DISCLOSURE_SERVICE_SPEND_WARNING =
  "The auditor cannot spend, but this wallet service still holds the seed and can spend from the disclosure account. Only deposit funds there that you intend the service to control.";

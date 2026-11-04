//! Independent read-only account scanning. No seed or spending wallet is opened.
use std::collections::HashMap;

use crate::cache::MemoryBlockCache;
use crate::config::Chain;
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use rusqlite::Connection;
use serde::Serialize;
use zcash_client_backend::{
    data_api::wallet::{decrypt_and_store_transaction, ConfirmationsPolicy},
    data_api::{
        Account, AccountBirthday, AccountPurpose, TransactionDataRequest, WalletRead, WalletWrite,
    },
    proto::service::{
        compact_tx_streamer_client::CompactTxStreamerClient, BlockId, ChainSpec, Empty, TxFilter,
    },
    sync,
};
use zcash_client_sqlite::{util::SystemClock, wallet::init::init_wallet_db, AccountUuid, WalletDb};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_protocol::consensus::{BlockHeight, BranchId, Network};
use zcash_protocol::memo::Memo;

/// How far back one in-memory scan may start. About six weeks of testnet blocks.
const MAX_AUDIT_BLOCKS: u64 = 50_000;
/// Blocks per download-and-scan round. Larger than the wallet's batch: this is a one-shot
/// in-memory scan, and fewer round trips matter most over a mixnet.
const AUDIT_BATCH: u32 = 1_000;
/// Upper bound on full-transaction downloads per scan, so one request stays bounded.
const MAX_ENHANCEMENTS: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditReport {
    pub network: &'static str,
    pub mode: &'static str,
    pub detected_zatoshis: String,
    pub scanned_height: u32,
    pub tip_height: u64,
    pub complete: bool,
    pub can_spend: bool,
    /// Every transaction the viewing key detected, oldest first.
    pub transactions: Vec<AuditTransaction>,
    /// Full transactions fetched from lightwalletd to recover memos, fees and recipients.
    pub enhanced: EnhancementReport,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditTransaction {
    pub txid: String,
    pub mined_height: Option<u32>,
    /// Unix seconds of the block that mined it.
    pub block_time: Option<i64>,
    /// `received` | `sent` | `shield` | `other`
    pub kind: &'static str,
    /// Signed change to the account's balance, fee included.
    pub net_zatoshis: String,
    pub received_zatoshis: String,
    pub spent_zatoshis: String,
    /// Known only when the account paid the fee and the full transaction was fetched.
    pub fee_zatoshis: Option<String>,
    pub pools: Vec<&'static str>,
    /// Outputs to other parties, recovered with the outgoing viewing key. Empty for receives:
    /// shielded senders are not revealed.
    pub recipients: Vec<AuditRecipient>,
    /// Text memos on outputs this account received or sent.
    pub memos: Vec<String>,
    /// False when only compact data was available: memos, fee and recipients may be missing.
    pub full_details: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecipient {
    pub address: String,
    pub zatoshis: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnhancementReport {
    pub requested: usize,
    pub fetched: usize,
    pub failed: usize,
}

fn decode_key(chain: Chain, encoded: &str) -> Result<UnifiedFullViewingKey, String> {
    let prefix_ok = if chain.is_main() {
        encoded.starts_with("uview1") && !encoded.starts_with("uviewtest")
    } else {
        encoded.starts_with("uviewtest1")
    };
    if encoded.len() > 2048 || !prefix_ok {
        return Err(format!(
            "Enter a {} unified full viewing key. The other network and spending keys are refused.",
            chain.as_str()
        ));
    }
    UnifiedFullViewingKey::decode(&chain.zcash(), encoded)
        .map_err(|_| format!("The {} viewing key could not be decoded.", chain.as_str()))
}

type AuditDb<'c> = WalletDb<&'c mut Connection, Network, SystemClock, UnwrapErr<SysRng>>;

fn audit_connection() -> Result<Connection, String> {
    let connection = Connection::open_in_memory()
        .map_err(|_| "Could not create the audit database.".to_string())?;
    connection
        .execute_batch("PRAGMA temp_store = MEMORY;")
        .map_err(|_| "Could not configure in-memory storage.".to_string())?;
    rusqlite::vtab::array::load_module(&connection)
        .map_err(|_| "Could not initialize the audit database modules.".to_string())?;
    Ok(connection)
}

fn audit_database(chain: Chain, connection: &mut Connection) -> Result<AuditDb<'_>, String> {
    let mut db = WalletDb::from_connection(connection, chain.zcash(), SystemClock, UnwrapErr(SysRng));
    init_wallet_db(&mut db, None)
        .map_err(|_| "Could not initialize the audit schema.".to_string())?;
    Ok(db)
}

pub async fn scan(
    chain: Chain,
    endpoint: &str,
    encoded: &str,
    birthday_height: u32,
) -> Result<AuditReport, String> {
    let key = decode_key(chain, encoded)?;
    let mut client = crate::network::lightwalletd(endpoint).await?;
    let info = client
        .get_lightd_info(Empty {})
        .await
        .map_err(|_| "Could not verify the server network.".to_string())?
        .into_inner();
    let name = info.chain_name.to_ascii_lowercase();
    let matches = if chain.is_main() {
        name.contains("main") && !name.contains("test")
    } else {
        name.contains("test") && !name.contains("main")
    };
    if !matches {
        return Err(format!(
            "The auditor is configured for {} and the server reported {name}.",
            chain.as_str()
        ));
    }
    let tip = client
        .get_latest_block(ChainSpec {})
        .await
        .map_err(|_| "Could not read the testnet tip.".to_string())?
        .into_inner()
        .height;
    if birthday_height == 0
        || u64::from(birthday_height) > tip
        || tip - u64::from(birthday_height) > MAX_AUDIT_BLOCKS
    {
        return Err("This scanner covers up to 50,000 blocks before the tip. Use the dedicated account's actual birthday, within that range; choosing a later birthday can hide payments.".into());
    }
    let tree = client
        .get_tree_state(BlockId {
            height: u64::from(birthday_height - 1),
            hash: vec![],
        })
        .await
        .map_err(|_| "Could not fetch the account birthday tree state.".to_string())?
        .into_inner();
    let birthday = AccountBirthday::from_treestate(tree, None)
        .map_err(|_| "Could not decode the birthday tree state.".to_string())?;
    let mut connection = audit_connection()?;
    let mut db = audit_database(chain, &mut connection)?;
    let account = db
        .import_account_ufvk("Auditor", &key, &birthday, AccountPurpose::ViewOnly, None)
        .map_err(|_| "Could not import the viewing key into the audit database.".to_string())?;
    let cache = MemoryBlockCache::default();
    let network = chain.zcash();
    sync::run(&mut client, &network, &cache, &mut db, AUDIT_BATCH)
        .await
        .map_err(|_| {
            "The read-only scan failed. No complete balance can be reported; try again.".to_string()
        })?;
    let enhanced = enhance(&mut client, &network, &mut db).await;
    let summary = db
        .get_wallet_summary(ConfirmationsPolicy::default())
        .map_err(|_| "Could not read the audit summary.".to_string())?
        .ok_or("No audit summary is available yet.")?;
    let balance = summary
        .account_balances()
        .get(&account.id())
        .ok_or("The imported account is missing from the audit summary.")?;
    let scanned = u32::from(summary.fully_scanned_height());
    let detected = u64::from(balance.total()).to_string();
    let account_id = account.id();
    drop(db);
    let transactions = list_transactions(&connection, account_id)?;
    Ok(AuditReport {
        network: chain.as_str(),
        mode: "view_only",
        detected_zatoshis: detected,
        scanned_height: scanned,
        tip_height: tip,
        complete: u64::from(scanned) >= tip,
        can_spend: false,
        transactions,
        enhanced,
    })
}

/// Downloads the full transactions the scan asked for and decrypts them with the viewing
/// key, which fills in memos, fees and outgoing recipients. Failures are counted, not fatal:
/// the compact scan already established the balance.
async fn enhance(
    client: &mut CompactTxStreamerClient<tonic::transport::Channel>,
    network: &Network,
    db: &mut AuditDb<'_>,
) -> EnhancementReport {
    let mut report = EnhancementReport::default();
    let Ok(requests) = db.transaction_data_requests() else {
        return report;
    };
    let txids: Vec<TxId> = requests
        .into_iter()
        .filter_map(|request| match request {
            TransactionDataRequest::Enhancement(txid) => Some(txid),
            _ => None,
        })
        .take(MAX_ENHANCEMENTS)
        .collect();
    report.requested = txids.len();
    for txid in txids {
        let fetched = client
            .get_transaction(TxFilter {
                block: None,
                index: 0,
                hash: txid.as_ref().to_vec(),
            })
            .await;
        let stored = match fetched {
            Ok(response) => {
                let raw = response.into_inner();
                let height = u32::try_from(raw.height)
                    .ok()
                    .filter(|height| *height > 0)
                    .map(BlockHeight::from_u32);
                height.is_some_and(|height| {
                    Transaction::read(&raw.data[..], BranchId::for_height(network, height))
                        .ok()
                        .is_some_and(|tx| {
                            decrypt_and_store_transaction(network, db, &tx, Some(height)).is_ok()
                        })
                })
            }
            Err(_) => false,
        };
        if stored {
            report.fetched += 1;
        } else {
            report.failed += 1;
        }
    }
    report
}

fn pool_name(code: i64) -> &'static str {
    match code {
        0 => "transparent",
        2 => "sapling",
        3 => "orchard",
        4 => "ironwood",
        _ => "unknown",
    }
}

fn memo_text(bytes: &[u8]) -> Option<String> {
    match Memo::from_bytes(bytes).ok()? {
        Memo::Text(text) => {
            let text: &str = &text;
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_string())
        }
        _ => None,
    }
}

#[derive(Default)]
struct OutputDetails {
    pools: Vec<&'static str>,
    recipients: Vec<AuditRecipient>,
    memos: Vec<String>,
}

fn list_transactions(
    connection: &Connection,
    account: AccountUuid,
) -> Result<Vec<AuditTransaction>, String> {
    let account_key = account.expose_uuid();
    let account_key = account_key.as_bytes().as_slice();
    let read_error = |_| "Could not read the scanned transactions.".to_string();

    let mut outputs: HashMap<Vec<u8>, OutputDetails> = HashMap::new();
    let mut statement = connection
        .prepare(
            "SELECT txid, output_pool, to_account_uuid, from_account_uuid, to_address, value, is_change, memo
             FROM v_tx_outputs
             WHERE to_account_uuid = ?1 OR from_account_uuid = ?1
             ORDER BY output_pool, output_index",
        )
        .map_err(read_error)?;
    let rows = statement
        .query_map([account_key], |row| {
            Ok((
                row.get::<_, Vec<u8>>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<Vec<u8>>>(2)?,
                row.get::<_, Option<Vec<u8>>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, Option<Vec<u8>>>(7)?,
            ))
        })
        .map_err(read_error)?;
    for row in rows {
        let (txid, pool, to_account, from_account, address, value, is_change, memo) =
            row.map_err(read_error)?;
        let entry = outputs.entry(txid).or_default();
        let pool = pool_name(pool);
        if !entry.pools.contains(&pool) {
            entry.pools.push(pool);
        }
        let to_us = to_account.as_deref() == Some(account_key);
        let from_us = from_account.as_deref() == Some(account_key);
        if from_us && !to_us && !is_change {
            if let Some(address) = address {
                entry.recipients.push(AuditRecipient {
                    address,
                    zatoshis: value.max(0).to_string(),
                });
            }
        }
        if !is_change {
            if let Some(text) = memo.as_deref().and_then(memo_text) {
                if !entry.memos.contains(&text) {
                    entry.memos.push(text);
                }
            }
        }
    }

    let mut statement = connection
        .prepare(
            "SELECT txid, mined_height, block_time, account_balance_delta, total_received,
                    total_spent, fee_paid, is_shielding, pool_crossing_value, raw IS NOT NULL
             FROM v_transactions
             WHERE account_uuid = ?1 AND expired_unmined = 0
             ORDER BY mined_height ASC NULLS LAST, tx_index ASC, txid ASC",
        )
        .map_err(read_error)?;
    let rows = statement
        .query_map([account_key], |row| {
            Ok((
                row.get::<_, Vec<u8>>(0)?,
                row.get::<_, Option<u32>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, bool>(9)?,
            ))
        })
        .map_err(read_error)?;
    let mut transactions = Vec::new();
    for row in rows {
        let (txid_bytes, mined_height, block_time, delta, received, spent, fee, shielding, crossing, has_raw) =
            row.map_err(read_error)?;
        let details = outputs.remove(&txid_bytes).unwrap_or_default();
        let txid: [u8; 32] = txid_bytes
            .try_into()
            .map_err(|_| "A scanned transaction had an invalid id.".to_string())?;
        transactions.push(AuditTransaction {
            txid: TxId::from_bytes(txid).to_string(),
            mined_height,
            block_time,
            kind: crate::wallet::history_kind(shielding, crossing, delta),
            net_zatoshis: delta.to_string(),
            received_zatoshis: received.to_string(),
            spent_zatoshis: spent.to_string(),
            fee_zatoshis: fee.map(|value| value.to_string()),
            pools: details.pools,
            recipients: details.recipients,
            memos: details.memos,
            full_details: has_raw,
        });
    }
    Ok(transactions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_keys::keys::UnifiedSpendingKey;
    use zip32::AccountId;
    #[test]
    fn accepts_testnet_viewing_keys_and_rejects_mainnet_and_seeds() {
        let spending =
            UnifiedSpendingKey::from_seed(&Network::TestNetwork, &[7u8; 32], AccountId::ZERO)
                .unwrap();
        let key = spending.to_unified_full_viewing_key();
        assert!(decode_key(Chain::Test, &key.encode(&Network::TestNetwork).unwrap()).is_ok());
        assert!(decode_key(Chain::Test, &key.encode(&Network::MainNetwork).unwrap()).is_err());
        assert!(decode_key(Chain::Test, "abandon abandon abandon").is_err());
    }
    #[test]
    fn imports_only_a_viewing_account_without_a_seed() {
        use zcash_client_backend::data_api::chain::ChainState;
        use zcash_client_backend::data_api::AccountSource;
        use zcash_primitives::block::BlockHash;
        use zcash_protocol::consensus::BlockHeight;
        let spending =
            UnifiedSpendingKey::from_seed(&Network::TestNetwork, &[9u8; 32], AccountId::ZERO)
                .unwrap();
        let key = spending.to_unified_full_viewing_key();
        let birthday = AccountBirthday::from_parts(
            ChainState::empty(BlockHeight::from_u32(2_100_000), BlockHash([0; 32])),
            None,
        );
        let mut connection = audit_connection().unwrap();
        let mut db = audit_database(Chain::Test, &mut connection).unwrap();
        let account = db
            .import_account_ufvk("Audit", &key, &birthday, AccountPurpose::ViewOnly, None)
            .unwrap();
        assert!(matches!(
            account.source(),
            AccountSource::Imported {
                purpose: AccountPurpose::ViewOnly,
                ..
            }
        ));
        assert_eq!(db.get_account_ids().unwrap().len(), 1);
        let id = account.id();
        drop(db);
        // A freshly imported account lists no transactions and the queries are valid SQL.
        assert!(list_transactions(&connection, id).unwrap().is_empty());
    }

    #[test]
    fn reads_only_text_memos() {
        let mut bytes = [0u8; 512];
        bytes[..11].copy_from_slice(b"Invoice 42 ");
        assert_eq!(memo_text(&bytes).as_deref(), Some("Invoice 42"));
        let mut empty = [0u8; 512];
        empty[0] = 0xF6;
        assert_eq!(memo_text(&empty), None);
        let mut arbitrary = [0u8; 512];
        arbitrary[0] = 0xFF;
        assert_eq!(memo_text(&arbitrary), None);
    }
}

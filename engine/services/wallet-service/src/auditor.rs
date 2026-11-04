//! Independent read-only account scanning. No seed or spending wallet is opened.
use crate::cache::MemoryBlockCache;
use crate::config::Chain;
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use rusqlite::Connection;
use serde::Serialize;
use zcash_client_backend::{
    data_api::wallet::ConfirmationsPolicy,
    data_api::{Account, AccountBirthday, AccountPurpose, WalletRead, WalletWrite},
    proto::service::{
        compact_tx_streamer_client::CompactTxStreamerClient, BlockId, ChainSpec, Empty,
    },
    sync,
};
use zcash_client_sqlite::{util::SystemClock, wallet::init::init_wallet_db, WalletDb};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::Network;

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

fn audit_database(
    chain: Chain,
) -> Result<WalletDb<Connection, Network, SystemClock, UnwrapErr<SysRng>>, String> {
    let connection = Connection::open_in_memory()
        .map_err(|_| "Could not create the audit database.".to_string())?;
    connection
        .execute_batch("PRAGMA temp_store = MEMORY;")
        .map_err(|_| "Could not configure in-memory storage.".to_string())?;
    rusqlite::vtab::array::load_module(&connection)
        .map_err(|_| "Could not initialize the audit database modules.".to_string())?;
    let mut db = WalletDb::from_connection(
        connection,
        chain.zcash(),
        SystemClock,
        UnwrapErr(SysRng),
    );
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
    let mut client = CompactTxStreamerClient::connect(endpoint.to_string())
        .await
        .map_err(|_| {
            format!(
                "Could not connect to the configured {} lightwallet server.",
                chain.as_str()
            )
        })?;
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
        || tip - u64::from(birthday_height) > 2000
    {
        return Err("This prototype scans up to 2,000 blocks. Use the dedicated account's actual birthday, within that range; choosing a later birthday can hide payments.".into());
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
    let mut db = audit_database(chain)?;
    let account = db
        .import_account_ufvk("Auditor", &key, &birthday, AccountPurpose::ViewOnly, None)
        .map_err(|_| "Could not import the viewing key into the audit database.".to_string())?;
    let cache = MemoryBlockCache::default();
    let network = chain.zcash();
    sync::run(&mut client, &network, &cache, &mut db, 100)
        .await
        .map_err(|_| {
            "The read-only scan failed. No complete balance can be reported; try again.".to_string()
        })?;
    let summary = db
        .get_wallet_summary(ConfirmationsPolicy::default())
        .map_err(|_| "Could not read the audit summary.".to_string())?
        .ok_or("No audit summary is available yet.")?;
    let balance = summary
        .account_balances()
        .get(&account.id())
        .ok_or("The imported account is missing from the audit summary.")?;
    let scanned = u32::from(summary.fully_scanned_height());
    Ok(AuditReport {
        network: chain.as_str(),
        mode: "view_only",
        detected_zatoshis: u64::from(balance.total()).to_string(),
        scanned_height: scanned,
        tip_height: tip,
        complete: u64::from(scanned) >= tip,
        can_spend: false,
    })
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
        let mut db = audit_database(Chain::Test).unwrap();
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
    }
}

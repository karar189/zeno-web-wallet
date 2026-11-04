use std::collections::HashMap;
use std::error::Error;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use bip0039::{Count, Mnemonic};
use rand::rand_core::UnwrapErr;
use rand::rngs::SysRng;
use rand::Rng;
use rusqlite::{Connection, OpenFlags};
use secrecy::{ExposeSecret, SecretVec};
use serde::{Deserialize, Serialize};
use zcash_address::unified::{
    Container as _, Encoding as _, Fvk as UnifiedFvk, Ufvk as UnifiedUfvk, Uitem,
};
use zcash_address::{ConversionError, TryFromAddress, ZcashAddress};
use zcash_client_backend::data_api::locking::{unlock_proposal_inputs, LockOwner, LockRequest};
use zcash_client_backend::data_api::wallet::input_selection::{
    GreedyInputSelector, GreedyInputSelectorError, SpendPolicy,
};
use zcash_client_backend::data_api::wallet::{
    create_proposed_transactions, propose_shielding, propose_transfer, ConfirmationsPolicy,
    SpendingKeys, TargetHeight,
};
use zcash_client_backend::data_api::{
    Account, AccountBirthday, AccountSource, CoinbaseFilter, OutputLockStore,
    WalletCommitmentTrees, WalletRead, WalletWrite,
};
use zcash_client_backend::fees::zip317::SingleOutputChangeStrategy;
use zcash_client_backend::fees::DustOutputPolicy;
use zcash_client_backend::proposal::Proposal;
use zcash_client_backend::proto::service::compact_tx_streamer_client::CompactTxStreamerClient;
use zcash_client_backend::proto::service::{BlockId, ChainSpec, LightdInfo, RawTransaction, TxFilter};
use zcash_client_backend::sync;
use zcash_client_backend::wallet::OvkPolicy;
use zcash_client_backend::zip321::{Payment, TransactionRequest};
use zcash_client_sqlite::util::SystemClock;
use zcash_client_sqlite::wallet::init::{init_wallet_db, WalletMigrationError};
use zcash_client_sqlite::{AccountUuid, ReceivedNoteId, WalletDb};
use zcash_keys::encoding::AddressCodec;
use zcash_keys::keys::{
    ReceiverRequirement, UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedSpendingKey,
};
use zcash_primitives::transaction::fees::zip317::FeeRule;
use zcash_primitives::transaction::TxId;
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::consensus::{BlockHeight, Network, NetworkType};
use zcash_protocol::value::Zatoshis;
use zcash_protocol::{PoolType, ShieldedPool};
use zcash_transparent::address::TransparentAddress;
use zcash_transparent::keys::IncomingViewingKey;

use crate::cache::MemoryBlockCache;
use crate::config::Chain;
use crate::faucet::FaucetClient;

const SYNC_LAG_BLOCKS: u64 = 10;
const COMPACT_BLOCK_BATCH: u32 = 100;
const QUOTE_TTL_MS: u64 = 10 * 60 * 1000;
const LOCK_FOR_BLOCKS: u32 = 30;
/// Testnet demo policy: one confirmation for own change and external notes.
/// Mainnet ZIP 315 defaults (3 trusted / 10 untrusted) made post-send change look
/// like a zero balance for several blocks and triggered "fund the wallet" blockers.
fn wallet_confirmations(chain: Chain) -> ConfirmationsPolicy {
    match chain {
        Chain::Test => ConfirmationsPolicy::MIN,
        Chain::Main => ConfirmationsPolicy::default(),
    }
}
const RECOVERY_FILE: &str = "recovery.txt";
const CLAIM_FILE: &str = "browser-wallet.json";
const BIRTHDAY_FILE: &str = "birthday.txt";
const JOURNAL_FILE: &str = "send-journal.json";
const DISCLOSURE_ACCOUNT_INDEX: u32 = 1;
const DISCLOSURE_EXPORT_TTL_MS: u64 = 2 * 60 * 1000;
const PENDING_WALLET_TTL_MS: u64 = 10 * 60 * 1000;

type ServiceRng = UnwrapErr<SysRng>;
type Db = WalletDb<Connection, Network, SystemClock, ServiceRng>;
type TransferProposal = Proposal<FeeRule, ReceivedNoteId>;
type ShieldProposal = Proposal<FeeRule, core::convert::Infallible>;

fn service_rng() -> ServiceRng {
    UnwrapErr(SysRng)
}

enum StoredProposal {
    Transfer(TransferProposal),
    Shield(ShieldProposal),
}

struct StoredQuote {
    proposal: StoredProposal,
    owner: LockOwner,
    recipient: String,
    amount_zatoshis: u64,
    fee_zatoshis: u64,
    created_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SendState {
    Building,
    Prepared,
    Accepted,
    Indeterminate,
    Interrupted,
    Rejected,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JournalSend {
    quote_id: String,
    recipient: String,
    amount_zatoshis: u64,
    fee_zatoshis: u64,
    created_ms: u64,
    updated_ms: u64,
    #[serde(default)]
    txids: Vec<String>,
    state: SendState,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Journal {
    version: u32,
    #[serde(default)]
    sends: std::collections::BTreeMap<String, JournalSend>,
}

impl Default for Journal {
    fn default() -> Self {
        Self {
            version: 1,
            sends: std::collections::BTreeMap::new(),
        }
    }
}

struct DisclosureExportChallenge {
    id: String,
    created_ms: u64,
}

enum PendingKind {
    Create,
    Claim,
}

struct PendingWallet {
    id: String,
    kind: PendingKind,
    phrase: SecretVec<u8>,
    new_password: SecretVec<u8>,
    created_ms: u64,
    wallet_id: Option<String>,
    vault: Option<crate::session_secret::VaultRecord>,
    birthday_height: Option<u32>,
}

struct Wallet {
    chain: Chain,
    db: Db,
    db_path: PathBuf,
    data_dir: PathBuf,
    seed: Option<SecretVec<u8>>,
    password_configured: bool,
    account_id: Option<AccountUuid>,
    account_index: Option<zip32::AccountId>,
    disclosure_account_id: Option<AccountUuid>,
    disclosure_account_index: Option<zip32::AccountId>,
    disclosure_export: Option<DisclosureExportChallenge>,
    quotes: HashMap<String, StoredQuote>,
    journal: Journal,
    journal_path: PathBuf,
    startup_note: Option<String>,
}

impl Wallet {
    fn insert_send(&mut self, record: JournalSend) -> Result<(), String> {
        let quote_id = record.quote_id.clone();
        self.journal.sends.insert(quote_id.clone(), record);
        if let Err(error) = save_journal(&self.journal_path, &self.journal) {
            self.journal.sends.remove(&quote_id);
            return Err(error);
        }
        Ok(())
    }

    fn mark_send(
        &mut self,
        quote_id: &str,
        state: SendState,
        message: Option<String>,
        txids: Option<Vec<String>>,
    ) -> Result<(), String> {
        let Some(record) = self.journal.sends.get_mut(quote_id) else {
            return Err(format!("The send journal has no entry for {quote_id}."));
        };
        record.state = state;
        record.message = message;
        if let Some(txids) = txids {
            record.txids = txids;
        }
        record.updated_ms = now_ms();
        save_journal(&self.journal_path, &self.journal)
    }
}

pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    chain: Chain,
    data_dir: PathBuf,
    wallets: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<Wallet>>>>,
    sessions: tokio::sync::Mutex<HashMap<String, String>>,
    pending: tokio::sync::Mutex<HashMap<String, PendingWallet>>,
    legacy_lock: tokio::sync::Mutex<()>,
    endpoint: Option<String>,
    cache: MemoryBlockCache,
    prover: LocalTxProver,
    faucet: Option<FaucetClient>,
    faucet_claim: Arc<tokio::sync::Mutex<()>>,
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

#[derive(Debug)]
pub struct ReadinessReport {
    pub sync: api_types::SyncState,
    pub detected_zatoshis: Option<u64>,
    pub spendable_zatoshis: Option<u64>,
    pub pending_change_zatoshis: Option<u64>,
    pub pending_spendability_zatoshis: Option<u64>,
    pub locked_zatoshis: Option<u64>,
    pub transparent_detected_zatoshis: Option<u64>,
    pub transparent_spendable_zatoshis: Option<u64>,
    pub can_submit: bool,
    pub blocker: String,
    pub note: String,
}

pub struct QuoteReport {
    pub quote_id: Option<String>,
    pub recipient: Option<String>,
    pub amount_zatoshis: Option<u64>,
    pub fee_zatoshis: Option<u64>,
    pub expires_at_ms: Option<u64>,
    pub note: String,
}

pub struct AddressReport {
    pub address: Option<String>,
    pub transparent_address: Option<String>,
    pub birthday_height: Option<u32>,
    pub note: String,
}

pub struct DisclosureStatusReport {
    pub account_index: Option<u32>,
    pub address: Option<String>,
    pub birthday_height: Option<u32>,
    pub detected_zatoshis: Option<u64>,
    pub spendable_zatoshis: Option<u64>,
    pub sync: api_types::SyncState,
    pub note: String,
}

pub struct DisclosureExportRequestReport {
    pub export_id: String,
    pub expires_at_ms: u64,
    pub account_index: u32,
    pub note: String,
}

pub struct DisclosureKeyReport {
    pub export_id: String,
    pub account_index: u32,
    pub ufvk: String,
    pub uivk: String,
}

#[derive(Clone, Copy)]
pub struct SendExpectation<'a> {
    pub recipient: &'a str,
    pub amount_zatoshis: u64,
    pub fee_zatoshis: u64,
}

pub enum SendReport {
    Accepted {
        txids: Vec<String>,
    },
    Rejected {
        message: String,
    },
    Indeterminate {
        message: String,
        txids: Vec<String>,
    },
}

pub struct StatusReport {
    pub txid: String,
    pub mined_height: Option<u64>,
    pub block_hash: Option<String>,
    pub confirmations: Option<u64>,
    pub confirmation_met: bool,
    pub confirmation_note: String,
    pub confirmation_available: bool,
    pub detected: bool,
    pub detection_note: String,
    pub detection_available: bool,
}

/// One wallet-affecting transaction from `v_transactions`, with amounts in zatoshis.
#[derive(Debug, Clone)]
pub struct HistoryEntry {
    pub txid: String,
    pub mined_height: Option<u32>,
    pub account_balance_delta_zatoshis: String,
    pub total_received_zatoshis: String,
    pub total_spent_zatoshis: String,
    pub fee_paid_zatoshis: Option<String>,
    /// `received` | `sent` | `shield` | `other`
    pub kind: String,
    pub received_note_count: u32,
    pub sent_note_count: u32,
}

enum SendStep {
    Reply(SendReport),
    Broadcast {
        quote_id: String,
        txids: Vec<TxId>,
        raw: Vec<(TxId, Vec<u8>)>,
        resumed: bool,
    },
}

struct DetectionReport {
    detected: bool,
    note: String,
    available: bool,
}

impl AppState {
    pub async fn open(
        chain: Chain,
        data_dir: &Path,
        endpoint: Option<String>,
        _birthday_height: Option<u32>,
        faucet_endpoint: Option<String>,
    ) -> Result<Self, String> {
        let faucet = if chain.is_main() {
            None
        } else {
            match faucet_endpoint {
                Some(endpoint) => Some(FaucetClient::new(&endpoint)?),
                None => None,
            }
        };
        fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
        set_private_dir(data_dir)?;
        remember_chain(data_dir, chain)?;
        let vaults = data_dir.join("vaults");
        fs::create_dir_all(&vaults).map_err(|error| error.to_string())?;
        set_private_dir(&vaults)?;
        Ok(Self {
            inner: Arc::new(Inner {
                chain,
                data_dir: data_dir.to_path_buf(),
                wallets: tokio::sync::Mutex::new(HashMap::new()),
                sessions: tokio::sync::Mutex::new(HashMap::new()),
                pending: tokio::sync::Mutex::new(HashMap::new()),
                legacy_lock: tokio::sync::Mutex::new(()),
                endpoint,
                cache: MemoryBlockCache::default(),
                prover: LocalTxProver::bundled(),
                faucet,
                faucet_claim: Arc::new(tokio::sync::Mutex::new(())),
            }),
        })
    }

    pub fn chain(&self) -> Chain {
        self.inner.chain
    }

    async fn wallet_handle(&self, token: &str) -> Result<Arc<tokio::sync::Mutex<Wallet>>, String> {
        let sessions = self.inner.sessions.lock().await;
        let wallet_id = sessions
            .get(token)
            .cloned()
            .ok_or_else(|| "Unlock the wallet before using it.".to_string())?;
        drop(sessions);
        let wallets = self.inner.wallets.lock().await;
        wallets
            .get(&wallet_id)
            .cloned()
            .ok_or_else(|| "Unlock the wallet before using it.".to_string())
    }

    pub async fn session_unlocked(&self, token: &str) -> bool {
        let Ok(handle) = self.wallet_handle(token).await else {
            return false;
        };
        let wallet = handle.lock().await;
        !(wallet.password_configured && wallet.seed.is_none())
    }

    #[cfg(test)]
    pub async fn adopt_for_test(&self, load_plaintext: bool) -> Result<String, String> {
        let wallet = load_wallet_database(&self.inner.data_dir, load_plaintext, self.inner.chain)?;
        let wallet_id = format!("w_{}", uuid::Uuid::new_v4().simple());
        self.inner
            .wallets
            .lock()
            .await
            .insert(wallet_id.clone(), Arc::new(tokio::sync::Mutex::new(wallet)));
        let token = random_token();
        self.inner.sessions.lock().await.insert(token.clone(), wallet_id);
        Ok(token)
    }

    pub fn faucet_client(&self) -> Option<&FaucetClient> {
        self.inner.faucet.as_ref()
    }

    pub fn faucet_claim_lock(&self) -> Arc<tokio::sync::Mutex<()>> {
        Arc::clone(&self.inner.faucet_claim)
    }

    pub async fn readiness(&self, token: &str) -> ReadinessReport {
        let server_height = match self.server_height().await {
            Ok(height) => Some(height),
            Err(error) => {
                return self.blocked(token, error).await;
            }
        };
        let Ok(handle) = self.wallet_handle(token).await else {
            return denied_readiness("Unlock the wallet before using it.".to_string());
        };
        let mut wallet = handle.lock().await;
        if let Err(error) = sweep_expired_quotes(&mut wallet) {
            wallet.startup_note = Some(format!("Could not release expired quote locks: {error}"));
        }
        readiness_from_wallet(&wallet, server_height)
    }

    pub async fn audit_viewing_key(&self, key: &str, birthday: u32) -> Result<crate::auditor::AuditReport, String> {
        let endpoint = self.inner.endpoint.as_deref().ok_or("Configure LIGHTWALLETD_ENDPOINT before auditing.")?;
        crate::auditor::scan(self.inner.chain, endpoint, key, birthday).await
    }

    pub async fn sync(&self, token: &str) -> ReadinessReport {
        let Some(endpoint) = self.inner.endpoint.clone() else {
            return self
                .blocked(token, "Set LIGHTWALLETD_ENDPOINT before syncing.".to_string())
                .await;
        };
        let mut client = match connect(&endpoint).await {
            Ok(client) => client,
            Err(error) => return self.blocked(token, error).await,
        };
        if let Err(error) = ensure_chain(&mut client, self.inner.chain).await {
            return self.blocked(token, error).await;
        }
        let Ok(handle) = self.wallet_handle(token).await else {
            return denied_readiness("Unlock the wallet before using it.".to_string());
        };
        let mut wallet = handle.lock().await;
        if wallet.account_id.is_none() {
            return empty_readiness(
                wallet.startup_note.clone().unwrap_or_else(|| {
                    "No testnet account is open, so sync cannot start.".to_string()
                }),
                "Sync did not start.".to_string(),
            );
        }
        // Register the seed-derived tm… receiver before sync so refresh_utxos can
        // observe transparent deposits (including unshield-to-self).
        if let Some(account_id) = wallet.account_id {
            let _ = transparent_address_string(&mut wallet, account_id);
        }
        let network = self.inner.chain.zcash();
        let synced = sync::run(
            &mut client,
            &network,
            &self.inner.cache,
            &mut wallet.db,
            COMPACT_BLOCK_BATCH,
        )
        .await;
        let sync_error = synced.err().map(|error| error.to_string());
        if let Some(error) = sync_error.clone() {
            wallet.startup_note = Some(error);
        }
        let _ = sweep_expired_quotes(&mut wallet);
        let server_height = latest_height(&mut client).await.ok();
        let mut report = readiness_from_wallet(&wallet, server_height);
        if let Some(error) = sync_error {
            if report.sync != api_types::SyncState::Synced {
                report.can_submit = false;
                report.blocker = format!("Sync stopped before the testnet tip: {error}");
                report.note = report.blocker.clone();
            }
        }
        report
    }

    async fn catch_up_for_send(&self, token: &str) -> ReadinessReport {
        let current = self.readiness(token).await;
        if current.sync == api_types::SyncState::Syncing {
            self.sync(token).await
        } else {
            current
        }
    }

    pub async fn receiving_address(&self, token: &str) -> AddressReport {
        let Ok(handle) = self.wallet_handle(token).await else {
            return AddressReport {
                address: None,
                transparent_address: None,
                birthday_height: None,
                note: "Unlock the wallet before using it.".to_string(),
            };
        };
        let mut wallet = handle.lock().await;
        let Some(account_id) = wallet.account_id else {
            return AddressReport {
                address: None,
                transparent_address: None,
                birthday_height: None,
                note: wallet.startup_note.clone().unwrap_or_else(|| {
                    "No testnet account is open, so no receiving address exists yet.".to_string()
                }),
            };
        };
        let birthday_height = WalletRead::get_account_birthday(&wallet.db, account_id)
            .ok()
            .map(|height| u32::from(height));
        let shielded = account_address_string(&mut wallet.db, account_id);
        let transparent = transparent_address_string(&mut wallet, account_id);
        match (shielded, transparent) {
            (Ok(address), Ok(transparent_address)) => AddressReport {
                address: Some(address),
                transparent_address: Some(transparent_address),
                birthday_height,
                note: "Default receive is shielded (utest1). transparentAddress (tm) is public on-chain.".to_string(),
            },
            (Ok(address), Err(transparent_error)) => AddressReport {
                address: Some(address),
                transparent_address: None,
                birthday_height,
                note: format!(
                    "Shielded receive is ready. Transparent address unavailable: {transparent_error}"
                ),
            },
            (Err(error), Ok(transparent_address)) => AddressReport {
                address: None,
                transparent_address: Some(transparent_address),
                birthday_height,
                note: format!("The wallet could not read a shielded receiving address: {error}"),
            },
            (Err(error), Err(transparent_error)) => AddressReport {
                address: None,
                transparent_address: None,
                birthday_height,
                note: format!(
                    "The wallet could not read receiving addresses: {error}; transparent: {transparent_error}"
                ),
            },
        }
    }

    pub async fn disclosure_status(&self, token: &str) -> DisclosureStatusReport {
        let server_height = self.server_height().await.ok();
        let Ok(handle) = self.wallet_handle(token).await else {
            return disclosure_status_from_wallet_missing();
        };
        let mut wallet = handle.lock().await;
        disclosure_status_from_wallet(&mut wallet, server_height)
    }

    pub async fn create_disclosure_account(&self, token: &str) -> Result<DisclosureStatusReport, String> {
        {
            let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
            if wallet.disclosure_account_id.is_some() {
                return Ok(disclosure_status_from_wallet(&mut wallet, None));
            }
            if wallet.seed.is_none() {
                return Err(
                    "The recovery file is missing, so this service cannot derive a dedicated disclosure account."
                        .to_string(),
                );
            }
            if wallet.account_id.is_none() {
                return Err("No primary testnet account is open.".to_string());
            }
        }

        let Some(endpoint) = self.inner.endpoint.clone() else {
            return Err(
                "Set LIGHTWALLETD_ENDPOINT before this process can create a disclosure account."
                    .to_string(),
            );
        };
        let mut client = connect(&endpoint).await?;
        ensure_chain(&mut client, self.inner.chain).await?;
        let tip = latest_height(&mut client).await?;
        let tree = client
            .get_tree_state(BlockId {
                height: tip,
                hash: Vec::new(),
            })
            .await
            .map_err(|error| format!("lightwalletd did not return a tree state: {error}"))?;
        let birthday = AccountBirthday::from_treestate(tree.into_inner(), None)
            .map_err(|error| format!("Could not build a disclosure account birthday: {error}"))?;

        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        if wallet.disclosure_account_id.is_some() {
            return Ok(disclosure_status_from_wallet(&mut wallet, Some(tip)));
        }
        let primary_id = wallet
            .account_id
            .ok_or("No primary testnet account is open.")?;

        let (created_id, created_index, spending_key) = {
            let Wallet { db, seed, .. } = &mut *wallet;
            let seed = seed.as_ref().ok_or(
                "The recovery file is missing, so this service cannot derive a dedicated disclosure account.",
            )?;
            let (created_id, spending_key) = WalletWrite::create_account(
                db,
                "disclosure",
                seed,
                &birthday,
                Some("local-file"),
            )
            .map_err(|error| format!("The disclosure account could not be created: {error}"))?;
            let created_index = account_index(db, created_id)?;
            if u32::from(created_index) != DISCLOSURE_ACCOUNT_INDEX {
                return Err(format!(
                    "The wallet created an account at ZIP 32 index {} instead of {DISCLOSURE_ACCOUNT_INDEX}. The disclosure account was not enabled.",
                    u32::from(created_index)
                ));
            }
            if !WalletRead::validate_seed(db, created_id, seed)
                .map_err(|error| error.to_string())?
            {
                return Err("The new disclosure account does not match the local recovery seed. The disclosure account was not enabled.".to_string());
            }
            (created_id, created_index, spending_key)
        };
        drop(spending_key);

        if created_id == primary_id {
            return Err("The wallet returned the primary account for the disclosure request. The disclosure account was not enabled.".to_string());
        }
        wallet.disclosure_account_id = Some(created_id);
        wallet.disclosure_account_index = Some(created_index);
        wallet.disclosure_export = None;
        Ok(disclosure_status_from_wallet(&mut wallet, Some(tip)))
    }

    pub async fn request_disclosure_export(&self, token: &str) -> Result<DisclosureExportRequestReport, String> {
        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        let _ = disclosure_ufvk(&wallet)?;
        let account_index = wallet
            .disclosure_account_index
            .map(u32::from)
            .ok_or("Create a dedicated disclosure account first.")?;
        let created_ms = now_ms();
        let export_id = format!("export_{}", uuid::Uuid::new_v4().simple());
        wallet.disclosure_export = Some(DisclosureExportChallenge {
            id: export_id.clone(),
            created_ms,
        });
        Ok(DisclosureExportRequestReport {
            export_id,
            expires_at_ms: created_ms.saturating_add(DISCLOSURE_EXPORT_TTL_MS),
            account_index,
            note: "No key has been released yet. Confirm the warning, then reveal the dedicated account's viewing key once."
                .to_string(),
        })
    }

    pub async fn export_disclosure_key(
        &self,
        token: &str,
        export_id: &str,
    ) -> Result<DisclosureKeyReport, String> {
        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        let Some(challenge) = wallet.disclosure_export.as_ref() else {
            return Err("The export request is missing, expired, or already used. Request a new one.".to_string());
        };
        if challenge.id != export_id {
            return Err("The export request is missing, expired, or already used. Request a new one.".to_string());
        }
        let expired = now_ms().saturating_sub(challenge.created_ms) > DISCLOSURE_EXPORT_TTL_MS;
        let challenge = wallet
            .disclosure_export
            .take()
            .expect("export challenge checked above");
        if expired {
            return Err("The export request expired before the key was revealed. Request a new one.".to_string());
        }
        let network = wallet.chain.zcash();
        let ufvk = disclosure_ufvk(&wallet)?;
        let encoded = ufvk
            .encode(&network)
            .map_err(|error| format!("Could not encode the disclosure viewing key: {error}"))?;
        // transparent-inputs may attach a P2PKH item; disclosure export stays shielded-only.
        let encoded = shielded_only_ufvk_encoding(&encoded, wallet.chain.network_type())?;
        validate_exported_ufvk(&encoded, wallet.chain.network_type())?;
        let shielded_ufvk = UnifiedFullViewingKey::decode(&network, &encoded)
            .map_err(|error| format!("Could not re-import the shielded disclosure key: {error}"))?;
        let uivk = shielded_ufvk
            .to_unified_incoming_viewing_key()
            .encode(&network)
            .map_err(|error| {
                format!("Could not encode the disclosure incoming viewing key: {error}")
            })?;
        let account_index = wallet
            .disclosure_account_index
            .map(u32::from)
            .ok_or("Create a dedicated disclosure account first.")?;
        Ok(DisclosureKeyReport {
            export_id: challenge.id,
            account_index,
            ufvk: encoded,
            uivk,
        })
    }

    /// Primary account UFVK + birthday for the opt-in Instant Sync server. Testnet only.
    pub async fn export_primary_viewing_key(&self, token: &str) -> Result<(String, Option<u32>), String> {
        if self.inner.chain.is_main() {
            return Err("Instant Sync is testnet only. The primary viewing key was not released.".to_string());
        }
        let handle = self.wallet_handle(token).await?;
        let wallet = handle.lock().await;
        let account_id = wallet.account_id.ok_or("No account is open, so there is no viewing key to share.")?;
        let keys = WalletRead::get_unified_full_viewing_keys(&wallet.db).map_err(|error| error.to_string())?;
        let ufvk = keys
            .get(&account_id)
            .ok_or("The primary account has no unified full viewing key in the wallet database.")?;
        let encoded = ufvk
            .encode(&wallet.chain.zcash())
            .map_err(|error| format!("Could not encode the primary viewing key: {error}"))?;
        if !encoded.starts_with("uviewtest") {
            return Err("The primary viewing key is not a testnet key, so it was withheld.".to_string());
        }
        let birthday = WalletRead::get_account_birthday(&wallet.db, account_id)
            .ok()
            .map(u32::from);
        Ok((encoded, birthday))
    }

    pub async fn quote(&self, token: &str, recipient: &str, amount_zatoshis: u64) -> Result<QuoteReport, String> {
        let address = parse_payment_recipient(recipient, self.inner.chain)?;
        if amount_zatoshis == 0 {
            return Err("Amount must be greater than zero.".to_string());
        }
        let recipient = address.encode();
        let zatoshis = Zatoshis::from_u64(amount_zatoshis)
            .map_err(|_| "Amount is not a valid zatoshis value.".to_string())?;
        let payment = Payment::without_memo(address, zatoshis);
        let request =
            TransactionRequest::new(vec![payment]).map_err(|error| error.to_string())?;
        let caught_up = self.catch_up_for_send(token).await;
        if caught_up.sync == api_types::SyncState::Syncing {
            return Ok(QuoteReport {
                quote_id: None,
                recipient: Some(recipient),
                amount_zatoshis: Some(amount_zatoshis),
                fee_zatoshis: None,
                expires_at_ms: None,
                note: caught_up.blocker,
            });
        }
        let server_height = self.server_height().await.ok();
        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        sweep_expired_quotes(&mut wallet)?;
        let mut readiness = readiness_from_wallet(&wallet, server_height);
        if !readiness.can_submit
            && readiness.blocker.contains("locked by an open quote")
            && !wallet.quotes.is_empty()
        {
            release_unsent_quotes(&mut wallet)?;
            readiness = readiness_from_wallet(&wallet, server_height);
        }
        if !readiness.can_submit {
            return Ok(QuoteReport {
                quote_id: None,
                recipient: Some(recipient),
                amount_zatoshis: Some(amount_zatoshis),
                fee_zatoshis: None,
                expires_at_ms: None,
                note: readiness.blocker,
            });
        }
        let account_id = wallet.account_id.ok_or("No testnet account is open.")?;
        let owner = LockOwner::random(&mut service_rng());
        let selector = GreedyInputSelector::<Db>::new();
        let change = SingleOutputChangeStrategy::new(
            FeeRule::standard(),
            None,
            ShieldedPool::Orchard,
            DustOutputPolicy::default(),
        );
        let network = wallet.chain.zcash();
        let confirmations = wallet_confirmations(wallet.chain);
        let proposal = propose_transfer::<
            Db,
            Network,
            GreedyInputSelector<Db>,
            SingleOutputChangeStrategy<FeeRule, Db>,
            <Db as WalletCommitmentTrees>::Error,
        >(
            &mut wallet.db,
            &network,
            account_id,
            &selector,
            &change,
            request,
            confirmations,
            &SpendPolicy::default(),
            Some(LockRequest::new(owner, LOCK_FOR_BLOCKS)),
            None,
        )
        .map_err(|error| {
            let message = error.to_string();
            if message.to_ascii_lowercase().contains("lock") {
                "Another open quote is holding the notes this payment would spend. Wait for that quote to expire, then request a new quote.".to_string()
            } else {
                message
            }
        })?;
        if let Err(error) = transfer_proposal_matches(&proposal, &recipient, amount_zatoshis) {
            let _ = unlock_proposal_inputs(&mut wallet.db, &proposal, owner);
            return Err(error);
        }
        let fee_zatoshis = match transfer_proposal_fee(&proposal) {
            Ok(fee) => fee,
            Err(error) => {
                let _ = unlock_proposal_inputs(&mut wallet.db, &proposal, owner);
                return Err(error);
            }
        };
        let created_ms = now_ms();
        let quote_id = format!("quote_{}", uuid::Uuid::new_v4().simple());
        let public_note = if recipient.starts_with("tm") || recipient.starts_with("t2") {
            "Fee comes from propose_transfer to a transparent testnet recipient. The output is public on-chain."
        } else {
            "Fee comes from propose_transfer. The quote is bound to this recipient, amount, fee, and expiry."
        };
        wallet.quotes.insert(
            quote_id.clone(),
            StoredQuote {
                proposal: StoredProposal::Transfer(proposal),
                owner,
                recipient: recipient.clone(),
                amount_zatoshis,
                fee_zatoshis,
                created_ms,
            },
        );
        Ok(QuoteReport {
            quote_id: Some(quote_id),
            recipient: Some(recipient),
            amount_zatoshis: Some(amount_zatoshis),
            fee_zatoshis: Some(fee_zatoshis),
            expires_at_ms: Some(created_ms.saturating_add(QUOTE_TTL_MS)),
            note: public_note.to_string(),
        })
    }

    pub async fn quote_shield(&self, token: &str) -> Result<QuoteReport, String> {
        let caught_up = self.catch_up_for_send(token).await;
        if caught_up.sync == api_types::SyncState::Syncing {
            return Ok(QuoteReport {
                quote_id: None,
                recipient: None,
                amount_zatoshis: None,
                fee_zatoshis: None,
                expires_at_ms: None,
                note: caught_up.blocker,
            });
        }
        let server_height = self.server_height().await.ok();
        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        sweep_expired_quotes(&mut wallet)?;
        let account_id = wallet.account_id.ok_or("No testnet account is open.")?;
        let shielded = account_address_string(&mut wallet.db, account_id)?;
        let transparent = transparent_address_string(&mut wallet, account_id)?;
        let network = wallet.chain.zcash();
        let transparent_addr = TransparentAddress::decode(&network, &transparent)
            .map_err(|error| format!("Could not decode the transparent receive address: {error}"))?;
        let (_detected, transparent_spendable) =
            transparent_balances_for_account(&wallet, account_id, server_height);
        if transparent_spendable == 0 {
            return Ok(QuoteReport {
                quote_id: None,
                recipient: Some(shielded),
                amount_zatoshis: Some(0),
                fee_zatoshis: None,
                expires_at_ms: None,
                note: format!(
                    "No spendable transparent {} balance to shield.",
                    wallet.chain.as_str()
                ),
            });
        }
        let owner = LockOwner::random(&mut service_rng());
        let selector = GreedyInputSelector::<Db>::new();
        let change = SingleOutputChangeStrategy::new(
            FeeRule::standard(),
            None,
            ShieldedPool::Orchard,
            DustOutputPolicy::default(),
        );
        let threshold = Zatoshis::from_u64(1).expect("1 zatoshi is valid");
        let confirmations = wallet_confirmations(wallet.chain);
        let proposal = propose_shielding::<
            Db,
            Network,
            GreedyInputSelector<Db>,
            SingleOutputChangeStrategy<FeeRule, Db>,
            <Db as WalletCommitmentTrees>::Error,
        >(
            &mut wallet.db,
            &network,
            &selector,
            &change,
            threshold,
            &[transparent_addr],
            account_id,
            confirmations,
            CoinbaseFilter::AllTransparentOutputs,
            Some(LockRequest::new(owner, LOCK_FOR_BLOCKS)),
        )
        .map_err(|error| error.to_string())?;
        let fee_zatoshis = shield_proposal_fee(&proposal).map_err(|error| {
            let _ = unlock_proposal_inputs(&mut wallet.db, &proposal, owner);
            error
        })?;
        let amount_zatoshis = transparent_spendable.saturating_sub(fee_zatoshis);
        if amount_zatoshis == 0 {
            let _ = unlock_proposal_inputs(&mut wallet.db, &proposal, owner);
            return Ok(QuoteReport {
                quote_id: None,
                recipient: Some(shielded),
                amount_zatoshis: Some(0),
                fee_zatoshis: Some(fee_zatoshis),
                expires_at_ms: None,
                note: "Transparent funds are not large enough to shield after fees.".to_string(),
            });
        }
        let created_ms = now_ms();
        let quote_id = format!("quote_{}", uuid::Uuid::new_v4().simple());
        wallet.quotes.insert(
            quote_id.clone(),
            StoredQuote {
                proposal: StoredProposal::Shield(proposal),
                owner,
                recipient: shielded.clone(),
                amount_zatoshis,
                fee_zatoshis,
                created_ms,
            },
        );
        Ok(QuoteReport {
            quote_id: Some(quote_id),
            recipient: Some(shielded),
            amount_zatoshis: Some(amount_zatoshis),
            fee_zatoshis: Some(fee_zatoshis),
            expires_at_ms: Some(created_ms.saturating_add(QUOTE_TTL_MS)),
            note: format!(
                "Shields spendable transparent {} UTXOs into Orchard. Approve to broadcast.",
                wallet.chain.as_str()
            ),
        })
    }

    pub async fn send(
        &self,
        token: &str,
        quote_id: &str,
        approved: bool,
        expectation: Option<SendExpectation<'_>>,
    ) -> Result<SendReport, String> {
        if !approved {
            return Ok(SendReport::Rejected {
                message: "Send requires approved: true and the exact recipient, amount, and fee from the quote.".to_string(),
            });
        }
        let Some(expectation) = expectation else {
            return Ok(SendReport::Rejected {
                message: "Send requires the recipient, amountZatoshis, and feeZatoshis returned by the quote.".to_string(),
            });
        };
        let Some(endpoint) = self.inner.endpoint.clone() else {
            return Ok(SendReport::Rejected {
                message: "Set LIGHTWALLETD_ENDPOINT before sending.".to_string(),
            });
        };

        {
            let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
            if let Some(step) = journal_step(&mut wallet, quote_id, expectation)? {
                drop(wallet);
                return self.finish_send(token, step, &endpoint).await;
            }
            if !wallet.quotes.contains_key(quote_id) {
                return Ok(SendReport::Rejected {
                    message: "That quote is not open. Request a new quote and approve its exact fields."
                        .to_string(),
                });
            }
        }

        let server_height = match self.server_height().await {
            Ok(height) => height,
            Err(error) => {
                return Ok(SendReport::Rejected { message: error });
            }
        };

        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        if let Some(step) = journal_step(&mut wallet, quote_id, expectation)? {
            drop(wallet);
            return self.finish_send(token, step, &endpoint).await;
        }
        let Some(stored) = wallet.quotes.get(quote_id) else {
            return Ok(SendReport::Rejected {
                message: "That quote is not open. Request a new quote and approve its exact fields."
                    .to_string(),
            });
        };
        validate_expectation(
            wallet.chain,
            &stored.recipient,
            stored.amount_zatoshis,
            stored.fee_zatoshis,
            expectation,
        )?;
        if now_ms().saturating_sub(stored.created_ms) > QUOTE_TTL_MS {
            let stored = wallet
                .quotes
                .remove(quote_id)
                .expect("quote checked immediately above");
            let _ = unlock_stored_proposal(&mut wallet, &stored.proposal, stored.owner);
            return Ok(SendReport::Rejected {
                message: "That quote expired. Request a new fee and approve the new quote."
                    .to_string(),
            });
        }
        let readiness = readiness_from_wallet(&wallet, Some(server_height));
        let reserved_by_this_quote = wallet.quotes.contains_key(quote_id)
            && (!readiness.can_submit
                || readiness.blocker.contains("locked by an open quote")
                || matches!(
                    wallet.quotes.get(quote_id).map(|quote| &quote.proposal),
                    Some(StoredProposal::Shield(_))
                ));
        if !readiness.can_submit && !reserved_by_this_quote {
            return Ok(SendReport::Rejected {
                message: readiness.blocker,
            });
        }
        let stored = wallet
            .quotes
            .remove(quote_id)
            .expect("quote checked immediately above");
        let record = JournalSend {
            quote_id: quote_id.to_string(),
            recipient: stored.recipient.clone(),
            amount_zatoshis: stored.amount_zatoshis,
            fee_zatoshis: stored.fee_zatoshis,
            created_ms: stored.created_ms,
            updated_ms: now_ms(),
            txids: Vec::new(),
            state: SendState::Building,
            message: None,
        };
        if let Err(error) = wallet.insert_send(record) {
            wallet.quotes.insert(quote_id.to_string(), stored);
            return Err(format!(
                "Could not persist the send journal, so nothing was built: {error}"
            ));
        }
        let built = build_transactions(&mut wallet, &self.inner.prover, &stored);
        let (txids, raw) = match built {
            Ok(built) => built,
            Err(message) => {
                let _ = unlock_stored_proposal(&mut wallet, &stored.proposal, stored.owner);
                let _ = wallet.mark_send(
                    quote_id,
                    SendState::Rejected,
                    Some(message.clone()),
                    Some(Vec::new()),
                );
                return Ok(SendReport::Rejected { message });
            }
        };
        let txid_strings: Vec<String> = txids.iter().map(ToString::to_string).collect();
        if let Err(error) =
            wallet.mark_send(quote_id, SendState::Prepared, None, Some(txid_strings.clone()))
        {
            return Ok(SendReport::Indeterminate {
                message: format!(
                    "The transaction was prepared but its ids could not be persisted ({error}). It was not broadcast. Check the wallet history before retrying."
                ),
                txids: txid_strings,
            });
        }
        drop(wallet);
        self.finish_send(
            token,
            SendStep::Broadcast {
                quote_id: quote_id.to_string(),
                txids,
                raw,
                resumed: false,
            },
            &endpoint,
        )
        .await
    }

    async fn finish_send(
        &self,
        token: &str,
        step: SendStep,
        endpoint: &str,
    ) -> Result<SendReport, String> {
        let (quote_id, txids, raw, resumed) = match step {
            SendStep::Reply(report) => return Ok(report),
            SendStep::Broadcast {
                quote_id,
                txids,
                raw,
                resumed,
            } => (quote_id, txids, raw, resumed),
        };
        let all_txids: Vec<String> = txids.iter().map(ToString::to_string).collect();
        if raw.is_empty() {
            let message = "No transaction bytes were prepared, so nothing was broadcast.".to_string();
            self.persist_outcome(token,
                &quote_id,
                SendState::Rejected,
                Some(message.clone()),
                Vec::new(),
            )
            .await;
            return Ok(SendReport::Rejected { message });
        }
        let mut client = match connect(endpoint).await {
            Ok(client) => client,
            Err(message) => {
                return Ok(SendReport::Indeterminate {
                    message,
                    txids: all_txids,
                });
            }
        };
        if let Err(message) = ensure_chain(&mut client, self.inner.chain).await {
            return Ok(SendReport::Indeterminate {
                message,
                txids: all_txids,
            });
        }
        if resumed {
            let mut all_mined = true;
            for txid in &txids {
                if !matches!(chain_mined(&mut client, *txid).await, Some(true)) {
                    all_mined = false;
                }
            }
            if all_mined {
                self.persist_outcome(token,
                    &quote_id,
                    SendState::Accepted,
                    Some("All prepared transactions are already mined on testnet.".to_string()),
                    all_txids.clone(),
                )
                .await;
                return Ok(SendReport::Accepted { txids: all_txids });
            }
        }
        let mut accepted = Vec::new();
        let mut rejections = Vec::new();
        let mut uncertain = Vec::new();
        for (txid, data) in raw {
            match client
                .send_transaction(RawTransaction { data, height: 0 })
                .await
            {
                Ok(response) => {
                    let response = response.into_inner();
                    if response.error_code == 0 {
                        accepted.push(txid);
                    } else {
                        rejections.push(format!(
                            "lightwalletd rejected {}: {}",
                            display_txid(txid),
                            response.error_message
                        ));
                    }
                }
                Err(error) => uncertain.push(format!(
                    "Broadcast of {} did not return a lightwalletd result: {error}",
                    display_txid(txid)
                )),
            }
        }
        let accepted_strings: Vec<String> = accepted.iter().map(|txid| txid.to_string()).collect();
        if rejections.is_empty() && uncertain.is_empty() && accepted.len() == txids.len() {
            self.persist_outcome(token,
                &quote_id,
                SendState::Accepted,
                Some("lightwalletd accepted the transaction bytes.".to_string()),
                accepted_strings.clone(),
            )
            .await;
            return Ok(SendReport::Accepted {
                txids: accepted_strings,
            });
        }
        if accepted.is_empty() {
            if !uncertain.is_empty() {
                let message = format!(
                    "The broadcast did not return a definite result, so the transaction may have reached lightwalletd. Check the transaction status before trying again. {}",
                    uncertain.join(" ")
                );
                self.persist_outcome(token,
                    &quote_id,
                    SendState::Indeterminate,
                    Some(message.clone()),
                    all_txids.clone(),
                )
                .await;
                return Ok(SendReport::Indeterminate {
                    message,
                    txids: all_txids,
                });
            }
            if resumed {
                let message = format!(
                    "The prepared transaction was rebroadcast, but lightwalletd did not report acceptance. It may already be in the mempool, so check the transaction status before trying again. {}",
                    rejections.join(" ")
                );
                self.persist_outcome(token,
                    &quote_id,
                    SendState::Indeterminate,
                    Some(message.clone()),
                    all_txids.clone(),
                )
                .await;
                return Ok(SendReport::Indeterminate {
                    message,
                    txids: all_txids,
                });
            }
            let message = format!(
                "lightwalletd did not accept the transaction. {}",
                rejections.join(" ")
            );
            self.persist_outcome(token,
                &quote_id,
                SendState::Rejected,
                Some(message.clone()),
                Vec::new(),
            )
            .await;
            return Ok(SendReport::Rejected { message });
        }
        let message = format!(
            "lightwalletd accepted some transactions, but not all. Check each transaction id before retrying. {}",
            rejections
                .iter()
                .chain(uncertain.iter())
                .cloned()
                .collect::<Vec<_>>()
                .join(" ")
        );
        self.persist_outcome(token,
            &quote_id,
            SendState::Indeterminate,
            Some(message.clone()),
            accepted_strings.clone(),
        )
        .await;
        Ok(SendReport::Indeterminate {
            message,
            txids: accepted_strings,
        })
    }

    async fn persist_outcome(
        &self,
        token: &str,
        quote_id: &str,
        state: SendState,
        message: Option<String>,
        txids: Vec<String>,
    ) {
        let Ok(handle) = self.wallet_handle(token).await else {
            return;
        };
        let mut wallet = handle.lock().await;
        if let Err(error) = wallet.mark_send(quote_id, state, message, Some(txids)) {
            eprintln!("Could not update the send journal: {error}");
        }
    }

    pub async fn history(&self, token: &str, limit: usize) -> Result<Vec<HistoryEntry>, String> {
        let handle = self.wallet_handle(token).await?;
        let wallet = handle.lock().await;
        let account_id = wallet
            .account_id
            .ok_or_else(|| "Create or unlock a wallet before reading history.".to_string())?;
        let db_path = wallet.db_path.clone();
        drop(wallet);
        list_wallet_history(&db_path, account_id, limit)
    }

    pub async fn transaction_status(&self, token: &str, txid_text: &str) -> Result<StatusReport, String> {
        let txid = parse_txid(txid_text)?;
        let txid_display = display_txid(txid);
        let Some(endpoint) = self.inner.endpoint.clone() else {
            return Ok(unavailable_status(
                &txid_display,
                "Set LIGHTWALLETD_ENDPOINT before chain status can be read.",
            ));
        };
        let mut client = match connect(&endpoint).await {
            Ok(client) => client,
            Err(error) => return Ok(unavailable_status(&txid_display, &error)),
        };
        if let Err(error) = ensure_chain(&mut client, self.inner.chain).await {
            return Ok(unavailable_status(&txid_display, &error));
        }
        let server_height = latest_height(&mut client).await.ok();
        let transaction = client
            .get_transaction(TxFilter {
                block: None,
                index: 0,
                hash: txid.as_ref().to_vec(),
            })
            .await;
        let (confirmation_met, mined_height, confirmations, confirmation_note, confirmation_available) =
            match transaction {
                Ok(response) => {
                    let raw = response.into_inner();
                    if raw.height == 0 {
                        (
                            false,
                            None,
                            None,
                            "lightwalletd returned the transaction without a mined height."
                                .to_string(),
                            true,
                        )
                    } else {
                        let confirmations = server_height
                            .map(|tip| tip.saturating_sub(raw.height).saturating_add(1));
                        (
                            confirmations.is_some_and(|count| count >= 1),
                            Some(raw.height),
                            confirmations,
                            match confirmations {
                                Some(count) => format!(
                                    "lightwalletd mined this transaction at height {} with {count} confirmation(s) against the current tip.",
                                    raw.height
                                ),
                                None => format!(
                                    "lightwalletd mined this transaction at height {}, and the current tip was not available.",
                                    raw.height
                                ),
                            },
                            true,
                        )
                    }
                }
                Err(error) => (
                    false,
                    None,
                    None,
                    format!("lightwalletd did not return this transaction: {error}"),
                    false,
                ),
            };

        let block_hash = match mined_height {
            Some(height) => block_hash_at(&mut client, height).await,
            None => None,
        };

        let handle = self.wallet_handle(token).await?;
        let wallet = handle.lock().await;
        let (detected, detection_note, detection_available) =
            match detect_recipient_output(&wallet, txid, confirmation_met) {
                Ok(report) => (report.detected, report.note, report.available),
                Err(error) => (false, error, false),
            };
        Ok(StatusReport {
            txid: txid_display,
            mined_height,
            block_hash,
            confirmations,
            confirmation_met,
            confirmation_note,
            confirmation_available,
            detected,
            detection_note,
            detection_available,
        })
    }

    async fn server_height(&self) -> Result<u64, String> {
        let Some(endpoint) = self.inner.endpoint.clone() else {
            return Err(
                "Set LIGHTWALLETD_ENDPOINT before the wallet can be compared with testnet."
                    .to_string(),
            );
        };
        let mut client = connect(&endpoint).await?;
        ensure_chain(&mut client, self.inner.chain).await?;
        latest_height(&mut client).await
    }

    async fn blocked(&self, token: &str, blocker: String) -> ReadinessReport {
        let mut report = if let Ok(handle) = self.wallet_handle(token).await {
            let wallet = handle.lock().await;
            readiness_from_wallet(&wallet, None)
        } else {
            denied_readiness(blocker.clone())
        };
        report.can_submit = false;
        report.sync = api_types::SyncState::Unknown;
        report.blocker = blocker;
        report
    }

    pub async fn is_locked(&self, token: &str) -> bool {
        !self.session_unlocked(token).await
    }

    pub async fn session_status(&self, token: Option<&str>) -> SessionStatus {
        let legacy_unclaimed = legacy_wallet_unclaimed(&self.inner.data_dir);
        let Some(token) = token else {
            return SessionStatus {
                locked: true,
                has_wallet: false,
                has_password: false,
                legacy_unclaimed,
            };
        };
        let Ok(handle) = self.wallet_handle(token).await else {
            return SessionStatus {
                locked: true,
                has_wallet: false,
                has_password: false,
                legacy_unclaimed,
            };
        };
        let wallet = handle.lock().await;
        SessionStatus {
            locked: wallet.password_configured && wallet.seed.is_none(),
            has_wallet: true,
            has_password: wallet.password_configured,
            legacy_unclaimed,
        }
    }

    pub async fn set_password(&self, token: &str, password: &str) -> Result<(), String> {
        crate::session_secret::assert_password(password)?;
        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        if wallet.password_configured {
            return Err("This wallet already has a password.".to_string());
        }
        if wallet.seed.is_none() {
            return Err("The recovery phrase is not loaded, so a password was not set.".to_string());
        }
        let phrase = fs::read_to_string(wallet.data_dir.join(RECOVERY_FILE)).map_err(|_| {
            "The recovery phrase file is missing, so a password was not set.".to_string()
        })?;
        let mnemonic = <Mnemonic>::from_phrase(phrase.trim())
            .map_err(|_| "The recovery phrase file is not a valid phrase.".to_string())?;
        let derived = SecretVec::new(mnemonic.to_seed("").to_vec());
        let loaded = wallet
            .seed
            .as_ref()
            .ok_or("The recovery phrase is not loaded, so a password was not set.")?;
        if derived.expose_secret() != loaded.expose_secret() {
            return Err("The recovery phrase file does not match the loaded wallet.".to_string());
        }
        crate::session_secret::encrypt_phrase(&wallet.data_dir, phrase.trim(), password)?;
        wallet.password_configured = true;
        Ok(())
    }

    pub async fn unlock_vault(
        &self,
        password: &str,
        wallet_id: &str,
        kdf_salt: &str,
        ciphertext: &str,
    ) -> Result<SessionGrant, String> {
        let record = crate::session_secret::VaultRecord {
            version: 1,
            kdf_salt: kdf_salt.to_string(),
            ciphertext: ciphertext.to_string(),
        };
        let phrase = crate::session_secret::open_vault(password, &record)?;
        let seed = seed_from_phrase(&phrase)?;
        let dir = directory_for(&self.inner.data_dir, wallet_id)?;
        let existing = self.inner.wallets.lock().await.get(wallet_id).cloned();
        if let Some(handle) = existing {
            let mut wallet = handle.lock().await;
            bind_seed(&mut wallet, &seed)?;
        } else {
            let mut wallet = load_wallet_database(&dir, false, self.inner.chain)?;
            bind_seed(&mut wallet, &seed)?;
            self.inner
                .wallets
                .lock()
                .await
                .insert(wallet_id.to_string(), Arc::new(tokio::sync::Mutex::new(wallet)));
        }
        let session_token = self.issue_token(wallet_id).await?;
        Ok(SessionGrant { session_token })
    }

    pub async fn lock(&self, token: &str) -> Result<(), String> {
        let handle = self.wallet_handle(token).await?;
        let mut wallet = handle.lock().await;
        if !wallet.password_configured {
            return Err("Set a password before logging out.".to_string());
        }
        wallet.seed = None;
        wallet.disclosure_export = None;
        wallet.quotes.clear();
        Ok(())
    }

    pub async fn begin_new_wallet(&self, new_password: &str) -> Result<NewWalletChallenge, String> {
        crate::session_secret::assert_password(new_password)?;
        let mnemonic = <Mnemonic>::generate(Count::Words24);
        let phrase = mnemonic.phrase().to_string();
        let id = format!("wallet_{}", uuid::Uuid::new_v4().simple());
        let created_ms = now_ms();
        self.inner.pending.lock().await.insert(
            id.clone(),
            PendingWallet {
                id: id.clone(),
                kind: PendingKind::Create,
                phrase: SecretVec::new(phrase.clone().into_bytes()),
                new_password: SecretVec::new(new_password.as_bytes().to_vec()),
                created_ms,
                wallet_id: None,
                vault: None,
                birthday_height: None,
            },
        );
        Ok(NewWalletChallenge {
            create_id: id,
            phrase,
            expires_at_ms: created_ms.saturating_add(PENDING_WALLET_TTL_MS),
        })
    }

    pub async fn cancel_new_wallet(&self, create_id: &str) -> Result<(), String> {
        let mut pending = self.inner.pending.lock().await;
        match pending.get(create_id) {
            Some(item) if item.vault.is_none() => {
                pending.remove(create_id);
                Ok(())
            }
            Some(_) => Err("That wallet was already created. Open it from this browser.".to_string()),
            None => Err("That new-wallet request is not pending.".to_string()),
        }
    }

    pub async fn confirm_new_wallet(&self, create_id: &str) -> Result<VaultChallenge, String> {
        let _ = self
            .inner
            .endpoint
            .clone()
            .ok_or("Set LIGHTWALLETD_ENDPOINT before creating a wallet.".to_string())?;
        self.finish_new_wallet(create_id, false).await
    }

    #[cfg(test)]
    pub async fn confirm_new_wallet_offline(&self, create_id: &str) -> Result<VaultChallenge, String> {
        self.finish_new_wallet(create_id, true).await
    }

    pub async fn acknowledge_wallet(&self, create_id: &str) -> Result<SessionGrant, String> {
        let wallet_id = {
            let mut pending = self.inner.pending.lock().await;
            let item = pending
                .get(create_id)
                .ok_or("Confirm the new seed before saving it in this browser.")?;
            if !matches!(item.kind, PendingKind::Create) || item.vault.is_none() {
                return Err("Confirm the new seed before saving it in this browser.".to_string());
            }
            let wallet_id = item
                .wallet_id
                .clone()
                .ok_or("Confirm the new seed before saving it in this browser.")?;
            pending.remove(create_id);
            wallet_id
        };
        let session_token = self.issue_token(&wallet_id).await?;
        Ok(SessionGrant { session_token })
    }

    pub async fn begin_claim(&self, password: &str) -> Result<NewWalletChallenge, String> {
        crate::session_secret::assert_password(password)?;
        let _guard = self.inner.legacy_lock.lock().await;
        if !legacy_wallet_unclaimed(&self.inner.data_dir) {
            return Err("There is no unclaimed wallet on this computer.".to_string());
        }
        let phrase = fs::read_to_string(self.inner.data_dir.join(RECOVERY_FILE))
            .map_err(|_| "The wallet phrase on this computer could not be read.".to_string())?;
        let phrase = phrase.trim().to_string();
        let loaded = load_wallet_database(&self.inner.data_dir, true, self.inner.chain)?;
        let account_id = loaded
            .account_id
            .ok_or("The wallet on this computer has no account.")?;
        let seed = loaded
            .seed
            .as_ref()
            .ok_or("The wallet phrase on this computer could not be loaded.")?;
        let matches = WalletRead::validate_seed(&loaded.db, account_id, seed)
            .map_err(|error| error.to_string())?;
        if !matches {
            return Err(
                "The wallet phrase does not match the account on this computer.".to_string(),
            );
        }
        drop(loaded);
        let id = format!("claim_{}", uuid::Uuid::new_v4().simple());
        let created_ms = now_ms();
        self.inner.pending.lock().await.insert(
            id.clone(),
            PendingWallet {
                id: id.clone(),
                kind: PendingKind::Claim,
                phrase: SecretVec::new(phrase.clone().into_bytes()),
                new_password: SecretVec::new(password.as_bytes().to_vec()),
                created_ms,
                wallet_id: None,
                vault: None,
                birthday_height: None,
            },
        );
        Ok(NewWalletChallenge {
            create_id: id,
            phrase,
            expires_at_ms: created_ms.saturating_add(PENDING_WALLET_TTL_MS),
        })
    }

    pub async fn confirm_claim(&self, claim_id: &str) -> Result<VaultChallenge, String> {
        let _guard = self.inner.legacy_lock.lock().await;
        let (phrase, password) = {
            let pending = self.inner.pending.lock().await;
            let item = pending
                .get(claim_id)
                .ok_or("Start the move before confirming it.")?;
            if !matches!(item.kind, PendingKind::Claim) {
                return Err("Start the move before confirming it.".to_string());
            }
            if pending_expired(item.created_ms) {
                return Err("That move expired. Start again.".to_string());
            }
            if let (Some(wallet_id), Some(vault)) = (&item.wallet_id, &item.vault) {
                return Ok(vault_challenge(wallet_id, vault, item.birthday_height));
            }
            (
                String::from_utf8(item.phrase.expose_secret().clone())
                    .map_err(|_| "The pending recovery phrase is not text.".to_string())?,
                String::from_utf8(item.new_password.expose_secret().clone())
                    .map_err(|_| "The pending password is not text.".to_string())?,
            )
        };
        if claim_wallet_id(&self.inner.data_dir).is_some() {
            return Err("This wallet was already moved into a browser.".to_string());
        }
        let loaded = load_wallet_database(&self.inner.data_dir, true, self.inner.chain)?;
        let account_id = loaded
            .account_id
            .ok_or("The wallet on this computer has no account.")?;
        let birthday_height = WalletRead::get_account_birthday(&loaded.db, account_id)
            .ok()
            .map(u32::from);
        drop(loaded);
        let vault = crate::session_secret::seal_vault(&password, &phrase)?;
        let wallet_id = new_wallet_id();
        let mut pending = self.inner.pending.lock().await;
        let item = pending
            .get_mut(claim_id)
            .ok_or("Start the move before confirming it.")?;
        if let (Some(existing_id), Some(existing)) = (&item.wallet_id, &item.vault) {
            return Ok(vault_challenge(existing_id, existing, item.birthday_height));
        }
        item.wallet_id = Some(wallet_id.clone());
        item.vault = Some(vault.clone());
        item.birthday_height = birthday_height;
        Ok(vault_challenge(&wallet_id, &vault, birthday_height))
    }

    pub async fn acknowledge_claim(&self, claim_id: &str) -> Result<SessionGrant, String> {
        let _guard = self.inner.legacy_lock.lock().await;
        let (wallet_id, password, vault) = {
            let pending = self.inner.pending.lock().await;
            let item = pending
                .get(claim_id)
                .ok_or("Save the wallet in this browser before finishing the move.")?;
            if !matches!(item.kind, PendingKind::Claim) {
                return Err("Save the wallet in this browser before finishing the move.".to_string());
            }
            let wallet_id = item.wallet_id.clone().ok_or(
                "Confirm the move before saving it in this browser.",
            )?;
            let vault = item.vault.clone().ok_or(
                "Confirm the move before saving it in this browser.",
            )?;
            let password = String::from_utf8(item.new_password.expose_secret().clone())
                .map_err(|_| "The pending password is not text.".to_string())?;
            (wallet_id, password, vault)
        };
        if let Some(existing) = claim_wallet_id(&self.inner.data_dir) {
            if existing != wallet_id {
                return Err("This wallet was already moved into a browser.".to_string());
            }
        } else {
            write_claim_marker(&self.inner.data_dir, &wallet_id)?;
        }
        crate::session_secret::remove_secret_file(&self.inner.data_dir.join(RECOVERY_FILE))?;
        let phrase = crate::session_secret::open_vault(&password, &vault)?;
        let seed = seed_from_phrase(&phrase)?;
        let existing = self.inner.wallets.lock().await.get(&wallet_id).cloned();
        if let Some(handle) = existing {
            let mut wallet = handle.lock().await;
            bind_seed(&mut wallet, &seed)?;
        } else {
            let mut wallet = load_wallet_database(&self.inner.data_dir, false, self.inner.chain)?;
            bind_seed(&mut wallet, &seed)?;
            self.inner
                .wallets
                .lock()
                .await
                .insert(wallet_id.clone(), Arc::new(tokio::sync::Mutex::new(wallet)));
        }
        self.inner.pending.lock().await.remove(claim_id);
        let session_token = self.issue_token(&wallet_id).await?;
        Ok(SessionGrant { session_token })
    }

    async fn finish_new_wallet(&self, create_id: &str, offline: bool) -> Result<VaultChallenge, String> {
        {
            let pending = self.inner.pending.lock().await;
            let item = pending
                .get(create_id)
                .ok_or("Start a new wallet before confirming it.")?;
            if !matches!(item.kind, PendingKind::Create) {
                return Err("Start a new wallet before confirming it.".to_string());
            }
            if pending_expired(item.created_ms) {
                return Err("That new-wallet request expired. Start again.".to_string());
            }
            if let (Some(wallet_id), Some(vault)) = (&item.wallet_id, &item.vault) {
                return Ok(vault_challenge(wallet_id, vault, item.birthday_height));
            }
        }
        let (phrase, password) = {
            let pending = self.inner.pending.lock().await;
            let item = pending
                .get(create_id)
                .ok_or("Start a new wallet before confirming it.")?;
            (
                String::from_utf8(item.phrase.expose_secret().clone())
                    .map_err(|_| "The pending recovery phrase is not text.".to_string())?,
                String::from_utf8(item.new_password.expose_secret().clone())
                    .map_err(|_| "The pending password is not text.".to_string())?,
            )
        };
        let wallet_id = new_wallet_id();
        let dir = self.inner.data_dir.join("vaults").join(&wallet_id);
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        set_private_dir(&dir)?;
        let installed = async {
            let mut wallet = load_wallet_database(&dir, false, self.inner.chain)?;
            let (seed, account_id, index) = if offline {
                if self.inner.chain.is_main() {
                    return Err(
                        "A mainnet wallet is created from the current chain tip. Set LIGHTWALLETD_ENDPOINT and try again."
                            .to_string(),
                    );
                }
                install_offline_account(&mut wallet.db, &dir, &phrase)?
            } else {
                let endpoint = self.inner.endpoint.clone().ok_or(
                    "Set LIGHTWALLETD_ENDPOINT before creating a wallet.",
                )?;
                create_account_from_phrase(&mut wallet.db, &phrase, &dir.join(BIRTHDAY_FILE), &endpoint, self.inner.chain)
                    .await?
            };
            let matches = WalletRead::validate_seed(&wallet.db, account_id, &seed)
                .map_err(|error| error.to_string())?;
            if !matches {
                return Err("The new seed does not match the account that was created.".to_string());
            }
            if u32::from(index) != 0 {
                return Err(format!(
                    "The new seed created account index {} instead of account 0.",
                    u32::from(index)
                ));
            }
            wallet.seed = Some(seed);
            wallet.account_id = Some(account_id);
            wallet.account_index = Some(index);
            wallet.password_configured = true;
            wallet.startup_note = None;
            let birthday_height = WalletRead::get_account_birthday(&wallet.db, account_id)
                .ok()
                .map(u32::from);
            let vault = crate::session_secret::seal_vault(&password, &phrase)?;
            Ok::<_, String>((wallet, vault, birthday_height))
        }
        .await;
        let (wallet, vault, birthday_height) = match installed {
            Ok(created) => created,
            Err(error) => {
                let _ = fs::remove_dir_all(&dir);
                return Err(error);
            }
        };
        self.inner
            .wallets
            .lock()
            .await
            .insert(wallet_id.clone(), Arc::new(tokio::sync::Mutex::new(wallet)));
        let mut pending = self.inner.pending.lock().await;
        let Some(item) = pending.get_mut(create_id) else {
            return Err("Start a new wallet before confirming it.".to_string());
        };
        if let (Some(existing_id), Some(existing)) = (&item.wallet_id, &item.vault) {
            return Ok(vault_challenge(existing_id, existing, item.birthday_height));
        }
        item.wallet_id = Some(wallet_id.clone());
        item.vault = Some(vault.clone());
        item.birthday_height = birthday_height;
        Ok(vault_challenge(&wallet_id, &vault, birthday_height))
    }

    async fn issue_token(&self, wallet_id: &str) -> Result<String, String> {
        if !self.inner.wallets.lock().await.contains_key(wallet_id) {
            return Err("This browser's wallet is not open.".to_string());
        }
        let token = random_token();
        self.inner
            .sessions
            .lock()
            .await
            .insert(token.clone(), wallet_id.to_string());
        Ok(token)
    }
}

pub struct SessionStatus {
    pub locked: bool,
    pub has_wallet: bool,
    pub has_password: bool,
    pub legacy_unclaimed: bool,
}

pub struct VaultChallenge {
    pub wallet_id: String,
    pub kdf_salt: String,
    pub ciphertext: String,
    pub birthday_height: Option<u32>,
}

pub struct SessionGrant {
    pub session_token: String,
}

pub struct NewWalletChallenge {
    pub create_id: String,
    pub phrase: String,
    pub expires_at_ms: u64,
}

fn empty_readiness(blocker: String, note: String) -> ReadinessReport {
    ReadinessReport {
        sync: api_types::SyncState::Unknown,
        detected_zatoshis: None,
        spendable_zatoshis: None,
        pending_change_zatoshis: None,
        pending_spendability_zatoshis: None,
        locked_zatoshis: None,
        transparent_detected_zatoshis: None,
        transparent_spendable_zatoshis: None,
        can_submit: false,
        blocker,
        note,
    }
}

fn denied_readiness(blocker: String) -> ReadinessReport {
    empty_readiness(blocker.clone(), blocker)
}

fn disclosure_status_from_wallet_missing() -> DisclosureStatusReport {
    DisclosureStatusReport {
        account_index: None,
        address: None,
        birthday_height: None,
        detected_zatoshis: None,
        spendable_zatoshis: None,
        sync: api_types::SyncState::Unknown,
        note: "Unlock the wallet before using it.".to_string(),
    }
}

fn pending_expired(created_ms: u64) -> bool {
    now_ms().saturating_sub(created_ms) > PENDING_WALLET_TTL_MS
}

fn valid_wallet_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("w_") else {
        return false;
    };
    rest.len() == 32 && rest.chars().all(|character| character.is_ascii_hexdigit())
}

fn new_wallet_id() -> String {
    format!("w_{}", uuid::Uuid::new_v4().simple())
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    service_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn vault_challenge(
    wallet_id: &str,
    vault: &crate::session_secret::VaultRecord,
    birthday_height: Option<u32>,
) -> VaultChallenge {
    VaultChallenge {
        wallet_id: wallet_id.to_string(),
        kdf_salt: vault.kdf_salt.clone(),
        ciphertext: vault.ciphertext.clone(),
        birthday_height,
    }
}

fn seed_from_phrase(phrase: &str) -> Result<SecretVec<u8>, String> {
    let mnemonic = <Mnemonic>::from_phrase(phrase.trim())
        .map_err(|_| "The password does not match this wallet.".to_string())?;
    Ok(SecretVec::new(mnemonic.to_seed("").to_vec()))
}

fn bind_seed(wallet: &mut Wallet, seed: &SecretVec<u8>) -> Result<(), String> {
    let Some(account_id) = wallet.account_id else {
        return Err("This wallet has no account.".to_string());
    };
    let matches = WalletRead::validate_seed(&wallet.db, account_id, seed)
        .map_err(|error| error.to_string())?;
    if !matches {
        return Err("The password unlocked a phrase that does not match this wallet.".to_string());
    }
    if let Some(disclosure_id) = wallet.disclosure_account_id {
        let matches = WalletRead::validate_seed(&wallet.db, disclosure_id, seed)
            .map_err(|error| error.to_string())?;
        if !matches {
            return Err(
                "The password unlocked a phrase that does not match this wallet.".to_string(),
            );
        }
    }
    wallet.seed = Some(duplicate_secret(seed));
    wallet.password_configured = true;
    wallet.startup_note = None;
    // Register the transparent receiver before the next sync so lightwalletd UTXO
    // refresh can detect tm… deposits (including unshield-to-self).
    let _ = transparent_address_string(wallet, account_id);
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimMarker {
    wallet_id: String,
}

fn claim_wallet_id(data_dir: &Path) -> Option<String> {
    let bytes = fs::read(data_dir.join(CLAIM_FILE)).ok()?;
    let marker: ClaimMarker = serde_json::from_slice(&bytes).ok()?;
    if valid_wallet_id(&marker.wallet_id) {
        Some(marker.wallet_id)
    } else {
        None
    }
}

fn write_claim_marker(data_dir: &Path, wallet_id: &str) -> Result<(), String> {
    let encoded = serde_json::to_vec(&ClaimMarker {
        wallet_id: wallet_id.to_string(),
    })
    .map_err(|error| error.to_string())?;
    write_atomic_private(&data_dir.join(CLAIM_FILE), &encoded)
}

fn legacy_wallet_unclaimed(data_dir: &Path) -> bool {
    data_dir.join(RECOVERY_FILE).is_file() && claim_wallet_id(data_dir).is_none()
}

fn directory_for(data_dir: &Path, wallet_id: &str) -> Result<PathBuf, String> {
    if !valid_wallet_id(wallet_id) {
        return Err("This browser's wallet id is not valid.".to_string());
    }
    if claim_wallet_id(data_dir).as_deref() == Some(wallet_id) {
        return Ok(data_dir.to_path_buf());
    }
    let dir = data_dir.join("vaults").join(wallet_id);
    if dir.join("wallet.sqlite").is_file() {
        Ok(dir)
    } else {
        Err("This browser's wallet is not on this computer.".to_string())
    }
}

fn load_wallet_database(
    data_dir: &Path,
    load_plaintext: bool,
    chain: Chain,
) -> Result<Wallet, String> {
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    set_private_dir(data_dir)?;
    let db_path = data_dir.join("wallet.sqlite");
    let mut db = WalletDb::for_path(&db_path, chain.zcash(), SystemClock, service_rng())
        .map_err(|error| error.to_string())?;
    set_private_file(&db_path)?;
    let recovery_path = data_dir.join(RECOVERY_FILE);
    let birthday_path = data_dir.join(BIRTHDAY_FILE);
    let journal_path = data_dir.join(JOURNAL_FILE);
    set_private_file(&birthday_path)?;
    set_private_file(&journal_path)?;

    let mut startup_note = None;
    let password_files = crate::session_secret::password_paths_ready(data_dir);
    let password_configured = if load_plaintext { password_files } else { true };
    let mut seed = None;
    if load_plaintext && !password_files && recovery_path.exists() {
        set_private_file(&recovery_path)?;
        match load_seed(&recovery_path) {
            Ok(loaded) => seed = Some(loaded),
            Err(error) => startup_note = Some(error),
        }
    }
    initialize_database(&mut db, seed.as_ref().map(duplicate_secret))?;

    let account_ids = WalletRead::get_account_ids(&db).map_err(|error| error.to_string())?;
    if account_ids.len() > 2 {
        return Err("The wallet database has more than two accounts. This service tracks one primary testnet account and at most one disclosure account.".to_string());
    }
    let mut primary_account: Option<(AccountUuid, zip32::AccountId)> = None;
    let mut disclosure_account: Option<(AccountUuid, zip32::AccountId)> = None;
    for account_id in account_ids.iter().copied() {
        let index = account_index(&db, account_id)?;
        match u32::from(index) {
            0 => primary_account = Some((account_id, index)),
            DISCLOSURE_ACCOUNT_INDEX => disclosure_account = Some((account_id, index)),
            other => {
                return Err(format!(
                    "The wallet database has an unsupported ZIP 32 account index ({other}). This service uses index 0 for the primary account and index 1 for the disclosure account."
                ));
            }
        }
    }
    if disclosure_account.is_some() && primary_account.is_none() {
        return Err("The wallet database has a disclosure account but no primary account.".to_string());
    }
    let (account_id, account_index) = if let Some((account_id, index)) = primary_account {
        if let Some(seed) = seed.as_ref() {
            if !WalletRead::validate_seed(&db, account_id, seed).map_err(|error| error.to_string())? {
                return Err("The recovery file does not match the primary account in the wallet database.".to_string());
            }
            if let Some((disclosure_id, _)) = disclosure_account {
                if !WalletRead::validate_seed(&db, disclosure_id, seed).map_err(|error| error.to_string())? {
                    return Err("The recovery file does not match the disclosure account in the wallet database.".to_string());
                }
            }
        } else if load_plaintext && startup_note.is_none() {
            startup_note = Some(format!(
                "The recovery file at {} is missing, so this wallet cannot sign.",
                recovery_path.display()
            ));
        }
        let account = WalletRead::get_account(&db, account_id)
            .map_err(|error| error.to_string())?
            .ok_or("The wallet account was not found.")?;
        write_birthday(&birthday_path, u32::from(account.birthday_height()))?;
        (Some(account_id), Some(index))
    } else {
        if startup_note.is_none() && load_plaintext {
            startup_note = Some("No testnet account is open.".to_string());
        }
        (None, None)
    };
    if let (Some(account_id), Some(_)) = (account_id, account_index) {
        db.clear_locked_outputs(account_id)
            .map_err(|error| format!("Could not release stale quote locks: {error}"))?;
    }
    let journal = load_and_recover_journal(&journal_path)?;
    Ok(Wallet {
        chain,
        db,
        db_path,
        data_dir: data_dir.to_path_buf(),
        seed,
        password_configured,
        account_id,
        account_index,
        disclosure_account_id: disclosure_account.map(|(id, _)| id),
        disclosure_account_index: disclosure_account.map(|(_, index)| index),
        disclosure_export: None,
        quotes: HashMap::new(),
        journal,
        journal_path,
        startup_note,
    })
}

async fn create_account_from_phrase(
    db: &mut Db,
    phrase: &str,
    birthday_path: &Path,
    endpoint: &str,
    chain: Chain,
) -> Result<(SecretVec<u8>, AccountUuid, zip32::AccountId), String> {
    let seed = seed_from_phrase(phrase)?;
    let mut client = connect(endpoint).await?;
    ensure_chain(&mut client, chain).await?;
    let prior_height = latest_height(&mut client).await?;
    let tree = client
        .get_tree_state(BlockId {
            height: prior_height,
            hash: Vec::new(),
        })
        .await
        .map_err(|error| format!("lightwalletd did not return a tree state: {error}"))?;
    let birthday = AccountBirthday::from_treestate(tree.into_inner(), None)
        .map_err(|error| format!("Could not build an account birthday from the {} tree state: {error}", chain.as_str()))?;
    let account_height = u32::from(birthday.height());
    let (account_id, _spending_key) =
        WalletWrite::create_account(db, chain.as_str(), &seed, &birthday, Some("local-file"))
            .map_err(|error| format!("The new account could not be created: {error}"))?;
    let index = account_index(db, account_id)?;
    if u32::from(index) != 0 {
        return Err(format!(
            "The new seed created account index {} instead of account 0.",
            u32::from(index)
        ));
    }
    write_birthday(birthday_path, account_height)?;
    Ok((seed, account_id, index))
}

fn install_offline_account(
    db: &mut Db,
    data_dir: &Path,
    phrase: &str,
) -> Result<(SecretVec<u8>, AccountUuid, zip32::AccountId), String> {
    use zcash_client_backend::data_api::chain::ChainState;
    use zcash_primitives::block::BlockHash;
    use zcash_protocol::consensus::BlockHeight;

    let mnemonic = <Mnemonic>::from_phrase(phrase)
        .map_err(|_| "The pending recovery phrase is not valid.".to_string())?;
    let seed = SecretVec::new(mnemonic.to_seed("").to_vec());
    fs::write(data_dir.join(BIRTHDAY_FILE), "2100000\n").map_err(|error| error.to_string())?;
    let birthday = AccountBirthday::from_parts(
        ChainState::empty(BlockHeight::from_u32(2_100_000), BlockHash([0; 32])),
        None,
    );
    let (account_id, _spending_key) =
        WalletWrite::create_account(db, "testnet", &seed, &birthday, Some("local-file"))
            .map_err(|error| format!("The new account could not be created: {error}"))?;
    let index = account_index(db, account_id)?;
    if u32::from(index) != 0 {
        return Err(format!(
            "The new seed created account index {} instead of account 0.",
            u32::from(index)
        ));
    }
    Ok((seed, account_id, index))
}

fn reopen_database(wallet: &mut Wallet, db_path: &Path) -> Result<(), String> {
    wallet.db = WalletDb::for_path(db_path, wallet.chain.zcash(), SystemClock, service_rng())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn live_wallet_files() -> &'static [&'static str] {
    &[
        "wallet.sqlite",
        "wallet.sqlite-wal",
        "wallet.sqlite-shm",
        RECOVERY_FILE,
        crate::session_secret::RECOVERY_ENC,
        "session-password.json",
        BIRTHDAY_FILE,
        JOURNAL_FILE,
    ]
}

fn archive_live_files(data_dir: &Path) -> Result<PathBuf, String> {
    let archive = data_dir.join("archive").join(now_ms().to_string());
    fs::create_dir_all(&archive).map_err(|error| error.to_string())?;
    set_private_dir(&archive)?;
    let mut moved = Vec::new();
    for name in live_wallet_files() {
        let source = data_dir.join(name);
        if !source.exists() {
            continue;
        }
        let dest = archive.join(name);
        if let Err(error) = fs::rename(&source, &dest) {
            for (from, to) in moved.iter().rev() {
                let _ = fs::rename(from, to);
            }
            return Err(format!("Could not archive {name}: {error}"));
        }
        moved.push((dest, source));
    }
    Ok(archive)
}

fn restore_archived_files(data_dir: &Path, archive: &Path) -> Result<(), String> {
    for name in live_wallet_files() {
        let archived = archive.join(name);
        if !archived.exists() {
            continue;
        }
        let dest = data_dir.join(name);
        if dest.exists() {
            fs::remove_file(&dest).map_err(|error| error.to_string())?;
        }
        fs::rename(&archived, &dest).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn readiness_from_wallet(wallet: &Wallet, server_height: Option<u64>) -> ReadinessReport {
    if wallet.account_id.is_none() {
        let blocker = wallet
            .startup_note
            .clone()
            .unwrap_or_else(|| "No testnet account is open.".to_string());
        return empty_readiness(
            blocker,
            "An account, a synced chain tip, and a spendable balance are required before send."
                .to_string(),
        );
    }
    let summary = match WalletRead::get_wallet_summary(&wallet.db, wallet_confirmations(wallet.chain)) {
        Ok(summary) => summary,
        Err(error) => {
            return empty_readiness(
                format!("Balance query failed: {error}"),
                "The balance query did not succeed.".to_string(),
            );
        }
    };
    let Some(summary) = summary else {
        return empty_readiness(
            "The wallet has no balance summary yet. Sync before sending.".to_string(),
            "A lightwalletd response alone is not a ready wallet.".to_string(),
        );
    };
    let account_id = wallet.account_id.expect("account checked above");
    let Some(balance) = summary.account_balances().get(&account_id) else {
        return empty_readiness(
            "The balance query did not include this account.".to_string(),
            "Spendable balance is unavailable.".to_string(),
        );
    };
    let detected = u64::from(balance.total());
    let spendable = u64::from(balance.spendable_value());
    let locked = u64::from(balance.locked_value());
    let pending_change = u64::from(balance.change_pending_confirmation());
    let pending_spendability = u64::from(balance.value_pending_spendability());
    let (transparent_detected, transparent_spendable) =
        transparent_balances_for_account(wallet, account_id, server_height);
    let with_pending = |mut report: ReadinessReport| {
        report.pending_change_zatoshis = Some(pending_change);
        report.pending_spendability_zatoshis = Some(pending_spendability);
        report.locked_zatoshis = Some(locked);
        report.transparent_detected_zatoshis = Some(transparent_detected);
        report.transparent_spendable_zatoshis = Some(transparent_spendable);
        report
    };
    let Some(server_height) = server_height else {
        return with_pending(ReadinessReport {
            sync: api_types::SyncState::Unknown,
            detected_zatoshis: Some(detected),
            spendable_zatoshis: Some(spendable),
            pending_change_zatoshis: Some(pending_change),
            pending_spendability_zatoshis: Some(pending_spendability),
            locked_zatoshis: Some(locked),
            transparent_detected_zatoshis: Some(transparent_detected),
            transparent_spendable_zatoshis: Some(transparent_spendable),
            can_submit: false,
            blocker: "The testnet tip is unavailable, so the wallet is not ready to send."
                .to_string(),
            note: "Detected and spendable balances were read from the local wallet. The chain tip was not."
                .to_string(),
        });
    };
    let scanned = u64::from(u32::from(summary.fully_scanned_height()));
    let (sync, mut can_submit, mut blocker) = if server_height < scanned {
        (
            api_types::SyncState::Stale,
            false,
            "The wallet scan is ahead of the lightwalletd tip, so send stays refused.".to_string(),
        )
    } else if server_height - scanned <= SYNC_LAG_BLOCKS {
        (
            api_types::SyncState::Synced,
            true,
            "The wallet is within 10 blocks of the testnet tip and a balance query succeeded."
                .to_string(),
        )
    } else {
        (
            api_types::SyncState::Syncing,
            false,
            format!(
                "The wallet is {lag} blocks behind the testnet tip. Sync again before sending.",
                lag = server_height - scanned
            ),
        )
    };
    if can_submit && spendable == 0 && transparent_spendable == 0 {
        can_submit = false;
        blocker = if locked > 0 {
            format!(
                "Spendable balance is zero zatoshi because {locked} zatoshi is locked by an open quote. Complete or let that quote expire before sending."
            )
        } else if pending_change > 0 {
            format!(
                "Detected {detected} zatoshi, but {pending_change} zatoshi is change still waiting for confirmation after your last send. {wait} the funds are still in this wallet.",
                wait = if wallet.chain.is_main() {
                    "Mainnet needs 3 confirmations for your own change and 10 for incoming funds (about 4 to 13 minutes). Sync again later;"
                } else {
                    "Sync again in a minute;"
                }
            )
        } else if pending_spendability > 0 {
            format!(
                "Detected {detected} zatoshi, but {pending_spendability} zatoshi is not spendable until scanning finishes deriving witnesses. Sync again shortly; nothing was lost."
            )
        } else if detected > 0 || transparent_detected > 0 {
            format!(
                "Detected shielded {detected} zatoshi and transparent {transparent_detected} zatoshi that are not yet spendable. Sync again after the next {} blocks.",
                wallet.chain.as_str()
            )
        } else {
            format!(
                "Spendable balance is zero zatoshi. Fund the {} wallet before sending.",
                wallet.chain.as_str()
            )
        };
    }
    if can_submit && wallet.seed.is_none() {
        can_submit = false;
        blocker = "The recovery file is missing, so this wallet cannot sign. Restore it before sending."
            .to_string();
    }
    with_pending(ReadinessReport {
        sync,
        detected_zatoshis: Some(detected),
        spendable_zatoshis: Some(spendable),
        pending_change_zatoshis: Some(pending_change),
        pending_spendability_zatoshis: Some(pending_spendability),
        locked_zatoshis: Some(locked),
        transparent_detected_zatoshis: Some(transparent_detected),
        transparent_spendable_zatoshis: Some(transparent_spendable),
        can_submit,
        note: blocker.clone(),
        blocker,
    })
}

fn transparent_balances_for_account(
    wallet: &Wallet,
    account_id: AccountUuid,
    server_height: Option<u64>,
) -> (u64, u64) {
    let tip_height = server_height
        .and_then(|height| u32::try_from(height).ok())
        .map(BlockHeight::from_u32)
        .or_else(|| WalletRead::chain_height(&wallet.db).ok().flatten())
        .or_else(|| {
            WalletRead::block_max_scanned(&wallet.db)
                .ok()
                .flatten()
                .map(|meta| meta.block_height())
        });
    let Some(tip) = tip_height else {
        return (0, 0);
    };
    let Ok(balances) = WalletRead::get_transparent_balances(
        &wallet.db,
        account_id,
        TargetHeight::from(tip),
        wallet_confirmations(wallet.chain),
    ) else {
        return (0, 0);
    };
    let mut detected = 0u64;
    let mut spendable = 0u64;
    for (_addr, (_origin, balance)) in balances {
        detected = detected.saturating_add(u64::from(balance.total()));
        spendable = spendable.saturating_add(u64::from(balance.spendable_value()));
    }
    (detected, spendable)
}

fn account_address_string(db: &mut Db, account_id: AccountUuid) -> Result<String, String> {
    let existing = WalletRead::get_last_generated_address_matching(
        db,
        account_id,
        UnifiedAddressRequest::SHIELDED,
    )
    .map_err(|error| error.to_string())?;
    let address = match existing {
        Some(address) => Some(address),
        None => WalletWrite::get_next_available_address(
            db,
            account_id,
            UnifiedAddressRequest::SHIELDED,
        )
        .map(|generated| generated.map(|(address, _)| address))
        .map_err(|error| error.to_string())?,
    };
    let encoded = address
        .as_ref()
        .map(|address| address.encode(db.params()))
        .ok_or_else(|| {
            "The wallet could not derive a shielded-only address for this account.".to_string()
        })?;
    Ok(encoded)
}

fn transparent_address_string(wallet: &mut Wallet, account_id: AccountUuid) -> Result<String, String> {
    let network = wallet.chain.zcash();
    if let Ok(existing) =
        WalletRead::get_transparent_receivers(&wallet.db, account_id, false, false)
    {
        if let Some((address, _)) = existing.iter().next() {
            return Ok(address.encode(&network));
        }
    }

    let require_transparent = UnifiedAddressRequest::unsafe_custom(
        ReceiverRequirement::Allow,
        ReceiverRequirement::Allow,
        ReceiverRequirement::Require,
    );

    // Prefer ZIP-32 registration in the wallet DB so sync can refresh UTXOs for this tm….
    if let Ok(Some(ua)) = WalletWrite::get_address_for_index(
        &mut wallet.db,
        account_id,
        zip32::DiversifierIndex::new(),
        require_transparent,
    ) {
        if let Some(transparent) = ua.transparent() {
            return Ok(transparent.encode(&network));
        }
    }
    for request in [UnifiedAddressRequest::AllAvailableKeys, require_transparent] {
        if let Ok(Some((ua, _))) =
            WalletWrite::get_next_available_address(&mut wallet.db, account_id, request)
        {
            if let Some(transparent) = ua.transparent() {
                return Ok(transparent.encode(&network));
            }
        }
    }

    // Vaults created before transparent-inputs may lack a transparent item in the stored
    // UIVK. Import the seed-derived external P2PKH pubkey so lightwalletd UTXO refresh
    // can see deposits to this address (including unshield-to-self).
    let (Some(seed), Some(index)) = (wallet.seed.as_ref(), wallet.account_index) else {
        return Err(
            "Unlock the wallet so it can derive a transparent testnet address from the seed."
                .to_string(),
        );
    };
    let usk = UnifiedSpendingKey::from_seed(&network, seed.expose_secret(), index)
        .map_err(|error| format!("Could not derive transparent keys from the seed: {error}"))?;
    let external = usk
        .transparent()
        .to_account_pubkey()
        .derive_external_ivk()
        .map_err(|error| format!("Could not derive the transparent external IVK: {error}"))?;
    let (transparent, child_index) = external.default_address();
    let pubkey = external
        .derive_pubkey(child_index)
        .map_err(|error| format!("Could not derive the transparent receive pubkey: {error}"))?;
    WalletWrite::import_standalone_transparent_pubkey(&mut wallet.db, account_id, pubkey)
        .map_err(|error| {
            format!("Could not register the transparent receive address for sync: {error}")
        })?;
    Ok(transparent.encode(&network))
}

fn disclosure_status_from_wallet(
    wallet: &mut Wallet,
    server_height: Option<u64>,
) -> DisclosureStatusReport {
    let Some(account_id) = wallet.disclosure_account_id else {
        return DisclosureStatusReport {
            account_index: None,
            address: None,
            birthday_height: None,
            detected_zatoshis: None,
            spendable_zatoshis: None,
            sync: api_types::SyncState::Unknown,
            note: "No dedicated disclosure account exists yet. Create one so an auditor can receive its own viewing key without the primary account key."
                .to_string(),
        };
    };
    let account_index = wallet.disclosure_account_index.map(u32::from);
    let birthday_height = WalletRead::get_account_birthday(&wallet.db, account_id)
        .ok()
        .map(u32::from);
    let address = account_address_string(&mut wallet.db, account_id).ok();
    let summary = WalletRead::get_wallet_summary(&wallet.db, wallet_confirmations(wallet.chain))
        .ok()
        .flatten();
    let (detected, spendable, sync) = match summary.as_ref() {
        Some(summary) => {
            let balance = summary.account_balances().get(&account_id);
            let detected = balance.map(|balance| u64::from(balance.total()));
            let spendable = balance.map(|balance| u64::from(balance.spendable_value()));
            let scanned = u64::from(u32::from(summary.fully_scanned_height()));
            let sync = match server_height {
                Some(server) if server < scanned => api_types::SyncState::Stale,
                Some(server) if server - scanned <= SYNC_LAG_BLOCKS => {
                    api_types::SyncState::Synced
                }
                Some(_) => api_types::SyncState::Syncing,
                None => api_types::SyncState::Unknown,
            };
            (detected, spendable, sync)
        }
        None => (None, None, api_types::SyncState::Unknown),
    };
    let note = if address.is_none() {
        "The disclosure account exists, but its shielded address could not be derived.".to_string()
    } else if wallet.seed.is_none() {
        "The disclosure account is watchable by an auditor, but the local recovery file is missing, so this service cannot spend from it."
            .to_string()
    } else {
        "A dedicated ZIP 32 account under the same local seed. Its viewing key cannot spend, but this service still holds the spending authority for it. Only this account is disclosed; the primary account stays private."
            .to_string()
    };
    DisclosureStatusReport {
        account_index,
        address,
        birthday_height,
        detected_zatoshis: detected,
        spendable_zatoshis: spendable,
        sync,
        note,
    }
}

fn disclosure_ufvk(wallet: &Wallet) -> Result<UnifiedFullViewingKey, String> {
    let disclosure_id = wallet
        .disclosure_account_id
        .ok_or("Create a dedicated disclosure account first.")?;
    let keys = WalletRead::get_unified_full_viewing_keys(&wallet.db)
        .map_err(|error| error.to_string())?;
    let ufvk = keys
        .get(&disclosure_id)
        .cloned()
        .ok_or("The disclosure account has no unified full viewing key in the wallet database.")?;
    if let Some(primary_id) = wallet.account_id {
        if let Some(primary) = keys.get(&primary_id) {
            let network = wallet.chain.zcash();
            let primary_encoded = primary
                .encode(&network)
                .map_err(|error| format!("Could not encode the primary viewing key: {error}"))?;
            let disclosure_encoded = ufvk
                .encode(&network)
                .map_err(|error| format!("Could not encode the disclosure viewing key: {error}"))?;
            if primary_encoded == disclosure_encoded {
                return Err(
                    "The disclosure account key is identical to the primary account key, so the export was refused."
                        .to_string(),
                );
            }
        }
    }
    Ok(ufvk)
}

fn shielded_only_ufvk_encoding(encoded: &str, expected: NetworkType) -> Result<String, String> {
    let (network, revision, ufvk) = UnifiedUfvk::decode(encoded)
        .map_err(|_| "The exported viewing key failed a decode check, so it was withheld.".to_string())?;
    if network != expected {
        return Err(format!(
            "The exported viewing key is not a {} key, so it was withheld.",
            if expected == NetworkType::Main { "mainnet" } else { "testnet" }
        ));
    }
    let shielded: Vec<_> = ufvk
        .items()
        .into_iter()
        .filter(|item| matches!(item, UnifiedFvk::Orchard(_) | UnifiedFvk::Sapling(_)))
        .map(Uitem::Data)
        .collect();
    if shielded.is_empty() {
        return Err(
            "The disclosure account has no shielded viewing key items, so the export was withheld."
                .to_string(),
        );
    }
    let filtered = UnifiedUfvk::try_from_items(revision, shielded).map_err(|_| {
        "The disclosure viewing key could not be reduced to shielded items, so the export was withheld."
            .to_string()
    })?;
    Ok(filtered.encode(&network))
}

fn validate_exported_ufvk(encoded: &str, expected: NetworkType) -> Result<(), String> {
    let (network, _revision, ufvk) = UnifiedUfvk::decode(encoded)
        .map_err(|_| "The exported viewing key failed a decode check, so it was withheld.".to_string())?;
    if network != expected {
        return Err(format!(
            "The exported viewing key is not a {} key, so it was withheld.",
            if expected == NetworkType::Main { "mainnet" } else { "testnet" }
        ));
    }
    let items = ufvk.items();
    if items.is_empty() {
        return Err(
            "The disclosure account has no shielded viewing key items, so the export was withheld."
                .to_string(),
        );
    }
    for item in items {
        match item {
            UnifiedFvk::Orchard(_) | UnifiedFvk::Sapling(_) => {}
            UnifiedFvk::P2pkh(_) | UnifiedFvk::P2sh(_) | UnifiedFvk::Unknown { .. } => {
                return Err("The disclosure account's unified viewing key contains a non-shielded item, so the export was withheld."
                    .to_string());
            }
        }
    }
    Ok(())
}

async fn create_first_account(
    db: &mut Db,
    recovery_path: &Path,
    birthday_path: &Path,
    endpoint: &str,
    requested_birthday: Option<u32>,
    chain: Chain,
) -> Result<(SecretVec<u8>, AccountUuid, zip32::AccountId), String> {
    let (seed, created_file) = load_or_create_seed(recovery_path)?;
    let stored_birthday = read_birthday(birthday_path)?;
    let birthday_height = requested_birthday.or(stored_birthday);
    if !created_file && birthday_height.is_none() {
        return Err(format!(
            "The recovery phrase at {} has no account in this wallet database, so restoring it needs a birthday. Set WALLET_BIRTHDAY_HEIGHT to a testnet height at or before the first deposit. Without it, earlier funds would be missed.",
            recovery_path.display()
        ));
    }
    let mut client = connect(endpoint).await?;
    ensure_chain(&mut client, chain).await?;
    // AccountBirthday is derived from the tree state of the block before the first scanned block.
    let prior_height = match birthday_height {
        Some(height) => u64::from(height.saturating_sub(1)),
        None => latest_height(&mut client).await?,
    };
    let tree = client
        .get_tree_state(BlockId {
            height: prior_height,
            hash: Vec::new(),
        })
        .await
        .map_err(|error| format!("lightwalletd did not return a tree state: {error}"))?;
    let birthday = AccountBirthday::from_treestate(tree.into_inner(), None)
        .map_err(|error| format!("Could not build an account birthday from the testnet tree state: {error}"))?;
    let account_height = u32::from(birthday.height());
    let (account_id, _spending_key) =
        WalletWrite::create_account(db, "testnet", &seed, &birthday, Some("local-file"))
            .map_err(|error| {
                if created_file {
                    format!(
                        "{error} The recovery file is {}.",
                        recovery_path.display()
                    )
                } else {
                    error.to_string()
                }
            })?;
    let index = account_index(db, account_id)?;
    write_birthday(birthday_path, account_height)?;
    Ok((seed, account_id, index))
}

fn load_or_create_seed(path: &Path) -> Result<(SecretVec<u8>, bool), String> {
    if path.exists() {
        set_private_file(path)?;
        return Ok((load_seed(path)?, false));
    }
    let mnemonic = <Mnemonic>::generate(Count::Words24);
    let phrase = mnemonic.phrase().to_string();
    write_private(path, &phrase)?;
    println!("Recovery phrase file: {}", path.display());
    Ok((SecretVec::new(mnemonic.to_seed("").to_vec()), true))
}

fn load_seed(path: &Path) -> Result<SecretVec<u8>, String> {
    let phrase = fs::read_to_string(path).map_err(|error| {
        format!(
            "Could not read the recovery file at {}: {error}",
            path.display()
        )
    })?;
    let mnemonic = <Mnemonic>::from_phrase(phrase.trim())
        .map_err(|error| format!("The recovery file is not a valid BIP-39 phrase: {error}"))?;
    Ok(SecretVec::new(mnemonic.to_seed("").to_vec()))
}

fn write_private(path: &Path, phrase: &str) -> Result<(), String> {
    let mut file = {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path).map_err(|error| error.to_string())?
    };
    file.write_all(phrase.as_bytes())
        .map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    sync_parent(path)?;
    Ok(())
}

fn set_private_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let _ = path;
    Ok(())
}

fn set_private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path.exists() {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|error| error.to_string())?;
        }
    }
    let _ = path;
    Ok(())
}

fn write_birthday(path: &Path, height: u32) -> Result<(), String> {
    let contents = format!("{height}\n");
    write_atomic_private(path, contents.as_bytes())
}

fn read_birthday(path: &Path) -> Result<Option<u32>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let height: u32 = text
        .trim()
        .parse()
        .map_err(|_| format!("{} is not a block height.", path.display()))?;
    if height == 0 {
        return Err(format!("{} is not a positive block height.", path.display()));
    }
    Ok(Some(height))
}

fn write_atomic_private(path: &Path, data: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|error| error.to_string())?;
    file.write_all(data).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    fs::rename(&temp, path).map_err(|error| error.to_string())?;
    sync_parent(path)
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Could not sync {}: {error}", parent.display()))
}

fn initialize_database(db: &mut Db, seed: Option<SecretVec<u8>>) -> Result<(), String> {
    match init_wallet_db(db, None) {
        Err(error)
            if matches!(
                error.source().and_then(|source| source.downcast_ref()),
                Some(&WalletMigrationError::SeedRequired)
            ) =>
        {
            let seed = seed.ok_or("A wallet migration requires the local recovery seed.")?;
            init_wallet_db(db, Some(seed)).map_err(|error| error.to_string())
        }
        result => result.map_err(|error| error.to_string()),
    }
}

fn account_index(db: &Db, account_id: AccountUuid) -> Result<zip32::AccountId, String> {
    let account = WalletRead::get_account(db, account_id)
        .map_err(|error| error.to_string())?
        .ok_or("The wallet account was not found.")?;
    match account.source() {
        AccountSource::Derived { derivation, .. } => Ok(derivation.account_index()),
        _ => Err("The wallet account is not derived from the local recovery phrase.".to_string()),
    }
}

fn spending_keys(
    network: &Network,
    seed: &SecretVec<u8>,
    index: zip32::AccountId,
) -> Result<SpendingKeys, String> {
    let spending_key = UnifiedSpendingKey::from_seed(network, seed.expose_secret(), index)
        .map_err(|error| {
            format!(
                "Could not derive the spending key from the local recovery phrase: {error}"
            )
        })?;
    Ok(SpendingKeys::from_unified_spending_key(spending_key))
}

fn transfer_proposal_fee(proposal: &TransferProposal) -> Result<u64, String> {
    let mut total = 0u64;
    for step in proposal.steps().iter() {
        let fee = u64::from(step.balance().fee_required());
        total = total.checked_add(fee).ok_or("The proposal fee overflowed.")?;
    }
    Ok(total)
}

fn shield_proposal_fee(proposal: &ShieldProposal) -> Result<u64, String> {
    let mut total = 0u64;
    for step in proposal.steps().iter() {
        let fee = u64::from(step.balance().fee_required());
        total = total.checked_add(fee).ok_or("The proposal fee overflowed.")?;
    }
    Ok(total)
}

fn transfer_proposal_matches(
    proposal: &TransferProposal,
    recipient: &str,
    amount_zatoshis: u64,
) -> Result<(), String> {
    let expected = ZcashAddress::try_from_encoded(recipient)
        .map_err(|_| "The quoted recipient is not a valid Zcash address.".to_string())?;
    let mut total = 0u64;
    let mut matched = 0usize;
    for step in proposal.steps().iter() {
        for payment in step.transaction_request().payments().values() {
            if payment.recipient_address() != &expected {
                return Err(
                    "The proposal pays a different recipient than the quoted address.".to_string(),
                );
            }
            let value = payment
                .amount()
                .ok_or("The proposal contains a payment without an amount.")?;
            total = total
                .checked_add(u64::from(value))
                .ok_or("The proposal amount overflowed.")?;
            matched += 1;
        }
    }
    if matched == 0 || total != amount_zatoshis {
        return Err(format!(
            "The proposal pays {total} zatoshi to the quoted recipient, not the quoted amount of {amount_zatoshis} zatoshi."
        ));
    }
    Ok(())
}

fn build_transactions(
    wallet: &mut Wallet,
    prover: &LocalTxProver,
    stored: &StoredQuote,
) -> Result<(Vec<TxId>, Vec<(TxId, Vec<u8>)>), String> {
    let spending_seed = wallet
        .seed
        .as_ref()
        .map(duplicate_secret)
        .ok_or("The recovery seed is not loaded, so this process cannot sign.")?;
    let index = wallet
        .account_index
        .ok_or("The account index is unavailable, so this process cannot sign.")?;
    let network = wallet.chain.zcash();
    let spending_keys = spending_keys(&network, &spending_seed, index)?;
    let txids = match &stored.proposal {
        StoredProposal::Transfer(proposal) => create_proposed_transactions::<
            Db,
            Network,
            GreedyInputSelectorError,
            FeeRule,
            <FeeRule as zcash_primitives::transaction::fees::FeeRule>::Error,
            ReceivedNoteId,
        >(
            &mut wallet.db,
            &network,
            &SystemClock,
            &mut service_rng(),
            prover,
            prover,
            &spending_keys,
            OvkPolicy::Sender,
            proposal,
            None,
        )
        .map_err(|error| error.to_string())?,
        StoredProposal::Shield(proposal) => create_proposed_transactions::<
            Db,
            Network,
            GreedyInputSelectorError,
            FeeRule,
            <FeeRule as zcash_primitives::transaction::fees::FeeRule>::Error,
            core::convert::Infallible,
        >(
            &mut wallet.db,
            &network,
            &SystemClock,
            &mut service_rng(),
            prover,
            prover,
            &spending_keys,
            OvkPolicy::Sender,
            proposal,
            None,
        )
        .map_err(|error| error.to_string())?,
    };
    let txids: Vec<TxId> = txids.into();
    let raw = raw_transactions(&wallet.db, &txids)?;
    Ok((txids, raw))
}

fn raw_transactions(db: &Db, txids: &[TxId]) -> Result<Vec<(TxId, Vec<u8>)>, String> {
    let mut raw = Vec::with_capacity(txids.len());
    for txid in txids {
        let transaction = WalletRead::get_transaction(db, *txid)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                format!("The library stored {txid} but did not return the raw transaction.")
            })?;
        let mut bytes = Vec::new();
        transaction
            .write(&mut bytes)
            .map_err(|error| format!("Could not serialize {txid}: {error}"))?;
        raw.push((*txid, bytes));
    }
    Ok(raw)
}

fn journal_step(
    wallet: &mut Wallet,
    quote_id: &str,
    expectation: SendExpectation<'_>,
) -> Result<Option<SendStep>, String> {
    let Some(record) = wallet.journal.sends.get(quote_id) else {
        return Ok(None);
    };
    let recipient = record.recipient.clone();
    let amount_zatoshis = record.amount_zatoshis;
    let fee_zatoshis = record.fee_zatoshis;
    let state = record.state;
    let txids = record.txids.clone();
    let message = record.message.clone();
    validate_expectation(
        wallet.chain,
        &recipient,
        amount_zatoshis,
        fee_zatoshis,
        expectation,
    )?;
    match state {
        SendState::Accepted => Ok(Some(SendStep::Reply(SendReport::Accepted { txids }))),
        SendState::Rejected => Ok(Some(SendStep::Reply(SendReport::Rejected {
            message: message.unwrap_or_else(|| {
                "The stored send was rejected. Request a new quote.".to_string()
            }),
        }))),
        SendState::Indeterminate | SendState::Interrupted | SendState::Building => {
            let message = message.unwrap_or_else(|| {
                "The stored send has no definite broadcast result. Check the transaction status before retrying."
                    .to_string()
            });
            Ok(Some(SendStep::Reply(SendReport::Indeterminate {
                message,
                txids,
            })))
        }
        SendState::Prepared => {
            let parsed: Vec<TxId> = txids
                .iter()
                .map(|value| parse_txid(value))
                .collect::<Result<_, _>>()?;
            if parsed.is_empty() {
                let message = "The journal has a prepared send without transaction ids. Check the wallet history before retrying.".to_string();
                let _ = wallet.mark_send(
                    quote_id,
                    SendState::Interrupted,
                    Some(message.clone()),
                    None,
                );
                return Ok(Some(SendStep::Reply(SendReport::Indeterminate {
                    message,
                    txids,
                })));
            }
            match raw_transactions(&wallet.db, &parsed) {
                Ok(raw) => Ok(Some(SendStep::Broadcast {
                    quote_id: quote_id.to_string(),
                    txids: parsed,
                    raw,
                    resumed: true,
                })),
                Err(message) => {
                    let _ = wallet.mark_send(
                        quote_id,
                        SendState::Indeterminate,
                        Some(message.clone()),
                        None,
                    );
                    Ok(Some(SendStep::Reply(SendReport::Indeterminate {
                        message,
                        txids,
                    })))
                }
            }
        }
    }
}

fn validate_expectation(
    chain: Chain,
    stored_recipient: &str,
    stored_amount: u64,
    stored_fee: u64,
    expectation: SendExpectation<'_>,
) -> Result<(), String> {
    let stored = parse_payment_recipient(stored_recipient, chain)?;
    let provided = parse_payment_recipient(expectation.recipient, chain)?;
    if stored != provided {
        return Err(
            "The approved recipient does not match the quoted recipient. Nothing was sent."
                .to_string(),
        );
    }
    if stored_amount != expectation.amount_zatoshis {
        return Err(format!(
            "The approved amount {} zatoshi does not match the quoted amount {} zatoshi. Nothing was sent.",
            expectation.amount_zatoshis, stored_amount
        ));
    }
    if stored_fee != expectation.fee_zatoshis {
        return Err(format!(
            "The approved fee {} zatoshi does not match the quoted fee {} zatoshi. Nothing was sent.",
            expectation.fee_zatoshis, stored_fee
        ));
    }
    Ok(())
}

fn unlock_stored_proposal(
    wallet: &mut Wallet,
    proposal: &StoredProposal,
    owner: LockOwner,
) -> Result<(), String> {
    match proposal {
        StoredProposal::Transfer(proposal) => {
            unlock_proposal_inputs(&mut wallet.db, proposal, owner).map_err(|error| error.to_string())
        }
        StoredProposal::Shield(proposal) => {
            unlock_proposal_inputs(&mut wallet.db, proposal, owner).map_err(|error| error.to_string())
        }
    }
}

fn release_unsent_quotes(wallet: &mut Wallet) -> Result<(), String> {
    let quote_ids: Vec<String> = wallet.quotes.keys().cloned().collect();
    for quote_id in quote_ids {
        if let Some(quote) = wallet.quotes.remove(&quote_id) {
            unlock_stored_proposal(wallet, &quote.proposal, quote.owner)?;
        }
    }
    Ok(())
}

fn sweep_expired_quotes(wallet: &mut Wallet) -> Result<(), String> {
    let now = now_ms();
    let expired: Vec<String> = wallet
        .quotes
        .iter()
        .filter(|(_, quote)| now.saturating_sub(quote.created_ms) > QUOTE_TTL_MS)
        .map(|(quote_id, _)| quote_id.clone())
        .collect();
    for quote_id in expired {
        if let Some(quote) = wallet.quotes.remove(&quote_id) {
            unlock_stored_proposal(wallet, &quote.proposal, quote.owner)?;
        }
    }
    Ok(())
}

fn detect_recipient_output(
    wallet: &Wallet,
    txid: TxId,
    confirmation_met: bool,
) -> Result<DetectionReport, String> {
    let txid_text = txid.to_string();
    let Some(record) = wallet
        .journal
        .sends
        .values()
        .find(|record| record.txids.iter().any(|value| value == &txid_text))
    else {
        return Ok(DetectionReport {
            detected: false,
            available: false,
            note: "This service has no quoted send record for this transaction id, so it cannot assert a recipient match."
                .to_string(),
        });
    };
    if !confirmation_met {
        return Ok(DetectionReport {
            detected: false,
            available: true,
            note: "The transaction is not confirmed by lightwalletd yet, so recipient detection is withheld until it is mined."
                .to_string(),
        });
    }
    let expected = parse_payment_recipient(&record.recipient, wallet.chain)?;
    let connection = Connection::open_with_flags(
        &wallet.db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|error| format!("Could not open the wallet database for recipient detection: {error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT to_address, value FROM v_tx_outputs
             WHERE txid = ?1 AND is_change = 0 AND to_account_uuid IS NULL",
        )
        .map_err(|error| format!("Could not query wallet outputs: {error}"))?;
    let rows = statement
        .query_map([txid.as_ref()], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, i64>(1)?,
            ))
        })
        .map_err(|error| format!("Could not read wallet outputs: {error}"))?;
    let mut matched_total = 0u64;
    let mut matched_outputs = 0usize;
    for row in rows {
        let (address, value) =
            row.map_err(|error| format!("Could not read a wallet output: {error}"))?;
        let Some(address) = address else {
            continue;
        };
        let Ok(parsed) = ZcashAddress::try_from_encoded(&address) else {
            continue;
        };
        if parsed == expected {
            matched_total = matched_total
                .checked_add(u64::try_from(value).unwrap_or(0))
                .ok_or("Recipient output total overflowed.")?;
            matched_outputs += 1;
        }
    }
    if matched_total == record.amount_zatoshis {
        Ok(DetectionReport {
            detected: true,
            available: true,
            note: format!(
                "The mined transaction contains {matched_outputs} non-change output(s) to the quoted recipient totaling exactly {} zatoshi.",
                record.amount_zatoshis
            ),
        })
    } else {
        Ok(DetectionReport {
            detected: false,
            available: true,
            note: format!(
                "The mined transaction has no non-change output to the quoted recipient totaling {} zatoshi (found {matched_total}).",
                record.amount_zatoshis
            ),
        })
    }
}

fn load_and_recover_journal(path: &Path) -> Result<Journal, String> {
    let mut journal = load_journal(path)?;
    let mut changed = false;
    for record in journal.sends.values_mut() {
        if record.state == SendState::Building {
            record.state = SendState::Interrupted;
            record.message = Some(
                "The process stopped while preparing this quote, so it was not broadcast. Check the wallet history and request a new quote before retrying."
                    .to_string(),
            );
            record.updated_ms = now_ms();
            changed = true;
        }
    }
    if changed {
        save_journal(path, &journal)?;
    }
    Ok(journal)
}

fn load_journal(path: &Path) -> Result<Journal, String> {
    if !path.exists() {
        return Ok(Journal::default());
    }
    let data = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let journal: Journal = serde_json::from_str(&data).map_err(|error| {
        format!(
            "Could not parse {}. Inspect the file before retrying: {error}",
            path.display()
        )
    })?;
    if journal.version != 1 {
        return Err(format!(
            "{} has unsupported version {}.",
            path.display(),
            journal.version
        ));
    }
    Ok(journal)
}

fn save_journal(path: &Path, journal: &Journal) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Could not serialize the send journal: {error}"))?;
    write_atomic_private(path, &data)
}

async fn connect(
    endpoint: &str,
) -> Result<CompactTxStreamerClient<tonic::transport::Channel>, String> {
    CompactTxStreamerClient::connect(endpoint.to_string())
        .await
        .map_err(|error| format!("Could not connect to LIGHTWALLETD_ENDPOINT: {error}"))
}

async fn ensure_chain(
    client: &mut CompactTxStreamerClient<tonic::transport::Channel>,
    chain: Chain,
) -> Result<(), String> {
    let info = client
        .get_lightd_info(zcash_client_backend::proto::service::Empty {})
        .await
        .map_err(|error| format!("lightwalletd did not return chain information: {error}"))?;
    configured_chain(&info.into_inner(), chain)
}

fn configured_chain(info: &LightdInfo, chain: Chain) -> Result<(), String> {
    let name = info.chain_name.to_ascii_lowercase();
    let main = name.contains("main");
    let test = name.contains("test");
    match chain {
        Chain::Main if main && !test => Ok(()),
        Chain::Test if test && !main => Ok(()),
        _ => Err(format!(
            "lightwalletd reported chain {name}. This service is configured for {}.",
            chain.as_str()
        )),
    }
}

fn remember_chain(data_dir: &Path, chain: Chain) -> Result<(), String> {
    let path = data_dir.join("chain.txt");
    if path.is_file() {
        let existing = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        let existing = existing.trim();
        if existing != chain.as_str() {
            return Err(format!(
                "This data directory is marked {existing}. Start it with WALLET_NETWORK={existing}, or choose a different WALLET_DATA_DIR."
            ));
        }
        return Ok(());
    }
    let has_wallet = data_dir.join("wallet.sqlite").is_file()
        || data_dir
            .join("vaults")
            .read_dir()
            .ok()
            .is_some_and(|mut entries| entries.next().is_some());
    if has_wallet && chain.is_main() {
        return Err(
            "This data directory already has a wallet and no chain marker. Refusing to open it as mainnet. Use a new WALLET_DATA_DIR."
                .to_string(),
        );
    }
    write_atomic_private(path.as_path(), format!("{}\n", chain.as_str()).as_bytes())
}

fn parse_payment_recipient(recipient: &str, chain: Chain) -> Result<ZcashAddress, String> {
    let pool = match chain {
        Chain::Test => wallet_core::classify_testnet_recipient(recipient)?,
        Chain::Main => wallet_core::classify_mainnet_recipient(recipient)?,
    };
    let address = ZcashAddress::try_from_encoded(recipient)
        .map_err(|_| "Recipient is not a valid Zcash address.".to_string())?;
    let expected = chain.network_type();
    match pool {
        wallet_core::AddressPool::Transparent => {
            address
                .clone()
                .convert_if_network::<AllowedTransparent>(expected)
                .map_err(|_| match chain {
                    Chain::Test => {
                        "Recipient must be a transparent testnet address (tm or t2).".to_string()
                    }
                    Chain::Main => {
                        "Recipient must be a transparent mainnet address (t1 or t3).".to_string()
                    }
                })?;
            Ok(address)
        }
        wallet_core::AddressPool::Sapling | wallet_core::AddressPool::Unified => {
            address
                .clone()
                .convert_if_network::<AllowedShielded>(expected)
                .map_err(|_| match chain {
                    Chain::Test => {
                        "Recipient must be a testnet address with a Sapling or Orchard receiver."
                            .to_string()
                    }
                    Chain::Main => {
                        "Recipient must be a mainnet address with a Sapling or Orchard receiver."
                            .to_string()
                    }
                })?;
            Ok(address)
        }
    }
}

async fn latest_height(
    client: &mut CompactTxStreamerClient<tonic::transport::Channel>,
) -> Result<u64, String> {
    let block = client
        .get_latest_block(ChainSpec {})
        .await
        .map_err(|error| format!("lightwalletd did not return a tip: {error}"))?;
    Ok(block.into_inner().height)
}

async fn chain_mined(
    client: &mut CompactTxStreamerClient<tonic::transport::Channel>,
    txid: TxId,
) -> Option<bool> {
    match client
        .get_transaction(TxFilter {
            block: None,
            index: 0,
            hash: txid.as_ref().to_vec(),
        })
        .await
    {
        Ok(response) => Some(response.into_inner().height > 0),
        Err(_) => None,
    }
}

/// Faucet funding stays on a shielded testnet address.
pub(crate) fn ensure_shielded_testnet_recipient(recipient: &str) -> Result<(), String> {
    parse_shielded_testnet_recipient(recipient).map(|_| ())
}

fn parse_shielded_testnet_recipient(recipient: &str) -> Result<ZcashAddress, String> {
    let pool = wallet_core::classify_testnet_recipient(recipient)?;
    if !wallet_core::is_shielded_pool(pool) {
        return Err("Faucet funding requires a shielded testnet address.".to_string());
    }
    let address = ZcashAddress::try_from_encoded(recipient)
        .map_err(|_| "Recipient is not a valid Zcash address.".to_string())?;
    address
        .clone()
        .convert_if_network::<AllowedShielded>(NetworkType::Test)
        .map_err(|_| {
            "Recipient must be a testnet address with a Sapling or Orchard receiver.".to_string()
        })?;
    Ok(address)
}

fn parse_txid(value: &str) -> Result<TxId, String> {
    TxId::from_hex(value)
        .ok_or_else(|| format!("Transaction id {value} is not a Zcash transaction id."))
}

fn duplicate_secret(seed: &SecretVec<u8>) -> SecretVec<u8> {
    SecretVec::new(seed.expose_secret().clone())
}

struct AllowedTransparent;

impl TryFromAddress for AllowedTransparent {
    type Error = &'static str;

    fn try_from_transparent_p2pkh(
        net: NetworkType,
        _data: [u8; 20],
    ) -> Result<Self, ConversionError<Self::Error>> {
        accept_payment_network(net).map(|_| AllowedTransparent)
    }

    fn try_from_transparent_p2sh(
        net: NetworkType,
        _data: [u8; 20],
    ) -> Result<Self, ConversionError<Self::Error>> {
        accept_payment_network(net).map(|_| AllowedTransparent)
    }
}

struct AllowedShielded;

impl TryFromAddress for AllowedShielded {
    type Error = &'static str;

    fn try_from_sapling(
        net: NetworkType,
        _data: [u8; 43],
    ) -> Result<Self, ConversionError<Self::Error>> {
        accept_payment_network(net).map(|_| AllowedShielded)
    }

    fn try_from_unified(
        net: NetworkType,
        data: zcash_address::unified::Address,
    ) -> Result<Self, ConversionError<Self::Error>> {
        accept_payment_network(net)?;
        if data.has_receiver_of_type(PoolType::SAPLING)
            || data.has_receiver_of_type(PoolType::ORCHARD)
        {
            Ok(AllowedShielded)
        } else {
            Err(ConversionError::User(
                "unified address has no shielded receiver",
            ))
        }
    }
}

fn accept_payment_network(net: NetworkType) -> Result<(), ConversionError<&'static str>> {
    if net == NetworkType::Test || net == NetworkType::Main {
        Ok(())
    } else {
        Err(ConversionError::User("unsupported network"))
    }
}

fn display_txid(txid: TxId) -> String {
    txid.to_string()
}

fn list_wallet_history(
    db_path: &Path,
    account_id: AccountUuid,
    limit: usize,
) -> Result<Vec<HistoryEntry>, String> {
    let limit = limit.clamp(1, 100);
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Could not open the wallet database for history: {error}"))?;

    let account_uuid = account_id.expose_uuid();
    let account_key = account_uuid.as_bytes().as_slice();
    let mut statement = conn
        .prepare(
            "SELECT txid,
                    mined_height,
                    account_balance_delta,
                    total_received,
                    total_spent,
                    fee_paid,
                    received_note_count,
                    sent_note_count,
                    is_shielding,
                    pool_crossing_value
             FROM v_transactions
             WHERE account_uuid = ?1
             ORDER BY mined_height DESC NULLS FIRST, txid DESC
             LIMIT ?2",
        )
        .map_err(|error| format!("Could not prepare wallet history: {error}"))?;

    let rows = statement
        .query_map(rusqlite::params![account_key, limit as i64], |row| {
            let txid_bytes: Vec<u8> = row.get(0)?;
            let mined_height: Option<u32> = row.get(1)?;
            let delta: i64 = row.get(2)?;
            let total_received: i64 = row.get(3)?;
            let total_spent: i64 = row.get(4)?;
            let fee_paid: Option<i64> = row.get(5)?;
            let received_note_count: u32 = row.get(6)?;
            let sent_note_count: u32 = row.get(7)?;
            let is_shielding: bool = row.get(8)?;
            let pool_crossing: Option<i64> = row.get(9)?;
            Ok((
                txid_bytes,
                mined_height,
                delta,
                total_received,
                total_spent,
                fee_paid,
                received_note_count,
                sent_note_count,
                is_shielding,
                pool_crossing,
            ))
        })
        .map_err(|error| format!("Could not read wallet history: {error}"))?;

    let mut entries = Vec::new();
    for row in rows {
        let (
            txid_bytes,
            mined_height,
            delta,
            total_received,
            total_spent,
            fee_paid,
            received_note_count,
            sent_note_count,
            is_shielding,
            pool_crossing,
        ) = row.map_err(|error| format!("Could not decode a history row: {error}"))?;
        let txid_array: [u8; 32] = txid_bytes
            .try_into()
            .map_err(|_| "A history row had an invalid transaction id.".to_string())?;
        let txid = TxId::from_bytes(txid_array);
        let kind = if is_shielding || pool_crossing.is_some() {
            "shield"
        } else if delta > 0 {
            "received"
        } else if delta < 0 {
            "sent"
        } else {
            "other"
        };
        entries.push(HistoryEntry {
            txid: display_txid(txid),
            mined_height,
            account_balance_delta_zatoshis: delta.to_string(),
            total_received_zatoshis: total_received.to_string(),
            total_spent_zatoshis: total_spent.to_string(),
            fee_paid_zatoshis: fee_paid.map(|value| value.to_string()),
            kind: kind.to_string(),
            received_note_count,
            sent_note_count,
        });
    }
    Ok(entries)
}

fn unavailable_status(txid: &str, note: &str) -> StatusReport {
    StatusReport {
        txid: txid.to_string(),
        mined_height: None,
        block_hash: None,
        confirmations: None,
        confirmation_met: false,
        confirmation_note: note.to_string(),
        confirmation_available: false,
        detected: false,
        detection_note: note.to_string(),
        detection_available: false,
    }
}

async fn block_hash_at(
    client: &mut CompactTxStreamerClient<tonic::transport::Channel>,
    height: u64,
) -> Option<String> {
    let block = client
        .get_block(BlockId {
            height,
            hash: Vec::new(),
        })
        .await
        .ok()?
        .into_inner();
    if block.hash.is_empty() {
        return None;
    }
    // CompactBlock.hash is the block hash in internal byte order; explorers expect
    // the conventional reversed hex encoding.
    Some(
        block
            .hash
            .iter()
            .rev()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use zcash_client_backend::data_api::chain::ChainState;
    use zcash_primitives::block::BlockHash;
    use zcash_protocol::consensus::BlockHeight;

    pub(crate) const TEST_PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    pub(crate) fn test_seed() -> SecretVec<u8> {
        let mnemonic = <Mnemonic>::from_phrase(TEST_PHRASE).expect("test mnemonic");
        SecretVec::new(mnemonic.to_seed("").to_vec())
    }

    pub(crate) fn seed_database(dir: &Path, accounts: usize) {
        fs::write(dir.join(RECOVERY_FILE), TEST_PHRASE).expect("write recovery");
        let mut db = WalletDb::for_path(
            dir.join("wallet.sqlite"),
            Network::TestNetwork,
            SystemClock,
            service_rng(),
        )
        .expect("open test wallet");
        init_wallet_db(&mut db, Some(test_seed())).expect("init test wallet");
        let seed = test_seed();
        let birthday = AccountBirthday::from_parts(
            ChainState::empty(BlockHeight::from_u32(2_000_000), BlockHash([0; 32])),
            None,
        );
        for name in ["testnet", "disclosure"].into_iter().take(accounts) {
            WalletWrite::create_account(&mut db, name, &seed, &birthday, Some("test"))
                .expect("create test account");
        }
    }
}

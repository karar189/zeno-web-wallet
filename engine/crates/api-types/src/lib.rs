use serde::{Deserialize, Serialize};

pub const LIVE_BACKEND_BLOCKER: &str =
    "No verified Zcash SDK is connected. Shielded testnet submission is not available.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreparationMode {
    Baseline,
    Optimized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataKind {
    Simulated,
    Observed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncState {
    Synced,
    Syncing,
    Stale,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageName {
    WalletReadiness,
    Preflight,
    Construction,
    Proof,
    Signing,
    Broadcast,
    Confirmation,
    RecipientDetection,
}

pub const STAGE_NAMES: [StageName; 8] = [
    StageName::WalletReadiness,
    StageName::Preflight,
    StageName::Construction,
    StageName::Proof,
    StageName::Signing,
    StageName::Broadcast,
    StageName::Confirmation,
    StageName::RecipientDetection,
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StageMeasurement {
    #[serde(rename = "measured", rename_all = "camelCase")]
    Measured { duration_ms: u64, kind: DataKind },
    #[serde(rename = "unavailable")]
    Unavailable { reason: String },
}

impl StageMeasurement {
    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self::Unavailable {
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    InsufficientFunds,
    StaleWallet,
    NotReady,
    InvalidRequest,
    RpcFailure,
    Rejected,
    BackendUnavailable,
    NotAuthorized,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentFailure {
    pub code: FailureCode,
    pub message: String,
    pub recovery: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRequest {
    pub recipient: String,
    pub amount_zec: Option<String>,
    pub network: String,
    pub memo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub sync: SyncState,
    pub spendable_zatoshis: Option<String>,
    pub network: String,
    pub measurement: StageMeasurement,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeeQuote {
    pub fee_zatoshis: Option<String>,
    pub note: String,
    pub measurement: StageMeasurement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPayment {
    pub preparation_id: String,
    pub recipient: String,
    pub amount_zatoshis: String,
    pub fee_zatoshis: String,
    pub network: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstructMeasurements {
    pub construction: StageMeasurement,
    pub proof: StageMeasurement,
    pub signing: StageMeasurement,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConstructResult {
    pub preparation: PreparedPayment,
    pub measurements: ConstructMeasurements,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    pub approved_at_ms: u64,
    pub recipient: String,
    pub amount_zatoshis: String,
    pub network: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionEvidence {
    pub source: String,
    pub reference: String,
    pub accepted_for_broadcast: bool,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationEvidence {
    pub source: String,
    pub met: bool,
    pub criterion: String,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionEvidence {
    pub source: String,
    pub detected: bool,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum SubmitResult {
    #[serde(rename = "accepted", rename_all = "camelCase")]
    Accepted {
        evidence: SubmissionEvidence,
        measurement: StageMeasurement,
    },
    #[serde(rename = "rejected", rename_all = "camelCase")]
    Rejected {
        message: String,
        measurement: StageMeasurement,
    },
    #[serde(rename = "indeterminate", rename_all = "camelCase")]
    Indeterminate {
        message: String,
        measurement: StageMeasurement,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentPhase {
    Draft,
    Preparing,
    AwaitingApproval,
    Submitting,
    Tracking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StatusConfidence {
    Known,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DataSource {
    Simulated,
    Live,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentRecord {
    pub id: String,
    pub mode: PreparationMode,
    pub phase: PaymentPhase,
    pub request: PaymentRequest,
    pub sync: SyncState,
    pub spendable_zatoshis: Option<String>,
    pub fee_zatoshis: Option<String>,
    pub fee_note: Option<String>,
    pub preparation: Option<PreparedPayment>,
    pub authorization: Option<Authorization>,
    pub submission: Option<SubmissionEvidence>,
    pub confirmation: Option<ConfirmationEvidence>,
    pub detection: Option<DetectionEvidence>,
    pub failure: Option<PaymentFailure>,
    pub status_confidence: StatusConfidence,
    pub stages: Vec<NamedStage>,
    pub data_source: DataSource,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedStage {
    pub name: StageName,
    pub measurement: StageMeasurement,
}

impl PaymentRecord {
    pub fn stage(&self, name: StageName) -> Option<&StageMeasurement> {
        self.stages
            .iter()
            .find(|stage| stage.name == name)
            .map(|stage| &stage.measurement)
    }

    pub fn set_stage(&mut self, name: StageName, measurement: StageMeasurement) {
        if let Some(stage) = self.stages.iter_mut().find(|stage| stage.name == name) {
            stage.measurement = measurement;
        } else {
            self.stages.push(NamedStage { name, measurement });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrialOutcome {
    Success,
    Failed,
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trial {
    pub id: String,
    pub mode: TrialMode,
    pub measurement_kind: DataKind,
    pub cold_start: bool,
    pub outcome: TrialOutcome,
    pub failure_code: Option<FailureCode>,
    pub stages: Vec<NamedStage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrialMode {
    Baseline,
    Optimized,
    Experimental,
}

impl Trial {
    pub fn stage(&self, name: StageName) -> Option<&StageMeasurement> {
        self.stages
            .iter()
            .find(|stage| stage.name == name)
            .map(|stage| &stage.measurement)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub can_submit: bool,
    pub kind: DataSource,
    pub network: String,
    pub blocker: String,
    pub proof: StageMeasurement,
    pub signing: StageMeasurement,
    pub broadcast: StageMeasurement,
}

pub const FORBIDDEN_FIELD_NAMES: &[&str] = &[
    "seed",
    "mnemonic",
    "seedphrase",
    "spendingkey",
    "viewingkey",
    "privatekey",
    "ufvk",
    "usk",
];

pub fn json_contains_key_material(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map.iter().any(|(key, child)| {
            forbidden_field(key) || json_contains_key_material(child) || string_looks_like_seed(child)
        }),
        serde_json::Value::Array(items) => items.iter().any(json_contains_key_material),
        other => string_looks_like_seed(other),
    }
}

fn forbidden_field(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(|character| character.to_lowercase())
        .collect();
    FORBIDDEN_FIELD_NAMES.contains(&normalized.as_str())
}

fn string_looks_like_seed(value: &serde_json::Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let words: Vec<&str> = text.split_whitespace().collect();
    (words.len() == 12 || words.len() == 24)
        && words.iter().all(|word| {
            let length = word.len();
            (3..=8).contains(&length) && word.chars().all(|character| character.is_ascii_lowercase())
        })
}

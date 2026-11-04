use api_types::{
    Authorization, ConfirmationEvidence, ConstructResult, DataSource, DetectionEvidence, FeeQuote,
    PreparationMode, PreparedPayment, Readiness, StageMeasurement, SubmitResult, LIVE_BACKEND_BLOCKER,
};

pub struct ConstructInput {
    pub mode: PreparationMode,
    pub recipient: String,
    pub amount_zatoshis: u64,
    pub fee_zatoshis: u64,
}

pub struct SubmitInput {
    pub preparation: PreparedPayment,
    pub authorization: Authorization,
}

pub trait WalletAdapter {
    fn id(&self) -> &str;
    fn kind(&self) -> DataSource;
    fn can_submit(&self) -> bool;
    fn blocker(&self) -> Option<&str>;
    fn get_readiness(&self, mode: PreparationMode) -> Readiness;
    fn quote_fee(&self, mode: PreparationMode) -> FeeQuote;
    fn construct(&self, input: ConstructInput) -> Result<ConstructResult, String>;
    fn submit(&self, input: SubmitInput) -> SubmitResult;
    fn confirm(&self, reference: &str) -> Result<ConfirmationEvidence, String>;
    fn detect(&self, reference: &str, recipient: &str) -> Result<DetectionEvidence, String>;
}

#[derive(Debug, Default)]
pub struct BlockedAdapter {
    pub submit_count: std::sync::atomic::AtomicUsize,
}

impl BlockedAdapter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn capabilities(&self) -> api_types::Capabilities {
        let unavailable = StageMeasurement::unavailable(LIVE_BACKEND_BLOCKER);
        api_types::Capabilities {
            can_submit: false,
            kind: DataSource::Live,
            network: "testnet".to_string(),
            blocker: LIVE_BACKEND_BLOCKER.to_string(),
            proof: unavailable.clone(),
            signing: unavailable.clone(),
            broadcast: unavailable,
        }
    }
}

impl WalletAdapter for BlockedAdapter {
    fn id(&self) -> &str {
        "zcash-live-unintegrated"
    }

    fn kind(&self) -> DataSource {
        DataSource::Live
    }

    fn can_submit(&self) -> bool {
        false
    }

    fn blocker(&self) -> Option<&str> {
        Some(LIVE_BACKEND_BLOCKER)
    }

    fn get_readiness(&self, _mode: PreparationMode) -> Readiness {
        Readiness {
            sync: api_types::SyncState::Unknown,
            spendable_zatoshis: None,
            network: "testnet".to_string(),
            measurement: StageMeasurement::unavailable(LIVE_BACKEND_BLOCKER),
            note: LIVE_BACKEND_BLOCKER.to_string(),
        }
    }

    fn quote_fee(&self, _mode: PreparationMode) -> FeeQuote {
        FeeQuote {
            fee_zatoshis: None,
            note: LIVE_BACKEND_BLOCKER.to_string(),
            measurement: StageMeasurement::unavailable(LIVE_BACKEND_BLOCKER),
        }
    }

    fn construct(&self, _input: ConstructInput) -> Result<ConstructResult, String> {
        Err(LIVE_BACKEND_BLOCKER.to_string())
    }

    fn submit(&self, _input: SubmitInput) -> SubmitResult {
        self.submit_count
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        SubmitResult::Rejected {
            message: LIVE_BACKEND_BLOCKER.to_string(),
            measurement: StageMeasurement::unavailable(LIVE_BACKEND_BLOCKER),
        }
    }

    fn confirm(&self, _reference: &str) -> Result<ConfirmationEvidence, String> {
        Ok(ConfirmationEvidence {
            source: "unavailable".to_string(),
            met: false,
            criterion: "backend_not_integrated".to_string(),
            note: LIVE_BACKEND_BLOCKER.to_string(),
        })
    }

    fn detect(&self, _reference: &str, _recipient: &str) -> Result<DetectionEvidence, String> {
        Ok(DetectionEvidence {
            source: "unavailable".to_string(),
            detected: false,
            note: LIVE_BACKEND_BLOCKER.to_string(),
        })
    }
}

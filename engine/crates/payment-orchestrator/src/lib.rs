use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use api_types::{
    Authorization, DataKind, DataSource, FailureCode, PaymentFailure, PaymentPhase, PaymentRecord,
    PaymentRequest, PreparationMode, StageMeasurement, StageName, StatusConfidence, SubmitResult,
    SyncState,
};
use wallet_core::{run_preflight, PreflightInput};
use zcash_adapter::{SubmitInput, WalletAdapter};

pub trait Clock {
    fn now_ms(&self) -> u64;
}

pub struct PaymentOrchestrator<A, C, I> {
    adapter: A,
    clock: C,
    ids: I,
    gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    settled: Mutex<HashMap<String, PaymentRecord>>,
}

impl<A, C, I> PaymentOrchestrator<A, C, I>
where
    A: WalletAdapter,
    C: Clock,
    I: Fn() -> String,
{
    pub fn new(adapter: A, clock: C, ids: I) -> Self {
        Self {
            adapter,
            clock,
            ids,
            gates: Mutex::new(HashMap::new()),
            settled: Mutex::new(HashMap::new()),
        }
    }

    pub fn adapter(&self) -> &A {
        &self.adapter
    }

    pub fn create_draft(
        &self,
        recipient: &str,
        amount_zec: Option<&str>,
        mode: PreparationMode,
    ) -> PaymentRecord {
        PaymentRecord {
            id: (self.ids)(),
            mode,
            phase: PaymentPhase::Draft,
            request: PaymentRequest {
                recipient: recipient.trim().to_string(),
                amount_zec: amount_zec
                    .map(str::trim)
                    .filter(|amount| !amount.is_empty())
                    .map(str::to_string),
                network: "testnet".to_string(),
                memo: None,
            },
            sync: SyncState::Unknown,
            spendable_zatoshis: None,
            fee_zatoshis: None,
            fee_note: None,
            preparation: None,
            authorization: None,
            submission: None,
            confirmation: None,
            detection: None,
            failure: None,
            status_confidence: StatusConfidence::Known,
            stages: Vec::new(),
            data_source: match self.adapter.kind() {
                DataSource::Simulated => DataSource::Simulated,
                DataSource::Live => DataSource::Live,
            },
            warnings: vec![
                "Submission, confirmation, and recipient detection stay separate.".to_string(),
            ],
        }
    }

    pub fn prepare(&self, record: PaymentRecord) -> PaymentRecord {
        if record.submission.as_ref().is_some_and(|submission| submission.accepted_for_broadcast)
            || record.status_confidence == StatusConfidence::Unknown
        {
            return record;
        }

        let mut preparing = record;
        preparing.phase = PaymentPhase::Preparing;
        preparing.authorization = None;
        preparing.preparation = None;
        preparing.submission = None;
        preparing.confirmation = None;
        preparing.detection = None;
        preparing.failure = None;
        preparing.status_confidence = StatusConfidence::Known;

        if !self.adapter.can_submit() {
            preparing.phase = PaymentPhase::Draft;
            preparing.sync = SyncState::Unknown;
            preparing.failure = Some(failure(
                FailureCode::BackendUnavailable,
                self.adapter
                    .blocker()
                    .unwrap_or("The selected backend cannot submit payments."),
                "Connect a verified backend before sending. Nothing was sent.",
            ));
            preparing.set_stage(
                StageName::WalletReadiness,
                StageMeasurement::unavailable(
                    self.adapter
                        .blocker()
                        .unwrap_or("Backend cannot submit payments."),
                ),
            );
            return preparing;
        }

        let readiness = self.adapter.get_readiness(preparing.mode);
        preparing.sync = readiness.sync;
        preparing.spendable_zatoshis = readiness.spendable_zatoshis.clone();
        preparing.set_stage(StageName::WalletReadiness, readiness.measurement);
        preparing.warnings.push(readiness.note);

        let spendable = parse_optional_u64(preparing.spendable_zatoshis.as_deref());
        if readiness.sync != SyncState::Synced || spendable.is_none() {
            let code = if readiness.sync == SyncState::Stale {
                FailureCode::StaleWallet
            } else {
                FailureCode::NotReady
            };
            preparing.phase = PaymentPhase::Draft;
            preparing.failure = Some(failure(
                code,
                if readiness.sync == SyncState::Stale {
                    "Wallet state is stale, so it cannot authorize a payment."
                } else {
                    "The wallet is not ready to send."
                },
                "Prepare the payment again after the wallet reports a synced balance.",
            ));
            return preparing;
        }

        let fee = self.adapter.quote_fee(preparing.mode);
        preparing.fee_zatoshis = fee.fee_zatoshis.clone();
        preparing.fee_note = Some(fee.note);
        preparing.set_stage(StageName::Preflight, fee.measurement);
        let fee_zatoshis = parse_optional_u64(preparing.fee_zatoshis.as_deref());

        let preflight = run_preflight(PreflightInput {
            recipient: &preparing.request.recipient,
            amount_zec: preparing.request.amount_zec.as_deref(),
            sync: readiness.sync,
            spendable_zatoshis: spendable,
            fee_zatoshis,
        });
        let (amount, _fee) = match preflight {
            Ok(values) => values,
            Err(error) => {
                preparing.phase = PaymentPhase::Draft;
                preparing.failure = Some(error);
                return preparing;
            }
        };

        let constructed = match self.adapter.construct(zcash_adapter::ConstructInput {
            mode: preparing.mode,
            recipient: preparing.request.recipient.clone(),
            amount_zatoshis: amount,
            fee_zatoshis: fee_zatoshis.unwrap_or(0),
        }) {
            Ok(constructed) => constructed,
            Err(message) => {
                preparing.phase = PaymentPhase::Draft;
                preparing.failure = Some(failure(
                    FailureCode::BackendUnavailable,
                    message,
                    "Nothing was sent.",
                ));
                return preparing;
            }
        };

        if constructed.preparation.recipient != preparing.request.recipient {
            preparing.phase = PaymentPhase::Draft;
            preparing.failure = Some(failure(
                FailureCode::InvalidRequest,
                "Preparation returned a different recipient.",
                "Start again. Nothing was sent.",
            ));
            return preparing;
        }

        preparing.phase = PaymentPhase::AwaitingApproval;
        preparing.set_stage(StageName::Construction, constructed.measurements.construction);
        preparing.set_stage(StageName::Proof, constructed.measurements.proof);
        preparing.set_stage(StageName::Signing, constructed.measurements.signing);
        preparing.preparation = Some(constructed.preparation);
        preparing.authorization = None;
        preparing.failure = None;
        preparing
    }

    pub fn authorize_and_submit(&self, record: PaymentRecord) -> PaymentRecord {
        let gate = {
            let mut gates = self.gates.lock().expect("authorize lock");
            gates
                .entry(record.id.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = gate.lock().expect("authorize gate");
        if let Some(existing) = self.settled.lock().expect("settled").get(&record.id) {
            return existing.clone();
        }
        let result = self.authorize_body(record);
        if result.submission.is_some() || result.status_confidence == StatusConfidence::Unknown {
            self.settled
                .lock()
                .expect("settled")
                .insert(result.id.clone(), result.clone());
        }
        result
    }

    pub fn confirm(&self, record: PaymentRecord) -> PaymentRecord {
        let Some(submission) = record.submission.clone() else {
            return record;
        };
        if !submission.accepted_for_broadcast {
            return record;
        }
        if record
            .confirmation
            .as_ref()
            .is_some_and(|confirmation| confirmation.met || confirmation.source == "unavailable")
        {
            return record;
        }
        let started = self.clock.now_ms();
        match self.adapter.confirm(&submission.reference) {
            Ok(confirmation) => {
                let mut next = record;
                let measurement = self.measured(&next, self.clock.now_ms().saturating_sub(started));
                next.set_stage(StageName::Confirmation, measurement);
                next.confirmation = Some(confirmation);
                next
            }
            Err(_) => {
                let mut next = record;
                next.confirmation = Some(api_types::ConfirmationEvidence {
                    source: "unavailable".to_string(),
                    met: false,
                    criterion: "status_check_failed".to_string(),
                    note: "The confirmation check failed. Submission evidence is unchanged.".to_string(),
                });
                next.set_stage(
                    StageName::Confirmation,
                    StageMeasurement::unavailable("The confirmation check failed."),
                );
                next
            }
        }
    }

    pub fn detect(&self, record: PaymentRecord) -> PaymentRecord {
        let Some(submission) = record.submission.clone() else {
            return record;
        };
        if !submission.accepted_for_broadcast {
            return record;
        }
        if record
            .detection
            .as_ref()
            .is_some_and(|detection| detection.detected || detection.source == "unavailable")
        {
            return record;
        }
        let started = self.clock.now_ms();
        match self.adapter.detect(&submission.reference, &record.request.recipient) {
            Ok(detection) => {
                let mut next = record;
                let measurement = self.measured(&next, self.clock.now_ms().saturating_sub(started));
                next.set_stage(StageName::RecipientDetection, measurement);
                next.detection = Some(detection);
                next
            }
            Err(_) => {
                let mut next = record;
                next.detection = Some(api_types::DetectionEvidence {
                    source: "unavailable".to_string(),
                    detected: false,
                    note: "Recipient detection failed. Confirmation evidence is unchanged.".to_string(),
                });
                next.set_stage(
                    StageName::RecipientDetection,
                    StageMeasurement::unavailable("Recipient detection failed."),
                );
                next
            }
        }
    }

    fn measured(&self, record: &PaymentRecord, duration_ms: u64) -> StageMeasurement {
        StageMeasurement::Measured {
            duration_ms,
            kind: match record.data_source {
                DataSource::Simulated => DataKind::Simulated,
                DataSource::Live => DataKind::Observed,
            },
        }
    }

    fn authorize_body(&self, record: PaymentRecord) -> PaymentRecord {
        if record.submission.as_ref().is_some_and(|submission| submission.accepted_for_broadcast)
            || record.status_confidence == StatusConfidence::Unknown
        {
            return record;
        }
        if record.phase != PaymentPhase::AwaitingApproval || record.preparation.is_none() {
            return record;
        }
        if !self.adapter.can_submit() {
            let mut next = record;
            next.phase = PaymentPhase::Draft;
            next.authorization = None;
            next.failure = Some(failure(
                FailureCode::BackendUnavailable,
                self.adapter
                    .blocker()
                    .unwrap_or("The selected backend cannot submit payments."),
                "Nothing was sent.",
            ));
            return next;
        }

        let readiness = self.adapter.get_readiness(record.mode);
        let fee = self.adapter.quote_fee(record.mode);
        let (amount, _) = match run_preflight(PreflightInput {
            recipient: &record.request.recipient,
            amount_zec: record.request.amount_zec.as_deref(),
            sync: readiness.sync,
            spendable_zatoshis: parse_optional_u64(readiness.spendable_zatoshis.as_deref()),
            fee_zatoshis: parse_optional_u64(fee.fee_zatoshis.as_deref()),
        }) {
            Ok(values) => values,
            Err(error) => {
                let mut next = record;
                next.phase = PaymentPhase::Draft;
                next.sync = readiness.sync;
                next.spendable_zatoshis = readiness.spendable_zatoshis;
                next.authorization = None;
                next.preparation = None;
                next.failure = Some(error);
                return next;
            }
        };
        let prepared = record.preparation.clone().expect("checked");
        if prepared.expires_at_ms <= self.clock.now_ms() {
            let mut next = record;
            next.phase = PaymentPhase::Draft;
            next.authorization = None;
            next.preparation = None;
            next.failure = Some(failure(
                FailureCode::StaleWallet,
                "The prepared payment expired before authorization.",
                "Prepare it again. Nothing was sent.",
            ));
            return next;
        }
        if prepared.recipient != record.request.recipient
            || prepared.amount_zatoshis != amount.to_string()
            || prepared.network != record.request.network
        {
            let mut next = record;
            next.phase = PaymentPhase::Draft;
            next.authorization = None;
            next.preparation = None;
            next.failure = Some(failure(
                FailureCode::InvalidRequest,
                "The payment details changed after preparation.",
                "Review the new details and prepare again. Nothing was sent.",
            ));
            return next;
        }

        let authorization = Authorization {
            approved_at_ms: self.clock.now_ms(),
            recipient: prepared.recipient.clone(),
            amount_zatoshis: prepared.amount_zatoshis.clone(),
            network: prepared.network.clone(),
        };
        let mut submitting = record;
        submitting.phase = PaymentPhase::Submitting;
        submitting.authorization = Some(authorization.clone());
        submitting.failure = None;
        submitting.sync = readiness.sync;
        submitting.spendable_zatoshis = readiness.spendable_zatoshis;
        let result = self.adapter.submit(SubmitInput {
            preparation: prepared,
            authorization,
        });
        match result {
            SubmitResult::Accepted {
                evidence,
                measurement,
            } => {
                submitting.phase = PaymentPhase::Tracking;
                submitting.submission = Some(evidence);
                submitting.set_stage(StageName::Broadcast, measurement);
                submitting
            }
            SubmitResult::Indeterminate {
                message,
                measurement,
            } => {
                submitting.phase = PaymentPhase::Tracking;
                submitting.status_confidence = StatusConfidence::Unknown;
                submitting.submission = None;
                submitting.failure = Some(failure(
                    FailureCode::RpcFailure,
                    message,
                    "Status is unknown. This payment will not be retried automatically.",
                ));
                submitting.set_stage(StageName::Broadcast, measurement);
                submitting
            }
            SubmitResult::Rejected {
                message,
                measurement,
            } => {
                let mut next = submitting;
                next.phase = PaymentPhase::Draft;
                next.authorization = None;
                next.failure = Some(failure(
                    FailureCode::Rejected,
                    message,
                    "The backend did not accept the payment. You can prepare it again.",
                ));
                next.set_stage(StageName::Broadcast, measurement);
                next
            }
        }
    }
}

fn parse_optional_u64(value: Option<&str>) -> Option<u64> {
    value?.parse().ok()
}

fn failure(code: FailureCode, message: impl Into<String>, recovery: impl Into<String>) -> PaymentFailure {
    PaymentFailure {
        code,
        message: message.into(),
        recovery: recovery.into(),
    }
}

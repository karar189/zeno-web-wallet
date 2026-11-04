use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::thread;

use api_types::{
    ConfirmationEvidence, ConstructMeasurements, ConstructResult, DataKind, DataSource,
    DetectionEvidence, FailureCode, FeeQuote, PaymentPhase, PreparationMode, PreparedPayment,
    Readiness, StageMeasurement, StageName, StatusConfidence, SubmissionEvidence, SubmitResult,
    SyncState, LIVE_BACKEND_BLOCKER,
};
use payment_orchestrator::{Clock, PaymentOrchestrator};
use zcash_adapter::{BlockedAdapter, ConstructInput, SubmitInput, WalletAdapter};

struct FixedClock(AtomicU64);

impl Clock for FixedClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct CountingAdapter {
    submits: AtomicUsize,
    can_submit: bool,
    spendable: u64,
    fee: u64,
    now: AtomicU64,
    expire_in_ms: u64,
    next_submit: MutexSubmit,
}

enum MutexSubmit {
    Accept,
    Indeterminate,
}

impl WalletAdapter for CountingAdapter {
    fn id(&self) -> &str {
        "counting"
    }
    fn kind(&self) -> DataSource {
        DataSource::Live
    }
    fn can_submit(&self) -> bool {
        self.can_submit
    }
    fn blocker(&self) -> Option<&str> {
        (!self.can_submit).then_some(LIVE_BACKEND_BLOCKER)
    }
    fn get_readiness(&self, _mode: PreparationMode) -> Readiness {
        Readiness {
            sync: SyncState::Synced,
            spendable_zatoshis: Some(self.spendable.to_string()),
            network: "testnet".to_string(),
            measurement: StageMeasurement::Measured {
                duration_ms: 1,
                kind: DataKind::Observed,
            },
            note: "synced".to_string(),
        }
    }
    fn quote_fee(&self, _mode: PreparationMode) -> FeeQuote {
        FeeQuote {
            fee_zatoshis: Some(self.fee.to_string()),
            note: "fee".to_string(),
            measurement: StageMeasurement::Measured {
                duration_ms: 1,
                kind: DataKind::Observed,
            },
        }
    }
    fn construct(&self, input: ConstructInput) -> Result<ConstructResult, String> {
        Ok(ConstructResult {
            preparation: PreparedPayment {
                preparation_id: "prep".to_string(),
                recipient: input.recipient,
                amount_zatoshis: input.amount_zatoshis.to_string(),
                fee_zatoshis: input.fee_zatoshis.to_string(),
                network: "testnet".to_string(),
                expires_at_ms: self.now.load(Ordering::SeqCst) + self.expire_in_ms,
            },
            measurements: ConstructMeasurements {
                construction: StageMeasurement::Measured {
                    duration_ms: 2,
                    kind: DataKind::Observed,
                },
                proof: StageMeasurement::unavailable("The timing was not inferred."),
                signing: StageMeasurement::unavailable("The timing was not inferred."),
            },
        })
    }
    fn submit(&self, _input: SubmitInput) -> SubmitResult {
        self.submits.fetch_add(1, Ordering::SeqCst);
        match self.next_submit {
            MutexSubmit::Accept => SubmitResult::Accepted {
                evidence: SubmissionEvidence {
                    source: "backend".to_string(),
                    reference: "not-a-broadcast".to_string(),
                    accepted_for_broadcast: true,
                    note: "Accepted by the test adapter. This is not a Zcash transaction id.".to_string(),
                },
                measurement: StageMeasurement::Measured {
                    duration_ms: 3,
                    kind: DataKind::Observed,
                },
            },
            MutexSubmit::Indeterminate => SubmitResult::Indeterminate {
                message: "The node did not answer.".to_string(),
                measurement: StageMeasurement::unavailable("Broadcast status is unknown."),
            },
        }
    }
    fn confirm(&self, _reference: &str) -> Result<ConfirmationEvidence, String> {
        Ok(ConfirmationEvidence {
            source: "backend".to_string(),
            met: true,
            criterion: "test".to_string(),
            note: "confirmed in the test adapter".to_string(),
        })
    }
    fn detect(&self, _reference: &str, _recipient: &str) -> Result<DetectionEvidence, String> {
        Err("detection unavailable".to_string())
    }
}

fn recipient() -> String {
    format!("ztestsapling1{}", "q".repeat(50))
}

#[test]
fn prepare_on_the_blocked_adapter_does_not_authorize_or_submit() {
    let adapter = BlockedAdapter::new();
    let engine = PaymentOrchestrator::new(adapter, FixedClock(AtomicU64::new(1_000)), || "pay".to_string());
    let draft = engine.create_draft(&recipient(), Some("0.10"), PreparationMode::Baseline);
    let prepared = engine.prepare(draft);
    assert!(prepared.authorization.is_none());
    assert!(prepared.submission.is_none());
    assert_eq!(
        prepared.failure.unwrap().code,
        FailureCode::BackendUnavailable
    );
    assert_eq!(engine.adapter().submit_count.load(Ordering::SeqCst), 0);
}

#[test]
fn expired_preparation_does_not_submit() {
    let adapter = CountingAdapter {
        submits: AtomicUsize::new(0),
        can_submit: true,
        spendable: 125_000_000,
        fee: 10_000,
        now: AtomicU64::new(1_000),
        expire_in_ms: 0,
        next_submit: MutexSubmit::Accept,
    };
    let engine = PaymentOrchestrator::new(adapter, FixedClock(AtomicU64::new(1_000)), || "pay".to_string());
    let prepared = engine.prepare(engine.create_draft(&recipient(), Some("0.10"), PreparationMode::Baseline));
    assert_eq!(prepared.phase, PaymentPhase::AwaitingApproval);
    assert!(prepared.authorization.is_none());
    let submitted = engine.authorize_and_submit(prepared);
    assert!(submitted.submission.is_none());
    assert_eq!(submitted.failure.unwrap().code, FailureCode::StaleWallet);
    assert_eq!(engine.adapter().submits.load(Ordering::SeqCst), 0);
}

#[test]
fn parallel_authorize_submits_once() {
    let adapter = CountingAdapter {
        submits: AtomicUsize::new(0),
        can_submit: true,
        spendable: 125_000_000,
        fee: 10_000,
        now: AtomicU64::new(1_000),
        expire_in_ms: 60_000,
        next_submit: MutexSubmit::Accept,
    };
    let engine = PaymentOrchestrator::new(adapter, FixedClock(AtomicU64::new(1_000)), || "pay".to_string());
    let prepared = engine.prepare(engine.create_draft(&recipient(), Some("0.10"), PreparationMode::Baseline));
    thread::scope(|scope| {
        let left = scope.spawn(|| engine.authorize_and_submit(prepared.clone()));
        let right = scope.spawn(|| engine.authorize_and_submit(prepared.clone()));
        let left = left.join().unwrap();
        let right = right.join().unwrap();
        assert!(left.submission.is_some());
        assert!(right.submission.is_some());
    });
    assert_eq!(engine.adapter().submits.load(Ordering::SeqCst), 1);
}

#[test]
fn indeterminate_submit_is_not_retried() {
    let adapter = CountingAdapter {
        submits: AtomicUsize::new(0),
        can_submit: true,
        spendable: 125_000_000,
        fee: 10_000,
        now: AtomicU64::new(1_000),
        expire_in_ms: 60_000,
        next_submit: MutexSubmit::Indeterminate,
    };
    let engine = PaymentOrchestrator::new(adapter, FixedClock(AtomicU64::new(1_000)), || "pay".to_string());
    let prepared = engine.prepare(engine.create_draft(&recipient(), Some("0.10"), PreparationMode::Baseline));
    let first = engine.authorize_and_submit(prepared);
    assert_eq!(first.status_confidence, StatusConfidence::Unknown);
    assert!(first.submission.is_none());
    let second = engine.authorize_and_submit(first);
    assert_eq!(engine.adapter().submits.load(Ordering::SeqCst), 1);
    assert_eq!(second.status_confidence, StatusConfidence::Unknown);
}

#[test]
fn detection_failure_does_not_invent_confirmation() {
    let adapter = CountingAdapter {
        submits: AtomicUsize::new(0),
        can_submit: true,
        spendable: 125_000_000,
        fee: 10_000,
        now: AtomicU64::new(1_000),
        expire_in_ms: 60_000,
        next_submit: MutexSubmit::Accept,
    };
    let engine = PaymentOrchestrator::new(adapter, FixedClock(AtomicU64::new(5_000)), || "pay".to_string());
    let prepared = engine.prepare(engine.create_draft(&recipient(), Some("0.10"), PreparationMode::Baseline));
    let submitted = engine.authorize_and_submit(prepared);
    let detected = engine.detect(submitted);
    assert!(detected.confirmation.is_none());
    assert_eq!(detected.detection.as_ref().unwrap().source, "unavailable");
    assert!(matches!(
        detected.stage(StageName::Proof),
        Some(StageMeasurement::Unavailable { .. })
    ));
}

use api_types::{DataKind, StageMeasurement, StageName, Trial, TrialMode, TrialOutcome, STAGE_NAMES};

const P95_MINIMUM: usize = 20;

#[derive(Debug, Clone, PartialEq)]
pub struct StageSummary {
    pub measured_samples: usize,
    pub median_ms: Option<f64>,
    pub p95_ms: Option<f64>,
    pub unavailable_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub mode: TrialMode,
    pub cold_start: bool,
    pub measurement_kind: DataKind,
    pub successful: usize,
    pub failed: usize,
    pub incomplete: usize,
    pub eligible: usize,
    pub stages: Vec<(StageName, StageSummary)>,
}

pub fn median(values: &[u64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        Some((sorted[middle - 1] + sorted[middle]) as f64 / 2.0)
    } else {
        Some(sorted[middle] as f64)
    }
}

pub fn percentile95(values: &[u64]) -> Option<u64> {
    if values.len() < P95_MINIMUM {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let index = (0.95 * sorted.len() as f64).ceil() as usize - 1;
    sorted.get(index).copied()
}

pub fn summarize(
    trials: &[Trial],
    mode: TrialMode,
    cold_start: bool,
) -> Result<Summary, String> {
    if matches!(mode, TrialMode::Experimental) {
        return Err("Experimental trials stay out of baseline and optimized summaries.".to_string());
    }
    let selected: Vec<&Trial> = trials
        .iter()
        .filter(|trial| trial.mode == mode && trial.cold_start == cold_start)
        .collect();
    if selected.is_empty() {
        return Err("No trials match this comparison.".to_string());
    }
    let mut kinds = selected.iter().map(|trial| trial.measurement_kind);
    let measurement_kind = kinds.next().expect("non-empty");
    if kinds.any(|kind| kind != measurement_kind) {
        return Err("Refusing to mix simulated and observed trials.".to_string());
    }
    let successful = selected
        .iter()
        .filter(|trial| trial.outcome == TrialOutcome::Success)
        .count();
    let stages = STAGE_NAMES
        .into_iter()
        .map(|name| {
            let measured: Vec<u64> = selected
                .iter()
                .filter(|trial| trial.outcome == TrialOutcome::Success)
                .filter_map(|trial| match trial.stage(name) {
                    Some(StageMeasurement::Measured { duration_ms, .. }) => Some(*duration_ms),
                    _ => None,
                })
                .collect();
            let unavailable_reason = selected.iter().find_map(|trial| match trial.stage(name) {
                Some(StageMeasurement::Unavailable { reason }) => Some(reason.clone()),
                _ => None,
            });
            (
                name,
                StageSummary {
                    measured_samples: measured.len(),
                    median_ms: median(&measured),
                    p95_ms: percentile95(&measured).map(|value| value as f64),
                    unavailable_reason: if measured.is_empty() {
                        unavailable_reason
                    } else {
                        None
                    },
                },
            )
        })
        .collect();
    Ok(Summary {
        mode,
        cold_start,
        measurement_kind,
        successful,
        failed: selected
            .iter()
            .filter(|trial| trial.outcome == TrialOutcome::Failed)
            .count(),
        incomplete: selected
            .iter()
            .filter(|trial| trial.outcome == TrialOutcome::Incomplete)
            .count(),
        eligible: selected.len(),
        stages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use api_types::{FailureCode, NamedStage};

    fn trial(kind: DataKind, mode: TrialMode, duration: u64) -> Trial {
        Trial {
            id: format!("{kind:?}-{duration}"),
            mode,
            measurement_kind: kind,
            cold_start: false,
            outcome: TrialOutcome::Success,
            failure_code: None,
            stages: vec![NamedStage {
                name: StageName::Broadcast,
                measurement: StageMeasurement::Measured {
                    duration_ms: duration,
                    kind,
                },
            }],
        }
    }

    #[test]
    fn p95_is_withheld_below_twenty_samples() {
        assert_eq!(percentile95(&[1, 2, 3]), None);
    }

    #[test]
    fn refuses_mixed_measurement_kinds() {
        let error = summarize(
            &[
                trial(DataKind::Simulated, TrialMode::Baseline, 10),
                trial(DataKind::Observed, TrialMode::Baseline, 12),
            ],
            TrialMode::Baseline,
            false,
        )
        .unwrap_err();
        assert!(error.contains("mix"));
    }

    #[test]
    fn unavailable_proof_is_not_given_a_median() {
        let trial = Trial {
            id: "one".to_string(),
            mode: TrialMode::Baseline,
            measurement_kind: DataKind::Observed,
            cold_start: true,
            outcome: TrialOutcome::Failed,
            failure_code: Some(FailureCode::BackendUnavailable),
            stages: vec![NamedStage {
                name: StageName::Proof,
                measurement: StageMeasurement::unavailable("The timing was not inferred."),
            }],
        };
        let summary = summarize(&[trial], TrialMode::Baseline, true).unwrap();
        let proof = summary
            .stages
            .iter()
            .find(|(name, _)| *name == StageName::Proof)
            .unwrap();
        assert_eq!(proof.1.median_ms, None);
        assert_eq!(
            proof.1.unavailable_reason.as_deref(),
            Some("The timing was not inferred.")
        );
    }
}

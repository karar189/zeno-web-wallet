use api_types::{StageMeasurement, StageName};

#[derive(Debug, Clone, PartialEq)]
pub struct ExperimentalProbe {
    pub name: &'static str,
    pub integration: &'static str,
    pub claims_project_tachyon: bool,
    pub on_payment_path: bool,
    pub finding: &'static str,
    pub proof: StageMeasurement,
}

pub fn probe() -> ExperimentalProbe {
    ExperimentalProbe {
        name: "isolated-preparation-sketch",
        integration: "not_integrated",
        claims_project_tachyon: false,
        on_payment_path: false,
        finding: "No payment-path bottleneck was reduced. The probe is not connected to a transaction backend.",
        proof: StageMeasurement::unavailable("No proof system is connected to this prototype."),
    }
}

pub fn proof_stage() -> (StageName, StageMeasurement) {
    (StageName::Proof, probe().proof)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_stays_off_the_payment_path() {
        let result = probe();
        assert_eq!(result.integration, "not_integrated");
        assert!(!result.claims_project_tachyon);
        assert!(!result.on_payment_path);
        assert!(matches!(result.proof, StageMeasurement::Unavailable { .. }));
    }
}

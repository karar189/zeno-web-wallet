use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::parse_faucet_endpoint;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const NETWORK: &str = "testnet";

#[derive(Clone)]
pub struct FaucetClient {
    endpoint: String,
    http: Client,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AddressKind {
    Unified,
    Sapling,
    Transparent,
}

impl AddressKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unified => "unified",
            Self::Sapling => "sapling",
            Self::Transparent => "transparent",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaucetError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_eligible_at_ms: Option<u64>,
}

impl FaucetError {
    pub fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            retryable,
            next_eligible_at_ms: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FallbackFaucet {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaucetInfo {
    pub endpoint: String,
    pub website_url: String,
    pub available: bool,
    pub network: String,
    pub faucet_network: Option<String>,
    pub supported_address_kinds: Vec<String>,
    pub funding_receiver_kinds: Vec<String>,
    pub captcha_mode: Option<String>,
    pub launch_phase: Option<String>,
    pub drip_zat: Option<u64>,
    pub max_amount_zat_per_claim: Option<u64>,
    pub address_cooldown_hours: Option<u64>,
    pub cause: Option<String>,
    pub support_url: Option<String>,
    pub source_url: Option<String>,
    pub fallback_faucets: Vec<FallbackFaucet>,
    pub wallet_address: Option<String>,
    pub wallet_address_kind: Option<String>,
    pub address_supported: bool,
    pub can_attempt_claim: bool,
    pub note: String,
    pub error: Option<FaucetError>,
}

impl FaucetInfo {
    pub fn unconfigured() -> Self {
        let error = Some(FaucetError::new(
            "faucet_unconfigured",
            "No faucet endpoint is configured for the wallet service.",
            false,
        ));
        Self {
            endpoint: String::new(),
            website_url: String::new(),
            available: false,
            network: NETWORK.to_string(),
            faucet_network: None,
            supported_address_kinds: Vec::new(),
            funding_receiver_kinds: Vec::new(),
            captcha_mode: None,
            launch_phase: None,
            drip_zat: None,
            max_amount_zat_per_claim: None,
            address_cooldown_hours: None,
            cause: None,
            support_url: None,
            source_url: None,
            fallback_faucets: Vec::new(),
            wallet_address: None,
            wallet_address_kind: None,
            address_supported: false,
            can_attempt_claim: false,
            note: "No faucet endpoint is configured, so no claim can be requested.".to_string(),
            error,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimReport {
    pub request_id: String,
    pub network: String,
    pub state: String,
    pub outcome: Option<String>,
    pub txid: Option<String>,
    pub amount_zat: Option<u64>,
    pub next_eligible_at_ms: Option<u64>,
    pub confirmed_height: Option<u64>,
    pub address: Option<String>,
    pub address_kind: Option<String>,
    pub privacy_policy: Option<String>,
    pub failure_reason: Option<String>,
    pub ambiguous: bool,
    pub note: String,
    pub error: Option<FaucetError>,
}

impl ClaimReport {
    pub fn failed(request_id: &str, error: FaucetError) -> Self {
        Self {
            request_id: request_id.to_string(),
            network: NETWORK.to_string(),
            state: "failed".to_string(),
            outcome: None,
            txid: None,
            amount_zat: None,
            next_eligible_at_ms: error.next_eligible_at_ms,
            confirmed_height: None,
            address: None,
            address_kind: None,
            privacy_policy: None,
            failure_reason: None,
            ambiguous: false,
            note: error.message.clone(),
            error: Some(error),
        }
    }
}

impl FaucetClient {
    pub fn new(endpoint: &str) -> Result<Self, String> {
        let endpoint = parse_faucet_endpoint(endpoint)?;
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .user_agent("zeno-wallet-service/0.1")
            .build()
            .map_err(|error| format!("Could not build the faucet HTTP client: {error}"))?;
        Ok(Self { endpoint, http })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub async fn info(&self, wallet_address: Option<&str>) -> FaucetInfo {
        let (network_reply, status_reply) = tokio::join!(
            self.get_json::<NetworkReply>("/api/v1/network"),
            self.get_json::<FaucetStatusReply>("/api/v1/faucet-status")
        );

        let mut info = FaucetInfo {
            endpoint: self.endpoint.clone(),
            website_url: self.endpoint.clone(),
            available: false,
            network: NETWORK.to_string(),
            faucet_network: None,
            supported_address_kinds: Vec::new(),
            funding_receiver_kinds: Vec::new(),
            captcha_mode: None,
            launch_phase: None,
            drip_zat: None,
            max_amount_zat_per_claim: None,
            address_cooldown_hours: None,
            cause: None,
            support_url: None,
            source_url: None,
            fallback_faucets: Vec::new(),
            wallet_address: wallet_address.map(str::to_string),
            wallet_address_kind: None,
            address_supported: false,
            can_attempt_claim: false,
            note: String::new(),
            error: None,
        };

        let mut network_error = None;
        let network_ok = match network_reply {
            Ok(reply) => {
                info.available = true;
                info.faucet_network = Some(reply.network);
                info.supported_address_kinds = reply.supported_address_kinds;
                info.funding_receiver_kinds = reply.funding_receiver_kinds;
                info.captcha_mode = Some(reply.captcha_mode);
                info.launch_phase = Some(reply.launch_phase);
                info.drip_zat = Some(reply.drip_zat);
                info.max_amount_zat_per_claim = Some(reply.max_amount_zat_per_claim);
                info.address_cooldown_hours = Some(reply.address_cooldown_hours);
                info.support_url = reply.support_url;
                info.source_url = reply.source_url;
                info.fallback_faucets = reply.fallback_faucets;
                true
            }
            Err(error) => {
                network_error = Some(error);
                false
            }
        };

        let mut status_error = None;
        let status_ok = match status_reply {
            Ok(reply) => {
                info.cause = Some(reply.cause);
                if info.drip_zat.is_none() {
                    info.drip_zat = Some(reply.drip_zat);
                }
                true
            }
            Err(error) => {
                status_error = Some(error);
                false
            }
        };

        let address_kind = match wallet_address.map(str::trim).filter(|value| !value.is_empty()) {
            Some(address) => match classify_address(address) {
                Ok(kind) => Some(kind),
                Err(error) => {
                    info.error = Some(error);
                    None
                }
            },
            None => None,
        };
        info.wallet_address_kind = address_kind.map(|kind| kind.as_str().to_string());

        let network_matches = info.faucet_network.as_deref() == Some(NETWORK);
        let launch_open = info.launch_phase.as_deref() == Some("open");
        let cause_ready = info.cause.as_deref() == Some("ready");
        info.address_supported = address_kind.is_some_and(|kind| {
            network_ok
                && info
                    .supported_address_kinds
                    .iter()
                    .any(|supported| supported.eq_ignore_ascii_case(kind.as_str()))
        });

        if wallet_address.is_none() {
            info.error = Some(FaucetError::new(
                "wallet_unavailable",
                "The wallet service has not opened a testnet account, so there is no receiving address to fund.",
                true,
            ));
        }
        if info.error.is_none() {
            info.error = network_error;
        }
        if info.error.is_none() {
            info.error = status_error;
        }
        if network_ok && !network_matches && info.error.is_none() {
            info.error = Some(map_error_code("network_mismatch", None));
        }
        if network_ok && !launch_open && info.error.is_none() {
            info.error = Some(map_error_code("launch_blocked", None));
        }
        if network_ok && status_ok && !cause_ready && info.error.is_none() {
            if let Some(cause) = info.cause.as_deref() {
                info.error = Some(cause_error(cause));
            }
        }
        if network_ok && address_kind.is_some() && !info.address_supported && info.error.is_none() {
            info.error = Some(map_error_code("unsupported_address_kind", None));
        }

        info.can_attempt_claim = network_ok
            && status_ok
            && network_matches
            && launch_open
            && cause_ready
            && info.address_supported;

        info.note = if info.can_attempt_claim {
            format!(
                "Faucet is ready. This wallet will claim to its {} shielded testnet address. Funds only count after the wallet service detects and confirms them.",
                info.wallet_address_kind.as_deref().unwrap_or("shielded")
            )
        } else {
            let reason = info
                .error
                .as_ref()
                .map(|error| error.message.clone())
                .unwrap_or_else(|| "The faucet is not ready for a claim.".to_string());
            format!("{reason} No claim was submitted.")
        };

        info
    }

    pub async fn claim(
        &self,
        address: &str,
        request_id: &str,
        captcha_token: Option<&str>,
    ) -> ClaimReport {
        if Uuid::parse_str(request_id).is_err() {
            return ClaimReport::failed(
                request_id,
                FaucetError::new(
                    "invalid_request_id",
                    "The claim request id must be a UUID so retries can reuse it.",
                    false,
                ),
            );
        }
        let kind = match classify_address(address) {
            Ok(kind) => kind,
            Err(error) => return ClaimReport::failed(request_id, error),
        };
        if kind == AddressKind::Transparent {
            return ClaimReport::failed(
                request_id,
                map_error_code("unsupported_address_kind", None),
            );
        }

        let body = ClaimRequest {
            network: NETWORK,
            address: address.trim(),
            request_id,
            captcha_token: captcha_token.map(str::trim).filter(|value| !value.is_empty()),
        };
        let response = match self
            .http
            .post(self.url("/api/v1/claim"))
            .json(&body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                let report_error = if error.is_timeout() {
                    FaucetError::new(
                        "submission_ambiguous",
                        "Fauzec did not answer before the wallet service timed out. Check this request id before trying again; do not submit a new claim.",
                        false,
                    )
                } else {
                    FaucetError::new(
                        "faucet_unreachable",
                        "The wallet service could not reach Fauzec. The claim may not have been submitted; check this request id before trying again.",
                        true,
                    )
                };
                let mut report = ClaimReport::failed(request_id, report_error);
                report.state = "unknown".to_string();
                report.ambiguous = true;
                report.note = format!(
                    "{} No funds are counted until the wallet service detects them.",
                    report.error.as_ref().map(|error| error.message.as_str()).unwrap_or("")
                );
                return report;
            }
        };

        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let reply = serde_json::from_str::<ClaimReply>(&text).ok();

        if status == StatusCode::ACCEPTED {
            let error = FaucetError::new(
                "submission_ambiguous",
                "Fauzec accepted the request for processing but did not return a final claim state. The claim may or may not dispense; check this request id instead of retrying.",
                false,
            );
            let mut report = build_report(
                request_id,
                reply,
                "unknown",
                true,
                Some(error),
                Some(kind),
            );
            report.ambiguous = true;
            return report;
        }

        if status.is_success() {
            let Some(reply) = reply else {
                let error = FaucetError::new(
                    "faucet_invalid_response",
                    "Fauzec accepted the claim but returned a response that does not match its documented schema. Check this request id before retrying.",
                    false,
                );
                let mut report = ClaimReport::failed(request_id, error);
                report.state = "unknown".to_string();
                report.ambiguous = true;
                return report;
            };
            if !request_id_matches(reply.request_id.as_deref(), request_id) {
                let error = FaucetError::new(
                    "faucet_invalid_response",
                    "Fauzec returned a claim record for a different request id. The wallet service ignored it.",
                    false,
                );
                let mut report = build_report(request_id, Some(reply), "unknown", false, Some(error), Some(kind));
                report.ambiguous = true;
                return report;
            }
            return build_report(request_id, Some(reply), "unknown", false, None, Some(kind));
        }

        let next = reply.as_ref().and_then(|reply| reply.next_eligible_at_ms);
        let error = reply
            .as_ref()
            .and_then(|reply| reply.error_code.as_deref())
            .map(|code| map_error_code(code, next))
            .unwrap_or_else(|| map_http_status(status.as_u16(), next));
        let fallback_state = if status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT {
            "unknown"
        } else {
            "failed"
        };
        let ambiguous = status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT;
        let mut report = build_report(request_id, reply, fallback_state, ambiguous, Some(error), Some(kind));
        report.ambiguous = ambiguous;
        report
    }

    pub async fn status(&self, request_id: &str) -> ClaimReport {
        if Uuid::parse_str(request_id).is_err() {
            return ClaimReport::failed(
                request_id,
                FaucetError::new(
                    "invalid_request_id",
                    "The claim request id must be a UUID.",
                    false,
                ),
            );
        }
        let path = format!("/api/v1/status/{NETWORK}/{request_id}");
        let response = match self.http.get(self.url(&path)).send().await {
            Ok(response) => response,
            Err(error) => {
                let report_error = FaucetError::new(
                    "faucet_unreachable",
                    if error.is_timeout() {
                        "Fauzec did not answer the status request before the wallet service timed out."
                    } else {
                        "The wallet service could not reach Fauzec to read the claim status."
                    },
                    true,
                );
                let mut report = ClaimReport::failed(request_id, report_error);
                report.state = "unknown".to_string();
                report.ambiguous = true;
                return report;
            }
        };

        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let reply = serde_json::from_str::<ClaimReply>(&text).ok();

        if status == StatusCode::NOT_FOUND {
            let error = map_error_code("claim_not_found", None);
            let mut report = build_report(request_id, reply, "failed", false, Some(error), None);
            report.state = "failed".to_string();
            return report;
        }

        if status.is_success() {
            let Some(reply) = reply else {
                let error = FaucetError::new(
                    "faucet_invalid_response",
                    "Fauzec returned a status response that does not match its documented schema.",
                    false,
                );
                let mut report = ClaimReport::failed(request_id, error);
                report.state = "unknown".to_string();
                report.ambiguous = true;
                return report;
            };
            if !request_id_matches(reply.request_id.as_deref(), request_id) {
                let error = FaucetError::new(
                    "faucet_invalid_response",
                    "Fauzec returned a claim record for a different request id. The wallet service ignored it.",
                    false,
                );
                let mut report = build_report(request_id, Some(reply), "unknown", false, Some(error), None);
                report.ambiguous = true;
                return report;
            }
            return build_report(request_id, Some(reply), "unknown", false, None, None);
        }

        let next = reply.as_ref().and_then(|reply| reply.next_eligible_at_ms);
        let error = reply
            .as_ref()
            .and_then(|reply| reply.error_code.as_deref())
            .map(|code| map_error_code(code, next))
            .unwrap_or_else(|| map_http_status(status.as_u16(), next));
        let ambiguous = status.is_server_error()
            || status == StatusCode::REQUEST_TIMEOUT
            || status == StatusCode::ACCEPTED;
        let fallback_state = if ambiguous { "unknown" } else { "failed" };
        let mut report = build_report(request_id, reply, fallback_state, ambiguous, Some(error), None);
        report.ambiguous = ambiguous;
        report
    }

    async fn get_json<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<T, FaucetError> {
        let response = self
            .http
            .get(self.url(path))
            .send()
            .await
            .map_err(transport_error)?;
        let status = response.status();
        let text = response.text().await.map_err(|_| {
            FaucetError::new(
                "faucet_invalid_response",
                "Fauzec's response could not be read.",
                true,
            )
        })?;
        if !status.is_success() {
            let error = parse_error_body(&text)
                .map(|(code, next)| map_error_code(&code, next))
                .unwrap_or_else(|| map_http_status(status.as_u16(), None));
            return Err(error);
        }
        serde_json::from_str(&text).map_err(|_| {
            FaucetError::new(
                "faucet_invalid_response",
                format!("Fauzec's {path} response does not match its documented schema."),
                true,
            )
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.endpoint.trim_end_matches('/'), path)
    }
}

fn build_report(
    request_id: &str,
    reply: Option<ClaimReply>,
    fallback_state: &str,
    ambiguous: bool,
    fallback_error: Option<FaucetError>,
    local_kind: Option<AddressKind>,
) -> ClaimReport {
    let reply = reply.unwrap_or_default();
    let mut ambiguous = ambiguous;
    let state = match reply.state.as_deref() {
        Some("pending") => "pending",
        Some("broadcasting") => "broadcasting",
        Some("confirmed") => "confirmed",
        Some("failed") => "failed",
        Some(_) => "unknown",
        None => fallback_state,
    }
    .to_string();
    let outcome = match reply.outcome.as_deref() {
        Some("accepted") => Some("accepted".to_string()),
        Some("refused") => Some("refused".to_string()),
        Some("failed") => Some("failed".to_string()),
        _ => None,
    };
    let mut warning = None;
    let txid = reply.txid.clone().and_then(|value| {
        let normalized = value.trim().to_ascii_lowercase();
        if normalized.len() == 64 && normalized.chars().all(|character| character.is_ascii_hexdigit()) {
            Some(normalized)
        } else {
            warning = Some("Fauzec returned a transaction id that was not 64 hexadecimal characters; the wallet service ignored it.".to_string());
            None
        }
    });
    let network_mismatch = reply
        .network
        .as_deref()
        .is_some_and(|network| network != NETWORK);
    let mut error = reply
        .error_code
        .as_deref()
        .map(|code| map_error_code(code, reply.next_eligible_at_ms))
        .or(fallback_error);
    if network_mismatch {
        ambiguous = true;
        error = Some(map_error_code("network_mismatch", None));
    }
    let note = describe_state(
        &state,
        error.as_ref(),
        reply.failure_reason.as_deref(),
        ambiguous,
        warning.as_deref(),
    );
    ClaimReport {
        request_id: request_id.to_string(),
        network: NETWORK.to_string(),
        state,
        outcome,
        txid,
        amount_zat: reply.claim_amount_zat.or(reply.amount_zat),
        next_eligible_at_ms: reply.next_eligible_at_ms,
        confirmed_height: reply.confirmed_height,
        address: reply.address,
        address_kind: reply
            .address_kind
            .or_else(|| local_kind.map(|kind| kind.as_str().to_string())),
        privacy_policy: reply.privacy_policy,
        failure_reason: reply.failure_reason,
        ambiguous,
        note,
        error,
    }
}

fn describe_state(
    state: &str,
    error: Option<&FaucetError>,
    failure_reason: Option<&str>,
    ambiguous: bool,
    warning: Option<&str>,
) -> String {
    let mut note = if let Some(error) = error {
        error.message.clone()
    } else {
        match state {
            "pending" => "Fauzec queued the claim. It has not reported a dispensed transaction yet.".to_string(),
            "broadcasting" => "Fauzec reports a dispense is broadcasting. This is not evidence that the wallet received funds.".to_string(),
            "confirmed" => "Fauzec reports its dispense transaction is confirmed. The wallet service must still detect and confirm the funds before they are spendable.".to_string(),
            "failed" => failure_reason
                .filter(|reason| !reason.trim().is_empty())
                .map(|reason| format!("Fauzec reported the claim failed: {reason}"))
                .unwrap_or_else(|| "Fauzec reported the claim failed.".to_string()),
            _ => "Fauzec did not return a recognized claim state. Do not assume funds were sent.".to_string(),
        }
    };
    if ambiguous {
        note.push_str(" Check this request id before submitting a new claim.");
    }
    if let Some(warning) = warning {
        note.push(' ');
        note.push_str(warning);
    }
    note
}

fn request_id_matches(returned: Option<&str>, expected: &str) -> bool {
    match returned {
        None => true,
        Some(returned) => {
            (Uuid::parse_str(returned).ok()) == (Uuid::parse_str(expected).ok())
        }
    }
}

fn classify_address(address: &str) -> Result<AddressKind, FaucetError> {
    let address = address.trim();
    if address.starts_with("utest1") {
        Ok(AddressKind::Unified)
    } else if address.starts_with("ztestsapling1") {
        Ok(AddressKind::Sapling)
    } else if address.starts_with("tm") || address.starts_with("t2") {
        Err(map_error_code("unsupported_address_kind", None))
    } else if address.starts_with("u1")
        || address.starts_with("zs1")
        || address.starts_with("t1")
        || address.starts_with("t3")
    {
        Err(map_error_code("network_mismatch", None))
    } else {
        Err(map_error_code("malformed_address", None))
    }
}

fn map_error_code(code: &str, next: Option<u64>) -> FaucetError {
    let (message, retryable) = match code {
        "malformed_request" => ("Fauzec rejected the claim request as malformed. No funds were requested.", false),
        "malformed_address" => ("Fauzec could not parse the wallet's receiving address. No funds were requested.", false),
        "network_mismatch" => ("The faucet and wallet are not on the same network. This wallet is Zcash testnet-only.", false),
        "unsupported_address_kind" => ("Fauzec does not fund this address type. The wallet must use a shielded testnet address.", false),
        "memo_unsupported_for_transparent" => ("Fauzec cannot attach a memo to a transparent address.", false),
        "captcha_required" => ("Fauzec requires its browser captcha for this claim. Open Fauzec, paste the wallet address, and complete the claim there.", false),
        "on_abuse_list" => ("This requester is on Fauzec's abuse list, so the faucet refused the claim.", false),
        "address_on_cooldown" => ("This receiving address already claimed from Fauzec recently. Wait for the address cooldown to end before trying again.", false),
        "ip_on_cooldown" => ("This network already requested funds from Fauzec recently. Wait for the requester cooldown to end before trying again.", false),
        "faucet_dry" => ("Fauzec is out of funds right now. Try again after the faucet is refilled.", true),
        "launch_blocked" => ("Fauzec has not opened public claims yet.", false),
        "dispense_expired" => ("Fauzec's dispense expired before it completed. Check the claim status before retrying.", false),
        "wallet_unavailable" => ("Fauzec's wallet is unavailable, so it could not dispense funds.", true),
        "wallet_operation_failed" => ("Fauzec's wallet failed while preparing the dispense.", true),
        "wallet_insufficient_funds" => ("Fauzec's wallet does not have enough funds for this claim.", true),
        "wallet_catching_up" => ("Fauzec's wallet is still syncing. Try again later.", true),
        "wallet_proposal_rejected" => ("Fauzec's wallet rejected the dispense proposal.", false),
        "wallet_submission_rejected" => ("Fauzec's wallet rejected the transaction submission.", false),
        "claim_not_found" => ("Fauzec has no claim record for this request id.", false),
        "runtime_unavailable" => ("Fauzec's claim runtime is unavailable. No claim was confirmed.", true),
        "submission_ambiguous" => ("Fauzec could not confirm whether the dispense was broadcast. Check this request id before retrying.", false),
        _ => return FaucetError::new(code, format!("Fauzec returned the error code {code}."), false),
    };
    let mut error = FaucetError::new(code, message, retryable);
    error.next_eligible_at_ms = next;
    error
}

fn map_http_status(status: u16, next: Option<u64>) -> FaucetError {
    let code = match status {
        400 => "malformed_request",
        403 => "captcha_required",
        404 => "claim_not_found",
        409 => "address_on_cooldown",
        429 => "ip_on_cooldown",
        503 => "runtime_unavailable",
        _ => "faucet_request_failed",
    };
    if code == "faucet_request_failed" {
        return FaucetError::new(
            code,
            format!("Fauzec answered the claim request with HTTP {status} and no documented error code."),
            status >= 500,
        );
    }
    map_error_code(code, next)
}

fn cause_error(cause: &str) -> FaucetError {
    match cause {
        "faucet_dry" => map_error_code("faucet_dry", None),
        "network_mismatch" => map_error_code("network_mismatch", None),
        "wallet_unavailable" => map_error_code("wallet_unavailable", None),
        "starting" => FaucetError::new(
            "runtime_unavailable",
            "Fauzec is starting up. Try again shortly.",
            true,
        ),
        "wallet_identity_unsealed" => FaucetError::new(
            "wallet_unavailable",
            "Fauzec's wallet identity is not ready, so it cannot dispense funds.",
            true,
        ),
        "node_unavailable" => FaucetError::new(
            "runtime_unavailable",
            "Fauzec cannot reach its Zcash node. Try again later.",
            true,
        ),
        "store_unavailable" => FaucetError::new(
            "runtime_unavailable",
            "Fauzec's claim store is unavailable. Try again later.",
            true,
        ),
        "shutting_down" => FaucetError::new(
            "runtime_unavailable",
            "Fauzec is shutting down. Try again later.",
            true,
        ),
        "runtime_unreachable" => FaucetError::new(
            "runtime_unavailable",
            "Fauzec's claim runtime is unreachable. Try again later.",
            true,
        ),
        _ => FaucetError::new(
            "runtime_unavailable",
            format!("Fauzec reports the status {cause}, so it is not ready to dispense."),
            true,
        ),
    }
}

fn transport_error(error: reqwest::Error) -> FaucetError {
    FaucetError::new(
        "faucet_unreachable",
        if error.is_timeout() {
            "Fauzec did not answer before the wallet service timed out."
        } else {
            "The wallet service could not reach Fauzec."
        },
        true,
    )
}

fn parse_error_body(text: &str) -> Option<(String, Option<u64>)> {
    #[derive(Deserialize)]
    struct ErrorReply {
        #[serde(default)]
        error_code: Option<String>,
        #[serde(default)]
        next_eligible_at_ms: Option<u64>,
    }
    serde_json::from_str::<ErrorReply>(text)
        .ok()
        .and_then(|reply| reply.error_code.map(|code| (code, reply.next_eligible_at_ms)))
}

#[derive(Serialize)]
struct ClaimRequest<'a> {
    network: &'a str,
    address: &'a str,
    request_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    captcha_token: Option<&'a str>,
}

#[derive(Deserialize)]
struct NetworkReply {
    network: String,
    supported_address_kinds: Vec<String>,
    funding_receiver_kinds: Vec<String>,
    captcha_mode: String,
    launch_phase: String,
    drip_zat: u64,
    max_amount_zat_per_claim: u64,
    address_cooldown_hours: u64,
    #[serde(default)]
    support_url: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    fallback_faucets: Vec<FallbackFaucet>,
}

#[derive(Deserialize)]
struct FaucetStatusReply {
    cause: String,
    drip_zat: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct ClaimReply {
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    network: Option<String>,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    outcome: Option<String>,
    #[serde(default)]
    txid: Option<String>,
    #[serde(default)]
    next_eligible_at_ms: Option<u64>,
    #[serde(default)]
    error_code: Option<String>,
    #[serde(default)]
    claim_amount_zat: Option<u64>,
    #[serde(default)]
    address: Option<String>,
    #[serde(default)]
    address_kind: Option<String>,
    #[serde(default)]
    privacy_policy: Option<String>,
    #[serde(default)]
    amount_zat: Option<u64>,
    #[serde(default)]
    confirmed_height: Option<u64>,
    #[serde(default)]
    failure_reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use axum::routing::post;
    use axum::{Json, Router};
    use serde_json::Value;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[test]
    fn classifies_testnet_addresses_and_rejects_other_networks() {
        assert_eq!(
            classify_address("utest1example").unwrap().as_str(),
            "unified"
        );
        assert_eq!(
            classify_address("ztestsapling1example").unwrap().as_str(),
            "sapling"
        );
        assert_eq!(
            classify_address("tmExample").unwrap_err().code,
            "unsupported_address_kind"
        );
        assert_eq!(
            classify_address("t2Example").unwrap_err().code,
            "unsupported_address_kind"
        );
        assert_eq!(
            classify_address("u1example").unwrap_err().code,
            "network_mismatch"
        );
        assert_eq!(
            classify_address("zs1example").unwrap_err().code,
            "network_mismatch"
        );
        assert_eq!(
            classify_address("t1example").unwrap_err().code,
            "network_mismatch"
        );
        assert_eq!(
            classify_address("not-an-address").unwrap_err().code,
            "malformed_address"
        );
    }

    #[test]
    fn maps_documented_error_codes_without_inventing_success() {
        let cooldown = map_error_code("address_on_cooldown", Some(1_700_000_000_000));
        assert_eq!(cooldown.code, "address_on_cooldown");
        assert_eq!(cooldown.next_eligible_at_ms, Some(1_700_000_000_000));
        assert!(!cooldown.retryable);
        assert!(cooldown.message.contains("cooldown"));

        let captcha = map_error_code("captcha_required", None);
        assert!(captcha.message.contains("captcha"));

        let dry = map_error_code("faucet_dry", None);
        assert!(dry.retryable);

        let ambiguous = map_error_code("submission_ambiguous", None);
        assert!(!ambiguous.retryable);

        let unknown = map_error_code("something_new", None);
        assert_eq!(unknown.code, "something_new");
        assert!(unknown.message.contains("something_new"));
    }

    #[test]
    fn build_report_keeps_wallet_evidence_out_of_the_faucet_state() {
        let reply = ClaimReply {
            request_id: Some("6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31".to_string()),
            network: Some("testnet".to_string()),
            state: Some("confirmed".to_string()),
            outcome: Some("accepted".to_string()),
            txid: Some("AA".repeat(32)),
            confirmed_height: Some(4_541_600),
            amount_zat: Some(100_000_000),
            ..ClaimReply::default()
        };
        let report = build_report(
            "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31",
            Some(reply),
            "unknown",
            false,
            None,
            Some(AddressKind::Unified),
        );
        assert_eq!(report.state, "confirmed");
        assert_eq!(report.txid, Some("aa".repeat(32)));
        assert_eq!(report.amount_zat, Some(100_000_000));
        assert_eq!(report.address_kind.as_deref(), Some("unified"));
        assert!(report.note.contains("wallet service must still detect"));
    }

    #[test]
    fn rejects_a_mismatched_request_id() {
        assert!(request_id_matches(
            Some("6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31"),
            "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31"
        ));
        assert!(!request_id_matches(
            Some("00000000-0000-4000-8000-000000000000"),
            "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31"
        ));
        assert!(request_id_matches(None, "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31"));
    }

    #[tokio::test]
    async fn claim_posts_the_documented_body_and_never_sends_key_material() {
        #[derive(Clone)]
        struct Seen(Arc<Mutex<Option<Value>>>);

        async fn capture(
            State(seen): State<Seen>,
            Json(body): Json<Value>,
        ) -> Json<Value> {
            *seen.0.lock().await = Some(body);
            Json(serde_json::json!({
                "request_id": "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31",
                "network": "testnet",
                "state": "pending",
                "outcome": "accepted",
                "claim_amount_zat": 100000000
            }))
        }

        let seen = Seen(Arc::new(Mutex::new(None)));
        let app = Router::new()
            .route("/api/v1/claim", post(capture))
            .with_state(seen.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let client = FaucetClient::new(&format!("http://127.0.0.1:{}", address.port()))
            .expect("client");
        let report = client
            .claim(
                "utest1example",
                "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31",
                None,
            )
            .await;
        assert_eq!(report.state, "pending");
        assert_eq!(report.outcome.as_deref(), Some("accepted"));
        assert_eq!(report.amount_zat, Some(100_000_000));

        let body = seen.0.lock().await.clone().expect("claim body");
        assert_eq!(
            body,
            serde_json::json!({
                "network": "testnet",
                "address": "utest1example",
                "request_id": "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31"
            })
        );
        let text = body.to_string().to_lowercase();
        assert!(!text.contains("seed"));
        assert!(!text.contains("spending"));
        assert!(!text.contains("mnemonic"));
    }
}

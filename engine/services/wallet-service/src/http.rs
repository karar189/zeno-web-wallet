use std::time::Instant;

use api_types::{
    json_contains_key_material, ConfirmationEvidence, DataKind, DetectionEvidence, FeeQuote, Readiness,
    StageMeasurement, SubmitResult, SubmissionEvidence,
};
use axum::extract::{Path, State};
use axum::extract::Request;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::faucet::{ClaimReport, FaucetError, FaucetInfo};
use crate::wallet::{
    AppState, DisclosureStatusReport, QuoteReport, ReadinessReport, SendExpectation, SendReport,
    StatusReport,
};

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list([
            axum::http::HeaderValue::from_static("http://localhost:3000"),
            axum::http::HeaderValue::from_static("http://127.0.0.1:3000"),
        ]))
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::AUTHORIZATION,
        ]);

    Router::new()
        .route("/api/wallet/readiness", get(readiness))
        .route("/api/wallet/address", get(receiving_address))
        .route("/api/wallet/disclosure", get(disclosure_status))
        .route(
            "/api/wallet/disclosure/account",
            post(create_disclosure_account),
        )
        .route(
            "/api/wallet/disclosure/export/request",
            post(request_disclosure_export),
        )
        .route(
            "/api/wallet/disclosure/export",
            post(export_disclosure_key),
        )
        .route("/api/wallet/audit/scan", post(audit_scan))
        .route("/api/wallet/instant-sync/viewing-key", post(instant_sync_viewing_key))
        .route("/api/wallet/sync", post(sync_wallet))
        .route("/api/wallet/quote", post(quote))
        .route("/api/wallet/send", post(send))
        .route("/api/wallet/shield/quote", post(shield_quote))
        .route("/api/wallet/shield/send", post(shield_send))
        .route("/api/wallet/faucet/info", get(faucet_info))
        .route("/api/wallet/faucet/claim", post(faucet_claim))
        .route("/api/wallet/faucet/status/:request_id", get(faucet_status))
        .route("/api/wallet/transactions/:txid", get(transaction_status))
        .route("/api/wallet/session", get(session_status))
        .route("/api/wallet/session/password", post(set_session_password))
        .route("/api/wallet/session/unlock", post(unlock_session))
        .route("/api/wallet/session/lock", post(lock_session))
        .route("/api/wallet/wallets", post(begin_wallet))
        .route("/api/wallet/wallets/confirm", post(confirm_wallet))
        .route("/api/wallet/wallets/ack", post(acknowledge_wallet))
        .route("/api/wallet/wallets/cancel", post(cancel_wallet))
        .route("/api/wallet/wallets/claim", post(begin_claim))
        .route("/api/wallet/wallets/claim/confirm", post(confirm_claim))
        .route("/api/wallet/wallets/claim/ack", post(acknowledge_claim))
        .layer(middleware::from_fn_with_state(state.clone(), require_unlocked))
        .layer(middleware::from_fn(require_browser))
        .layer(cors)
        .with_state(state)
}

fn session_guarded(path: &str) -> bool {
    matches!(
        path,
        "/api/wallet/readiness"
            | "/api/wallet/address"
            | "/api/wallet/disclosure"
            | "/api/wallet/disclosure/account"
            | "/api/wallet/disclosure/export/request"
            | "/api/wallet/disclosure/export"
            | "/api/wallet/instant-sync/viewing-key"
            | "/api/wallet/sync"
            | "/api/wallet/quote"
            | "/api/wallet/shield/quote"
            | "/api/wallet/send"
            | "/api/wallet/shield/send"
            | "/api/wallet/faucet/info"
            | "/api/wallet/faucet/claim"
    ) || path.starts_with("/api/wallet/faucet/status/")
        || path.starts_with("/api/wallet/transactions/")
}

async fn require_unlocked(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, Response> {
    if session_guarded(request.uri().path()) {
        let Some(token) = bearer_token(request.headers()) else {
            return Err(locked_response());
        };
        if !state.session_unlocked(&token).await {
            return Err(locked_response());
        }
    }
    Ok(next.run(request).await)
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?.trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn required_token(headers: &HeaderMap) -> String {
    bearer_token(headers).unwrap_or_default()
}

fn locked_response() -> Response {
    no_store(
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "code": "wallet_locked",
                "message": "Unlock the wallet before using it."
            })),
        )
            .into_response(),
    )
}

async fn session_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let status = state
        .session_status(bearer_token(&headers).as_deref())
        .await;
    no_store(
        Json(json!({
            "locked": status.locked,
            "hasWallet": status.has_wallet,
            "hasPassword": status.has_password,
            "legacyUnclaimed": status.legacy_unclaimed,
        }))
        .into_response(),
    )
}

async fn set_session_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<PasswordBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state
        .set_password(&required_token(&headers), &body.password)
        .await
    {
        Ok(()) => no_store(Json(json!({ "passwordSet": true })).into_response()),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn unlock_session(
    State(state): State<AppState>,
    body: Result<Json<UnlockBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state
        .unlock_vault(
            &body.password,
            &body.wallet_id,
            &body.kdf_salt,
            &body.ciphertext,
        )
        .await
    {
        Ok(grant) => no_store(
            Json(json!({
                "locked": false,
                "sessionToken": grant.session_token,
            }))
            .into_response(),
        ),
        Err(message) => no_store(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "message": message })),
            )
                .into_response(),
        ),
    }
}

async fn lock_session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match state.lock(&required_token(&headers)).await {
        Ok(()) => no_store(Json(json!({ "locked": true })).into_response()),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn begin_wallet(
    State(state): State<AppState>,
    body: Result<Json<NewWalletBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    let _ = body.current_password;
    match state.begin_new_wallet(&body.password).await {
        Ok(challenge) => no_store(
            Json(json!({
                "createId": challenge.create_id,
                "phrase": challenge.phrase,
                "expiresAtMs": challenge.expires_at_ms,
            }))
            .into_response(),
        ),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn confirm_wallet(
    State(state): State<AppState>,
    body: Result<Json<ConfirmWalletBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state.confirm_new_wallet(&body.create_id).await {
        Ok(vault) => no_store(Json(vault_json(&vault)).into_response()),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn acknowledge_wallet(
    State(state): State<AppState>,
    body: Result<Json<ConfirmWalletBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state.acknowledge_wallet(&body.create_id).await {
        Ok(grant) => no_store(
            Json(json!({
                "sessionToken": grant.session_token,
                "locked": false,
            }))
            .into_response(),
        ),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn begin_claim(
    State(state): State<AppState>,
    body: Result<Json<PasswordBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state.begin_claim(&body.password).await {
        Ok(challenge) => no_store(
            Json(json!({
                "claimId": challenge.create_id,
                "phrase": challenge.phrase,
                "expiresAtMs": challenge.expires_at_ms,
            }))
            .into_response(),
        ),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn confirm_claim(
    State(state): State<AppState>,
    body: Result<Json<ClaimBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state.confirm_claim(&body.claim_id).await {
        Ok(vault) => no_store(Json(vault_json(&vault)).into_response()),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn acknowledge_claim(
    State(state): State<AppState>,
    body: Result<Json<ClaimBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state.acknowledge_claim(&body.claim_id).await {
        Ok(grant) => no_store(
            Json(json!({
                "sessionToken": grant.session_token,
                "locked": false,
            }))
            .into_response(),
        ),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

fn vault_json(vault: &crate::wallet::VaultChallenge) -> Value {
    json!({
        "walletId": vault.wallet_id,
        "kdfSalt": vault.kdf_salt,
        "ciphertext": vault.ciphertext,
        "birthdayHeight": vault.birthday_height,
    })
}

async fn cancel_wallet(
    State(state): State<AppState>,
    body: Result<Json<ConfirmWalletBody>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(body) => body,
        Err(_) => return no_store(bad_request("Send a JSON object.").into_response()),
    };
    match state.cancel_new_wallet(&body.create_id).await {
        Ok(()) => no_store(Json(json!({ "cancelled": true })).into_response()),
        Err(message) => no_store(bad_request(message).into_response()),
    }
}

async fn require_browser(request: Request, next: Next) -> Result<Response, StatusCode> {
    let headers = request.headers();
    let origin = header(headers, axum::http::header::ORIGIN);
    let host = header(headers, axum::http::header::HOST);
    if !origin_allowed(origin) || !host_is_loopback(host) {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(next.run(request).await)
}

async fn readiness(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let started = Instant::now();
    Json(readiness_json(
        state.chain(),
        state.readiness(&required_token(&headers)).await,
        started,
    ))
}

async fn sync_wallet(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let started = Instant::now();
    Json(readiness_json(
        state.chain(),
        state.sync(&required_token(&headers)).await,
        started,
    ))
}

async fn receiving_address(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let report = state.receiving_address(&required_token(&headers)).await;
    Json(json!({
        "address": report.address,
        "transparentAddress": report.transparent_address,
        "network": state.chain().as_str(),
        "birthdayHeight": report.birthday_height,
        "note": report.note,
    }))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuditScanBody {
    ufvk: String,
    birthday_height: u32,
    approved: bool,
}

async fn audit_scan(
    State(state): State<AppState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let Json(value) = body.map_err(|_| bad_request("Send a JSON object."))?;
    let request: AuditScanBody = serde_json::from_value(value)
        .map_err(|_| bad_request("Send only ufvk, birthdayHeight, and approved."))?;
    require_approval(Some(request.approved))?;
    static SCANS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = SCANS.try_acquire().map_err(|_| disclosure_conflict("An audit scan is already running. Try again when it finishes.".to_string()))?;
    let report = tokio::time::timeout(std::time::Duration::from_secs(90), state.audit_viewing_key(&request.ufvk, request.birthday_height))
        .await.map_err(|_| disclosure_conflict("The read-only scan timed out. No complete balance was reported.".to_string()))?
        .map_err(disclosure_conflict)?;
    Ok(no_store(Json(report).into_response()))
}

async fn disclosure_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    no_store(
        Json(disclosure_json(
            state.chain(),
            state.disclosure_status(&required_token(&headers)).await,
        ))
        .into_response(),
    )
}

async fn create_disclosure_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: ApprovalBody = serde_json::from_value(value)
        .map_err(|_| bad_request("Send JSON with approved: true."))?;
    require_approval(request.approved)?;
    let report = state
        .create_disclosure_account(&required_token(&headers))
        .await
        .map_err(disclosure_conflict)?;
    Ok(no_store(Json(disclosure_json(state.chain(), report)).into_response()))
}

async fn request_disclosure_export(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: ApprovalBody = serde_json::from_value(value)
        .map_err(|_| bad_request("Send JSON with approved: true."))?;
    require_approval(request.approved)?;
    let report = state
        .request_disclosure_export(&required_token(&headers))
        .await
        .map_err(disclosure_conflict)?;
    Ok(no_store(
        Json(json!({
            "exportId": report.export_id,
            "expiresAtMs": report.expires_at_ms,
            "network": state.chain().as_str(),
            "accountIndex": report.account_index,
            "note": report.note,
            "transactionDisclosure": transaction_disclosure_capability(),
        }))
        .into_response(),
    ))
}

#[derive(Deserialize)]
struct InstantSyncKeyBody {
    approved: Option<bool>,
}

/// Releases the primary account UFVK (never a spending key) for the opt-in Instant Sync server.
async fn instant_sync_viewing_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: InstantSyncKeyBody = serde_json::from_value(value)
        .map_err(|_| bad_request("Send JSON with approved: true."))?;
    require_approval(request.approved)?;
    let (ufvk, birthday) = state
        .export_primary_viewing_key(&required_token(&headers))
        .await
        .map_err(bad_request)?;
    Ok(no_store(
        Json(json!({ "network": state.chain().as_str(), "ufvk": ufvk, "birthday": birthday })).into_response(),
    ))
}

async fn export_disclosure_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: DisclosureExportBody = serde_json::from_value(value)
        .map_err(|_| bad_request("Send JSON with exportId and approved: true."))?;
    require_approval(request.approved)?;
    let export_id = request
        .export_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| bad_request("exportId is required."))?;
    let report = state
        .export_disclosure_key(&required_token(&headers), export_id)
        .await
        .map_err(bad_request)?;
    Ok(no_store(
        Json(json!({
            "exportId": report.export_id,
            "network": state.chain().as_str(),
            "accountIndex": report.account_index,
            "ufvk": report.ufvk,
            "uivk": report.uivk,
            "scope": {
                "account": "dedicated disclosure account",
                "incoming": [
                    "amount",
                    "memo",
                    "txid",
                    "mined height",
                    "receiving address diversifier"
                ],
                "outgoing": [
                    "recipient address",
                    "amount",
                    "memo"
                ],
                "canSpend": false,
                "seesPrimaryAccount": false,
                "provesSenderIdentity": false
            },
            "warning": "A viewing key is a bearer capability. Anyone with a copy can decrypt what it covers, including transaction history, and shared keys cannot be reliably revoked. This key covers the dedicated disclosure account only and cannot spend.",
            "transactionDisclosure": transaction_disclosure_capability(),
        }))
        .into_response(),
    ))
}

fn transaction_disclosure_capability() -> Value {
    json!({
        "implemented": false,
        "saplingZip311": false,
        "orchard": false,
        "reason": "The pinned zcash crates do not implement ZIP 311 payment disclosures. ZIP 311 is a Draft and covers Sapling only; Orchard has no standardized transaction-specific disclosure implementation in these crates."
    })
}

fn disclosure_json(chain: crate::config::Chain, report: DisclosureStatusReport) -> Value {
    json!({
        "created": report.account_index.is_some(),
        "network": chain.as_str(),
        "accountIndex": report.account_index,
        "address": report.address,
        "birthdayHeight": report.birthday_height,
        "detectedZatoshis": report.detected_zatoshis.map(|value| value.to_string()),
        "spendableZatoshis": report.spendable_zatoshis.map(|value| value.to_string()),
        "sync": report.sync,
        "note": report.note,
        "transactionDisclosure": transaction_disclosure_capability(),
    })
}

fn no_store(response: Response) -> Response {
    let mut response = response;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    response
}

fn require_approval(approved: Option<bool>) -> Result<(), (StatusCode, Json<Value>)> {
    if approved != Some(true) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "message": "Explicit approval is required before creating or exporting a disclosure account key."
            })),
        ));
    }
    Ok(())
}

fn disclosure_conflict(message: String) -> (StatusCode, Json<Value>) {
    (StatusCode::CONFLICT, Json(json!({ "message": message })))
}

async fn faucet_info(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    if state.chain().is_main() {
        return Json(mainnet_faucet_info());
    }
    let address = state
        .receiving_address(&required_token(&headers))
        .await
        .address;
    let info = match state.faucet_client() {
        Some(client) => client.info(address.as_deref()).await,
        None => FaucetInfo::unconfigured(),
    };
    Json(serde_json::to_value(info).unwrap_or(Value::Null))
}

async fn faucet_claim(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if state.chain().is_main() {
        return Err(faucet_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "mainnet",
            "faucet_testnet_only",
            "Faucet is testnet-only.",
            false,
        ));
    }
    let value = reject_secrets(body)?;
    let request: FaucetClaimBody = serde_json::from_value(value).map_err(|_| {
        bad_request(
            "Faucet claim fields are requestId and optional captchaToken. The receiving address always comes from the wallet service.",
        )
    })?;
    let request_id = uuid::Uuid::parse_str(request.request_id.trim())
        .map_err(|_| bad_request("requestId must be a UUID so retries reuse the same claim."))?
        .hyphenated()
        .to_string();
    let captcha_token = request
        .captcha_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if captcha_token.is_some_and(|token| token.len() > 4096) {
        return Err(bad_request("captchaToken is too long."));
    }

    let Some(client) = state.faucet_client() else {
        return Err(faucet_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &request_id,
            "faucet_unconfigured",
            "No faucet endpoint is configured for the wallet service.",
            false,
        ));
    };
    let address = state.receiving_address(&required_token(&headers)).await;
    let Some(address) = address.address else {
        return Err(faucet_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &request_id,
            "wallet_unavailable",
            "The wallet service has no receiving address yet, so it cannot request funds.",
            true,
        ));
    };
    if let Err(message) = crate::wallet::ensure_shielded_testnet_recipient(&address) {
        return Err(faucet_error(
            StatusCode::BAD_REQUEST,
            &request_id,
            "unsupported_address_kind",
            &message,
            false,
        ));
    }

    let lock = state.faucet_claim_lock();
    let Ok(_guard) = lock.try_lock_owned() else {
        return Err(faucet_error(
            StatusCode::CONFLICT,
            &request_id,
            "claim_in_flight",
            "A faucet claim is already in progress. Wait for it to finish instead of submitting another.",
            true,
        ));
    };
    let report = client.claim(&address, &request_id, captcha_token).await;
    let status = if report.ambiguous {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(serde_json::to_value(report).unwrap_or(Value::Null)),
    ))
}

async fn faucet_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if state.chain().is_main() {
        return Err(faucet_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "mainnet",
            "faucet_testnet_only",
            "Faucet is testnet-only.",
            false,
        ));
    }
    let request_id = uuid::Uuid::parse_str(request_id.trim())
        .map_err(|_| bad_request("request_id must be a UUID."))?
        .hyphenated()
        .to_string();
    let Some(client) = state.faucet_client() else {
        return Err(faucet_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &request_id,
            "faucet_unconfigured",
            "No faucet endpoint is configured for the wallet service.",
            false,
        ));
    };
    let wallet_address = state
        .receiving_address(&required_token(&headers))
        .await
        .address;
    let Some(wallet_address) = wallet_address else {
        return Err(faucet_error(
            StatusCode::SERVICE_UNAVAILABLE,
            &request_id,
            "wallet_unavailable",
            "The wallet service has no receiving address, so it cannot match this claim.",
            true,
        ));
    };

    let mut report = client.status(&request_id).await;
    match report.address.as_deref() {
        Some(claimed) if claimed.trim() == wallet_address => {}
        Some(_) => {
            report = ClaimReport::failed(
                &request_id,
                FaucetError::new(
                    "claim_not_found",
                    "Fauzec's claim record does not match this wallet's receiving address.",
                    false,
                ),
            );
        }
        None if report.error.is_none() => {
            report = ClaimReport::failed(
                &request_id,
                FaucetError::new(
                    "faucet_invalid_response",
                    "Fauzec's status response did not identify the receiving address, so the wallet service cannot verify that this claim belongs to the wallet.",
                    false,
                ),
            );
        }
        None => {}
    }
    let status = if report.ambiguous {
        StatusCode::ACCEPTED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(serde_json::to_value(report).unwrap_or(Value::Null)),
    ))
}

fn mainnet_faucet_info() -> Value {
    let mut info = FaucetInfo::unconfigured();
    info.note = "Faucet is testnet-only.".to_string();
    if let Some(error) = info.error.as_mut() {
        error.code = "faucet_testnet_only".to_string();
        error.message = "Faucet is testnet-only.".to_string();
    }
    serde_json::to_value(info).unwrap_or(Value::Null)
}

fn faucet_error(
    status: StatusCode,
    request_id: &str,
    code: &str,
    message: &str,
    retryable: bool,
) -> (StatusCode, Json<Value>) {
    let report = ClaimReport::failed(request_id, FaucetError::new(code, message, retryable));
    (status, Json(serde_json::to_value(report).unwrap_or(Value::Null)))
}

async fn quote(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: QuoteBody = if value.as_object().is_some_and(|object| object.is_empty()) {
        QuoteBody {
            recipient: None,
            amount_zatoshis: None,
        }
    } else {
        serde_json::from_value(value).map_err(|_| bad_request("Quote fields are recipient and amountZatoshis."))?
    };
    let Some(recipient) = request.recipient.as_deref().map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(Json(quote_json(QuoteReport {
            quote_id: None,
            recipient: None,
            amount_zatoshis: None,
            fee_zatoshis: None,
            expires_at_ms: None,
            note: if state.chain().is_main() {
                "A quote needs a mainnet recipient (shielded u1/zs1 or transparent t1/t3) and an integer zatoshis amount.".to_string()
            } else {
                "A quote needs a testnet recipient (shielded utest1/ztestsapling or transparent tm/t2) and an integer zatoshis amount.".to_string()
            },
        }, None)));
    };
    let Some(amount) = request.amount_zatoshis.as_deref() else {
        return Ok(Json(quote_json(QuoteReport {
            quote_id: None,
            recipient: Some(recipient.to_string()),
            amount_zatoshis: None,
            fee_zatoshis: None,
            expires_at_ms: None,
            note: "Amount must be an integer number of zatoshis.".to_string(),
        }, None)));
    };
    let amount_zatoshis = amount.parse::<u64>().map_err(|_| bad_request("Amount must be an integer number of zatoshis."))?;
    let started = Instant::now();
    match state
        .quote(&required_token(&headers), recipient, amount_zatoshis)
        .await
    {
        Ok(report) => {
            let measurement = if report.fee_zatoshis.is_some() {
                Some(observed(started.elapsed().as_millis() as u64))
            } else {
                None
            };
            Ok(Json(quote_json(report, measurement)))
        }
        Err(message) => Err(bad_request(message)),
    }
}

async fn send(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: SendBody = serde_json::from_value(value)
        .map_err(|_| bad_request("Send fields are quoteId, approved, recipient, amountZatoshis, and feeZatoshis."))?;
    let amount = optional_zatoshis(request.amount_zatoshis.as_deref())?;
    let fee = optional_zatoshis(request.fee_zatoshis.as_deref())?;
    let expectation = match (
        request.recipient.as_deref().map(str::trim).filter(|value| !value.is_empty()),
        amount,
        fee,
    ) {
        (Some(recipient), Some(amount_zatoshis), Some(fee_zatoshis)) => Some(SendExpectation {
            recipient,
            amount_zatoshis,
            fee_zatoshis,
        }),
        (None, None, None) => None,
        _ => {
            return Err(bad_request(
                "Send requires recipient, amountZatoshis, and feeZatoshis from the quote.",
            ));
        }
    };
    let started = Instant::now();
    match state
        .send(
            &required_token(&headers),
            &request.quote_id,
            request.approved,
            expectation,
        )
        .await
    {
        Ok(SendReport::Accepted { txids }) => {
            let measurement = observed(started.elapsed().as_millis() as u64);
            let mut value = serde_json::to_value(SubmitResult::Accepted {
                evidence: SubmissionEvidence {
                    source: "backend".to_string(),
                    reference: txids.first().cloned().unwrap_or_default(),
                    accepted_for_broadcast: true,
                    note: "The wallet service produced these transaction ids and did not report a rejection. Confirm on chain before treating the payment as settled.".to_string(),
                },
                measurement,
            })
            .unwrap_or(Value::Null);
            insert_txids(&mut value, &txids);
            Ok(Json(value))
        }
        Ok(SendReport::Rejected { message }) => Ok(Json(serde_json::to_value(SubmitResult::Rejected {
            message,
            measurement: StageMeasurement::unavailable("The wallet refused to broadcast."),
        }).unwrap_or(Value::Null))),
        Ok(SendReport::Indeterminate { message, txids }) => {
            let mut value = serde_json::to_value(SubmitResult::Indeterminate {
                message,
                measurement: StageMeasurement::unavailable("Broadcast did not return a definite acceptance."),
            })
            .unwrap_or(Value::Null);
            if let Some(object) = value.as_object_mut() {
                object.insert("txids".to_string(), json!(txids));
            }
            Ok(Json(value))
        }
        Err(message) => Ok(Json(serde_json::to_value(SubmitResult::Rejected {
            message,
            measurement: StageMeasurement::unavailable("The wallet refused to broadcast."),
        }).unwrap_or(Value::Null))),
    }
}

async fn shield_quote(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let started = Instant::now();
    match state.quote_shield(&required_token(&headers)).await {
        Ok(report) => {
            let measurement = if report.fee_zatoshis.is_some() {
                Some(observed(started.elapsed().as_millis() as u64))
            } else {
                None
            };
            Ok(Json(quote_json(report, measurement)))
        }
        Err(message) => Err(bad_request(message)),
    }
}

async fn shield_send(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Same approval contract as /api/wallet/send; quote ids come from /api/wallet/shield/quote.
    send(State(state), headers, body).await
}

fn optional_zatoshis(value: Option<&str>) -> Result<Option<u64>, (StatusCode, Json<Value>)> {
    match value.map(str::trim).filter(|text| !text.is_empty()) {
        None => Ok(None),
        Some(text) => text
            .parse::<u64>()
            .map(Some)
            .map_err(|_| bad_request("Amount and fee must be integer zatoshis.")),
    }
}

fn insert_txids(value: &mut Value, txids: &[String]) {
    if let Some(object) = value.as_object_mut() {
        object.insert("txids".to_string(), json!(txids));
        if let Some(evidence) = object.get_mut("evidence").and_then(Value::as_object_mut) {
            evidence.insert("txids".to_string(), json!(txids));
        }
    }
}

async fn transaction_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(txid): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if txid.trim().is_empty() {
        return Err(bad_request("Transaction id is required."));
    }
    let report = state
        .transaction_status(&required_token(&headers), txid.trim())
        .await
        .map_err(bad_request)?;
    Ok(Json(status_json(state.chain(), txid.trim(), report)))
}

fn readiness_json(chain: crate::config::Chain, report: ReadinessReport, started: Instant) -> Value {
    let measurement = if report.can_submit {
        observed(started.elapsed().as_millis() as u64)
    } else {
        StageMeasurement::unavailable(report.blocker.clone())
    };
    let readiness = Readiness {
        sync: report.sync,
        spendable_zatoshis: report.spendable_zatoshis.map(|value| value.to_string()),
        network: chain.as_str().to_string(),
        measurement,
        note: report.note,
    };
    let mut value = serde_json::to_value(readiness).unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "detectedZatoshis".to_string(),
            report
                .detected_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "pendingChangeZatoshis".to_string(),
            report
                .pending_change_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "pendingSpendabilityZatoshis".to_string(),
            report
                .pending_spendability_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "lockedZatoshis".to_string(),
            report
                .locked_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "transparentDetectedZatoshis".to_string(),
            report
                .transparent_detected_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "transparentSpendableZatoshis".to_string(),
            report
                .transparent_spendable_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert("canSubmit".to_string(), Value::Bool(report.can_submit));
        object.insert("blocker".to_string(), Value::String(report.blocker));
    }
    value
}

fn quote_json(report: QuoteReport, measurement: Option<StageMeasurement>) -> Value {
    let QuoteReport {
        quote_id,
        recipient,
        amount_zatoshis,
        fee_zatoshis,
        expires_at_ms,
        note,
    } = report;
    let measurement = measurement
        .unwrap_or_else(|| StageMeasurement::unavailable(note.clone()));
    let quote = FeeQuote {
        fee_zatoshis: fee_zatoshis.map(|value| value.to_string()),
        note,
        measurement,
    };
    let mut value = serde_json::to_value(quote).unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "quoteId".to_string(),
            quote_id.map(Value::String).unwrap_or(Value::Null),
        );
        object.insert(
            "recipient".to_string(),
            recipient.map(Value::String).unwrap_or(Value::Null),
        );
        object.insert(
            "amountZatoshis".to_string(),
            amount_zatoshis
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
        );
        object.insert(
            "expiresAtMs".to_string(),
            expires_at_ms.map(Value::from).unwrap_or(Value::Null),
        );
    }
    value
}

fn status_json(chain: crate::config::Chain, txid: &str, report: StatusReport) -> Value {
    let txid = if report.txid.is_empty() {
        txid.to_string()
    } else {
        report.txid.clone()
    };
    let host = if chain.is_main() {
        "https://mainnet.zcashblockexplorer.com"
    } else {
        "https://testnet.zcashblockexplorer.com"
    };
    json!({
        "txid": txid,
        "minedHeight": report.mined_height,
        "blockHash": report.block_hash,
        "confirmations": report.confirmations,
        "explorer": {
            "transaction": format!("{host}/transactions/{txid}"),
            "block": report.block_hash.as_ref().map(|hash| {
                format!("{host}/blocks/{hash}")
            }).or_else(|| report.mined_height.map(|height| {
                format!("{host}/blocks/{height}")
            })),
        },
        "confirmation": ConfirmationEvidence {
            source: if report.confirmation_available { "backend".to_string() } else { "unavailable".to_string() },
            met: report.confirmation_met,
            criterion: if chain.is_main() { "mined_on_mainnet".to_string() } else { "mined_on_testnet".to_string() },
            note: report.confirmation_note,
        },
        "detection": DetectionEvidence {
            source: if report.detection_available { "backend".to_string() } else { "unavailable".to_string() },
            detected: report.detected,
            note: report.detection_note,
        },
    })
}

fn observed(duration_ms: u64) -> StageMeasurement {
    StageMeasurement::Measured {
        duration_ms,
        kind: DataKind::Observed,
    }
}

fn reject_secrets(
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let Json(value) = body.map_err(|_| bad_request("Send a JSON object."))?;
    if json_contains_key_material(&value) {
        return Err(bad_request("Seed phrases and spending keys are not accepted by this service."));
    }
    Ok(value)
}

fn bad_request(message: impl AsRef<str>) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "message": message.as_ref() })),
    )
}

fn header(headers: &HeaderMap, name: axum::http::HeaderName) -> &str {
    headers.get(name).and_then(|value| value.to_str().ok()).unwrap_or("")
}

fn origin_allowed(origin: &str) -> bool {
    origin == "http://localhost:3000" || origin == "http://127.0.0.1:3000"
}

fn host_is_loopback(host: &str) -> bool {
    let name = if let Some(rest) = host.trim().strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    name == "localhost" || name == "127.0.0.1" || name == "::1"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuoteBody {
    recipient: Option<String>,
    amount_zatoshis: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendBody {
    quote_id: String,
    approved: bool,
    recipient: Option<String>,
    amount_zatoshis: Option<String>,
    fee_zatoshis: Option<String>,
}

#[derive(Deserialize)]
struct ApprovalBody {
    approved: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisclosureExportBody {
    export_id: Option<String>,
    approved: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FaucetClaimBody {
    request_id: String,
    captcha_token: Option<String>,
}

#[derive(Deserialize)]
struct PasswordBody {
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewWalletBody {
    password: String,
    current_password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmWalletBody {
    create_id: String,
    current_password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnlockBody {
    password: String,
    wallet_id: String,
    kdf_salt: String,
    ciphertext: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimBody {
    claim_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use secrecy::ExposeSecret;
    use tower::ServiceExt;
    use zcash_address::unified::{Container, Encoding, Fvk, Ufvk};
    use zcash_client_backend::encoding::AddressCodec;
    use zcash_keys::address::UnifiedAddress;
    use zcash_keys::keys::{
        UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedIncomingViewingKey, UnifiedSpendingKey,
    };
    use zcash_protocol::consensus::{Network, NetworkType};
    use zip32::AccountId;

    fn browser_request(method: &str, uri: &str, body: Option<Value>) -> Request<Body> {
        signed_request(method, uri, body, None)
    }

    fn signed_request(
        method: &str,
        uri: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> Request<Body> {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header("origin", "http://localhost:3000")
            .header("host", "127.0.0.1:8787");
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        if body.is_some() {
            builder = builder.header("content-type", "application/json");
        }
        builder
            .body(
                body.map(|value| Body::from(value.to_string()))
                    .unwrap_or_else(Body::empty),
            )
            .unwrap()
    }

    async fn body_json(response: Response) -> Value {
        serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap()
    }

    fn account_ufvk(index: u32) -> String {
        let seed = crate::wallet::test_support::test_seed();
        UnifiedSpendingKey::from_seed(
            &Network::TestNetwork,
            seed.expose_secret(),
            AccountId::try_from(index).expect("account index"),
        )
        .expect("spending key")
        .to_unified_full_viewing_key()
        .encode(&Network::TestNetwork)
        .expect("encode ufvk")
    }

    fn shielded_account_ufvk(index: u32) -> String {
        use zcash_address::unified::{
            Container as _, Encoding as _, Fvk, Ufvk, Uitem,
        };
        let (network, revision, ufvk) =
            Ufvk::decode(&account_ufvk(index)).expect("decode account ufvk");
        let shielded = ufvk
            .items()
            .into_iter()
            .filter(|item| matches!(item, Fvk::Orchard(_) | Fvk::Sapling(_)))
            .map(Uitem::Data)
            .collect();
        Ufvk::try_from_items(revision, shielded)
            .expect("shielded-only ufvk")
            .encode(&network)
    }

    #[tokio::test]
    async fn auditor_requires_consent_and_refuses_spending_material_without_a_wallet() {
        let directory = tempfile::tempdir().unwrap();
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None).await.unwrap();
        let app = router(state);
        let unapproved = app.clone().oneshot(browser_request("POST", "/api/wallet/audit/scan", Some(json!({"ufvk": account_ufvk(1), "birthdayHeight": 2100001, "approved": false})))).await.unwrap();
        assert_eq!(unapproved.status(), StatusCode::FORBIDDEN);
        let secrets = app.clone().oneshot(browser_request("POST", "/api/wallet/audit/scan", Some(json!({"ufvk": account_ufvk(1), "birthdayHeight": 2100001, "approved": true, "seed": "not-accepted"})))).await.unwrap();
        assert_eq!(secrets.status(), StatusCode::BAD_REQUEST);
        let unavailable = app.oneshot(browser_request("POST", "/api/wallet/audit/scan", Some(json!({"ufvk": account_ufvk(1), "birthdayHeight": 2100001, "approved": true})))).await.unwrap();
        assert_eq!(unavailable.status(), StatusCode::CONFLICT);
        assert!(!body_json(unavailable).await.to_string().contains("uviewtest1"));
    }

    #[tokio::test]
    async fn disclosure_status_is_scoped_and_hides_key_material() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::wallet::test_support::seed_database(directory.path(), 2);
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let token = state.adopt_for_test(true).await.expect("session");
        let app = router(state);

        let response = app
            .oneshot(signed_request("GET", "/api/wallet/disclosure", None, Some(&token)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let body = body_json(response).await;
        assert_eq!(body["created"], true);
        assert_eq!(body["accountIndex"], 1);
        assert!(body["address"]
            .as_str()
            .is_some_and(|address| address.starts_with("utest1")));
        assert_eq!(body["transactionDisclosure"]["implemented"], false);
        assert_eq!(body["transactionDisclosure"]["saplingZip311"], false);
        assert_eq!(body["transactionDisclosure"]["orchard"], false);
        let text = body.to_string();
        assert!(!text.contains("uviewtest1"));
        assert!(!text.contains("uivktest1"));
        assert!(!text.contains("abandon"));
    }

    #[tokio::test]
    async fn disclosure_export_requires_approval_and_is_single_use() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::wallet::test_support::seed_database(directory.path(), 2);
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let token = state.adopt_for_test(true).await.expect("session");
        let app = router(state);

        let denied = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export/request",
                Some(json!({ "approved": false })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        assert!(body_json(denied).await.get("exportId").is_none());

        let missing_approval = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export/request",
                Some(json!({})),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(missing_approval.status(), StatusCode::FORBIDDEN);

        let requested = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export/request",
                Some(json!({ "approved": true })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(requested.status(), StatusCode::OK);
        assert_eq!(
            requested.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let requested_body = body_json(requested).await;
        let export_id = requested_body["exportId"]
            .as_str()
            .expect("export id")
            .to_string();
        assert!(requested_body.get("ufvk").is_none());
        assert!(!requested_body.to_string().contains("uviewtest1"));

        let unapproved_export = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export",
                Some(json!({ "exportId": export_id, "approved": false })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(unapproved_export.status(), StatusCode::FORBIDDEN);

        let wrong_id = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export",
                Some(json!({ "exportId": "export_wrong", "approved": true })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(wrong_id.status(), StatusCode::BAD_REQUEST);
        assert!(!body_json(wrong_id).await.to_string().contains("uviewtest1"));

        let exported = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export",
                Some(json!({ "exportId": export_id, "approved": true })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(exported.status(), StatusCode::OK);
        assert_eq!(
            exported.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let exported_body = body_json(exported).await;
        let ufvk = exported_body["ufvk"].as_str().expect("ufvk").to_string();
        let uivk = exported_body["uivk"].as_str().expect("uivk").to_string();
        assert!(ufvk.starts_with("uviewtest1"));
        assert!(uivk.starts_with("uivktest1"));
        assert_eq!(exported_body["scope"]["canSpend"], false);
        assert_eq!(exported_body["scope"]["seesPrimaryAccount"], false);
        assert_eq!(exported_body["scope"]["provesSenderIdentity"], false);
        assert_eq!(exported_body["transactionDisclosure"]["orchard"], false);
        assert!(!exported_body.to_string().contains("abandon"));

        let (network, _revision, parsed) = Ufvk::decode(&ufvk).expect("decode exported ufvk");
        assert_eq!(network, NetworkType::Test);
        let items = parsed.items();
        assert!(!items.is_empty());
        for item in items {
            assert!(matches!(item, Fvk::Orchard(_) | Fvk::Sapling(_)));
        }

        assert_eq!(ufvk, shielded_account_ufvk(1));
        assert_ne!(ufvk, shielded_account_ufvk(0));
        assert_ne!(ufvk, account_ufvk(1));

        let status = app
            .clone()
            .oneshot(signed_request("GET", "/api/wallet/disclosure", None, Some(&token)))
            .await
            .unwrap();
        let disclosure_address = body_json(status).await["address"]
            .as_str()
            .expect("disclosure address")
            .to_string();

        let imported_ufvk =
            UnifiedFullViewingKey::decode(&Network::TestNetwork, &ufvk).expect("import ufvk");
        assert_eq!(
            imported_ufvk
                .encode(&Network::TestNetwork)
                .expect("encode imported ufvk"),
            ufvk
        );
        let (ufvk_address, _) = imported_ufvk
            .default_address(UnifiedAddressRequest::SHIELDED)
            .expect("derive address from ufvk");

        let imported_uivk =
            UnifiedIncomingViewingKey::decode(&Network::TestNetwork, &uivk).expect("import uivk");
        assert_eq!(
            imported_uivk
                .encode(&Network::TestNetwork)
                .expect("encode imported uivk"),
            uivk
        );
        assert_eq!(
            imported_ufvk
                .to_unified_incoming_viewing_key()
                .encode(&Network::TestNetwork)
                .expect("encode derived uivk"),
            uivk
        );
        let (uivk_address, _) = imported_uivk
            .default_address(UnifiedAddressRequest::SHIELDED)
            .expect("derive address from uivk");
        assert_eq!(
            ufvk_address.encode(&Network::TestNetwork),
            uivk_address.encode(&Network::TestNetwork)
        );

        let published = UnifiedAddress::decode(&Network::TestNetwork, &disclosure_address)
            .expect("decode published disclosure address");
        assert!(
            !imported_uivk.decrypt_diversifiers(&published).is_empty(),
            "the exported UIVK must recognize the published disclosure address"
        );

        let reused = app
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export",
                Some(json!({ "exportId": export_id, "approved": true })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(reused.status(), StatusCode::BAD_REQUEST);
        let reused_body = body_json(reused).await;
        assert!(!reused_body.to_string().contains("uviewtest1"));
        assert!(reused_body["message"]
            .as_str()
            .is_some_and(|message| message.contains("missing, expired, or already used")));
    }

    #[tokio::test]
    async fn disclosure_creation_requires_approval_and_reports_missing_endpoint() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::wallet::test_support::seed_database(directory.path(), 1);
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let token = state.adopt_for_test(true).await.expect("session");
        let app = router(state);

        let denied = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/account",
                Some(json!({ "approved": false })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);

        let blocked = app
            .clone()
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/account",
                Some(json!({ "approved": true })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(blocked.status(), StatusCode::CONFLICT);
        let blocked_body = body_json(blocked).await;
        assert!(blocked_body["message"]
            .as_str()
            .is_some_and(|message| message.contains("LIGHTWALLETD_ENDPOINT")));

        let status = app
            .oneshot(signed_request("GET", "/api/wallet/disclosure", None, Some(&token)))
            .await
            .unwrap();
        let status_body = body_json(status).await;
        assert_eq!(status_body["created"], false);
        assert_eq!(status_body["address"], Value::Null);
    }

    #[tokio::test]
    async fn disclosure_export_rejects_untrusted_origins_and_secrets() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::wallet::test_support::seed_database(directory.path(), 2);
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let token = state.adopt_for_test(true).await.expect("session");
        let app = router(state);

        let no_origin = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wallet/disclosure/export/request")
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from("{\"approved\":true}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(no_origin.status(), StatusCode::FORBIDDEN);

        let foreign_origin = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wallet/disclosure/export/request")
                    .header("origin", "https://evil.example")
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from("{\"approved\":true}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(foreign_origin.status(), StatusCode::FORBIDDEN);

        let secret = app
            .oneshot(signed_request(
                "POST",
                "/api/wallet/disclosure/export/request",
                Some(json!({
                    "approved": true,
                    "seedPhrase": "one two three"
                })),
Some(&token)))
            .await
            .unwrap();
        assert_eq!(secret.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn serves_readiness_without_a_seed_route() {
        let directory = tempfile::tempdir().expect("temp dir");
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let app = router(state);

        let missing = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/wallet/seed")
                    .header("origin", "http://127.0.0.1:3000")
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let forbidden = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/wallet/readiness")
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

        let address = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/wallet/address")
                    .header("origin", "http://127.0.0.1:3000")
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(address.status(), StatusCode::UNAUTHORIZED);
        let body = body_json(address).await;
        assert_eq!(body["code"], "wallet_locked");
        assert!(!body.to_string().contains("utest1"));

        let ready = app
            .oneshot(
                Request::builder()
                    .uri("/api/wallet/readiness")
                    .header("origin", "http://localhost:3000")
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ready.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(body_json(ready).await["code"], "wallet_locked");
        assert!(!directory.path().join("recovery.txt").exists());
    }

    #[tokio::test]
    async fn faucet_routes_use_the_wallet_address_and_refuse_secrets() {
        let directory = tempfile::tempdir().expect("temp dir");
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let token = state.adopt_for_test(true).await.expect("session");
        let app = router(state);
        let request_id = "6c1f0c2f-6f38-4f12-9f24-0d6f2f8a6d31";

        let unguarded = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wallet/faucet/claim")
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(format!("{{\"requestId\":\"{request_id}\"}}")))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unguarded.status(), StatusCode::FORBIDDEN);

        let info = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/wallet/faucet/info")
                    .header("origin", "http://localhost:3000")
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(info.status(), StatusCode::OK);
        let info: Value = serde_json::from_slice(
            &axum::body::to_bytes(info.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(info["canAttemptClaim"], false);
        assert_eq!(info["addressSupported"], false);
        assert_eq!(info["error"]["code"], "faucet_unconfigured");

        let secret = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wallet/faucet/claim")
                    .header("origin", "http://localhost:3000")
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(format!(
                        "{{\"requestId\":\"{request_id}\",\"seedPhrase\":\"one two three\"}}"
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(secret.status(), StatusCode::BAD_REQUEST);

        let invalid = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wallet/faucet/claim")
                    .header("origin", "http://localhost:3000")
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from("{\"requestId\":\"not-a-uuid\"}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);

        let claim = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/wallet/faucet/claim")
                    .header("origin", "http://localhost:3000")
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "127.0.0.1:8787")
                    .header("content-type", "application/json")
                    .body(Body::from(format!("{{\"requestId\":\"{request_id}\"}}")))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(claim.status(), StatusCode::SERVICE_UNAVAILABLE);
        let claim: Value = serde_json::from_slice(
            &axum::body::to_bytes(claim.into_body(), usize::MAX)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(claim["state"], "failed");
        assert_eq!(claim["error"]["code"], "faucet_unconfigured");
        assert_eq!(claim["requestId"], request_id);

        let status = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/wallet/faucet/status/{request_id}"))
                    .header("origin", "http://localhost:3000")
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(status.status(), StatusCode::SERVICE_UNAVAILABLE);

        let invalid_status = app
            .oneshot(
                Request::builder()
                    .uri("/api/wallet/faucet/status/not-a-uuid")
                    .header("origin", "http://localhost:3000")
                    .header("authorization", format!("Bearer {token}"))
                    .header("host", "127.0.0.1:8787")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_status.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn browsers_keep_separate_wallets_and_the_funded_wallet_stays_unclaimed() {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::wallet::test_support::seed_database(directory.path(), 2);
        let state = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("wallet");
        let app = router(state.clone());

        let session = app
            .clone()
            .oneshot(browser_request("GET", "/api/wallet/session", None))
            .await
            .unwrap();
        assert_eq!(session.status(), StatusCode::OK);
        assert_eq!(
            session.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let session_body = body_json(session).await;
        let encoded = session_body.to_string();
        assert!(!encoded.contains("abandon"));
        assert!(!encoded.contains("phrase"));
        assert!(!encoded.contains("utest1"));
        assert_eq!(session_body["locked"], true);
        assert_eq!(session_body["hasWallet"], false);
        assert_eq!(session_body["hasPassword"], false);
        assert_eq!(session_body["legacyUnclaimed"], true);

        let address = app
            .clone()
            .oneshot(browser_request("GET", "/api/wallet/address", None))
            .await
            .unwrap();
        assert_eq!(address.status(), StatusCode::UNAUTHORIZED);
        let send = app
            .clone()
            .oneshot(browser_request(
                "POST",
                "/api/wallet/send",
                Some(json!({ "quoteId": "quote_test" })),
            ))
            .await
            .unwrap();
        assert_eq!(send.status(), StatusCode::UNAUTHORIZED);

        let created = state
            .begin_new_wallet("new-password")
            .await
            .expect("begin");
        assert_ne!(created.phrase, crate::wallet::test_support::TEST_PHRASE);
        let created_vault = state
            .confirm_new_wallet_offline(&created.create_id)
            .await
            .expect("confirm");
        assert!(directory.path().join("recovery.txt").is_file());
        assert!(!created_vault.ciphertext.contains("abandon"));
        assert!(!directory
            .path()
            .join("vaults")
            .join(&created_vault.wallet_id)
            .join("recovery.txt")
            .exists());
        let created_grant = state
            .acknowledge_wallet(&created.create_id)
            .await
            .expect("ack");
        let created_address = state
            .receiving_address(&created_grant.session_token)
            .await
            .address
            .expect("new address");
        assert!(created_address.starts_with("utest1"));
        assert!(state
            .disclosure_status(&created_grant.session_token)
            .await
            .account_index
            .is_none());

        let claim = state.begin_claim("correct-horse").await.expect("claim");
        assert_eq!(claim.phrase.trim(), crate::wallet::test_support::TEST_PHRASE);
        assert!(!claim.phrase.contains("utest1"));
        let claim_vault = state.confirm_claim(&claim.create_id).await.expect("confirm claim");
        assert!(directory.path().join("recovery.txt").is_file());
        assert_ne!(claim_vault.wallet_id, created_vault.wallet_id);
        let opened = crate::session_secret::open_vault(
            "correct-horse",
            &crate::session_secret::VaultRecord {
                version: 1,
                kdf_salt: claim_vault.kdf_salt.clone(),
                ciphertext: claim_vault.ciphertext.clone(),
            },
        )
        .expect("open claim vault");
        assert_eq!(opened.trim(), crate::wallet::test_support::TEST_PHRASE);
        let claim_grant = state
            .acknowledge_claim(&claim.create_id)
            .await
            .expect("ack claim");
        assert!(!directory.path().join("recovery.txt").exists());
        let claimed_address = state
            .receiving_address(&claim_grant.session_token)
            .await
            .address
            .expect("claimed address");
        assert_ne!(claimed_address, created_address);

        let hidden = app
            .clone()
            .oneshot(browser_request("GET", "/api/wallet/session", None))
            .await
            .unwrap();
        let hidden_body = body_json(hidden).await;
        assert_eq!(hidden_body["hasWallet"], false);
        assert_eq!(hidden_body["legacyUnclaimed"], false);
        assert!(!hidden_body.to_string().contains("utest1"));

        state
            .lock(&claim_grant.session_token)
            .await
            .expect("lock claimed");
        assert!(state.is_locked(&claim_grant.session_token).await);
        assert!(!state.is_locked(&created_grant.session_token).await);
        let still_there = state
            .receiving_address(&created_grant.session_token)
            .await
            .address
            .expect("other browser stays open");
        assert_eq!(still_there, created_address);
        let locked_address = app
            .clone()
            .oneshot(signed_request(
                "GET",
                "/api/wallet/address",
                None,
                Some(&claim_grant.session_token),
            ))
            .await
            .unwrap();
        assert_eq!(locked_address.status(), StatusCode::UNAUTHORIZED);

        let wrong = app
            .clone()
            .oneshot(browser_request(
                "POST",
                "/api/wallet/session/unlock",
                Some(json!({
                    "password": "wrong-password",
                    "walletId": claim_vault.wallet_id,
                    "kdfSalt": claim_vault.kdf_salt,
                    "ciphertext": claim_vault.ciphertext,
                })),
            ))
            .await
            .unwrap();
        assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
        assert!(state.is_locked(&claim_grant.session_token).await);

        drop(state);
        let restarted = AppState::open(crate::config::Chain::Test, directory.path(), None, None, None)
            .await
            .expect("restart");
        let unlocked = restarted
            .unlock_vault(
                "correct-horse",
                &claim_vault.wallet_id,
                &claim_vault.kdf_salt,
                &claim_vault.ciphertext,
            )
            .await
            .expect("unlock claimed");
        let other = restarted
            .unlock_vault(
                "new-password",
                &created_vault.wallet_id,
                &created_vault.kdf_salt,
                &created_vault.ciphertext,
            )
            .await
            .expect("unlock created");
        assert_eq!(
            restarted
                .receiving_address(&unlocked.session_token)
                .await
                .address
                .as_deref(),
            Some(claimed_address.as_str())
        );
        assert_eq!(
            restarted
                .receiving_address(&other.session_token)
                .await
                .address
                .as_deref(),
            Some(created_address.as_str())
        );
        restarted.lock(&other.session_token).await.expect("lock other");
        assert!(!restarted.is_locked(&unlocked.session_token).await);
        assert!(!directory.path().join("recovery.txt").exists());
    }
}

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use api_types::{json_contains_key_material, LIVE_BACKEND_BLOCKER};
use axum::extract::{Path, State};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::{AllowOrigin, CorsLayer};
use wallet_core::{classify_testnet_recipient, parse_zec_to_zatoshis};
use zcash_adapter::BlockedAdapter;

#[derive(Clone)]
pub struct AppState {
    db: std::sync::Arc<Mutex<Connection>>,
    ids: std::sync::Arc<AtomicU64>,
}

pub fn router(connection: Connection) -> Router {
    let state = AppState {
        db: std::sync::Arc::new(Mutex::new(connection)),
        ids: std::sync::Arc::new(AtomicU64::new(1)),
    };
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list([
            HeaderValue::from_static("http://localhost:3000"),
            HeaderValue::from_static("http://127.0.0.1:3000"),
        ]))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([axum::http::header::CONTENT_TYPE]);

    Router::new()
        .route("/health", get(health))
        .route("/capabilities", get(capabilities))
        .route("/payment-requests", post(create_request))
        .route("/payment-requests/:id", get(read_request))
        .route("/benchmarks", post(create_benchmark))
        .route("/payments/prepare", post(prepare_payment))
        .route("/payments/submit", post(submit_payment))
        .with_state(state)
        .layer(cors)
}

pub fn open_memory() -> Connection {
    let connection = Connection::open_in_memory().expect("memory database");
    migrate(&connection);
    connection
}

pub fn open_file(path: &str) -> Connection {
    let connection = Connection::open(path).expect("sqlite file");
    migrate(&connection);
    connection
}

fn migrate(connection: &Connection) {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS payment_requests (
                id TEXT PRIMARY KEY,
                recipient TEXT NOT NULL,
                amount_zatoshis TEXT NOT NULL,
                expires_at_ms INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS benchmark_reports (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL
            );
            ",
        )
        .expect("migrate");
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn capabilities() -> Json<api_types::Capabilities> {
    Json(BlockedAdapter::new().capabilities())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRequest {
    recipient: String,
    amount_zec: String,
    expires_at_ms: u64,
}

async fn create_request(
    State(state): State<AppState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    let request: CreateRequest = serde_json::from_value(value).map_err(|_| bad_request("Payment request fields are recipient, amountZec, and expiresAtMs."))?;
    classify_testnet_recipient(request.recipient.trim()).map_err(bad_request)?;
    let amount = parse_zec_to_zatoshis(&request.amount_zec).map_err(bad_request)?;
    let id = format!("req_{}", state.ids.fetch_add(1, Ordering::SeqCst));
    let created_at_ms = now_ms();
    state
        .db
        .lock()
        .expect("db")
        .execute(
            "INSERT INTO payment_requests (id, recipient, amount_zatoshis, expires_at_ms, status, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, request.recipient.trim(), amount.to_string(), request.expires_at_ms, "open", created_at_ms],
        )
        .map_err(|_| server_error())?;
    Ok(Json(json!({
        "id": id,
        "recipient": request.recipient.trim(),
        "amountZatoshis": amount.to_string(),
        "expiresAtMs": request.expires_at_ms,
        "status": "open",
        "canSubmit": false,
        "blocker": LIVE_BACKEND_BLOCKER,
    })))
}

async fn read_request(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let connection = state.db.lock().expect("db");
    let mut statement = connection
        .prepare("SELECT recipient, amount_zatoshis, expires_at_ms, status FROM payment_requests WHERE id = ?1")
        .map_err(|_| server_error())?;
    let row = statement
        .query_row(params![id], |row| {
            Ok(json!({
                "id": id,
                "recipient": row.get::<_, String>(0)?,
                "amountZatoshis": row.get::<_, String>(1)?,
                "expiresAtMs": row.get::<_, u64>(2)?,
                "status": row.get::<_, String>(3)?,
                "canSubmit": false,
                "blocker": LIVE_BACKEND_BLOCKER,
            }))
        })
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({ "message": "No payment request with that id." }))))?;
    Ok(Json(row))
}

async fn create_benchmark(
    State(state): State<AppState>,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let value = reject_secrets(body)?;
    if !value.is_object() {
        return Err(bad_request("Benchmark upload must be a JSON object."));
    }
    let id = format!("bench_{}", state.ids.fetch_add(1, Ordering::SeqCst));
    state
        .db
        .lock()
        .expect("db")
        .execute(
            "INSERT INTO benchmark_reports (id, payload, created_at_ms) VALUES (?1, ?2, ?3)",
            params![id, value.to_string(), now_ms()],
        )
        .map_err(|_| server_error())?;
    Ok(Json(json!({ "id": id, "stored": true })))
}

async fn prepare_payment(
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _value = reject_secrets(body)?;
    Ok(Json(json!({
        "outcome": "blocked",
        "canSubmit": false,
        "reference": null,
        "blocker": LIVE_BACKEND_BLOCKER,
        "proof": { "status": "unavailable", "reason": LIVE_BACKEND_BLOCKER },
        "signing": { "status": "unavailable", "reason": LIVE_BACKEND_BLOCKER },
    })))
}

async fn submit_payment(
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _value = reject_secrets(body)?;
    Ok(Json(json!({
        "outcome": "rejected",
        "reference": null,
        "message": LIVE_BACKEND_BLOCKER,
    })))
}

fn reject_secrets(
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let Json(value) = body.map_err(|_| bad_request("Send a JSON object."))?;
    if json_contains_key_material(&value) {
        return Err(bad_request(
            "Seed phrases and spending keys are not accepted by this service.",
        ));
    }
    Ok(value)
}

fn bad_request(message: impl AsRef<str>) -> (StatusCode, Json<Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "message": message.as_ref() })),
    )
}

fn server_error() -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "message": "The payment request could not be stored." })),
    )
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn experimental_flags() -> experimental_optimizer::ExperimentalProbe {
    experimental_optimizer::probe()
}

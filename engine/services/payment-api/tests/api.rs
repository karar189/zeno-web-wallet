use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use payment_api::{experimental_flags, open_memory, router};
use serde_json::Value;
use tower::ServiceExt;

async fn call(app: axum::Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    let request = if let Some(body) = body {
        request.body(Body::from(body.to_string())).unwrap()
    } else {
        request.body(Body::empty()).unwrap()
    };
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

#[tokio::test]
async fn submit_returns_no_transaction_reference() {
    let app = router(open_memory());
    let (status, body) = call(app, "POST", "/payments/submit", Some(serde_json::json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["outcome"], "rejected");
    assert!(body["reference"].is_null());
    assert!(body["message"].as_str().unwrap().contains("not available"));
}

#[tokio::test]
async fn payment_request_rejects_a_seed() {
    let app = router(open_memory());
    let (status, body) = call(
        app,
        "POST",
        "/payment-requests",
        Some(serde_json::json!({
            "recipient": format!("ztestsapling1{}", "q".repeat(50)),
            "amountZec": "0.1",
            "expiresAtMs": 10,
            "mnemonic": "abandon ability able about above absent absorb abstract absurd abuse access accident"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["message"].as_str().unwrap().contains("Seed"));
}

#[tokio::test]
async fn stores_a_request_without_key_fields() {
    let app = router(open_memory());
    let (status, body) = call(
        app,
        "POST",
        "/payment-requests",
        Some(serde_json::json!({
            "recipient": format!("ztestsapling1{}", "q".repeat(50)),
            "amountZec": "0.10",
            "expiresAtMs": 10
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["amountZatoshis"], "10000000");
    assert_eq!(body["canSubmit"], false);
    assert!(experimental_flags().on_payment_path == false);
}

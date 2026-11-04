use payment_api::{open_file, router};

#[tokio::main]
async fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "4010".to_string());
    let database = std::env::var("ENGINE_DB").unwrap_or_else(|_| "engine.sqlite".to_string());
    let app = router(open_file(&database));
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .expect("bind payment api");
    println!("payment engine listening on http://127.0.0.1:{port}");
    axum::serve(listener, app).await.expect("serve payment api");
}

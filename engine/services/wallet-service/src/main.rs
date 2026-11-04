use std::process::ExitCode;

use wallet_service::{router, AppState, Config};

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(1);
        }
    };
    let state = match AppState::open(
        config.chain,
        &config.data_dir,
        config.endpoint.clone(),
        config.birthday_height,
        Some(config.faucet_endpoint.clone()),
    )
    .await
    {
        Ok(state) => state,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(1);
        }
    };
    let app = router(state);
    let listener = match tokio::net::TcpListener::bind(config.bind).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Could not bind {}: {error}", config.bind);
            return ExitCode::from(1);
        }
    };
    println!(
        "Zcash {} wallet listening on http://{}",
        config.chain.as_str(),
        config.bind
    );
    if let Err(error) = axum::serve(listener, app).await {
        eprintln!("{error}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

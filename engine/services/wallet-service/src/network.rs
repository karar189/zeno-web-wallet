//! Outbound transport for lightwalletd and the faucet.
//!
//! With `WALLET_SOCKS5_PROXY=socks5h://127.0.0.1:1080` (for example a local
//! `nym-socks5-client`), every outbound connection this service makes goes through that
//! SOCKS5 proxy, and hostnames are resolved by the proxy rather than locally. There is no
//! direct fallback: while a proxy is configured and unreachable, connections fail.
//! TLS to lightwalletd still terminates at lightwalletd, so the proxy and the Nym exit see
//! only ciphertext.

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::task::{Context, Poll};
use std::time::Duration;

use hyper_util::rt::TokioIo;
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_socks::tcp::Socks5Stream;
use tonic::transport::{Channel, ClientTlsConfig, Endpoint, Uri};
use zcash_client_backend::proto::service::compact_tx_streamer_client::CompactTxStreamerClient;

pub const DEFAULT_PROXY_NAME: &str = "Nym mixnet";
/// Mixnet circuits add seconds of latency per round trip; allow for a slow first hop.
const PROXY_CONNECT_TIMEOUT: Duration = Duration::from_secs(60);
const PROXY_REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
const PROXY_PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Socks5Proxy {
    pub host: String,
    pub port: u16,
    /// Shown to the user, e.g. "Nym mixnet". The service cannot verify what the proxy is.
    pub name: String,
}

impl Socks5Proxy {
    pub fn address(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    pub fn url(&self) -> String {
        format!("socks5h://{}", self.address())
    }
}

static PROXY: OnceLock<Option<Socks5Proxy>> = OnceLock::new();

/// Sets the process-wide transport once, at startup. Later calls are ignored, so the
/// transport cannot change under a running wallet.
pub fn install(proxy: Option<Socks5Proxy>) {
    let _ = PROXY.set(proxy);
}

pub fn proxy() -> Option<&'static Socks5Proxy> {
    PROXY.get().and_then(Option::as_ref)
}

/// Parses `socks5h://host:port`. Only loopback proxies are accepted: the proxy must run on
/// this machine (nym-socks5-client, Tor), otherwise the hop to it would itself reveal traffic.
pub fn parse_proxy(value: &str, name: Option<&str>) -> Result<Socks5Proxy, String> {
    let invalid = || {
        "WALLET_SOCKS5_PROXY must look like socks5h://127.0.0.1:1080 (a SOCKS5 proxy on this machine, such as nym-socks5-client).".to_string()
    };
    let url = reqwest::Url::parse(value.trim()).map_err(|_| invalid())?;
    if url.scheme() != "socks5h" {
        return Err(format!(
            "{} Use the socks5h scheme so hostnames are resolved by the proxy, not locally.",
            invalid()
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("WALLET_SOCKS5_PROXY must not embed credentials.".to_string());
    }
    if !(url.path().is_empty() || url.path() == "/") || url.query().is_some() || url.fragment().is_some() {
        return Err(invalid());
    }
    let host = url
        .host_str()
        .ok_or_else(invalid)?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let loopback = host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback());
    if !loopback {
        return Err("WALLET_SOCKS5_PROXY must point at a proxy on this machine (127.0.0.1, ::1 or localhost).".to_string());
    }
    let port = url.port().ok_or_else(invalid)?;
    let name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_PROXY_NAME);
    if name.len() > 40 || name.chars().any(char::is_control) {
        return Err("WALLET_SOCKS5_PROXY_NAME must be a short label, for example Nym mixnet.".to_string());
    }
    Ok(Socks5Proxy {
        host,
        port,
        name: name.to_string(),
    })
}

/// Opens a lightwalletd gRPC client over the configured transport.
pub async fn lightwalletd(endpoint: &str) -> Result<CompactTxStreamerClient<Channel>, String> {
    let mut target = Endpoint::from_shared(endpoint.to_string())
        .map_err(|_| "LIGHTWALLETD_ENDPOINT is not a valid URL.".to_string())?;
    if endpoint.starts_with("https://") {
        target = target
            .tls_config(ClientTlsConfig::new().with_enabled_roots())
            .map_err(|error| format!("Could not configure TLS for lightwalletd: {error}"))?;
    }
    let channel = match proxy() {
        None => target
            .connect()
            .await
            .map_err(|error| format!("Could not connect to LIGHTWALLETD_ENDPOINT: {}", describe(&error)))?,
        Some(proxy) => target
            .connect_timeout(PROXY_CONNECT_TIMEOUT)
            .connect_with_connector(Socks5Connector {
                proxy: proxy.clone(),
            })
            .await
            .map_err(|error| {
                format!(
                    "Could not reach lightwalletd through the {} proxy at {}: {}. Check that it is running. Nothing is sent directly while a proxy is configured.",
                    proxy.name,
                    proxy.address(),
                    describe(&error)
                )
            })?,
    };
    Ok(CompactTxStreamerClient::new(channel))
}

/// Applies the configured transport to an HTTP client (the faucet).
pub fn http_client(builder: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    match proxy() {
        None => Ok(builder),
        Some(proxy) => {
            let route = reqwest::Proxy::all(proxy.url())
                .map_err(|error| format!("Could not configure the {} proxy: {error}", proxy.name))?;
            // An explicit proxy also disables reqwest's system proxy lookup. Mixnet round
            // trips are slow, so the per-request budget is longer than the direct one.
            Ok(builder.proxy(route).timeout(PROXY_REQUEST_TIMEOUT))
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportStatus {
    /// `direct` or `socks5`
    pub transport: &'static str,
    pub name: Option<String>,
    pub proxy: Option<String>,
    /// Whether something accepts TCP connections on the proxy port right now. This does
    /// not prove the proxy is connected to the mixnet.
    pub proxy_listening: Option<bool>,
}

pub async fn status() -> TransportStatus {
    match proxy() {
        None => TransportStatus {
            transport: "direct",
            name: None,
            proxy: None,
            proxy_listening: None,
        },
        Some(proxy) => {
            let listening = tokio::time::timeout(
                PROXY_PROBE_TIMEOUT,
                TcpStream::connect((proxy.host.as_str(), proxy.port)),
            )
            .await
            .is_ok_and(|result| result.is_ok());
            TransportStatus {
                transport: "socks5",
                name: Some(proxy.name.clone()),
                proxy: Some(proxy.address()),
                proxy_listening: Some(listening),
            }
        }
    }
}

fn describe(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        message.push_str(": ");
        message.push_str(&inner.to_string());
        source = inner.source();
    }
    message
}

#[derive(Clone)]
struct Socks5Connector {
    proxy: Socks5Proxy,
}

type BoxError = Box<dyn std::error::Error + Send + Sync>;

impl tower::Service<Uri> for Socks5Connector {
    type Response = TokioIo<Socks5Stream<TcpStream>>;
    type Error = BoxError;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, uri: Uri) -> Self::Future {
        let proxy = self.proxy.clone();
        Box::pin(async move {
            let host = uri
                .host()
                .ok_or("lightwalletd URL has no host")?
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_string();
            let port = uri
                .port_u16()
                .unwrap_or(if uri.scheme_str() == Some("https") { 443 } else { 80 });
            // The hostname goes to the proxy unresolved (socks5h semantics).
            let stream = Socks5Stream::connect((proxy.host.as_str(), proxy.port), (host, port)).await?;
            Ok(TokioIo::new(stream))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_loopback_socks5h_proxies() {
        let proxy = parse_proxy("socks5h://127.0.0.1:1080", None).unwrap();
        assert_eq!(proxy.address(), "127.0.0.1:1080");
        assert_eq!(proxy.name, DEFAULT_PROXY_NAME);
        assert_eq!(parse_proxy("socks5h://[::1]:1080/", Some("Tor")).unwrap().address(), "[::1]:1080");
        assert_eq!(parse_proxy("socks5h://localhost:9050", Some(" Tor ")).unwrap().name, "Tor");
        assert!(parse_proxy("socks5://127.0.0.1:1080", None).is_err());
        assert!(parse_proxy("http://127.0.0.1:1080", None).is_err());
        assert!(parse_proxy("socks5h://10.0.0.2:1080", None).is_err());
        assert!(parse_proxy("socks5h://proxy.example.com:1080", None).is_err());
        assert!(parse_proxy("socks5h://user:pw@127.0.0.1:1080", None).is_err());
        assert!(parse_proxy("socks5h://127.0.0.1", None).is_err());
        assert!(parse_proxy("socks5h://127.0.0.1:1080/x", None).is_err());
        assert!(parse_proxy("127.0.0.1:1080", None).is_err());
        assert!(parse_proxy("socks5h://127.0.0.1:1080", Some("a\nb")).is_err());
    }
}

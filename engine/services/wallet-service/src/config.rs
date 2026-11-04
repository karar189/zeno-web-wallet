use std::net::{IpAddr, SocketAddr};

use zcash_protocol::consensus::{Network, NetworkType};

pub const DEFAULT_FAUCET_ENDPOINT: &str = "https://fauzec.com";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Chain {
    Test,
    Main,
}

impl Chain {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "testnet" => Ok(Chain::Test),
            "mainnet" => Ok(Chain::Main),
            _ => Err(
                "WALLET_NETWORK must be testnet or mainnet. This service rejects every other network."
                    .to_string(),
            ),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Chain::Test => "testnet",
            Chain::Main => "mainnet",
        }
    }

    pub fn zcash(self) -> Network {
        match self {
            Chain::Test => Network::TestNetwork,
            Chain::Main => Network::MainNetwork,
        }
    }

    pub fn network_type(self) -> NetworkType {
        match self {
            Chain::Test => NetworkType::Test,
            Chain::Main => NetworkType::Main,
        }
    }

    pub fn is_main(self) -> bool {
        matches!(self, Chain::Main)
    }
}

pub struct Config {
    pub chain: Chain,
    pub bind: SocketAddr,
    pub data_dir: std::path::PathBuf,
    pub endpoint: Option<String>,
    pub birthday_height: Option<u32>,
    pub faucet_endpoint: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let chain = Chain::parse(&required("WALLET_NETWORK")?)?;
        let bind = parse_loopback(&required("WALLET_API_BIND")?)?;
        let data_dir = std::path::PathBuf::from(required("WALLET_DATA_DIR")?);
        let endpoint = std::env::var("LIGHTWALLETD_ENDPOINT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let birthday_height = std::env::var("WALLET_BIRTHDAY_HEIGHT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| parse_birthday(&value))
            .transpose()?;
        let faucet_endpoint = std::env::var("FAUCET_ENDPOINT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_FAUCET_ENDPOINT.to_string());
        let faucet_endpoint = parse_faucet_endpoint(&faucet_endpoint)?;
        Ok(Self {
            chain,
            bind,
            data_dir,
            endpoint,
            birthday_height,
            faucet_endpoint,
        })
    }
}

pub fn parse_faucet_endpoint(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| "FAUCET_ENDPOINT must be an absolute URL, for example https://fauzec.com.".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("FAUCET_ENDPOINT must not embed credentials.".to_string());
    }
    let loopback_http = url.scheme() == "http" && url.host_str() == Some("127.0.0.1");
    if url.scheme() != "https" && !loopback_http {
        return Err("FAUCET_ENDPOINT must use https. Plain http is allowed only for 127.0.0.1 tests.".to_string());
    }
    if url.host_str().is_none() {
        return Err("FAUCET_ENDPOINT must include a host.".to_string());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("FAUCET_ENDPOINT must not include a query string or fragment.".to_string());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn parse_birthday(value: &str) -> Result<u32, String> {
    let height: u32 = value
        .parse()
        .map_err(|_| "WALLET_BIRTHDAY_HEIGHT must be a positive block height.".to_string())?;
    if height == 0 {
        return Err("WALLET_BIRTHDAY_HEIGHT must be a positive block height.".to_string());
    }
    Ok(height)
}

pub fn require_testnet(network: &str) -> Result<(), String> {
    match Chain::parse(network) {
        Ok(Chain::Test) => Ok(()),
        Ok(Chain::Main) => Err(
            "WALLET_NETWORK must be testnet. This service rejects every other network.".to_string(),
        ),
        Err(error) => Err(error),
    }
}

pub fn parse_loopback(bind: &str) -> Result<SocketAddr, String> {
    let address: SocketAddr = bind
        .parse()
        .map_err(|_| format!("WALLET_API_BIND must be a socket address, for example 127.0.0.1:8787. Received {bind}."))?;
    if !is_loopback(address.ip()) {
        return Err("WALLET_API_BIND must use a loopback address.".to_string());
    }
    Ok(address)
}

fn is_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
}

fn required(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("Set {name} before starting the wallet service."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_testnet_mainnet_and_loopback() {
        assert_eq!(Chain::parse("testnet").unwrap(), Chain::Test);
        assert_eq!(Chain::parse("mainnet").unwrap(), Chain::Main);
        assert!(Chain::parse("main").is_err());
        assert!(Chain::parse("regtest").is_err());
        assert!(require_testnet("testnet").is_ok());
        assert!(require_testnet("mainnet").is_err());
        assert!(parse_loopback("127.0.0.1:8787").is_ok());
        assert!(parse_loopback("[::1]:8787").is_ok());
        assert!(parse_loopback("0.0.0.0:8787").is_err());
        assert!(parse_loopback("192.168.1.8:8787").is_err());
    }

    #[test]
    fn birthday_must_be_a_positive_height() {
        assert_eq!(parse_birthday("2500000"), Ok(2_500_000));
        assert!(parse_birthday("0").is_err());
        assert!(parse_birthday("-1").is_err());
        assert!(parse_birthday("birthday").is_err());
    }

    #[test]
    fn faucet_endpoint_must_be_plain_https() {
        assert_eq!(
            parse_faucet_endpoint("https://fauzec.com/"),
            Ok("https://fauzec.com".to_string())
        );
        assert_eq!(
            parse_faucet_endpoint("http://127.0.0.1:9898"),
            Ok("http://127.0.0.1:9898".to_string())
        );
        assert!(parse_faucet_endpoint("http://fauzec.com").is_err());
        assert!(parse_faucet_endpoint("ftp://fauzec.com").is_err());
        assert!(parse_faucet_endpoint("https://user:secret@fauzec.com").is_err());
        assert!(parse_faucet_endpoint("https://fauzec.com/?network=testnet").is_err());
        assert!(parse_faucet_endpoint("https://fauzec.com/#faq").is_err());
        assert!(parse_faucet_endpoint("fauzec.com").is_err());
        assert!(parse_faucet_endpoint("").is_err());
    }
}

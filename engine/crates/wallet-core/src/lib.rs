use api_types::{FailureCode, PaymentFailure, SyncState};

const ZATOSHIS_PER_ZEC: u64 = 100_000_000;
const BECH32: &str = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressPool {
    Sapling,
    Unified,
    Transparent,
}

pub fn classify_testnet_recipient(address: &str) -> Result<AddressPool, String> {
    if address.is_empty() || address.chars().any(char::is_whitespace) {
        return Err("Enter a testnet Zcash address.".to_string());
    }
    if address.starts_with("t1")
        || address.starts_with("t3")
        || address.starts_with("zs1")
        || address.starts_with("u1")
    {
        return Err("This is a mainnet address. This demo only accepts testnet recipients.".to_string());
    }
    if address.starts_with("tm") || address.starts_with("t2") {
        let body = &address[2..];
        if body.len() < 20 || !uses_charset(body, BASE58) {
            return Err("Transparent testnet address has invalid characters.".to_string());
        }
        return Ok(AddressPool::Transparent);
    }
    if let Some(body) = address.strip_prefix("ztestsapling") {
        if !body.starts_with('1') || body.len() < 21 || !uses_charset(&body[1..], BECH32) {
            return Err("Sapling testnet address has invalid characters.".to_string());
        }
        return Ok(AddressPool::Sapling);
    }
    if let Some(body) = address.strip_prefix("utest1") {
        if body.len() < 20 || !uses_charset(body, BECH32) {
            return Err("Unified testnet address has invalid characters.".to_string());
        }
        return Ok(AddressPool::Unified);
    }
    Err("Recipient is not a supported testnet address.".to_string())
}

pub fn classify_mainnet_recipient(address: &str) -> Result<AddressPool, String> {
    if address.is_empty() || address.chars().any(char::is_whitespace) {
        return Err("Enter a mainnet Zcash address.".to_string());
    }
    if address.starts_with("tm")
        || address.starts_with("t2")
        || address.starts_with("ztestsapling")
        || address.starts_with("utest1")
    {
        return Err("This is a testnet address. Mainnet payments refuse it.".to_string());
    }
    if address.starts_with("t1") || address.starts_with("t3") {
        let body = &address[2..];
        if body.len() < 20 || !uses_charset(body, BASE58) {
            return Err("Transparent mainnet address has invalid characters.".to_string());
        }
        return Ok(AddressPool::Transparent);
    }
    if let Some(body) = address.strip_prefix("zs1") {
        if body.len() < 20 || !uses_charset(body, BECH32) {
            return Err("Sapling mainnet address has invalid characters.".to_string());
        }
        return Ok(AddressPool::Sapling);
    }
    if let Some(body) = address.strip_prefix("u1") {
        if body.len() < 20 || !uses_charset(body, BECH32) {
            return Err("Unified mainnet address has invalid characters.".to_string());
        }
        return Ok(AddressPool::Unified);
    }
    Err("Recipient is not a supported mainnet address.".to_string())
}

pub fn is_shielded_pool(pool: AddressPool) -> bool {
    matches!(pool, AddressPool::Sapling | AddressPool::Unified)
}

pub fn parse_zec_to_zatoshis(input: &str) -> Result<u64, String> {
    let value = input.trim();
    let mut parts = value.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.chars().all(|character| character.is_ascii_digit())
        || !fraction.chars().all(|character| character.is_ascii_digit())
        || fraction.len() > 8
    {
        return Err("Enter a ZEC amount with at most 8 decimal places.".to_string());
    }
    let whole_value: u64 = whole
        .parse()
        .map_err(|_| "Enter a ZEC amount with at most 8 decimal places.".to_string())?;
    let padded = format!("{fraction:0<8}");
    let fraction_value: u64 = padded
        .parse()
        .map_err(|_| "Enter a ZEC amount with at most 8 decimal places.".to_string())?;
    let zatoshis = whole_value
        .checked_mul(ZATOSHIS_PER_ZEC)
        .and_then(|whole_zatoshis| whole_zatoshis.checked_add(fraction_value))
        .ok_or_else(|| "Enter a ZEC amount with at most 8 decimal places.".to_string())?;
    if zatoshis == 0 {
        return Err("Amount must be greater than zero.".to_string());
    }
    Ok(zatoshis)
}

pub struct PreflightInput<'a> {
    pub recipient: &'a str,
    pub amount_zec: Option<&'a str>,
    pub sync: SyncState,
    pub spendable_zatoshis: Option<u64>,
    pub fee_zatoshis: Option<u64>,
}

pub fn run_preflight(input: PreflightInput<'_>) -> Result<(u64, u64), PaymentFailure> {
    if classify_testnet_recipient(input.recipient.trim()).is_err() {
        return Err(failure(
            FailureCode::InvalidRequest,
            classify_testnet_recipient(input.recipient.trim()).unwrap_err(),
            "Correct the recipient or amount. Nothing was sent.",
        ));
    }
    let Some(amount_zec) = input.amount_zec.map(str::trim).filter(|amount| !amount.is_empty()) else {
        return Err(failure(
            FailureCode::InvalidRequest,
            "Enter an amount before preparing this payment.",
            "Add a ZEC amount. Nothing was sent.",
        ));
    };
    let amount = parse_zec_to_zatoshis(amount_zec).map_err(|reason| {
        failure(
            FailureCode::InvalidRequest,
            reason,
            "Correct the amount. Nothing was sent.",
        )
    })?;
    if input.sync == SyncState::Stale {
        return Err(failure(
            FailureCode::StaleWallet,
            "Wallet state is stale, so it cannot authorize a payment.",
            "Prepare the payment again after the wallet syncs. Nothing was sent.",
        ));
    }
    if input.sync != SyncState::Synced {
        return Err(failure(
            FailureCode::NotReady,
            "The wallet is not ready to send.",
            "Wait until synchronization finishes, then prepare the payment again.",
        ));
    }
    let (Some(spendable), Some(fee)) = (input.spendable_zatoshis, input.fee_zatoshis) else {
        return Err(failure(
            FailureCode::NotReady,
            "Spendable balance or fee is unverified.",
            "Prepare the payment again once the wallet reports both values.",
        ));
    };
    if amount.saturating_add(fee) > spendable {
        return Err(failure(
            FailureCode::InsufficientFunds,
            "Spendable balance does not cover the amount and fee.",
            "Lower the amount. Nothing was sent.",
        ));
    }
    Ok((amount, fee))
}

fn failure(code: FailureCode, message: impl Into<String>, recovery: impl Into<String>) -> PaymentFailure {
    PaymentFailure {
        code,
        message: message.into(),
        recovery: recovery.into(),
    }
}

fn uses_charset(value: &str, alphabet: &str) -> bool {
    value.chars().all(|character| alphabet.contains(character))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_testnet_pools_and_rejects_mainnet() {
        assert!(classify_testnet_recipient("zs1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq").is_err());
        assert!(classify_testnet_recipient("t1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").is_err());
        assert_eq!(
            classify_testnet_recipient("tm123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnop"),
            Ok(AddressPool::Transparent)
        );
        assert_eq!(
            classify_testnet_recipient("t2abcdefghijkmnopqrstuvwxyz123456789ABCDEFGHJKLMNP"),
            Ok(AddressPool::Transparent)
        );
        assert!(classify_testnet_recipient(&format!("ztestsapling1{}", "q".repeat(50))).is_ok());
        assert!(is_shielded_pool(AddressPool::Unified));
        assert!(!is_shielded_pool(AddressPool::Transparent));
    }

    #[test]
    fn parses_zec_amounts_without_inventing_precision() {
        assert_eq!(parse_zec_to_zatoshis("0.10").unwrap(), 10_000_000);
        assert!(parse_zec_to_zatoshis("0.000000001").is_err());
        assert!(parse_zec_to_zatoshis("0").is_err());
    }
}

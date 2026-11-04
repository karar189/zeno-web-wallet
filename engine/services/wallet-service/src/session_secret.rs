use std::fs;
use std::path::{Path, PathBuf};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce};
use rand::rand_core::UnwrapErr;
use rand::rngs::SysRng;
use rand::Rng;
use serde::{Deserialize, Serialize};

const PASSWORD_FILE: &str = "session-password.json";
pub(crate) const RECOVERY_FILE: &str = "recovery.txt";
pub(crate) const RECOVERY_ENC: &str = "recovery.enc";
const MIN_PASSWORD_LEN: usize = 8;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasswordFile {
    version: u32,
    kdf_salt: String,
    verifier: String,
}

pub(crate) fn password_paths_ready(data_dir: &Path) -> bool {
    data_dir.join(PASSWORD_FILE).is_file() && data_dir.join(RECOVERY_ENC).is_file()
}

pub(crate) fn assert_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err("Use a password of at least 8 characters.".to_string());
    }
    Ok(())
}

pub(crate) fn verify_password(data_dir: &Path, password: &str) -> Result<(), String> {
    let record = read_password_file(data_dir)?;
    let parsed = PasswordHash::new(&record.verifier)
        .map_err(|_| "The stored password check could not be read.".to_string())?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| "The password does not match this wallet.".to_string())
}

pub(crate) fn encrypt_phrase(data_dir: &Path, phrase: &str, password: &str) -> Result<(), String> {
    assert_password(password)?;
    let trimmed = phrase.trim();
    if trimmed.is_empty() {
        return Err("The recovery phrase is empty, so it was not encrypted.".to_string());
    }
    let kdf_salt = random_bytes(16);
    let verifier = password_verifier(password)?;
    let ciphertext = seal(password, &kdf_salt, trimmed.as_bytes())?;
    let record = PasswordFile {
        version: 1,
        kdf_salt: hex::encode(kdf_salt),
        verifier,
    };
    let encoded = serde_json::to_vec(&record).map_err(|error| error.to_string())?;
    atomic_write(&data_dir.join(PASSWORD_FILE), &encoded)?;
    atomic_write(&data_dir.join(RECOVERY_ENC), &ciphertext)?;
    remove_secret_file(&data_dir.join(RECOVERY_FILE))?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultRecord {
    pub version: u32,
    pub kdf_salt: String,
    pub ciphertext: String,
}

pub(crate) fn seal_vault(password: &str, phrase: &str) -> Result<VaultRecord, String> {
    assert_password(password)?;
    let trimmed = phrase.trim();
    if trimmed.is_empty() {
        return Err("The recovery phrase is empty, so it was not encrypted.".to_string());
    }
    let kdf_salt = random_bytes(16);
    let ciphertext = seal(password, &kdf_salt, trimmed.as_bytes())?;
    Ok(VaultRecord {
        version: 1,
        kdf_salt: hex::encode(kdf_salt),
        ciphertext: hex::encode(ciphertext),
    })
}

pub(crate) fn open_vault(password: &str, record: &VaultRecord) -> Result<String, String> {
    if record.version != 1 {
        return Err("This browser wallet record is not supported.".to_string());
    }
    let salt = hex::decode(record.kdf_salt.trim())
        .map_err(|_| "The wallet salt is not valid.".to_string())?;
    let packed = hex::decode(record.ciphertext.trim())
        .map_err(|_| "The wallet ciphertext is not valid.".to_string())?;
    let opened = open_seal(password, &salt, &packed)?;
    String::from_utf8(opened).map_err(|_| "The wallet ciphertext is not a phrase.".to_string())
}

pub(crate) fn decrypt_phrase(data_dir: &Path, password: &str) -> Result<String, String> {
    verify_password(data_dir, password)?;
    let record = read_password_file(data_dir)?;
    let salt = hex::decode(record.kdf_salt.trim())
        .map_err(|_| "The stored password salt is not valid.".to_string())?;
    let bytes = fs::read(data_dir.join(RECOVERY_ENC)).map_err(|error| {
        format!("Could not read the encrypted recovery file: {error}")
    })?;
    let opened = open_seal(password, &salt, &bytes)?;
    let phrase = String::from_utf8(opened)
        .map_err(|_| "The encrypted recovery file is not a phrase.".to_string())?;
    Ok(phrase)
}

fn password_verifier(password: &str) -> Result<String, String> {
    let mut salt_bytes = random_bytes(16);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|_| "Could not encode a password salt.".to_string())?;
    salt_bytes.fill(0);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|_| "Could not store the password check.".to_string())?;
    Ok(hash.to_string())
}

fn seal(password: &str, salt: &[u8], phrase: &[u8]) -> Result<Vec<u8>, String> {
    let key = derive_key(password, salt)?;
    let cipher = ChaCha20Poly1305::new((&key).into());
    let mut nonce_bytes = [0u8; 12];
    UnwrapErr(SysRng).fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(&nonce, Payload { msg: phrase, aad: b"emperor-wallet-v1" })
        .map_err(|_| "Could not encrypt the recovery phrase.".to_string())?;
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend(nonce_bytes);
    out.extend(ciphertext);
    Ok(out)
}

fn open_seal(password: &str, salt: &[u8], packed: &[u8]) -> Result<Vec<u8>, String> {
    if packed.len() < 13 {
        return Err("The encrypted recovery file is incomplete.".to_string());
    }
    let key = derive_key(password, salt)?;
    let cipher = ChaCha20Poly1305::new((&key).into());
    let nonce = Nonce::from(<[u8; 12]>::try_from(&packed[..12]).expect("nonce length"));
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &packed[12..],
                aad: b"emperor-wallet-v1",
            },
        )
        .map_err(|_| "The password does not match this wallet.".to_string())
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "Could not derive a recovery key.".to_string())?;
    Ok(key)
}

fn read_password_file(data_dir: &Path) -> Result<PasswordFile, String> {
    let bytes = fs::read(data_dir.join(PASSWORD_FILE))
        .map_err(|_| "This wallet has no password yet.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "The password record could not be read.".to_string())
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let temp = temp_path(path);
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|error| error.to_string())?;
        use std::io::Write;
        file.write_all(data).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }
    fs::rename(&temp, path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("secret");
    path.with_file_name(format!("{name}.tmp"))
}

pub(crate) fn remove_secret_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let len = fs::metadata(path).map(|meta| meta.len() as usize).unwrap_or(0);
    if len > 0 {
        let _ = fs::write(path, vec![0u8; len]);
    }
    fs::remove_file(path).map_err(|error| error.to_string())
}

fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    UnwrapErr(SysRng).fill_bytes(&mut bytes);
    bytes
}

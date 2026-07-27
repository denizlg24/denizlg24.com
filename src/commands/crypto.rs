const BLOB_VERSION: u8 = 1;

const VERSION_LEN: usize = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;

const HEADER_LEN: usize = VERSION_LEN + SALT_LEN + NONCE_LEN;

const KEY_LEN: usize = 32;
const KEY_BLOB_VERSION: u8 = 2;

const KEY_VERSION_LEN: usize = 1;
const KEY_NONCE_LEN: usize = 24;
const KEY_HEADER_LEN: usize = KEY_VERSION_LEN + KEY_NONCE_LEN;

const FILE_BLOB_VERSION: u8 = 3;
const FILE_SALT_LEN: usize = 16;
const FILE_NONCE_LEN: usize = 24;
const FILE_HEADER_LEN: usize = VERSION_LEN + FILE_SALT_LEN + FILE_NONCE_LEN;

use anyhow::{Result, bail};
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::rand_core::{OsRng, RngCore},
};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce, aead::Aead};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use std::fs;
use zeroize::Zeroize;

use crate::utils::manifest::{
    FileEncryption, FileEntry, ManagedFile, get_project_key, load_manifest, save_manifest,
};
use crate::utils::paths::validate_project_path;

pub fn encrypt_bytes(plaintext: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    let mut pass = passphrase.as_bytes().to_vec();

    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);

    let argon2 = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19456, 2, 1, Some(32))
            .map_err(|e| anyhow::anyhow!("Failed to create Argon2 params: {}", e))?,
    );

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(&pass, &salt, &mut key)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?;

    let cipher = XChaCha20Poly1305::new(&key.into());

    let mut nonce_bytes = [0u8; 24];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("Encryption failed {}", e))?;

    let mut output = Vec::with_capacity(HEADER_LEN + ciphertext.len());

    output.push(BLOB_VERSION);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    pass.zeroize();
    key.zeroize();

    Ok(output)
}

pub fn decrypt_bytes(encrypted_data: &[u8], passphrase: &str) -> Result<Vec<u8>> {
    let mut pass = passphrase.as_bytes().to_vec();

    if encrypted_data.len() < HEADER_LEN {
        bail!("Invalid encrypted data: file is too short or corrupted");
    }

    let version = encrypted_data[0];

    if version != BLOB_VERSION {
        bail!(
            "Unsupported encryption format (version {}). Please update envy.",
            version
        );
    }

    let salt_start = VERSION_LEN;
    let nonce_start = salt_start + SALT_LEN;
    let ciphertext_start = nonce_start + NONCE_LEN;

    let salt = &encrypted_data[salt_start..nonce_start];
    let nonce_bytes = &encrypted_data[nonce_start..ciphertext_start];
    let ciphertext = &encrypted_data[ciphertext_start..];

    let argon2 = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19456, 2, 1, Some(32))
            .map_err(|e| anyhow::anyhow!("Failed to initialize encryption: {}", e))?,
    );

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(&pass, salt, &mut key)
        .map_err(|e| anyhow::anyhow!("Failed to derive encryption key: {}", e))?;

    let cipher = XChaCha20Poly1305::new(&key.into());
    let nonce = XNonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("Decryption failed: wrong passphrase or corrupted data"))?;

    pass.zeroize();
    key.zeroize();

    Ok(plaintext)
}

pub fn encrypt_file(path: &str, passphrase: &str) -> Result<()> {
    let mut manifest = load_manifest()?;

    let normalized_path = validate_project_path(path)?;

    let plaintext =
        fs::read(path).map_err(|e| anyhow::anyhow!("Failed to read file '{}': {}", path, e))?;

    let output = encrypt_bytes(&plaintext, passphrase)?;

    let mut hasher = Sha256::new();
    hasher.update(&output);
    let hash = hasher.finalize();

    let hash_hex = hex::encode(hash);

    let filename = format!(".envoy/cache/{}.blob", hash_hex);
    fs::write(&filename, &output)
        .map_err(|e| anyhow::anyhow!("Failed to write encrypted blob: {}", e))?;

    manifest
        .files
        .insert(normalized_path, FileEntry::Legacy(hash_hex));
    save_manifest(&manifest)?;

    Ok(())
}

pub fn add_file(path: &str) -> Result<()> {
    let mut manifest = load_manifest()?;
    let normalized_path = validate_project_path(path)?;
    let plaintext =
        fs::read(path).map_err(|e| anyhow::anyhow!("Failed to read file '{}': {}", path, e))?;
    let project_key = get_project_key()?;
    let encrypted = encrypt_file_bytes(&plaintext, &project_key)?;

    let blob_hash = hex::encode(Sha256::digest(&encrypted));
    let content_hash = hex::encode(Sha256::digest(&plaintext));
    let filename = format!(".envoy/cache/{}.blob", blob_hash);
    fs::write(&filename, encrypted)
        .map_err(|e| anyhow::anyhow!("Failed to write encrypted blob: {}", e))?;

    let existing_members = manifest
        .files
        .get(&normalized_path)
        .and_then(FileEntry::members)
        .cloned()
        .unwrap_or(None);

    manifest.upgrade();
    manifest.files.insert(
        normalized_path,
        FileEntry::Managed(ManagedFile {
            blob_hash,
            content_hash,
            encryption: FileEncryption::ProjectKey,
            members: existing_members,
        }),
    );
    save_manifest(&manifest)?;

    Ok(())
}

pub fn decrypt_files(passphrase: &str) -> Result<()> {
    let manifest = load_manifest()?;
    for (filename, entry) in manifest.files {
        let blob_hash = entry.blob_hash();
        let path = format!(".envoy/cache/{}.blob", blob_hash);
        let encrypted = fs::read(&path)?;

        let expected_hash = blob_hash;

        let mut hasher = Sha256::new();
        hasher.update(&encrypted);

        let computed_hash = hex::encode(hasher.finalize());

        if computed_hash != expected_hash {
            bail!("Encrypted blob integrity check failed (hash mismatch)");
        }

        let plaintext = match entry {
            FileEntry::Legacy(_) => decrypt_bytes(&encrypted, passphrase)?,
            FileEntry::Managed(_) => {
                let project_key = get_project_key()?;
                decrypt_file_bytes(&encrypted, &project_key)?
            }
        };

        fs::write(&filename, plaintext)?;
    }
    Ok(())
}

pub fn decrypt_bytes_with_key(encrypted_data: &[u8], manifest_key: &[u8]) -> Result<Vec<u8>> {
    if manifest_key.len() != KEY_LEN {
        bail!("Invalid encryption key length");
    }

    if encrypted_data.len() < KEY_HEADER_LEN {
        bail!("Invalid encrypted data: too short or corrupted");
    }

    let version = encrypted_data[0];
    if version != KEY_BLOB_VERSION {
        bail!(
            "Unsupported encryption format (version {}). Please update envy.",
            version
        );
    }

    let nonce_start = KEY_VERSION_LEN;
    let ciphertext_start = nonce_start + KEY_NONCE_LEN;

    let nonce_bytes = &encrypted_data[nonce_start..ciphertext_start];
    let ciphertext = &encrypted_data[ciphertext_start..];

    let cipher = XChaCha20Poly1305::new(manifest_key.into());
    let nonce = XNonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("Decryption failed: wrong passphrase or corrupted data"))?;

    Ok(plaintext)
}

pub fn encrypt_bytes_with_key(plaintext: &[u8], manifest_key: &[u8]) -> Result<Vec<u8>> {
    if manifest_key.len() != KEY_LEN {
        bail!("Invalid manifest key length");
    }

    let cipher = XChaCha20Poly1305::new(manifest_key.into());

    let mut nonce_bytes = [0u8; KEY_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    let mut output = Vec::with_capacity(KEY_HEADER_LEN + ciphertext.len());

    output.push(KEY_BLOB_VERSION);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(output)
}

pub fn encrypt_file_bytes(plaintext: &[u8], project_key: &[u8]) -> Result<Vec<u8>> {
    if project_key.len() != KEY_LEN {
        bail!("Invalid project key length");
    }

    let mut salt = [0_u8; FILE_SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let mut file_key = [0_u8; KEY_LEN];
    Hkdf::<Sha256>::new(Some(&salt), project_key)
        .expand(b"envoy-file-key-v1", &mut file_key)
        .map_err(|_| anyhow::anyhow!("Failed to derive file encryption key"))?;

    let cipher = XChaCha20Poly1305::new(&file_key.into());
    let mut nonce_bytes = [0_u8; FILE_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|error| anyhow::anyhow!("File encryption failed: {}", error))?;

    let mut output = Vec::with_capacity(FILE_HEADER_LEN + ciphertext.len());
    output.push(FILE_BLOB_VERSION);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    file_key.zeroize();
    Ok(output)
}

pub fn decrypt_file_bytes(encrypted_data: &[u8], project_key: &[u8]) -> Result<Vec<u8>> {
    if project_key.len() != KEY_LEN {
        bail!("Invalid project key length");
    }
    if encrypted_data.len() < FILE_HEADER_LEN {
        bail!("Invalid encrypted file: too short or corrupted");
    }
    if encrypted_data[0] != FILE_BLOB_VERSION {
        bail!(
            "Unsupported managed file encryption format (version {})",
            encrypted_data[0]
        );
    }

    let salt_start = VERSION_LEN;
    let nonce_start = salt_start + FILE_SALT_LEN;
    let ciphertext_start = nonce_start + FILE_NONCE_LEN;
    let salt = &encrypted_data[salt_start..nonce_start];
    let nonce = &encrypted_data[nonce_start..ciphertext_start];
    let ciphertext = &encrypted_data[ciphertext_start..];

    let mut file_key = [0_u8; KEY_LEN];
    Hkdf::<Sha256>::new(Some(salt), project_key)
        .expand(b"envoy-file-key-v1", &mut file_key)
        .map_err(|_| anyhow::anyhow!("Failed to derive file decryption key"))?;
    let cipher = XChaCha20Poly1305::new(&file_key.into());
    let plaintext = cipher
        .decrypt(XNonce::from_slice(nonce), ciphertext)
        .map_err(|_| anyhow::anyhow!("File decryption failed: wrong key or corrupted data"))?;
    file_key.zeroize();
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_encryption_round_trips_and_rejects_wrong_passphrase() {
        let encrypted = encrypt_bytes(b"API_KEY=secret", "correct horse").unwrap();

        assert_eq!(
            decrypt_bytes(&encrypted, "correct horse").unwrap(),
            b"API_KEY=secret"
        );
        assert!(decrypt_bytes(&encrypted, "wrong passphrase").is_err());
    }

    #[test]
    fn project_key_encryption_round_trips_and_rejects_wrong_key() {
        let key = [7_u8; KEY_LEN];
        let encrypted = encrypt_bytes_with_key(b"DATABASE_URL=secret", &key).unwrap();

        assert_eq!(
            decrypt_bytes_with_key(&encrypted, &key).unwrap(),
            b"DATABASE_URL=secret"
        );
        assert!(decrypt_bytes_with_key(&encrypted, &[8_u8; KEY_LEN]).is_err());
    }

    #[test]
    fn encrypted_formats_remain_distinguishable() {
        let legacy = encrypt_bytes(b"secret", "passphrase").unwrap();
        let managed = encrypt_bytes_with_key(b"secret", &[1_u8; KEY_LEN]).unwrap();
        let file = encrypt_file_bytes(b"secret", &[1_u8; KEY_LEN]).unwrap();

        assert_eq!(legacy[0], BLOB_VERSION);
        assert_eq!(managed[0], KEY_BLOB_VERSION);
        assert_eq!(file[0], FILE_BLOB_VERSION);
    }

    #[test]
    fn derived_file_keys_round_trip_and_use_unique_salts() {
        let key = [4_u8; KEY_LEN];
        let first = encrypt_file_bytes(b"SECRET=value", &key).unwrap();
        let second = encrypt_file_bytes(b"SECRET=value", &key).unwrap();

        assert_ne!(first, second);
        assert_eq!(decrypt_file_bytes(&first, &key).unwrap(), b"SECRET=value");
        assert!(decrypt_file_bytes(&first, &[5_u8; KEY_LEN]).is_err());
    }
}

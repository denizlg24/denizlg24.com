use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

pub const LEGACY_MANIFEST_VERSION: u8 = 1;
pub const MANIFEST_VERSION: u8 = 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileEncryption {
    ProjectKey,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ManagedFile {
    pub blob_hash: String,
    pub content_hash: String,
    pub encryption: FileEncryption,
    /// None means every project member (legacy-compatible). Some restricts
    /// remote downloads to the owner plus the listed member IDs; an empty list
    /// is therefore owner-only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<String>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FileEntry {
    /// Manifest v1 value: a blob encrypted with an independent file passphrase.
    Legacy(String),
    /// Manifest v2 value: a blob encrypted with the single project key.
    Managed(ManagedFile),
}

impl FileEntry {
    pub fn blob_hash(&self) -> &str {
        match self {
            Self::Legacy(hash) => hash,
            Self::Managed(file) => &file.blob_hash,
        }
    }

    pub fn content_hash(&self) -> Option<&str> {
        match self {
            Self::Legacy(_) => None,
            Self::Managed(file) => Some(&file.content_hash),
        }
    }

    pub fn members(&self) -> Option<&Option<Vec<String>>> {
        match self {
            Self::Legacy(_) => None,
            Self::Managed(file) => Some(&file.members),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u8,
    pub files: BTreeMap<String, FileEntry>,
}

impl Default for Manifest {
    fn default() -> Self {
        Self::new()
    }
}

impl Manifest {
    pub fn new() -> Self {
        Self {
            version: MANIFEST_VERSION,
            files: BTreeMap::new(),
        }
    }

    pub fn upgrade(&mut self) {
        self.version = MANIFEST_VERSION;
    }
}
use crate::{
    commands::crypto::{decrypt_bytes_with_key, encrypt_bytes_with_key},
    utils::{
        project_config::load_project_config,
        session::{clear_session, derive_manifest_key_from_passphrase, load_session, save_session},
        ui::{is_interactive, print_error, prompt_passphrase},
    },
};
use anyhow::{Result, bail};
use hex;
use sha2::{Digest, Sha256};
use std::fs;

pub fn save_manifest(manifest: &Manifest) -> Result<String> {
    let plaintext = serde_json::to_vec(manifest)
        .map_err(|e| anyhow::anyhow!("Failed to serialize manifest: {}", e))?;

    let manifest_key = get_project_key()?;

    let encrypted = encrypt_bytes_with_key(&plaintext, &manifest_key)?;

    let mut hasher = Sha256::new();
    hasher.update(&encrypted);
    let hash_hex = hex::encode(hasher.finalize());

    let path = format!(".envoy/cache/{}.blob", hash_hex);
    fs::write(&path, encrypted)
        .map_err(|e| anyhow::anyhow!("Failed to write manifest blob: {}", e))?;

    fs::write(".envoy/latest", &hash_hex)
        .map_err(|e| anyhow::anyhow!("Failed to update latest manifest reference: {}", e))?;

    Ok(hash_hex)
}

pub fn load_manifest() -> Result<Manifest> {
    if !std::path::Path::new(".envoy/latest").exists() {
        return Ok(Manifest::new());
    }

    let hash = fs::read_to_string(".envoy/latest")
        .map_err(|e| anyhow::anyhow!("Failed to read manifest reference: {}", e))?;
    let path = format!(".envoy/cache/{}.blob", hash.trim());

    if !std::path::Path::new(&path).exists() {
        return Ok(Manifest::new());
    }

    let project = load_project_config()?;
    let manifest_key = get_project_key()?;

    let encrypted =
        fs::read(&path).map_err(|e| anyhow::anyhow!("Failed to read manifest blob: {}", e))?;

    let plaintext = match decrypt_bytes_with_key(&encrypted, &manifest_key) {
        Ok(plain) => plain,
        Err(_) => {
            clear_session(&project.project_id)?;
            bail!("Failed to decrypt manifest. The passphrase may be incorrect.");
        }
    };

    let manifest: Manifest = serde_json::from_slice(&plaintext)
        .map_err(|e| anyhow::anyhow!("Failed to parse manifest: {}", e))?;

    if !matches!(manifest.version, LEGACY_MANIFEST_VERSION | MANIFEST_VERSION) {
        bail!(
            "Unsupported manifest version {}. Please update envy.",
            manifest.version
        );
    }

    Ok(manifest)
}

pub fn load_manifest_by_hash(hash: &str) -> Result<Manifest> {
    let project = load_project_config()?;
    let manifest_key = get_project_key()?;

    let path = format!(".envoy/cache/{}.blob", hash.trim());

    if !std::path::Path::new(&path).exists() {
        bail!(
            "Manifest blob {} not found in cache. Run `envy pull` to fetch it.",
            &hash[..12]
        );
    }

    let encrypted = fs::read(&path)
        .map_err(|e| anyhow::anyhow!("Failed to read manifest blob {}: {}", &hash[..12], e))?;

    let plaintext = match decrypt_bytes_with_key(&encrypted, &manifest_key) {
        Ok(plain) => plain,
        Err(_) => {
            clear_session(&project.project_id)?;
            bail!(
                "Failed to decrypt manifest {}. The passphrase may be incorrect.",
                &hash[..12]
            );
        }
    };

    let manifest: Manifest = serde_json::from_slice(&plaintext)
        .map_err(|e| anyhow::anyhow!("Failed to parse manifest {}: {}", &hash[..12], e))?;

    if !matches!(manifest.version, LEGACY_MANIFEST_VERSION | MANIFEST_VERSION) {
        bail!(
            "Unsupported manifest version {}. Please update envy.",
            manifest.version
        );
    }

    Ok(manifest)
}

const APPLIED_PATH: &str = ".envoy/cache/applied";

pub fn read_applied() -> Option<String> {
    fs::read_to_string(APPLIED_PATH)
        .ok()
        .map(|s| s.trim().to_string())
}

pub fn write_applied(hash: &str) -> anyhow::Result<()> {
    if let Some(parent) = Path::new(APPLIED_PATH).parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(APPLIED_PATH, hash)?;
    Ok(())
}

pub fn set_manifest(manifest_hash: &str) -> anyhow::Result<()> {
    fs::write(".envoy/latest", manifest_hash)?;
    Ok(())
}

pub fn get_current_manifest_hash() -> Option<String> {
    fs::read_to_string(".envoy/latest")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn compute_manifest_content_hash(manifest: &Manifest) -> String {
    let plaintext = serde_json::to_vec(manifest).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&plaintext);
    hex::encode(hasher.finalize())
}

/// Local encrypted blobs the project key can be checked against: the current
/// manifest and the HEAD commit. Empty on a fresh project or fresh clone.
fn verification_blobs() -> Vec<Vec<u8>> {
    let mut blobs = Vec::new();

    if let Some(hash) = get_current_manifest_hash()
        && let Ok(bytes) = fs::read(format!(".envoy/cache/{}.blob", hash))
    {
        blobs.push(bytes);
    }

    if let Some(head) = crate::utils::commit::read_head()
        && let Ok(bytes) = fs::read(format!(".envoy/cache/commits/{}.blob", head))
    {
        blobs.push(bytes);
    }

    blobs
}

fn key_matches_local_data(key: &[u8], blobs: &[Vec<u8>]) -> bool {
    // Nothing to verify against (fresh project/clone): accept, later decrypt
    // failures will clear the session.
    blobs.is_empty()
        || blobs
            .iter()
            .any(|blob| decrypt_bytes_with_key(blob, key).is_ok())
}

pub fn get_project_key() -> Result<Vec<u8>> {
    use crate::utils::session::take_passphrase_override;

    let project = load_project_config()?;

    if let Some(session) = load_session(&project.project_id)? {
        // Keys only enter the session store after verification; refresh the TTL.
        save_session(&project.project_id, &session.manifest_key)?;
        return Ok(session.manifest_key);
    }

    let blobs = verification_blobs();

    if let Some(passphrase) = take_passphrase_override() {
        let key = derive_manifest_key_from_passphrase(&passphrase, &project.project_id)?;
        if !key_matches_local_data(&key, &blobs) {
            bail!("Incorrect passphrase.");
        }
        save_session(&project.project_id, &key)?;
        return Ok(key);
    }

    let attempts = if is_interactive() { 3 } else { 1 };
    for attempt in 1..=attempts {
        let passphrase = match prompt_passphrase("Project passphrase", 6) {
            Ok(pass) => pass,
            Err(e) => {
                print_error(&format!("Failed to read passphrase: {}", e));
                std::process::exit(1);
            }
        };
        println!();

        let key = derive_manifest_key_from_passphrase(&passphrase, &project.project_id)?;
        if key_matches_local_data(&key, &blobs) {
            save_session(&project.project_id, &key)?;
            return Ok(key);
        }

        if attempt < attempts {
            print_error("Incorrect passphrase, try again.");
        }
    }

    bail!("Incorrect passphrase.")
}

const PENDING_RESTORE_PATH: &str = ".envoy/cache/pending_restore";

/// Files from a pull that could not be restored (skipped or wrong passphrase),
/// recorded against the manifest they belong to so the next pull retries them.
#[derive(Serialize, Deserialize)]
pub struct PendingRestore {
    pub manifest_hash: String,
    pub files: Vec<String>,
}

pub fn read_pending_restore() -> Option<PendingRestore> {
    let data = fs::read(PENDING_RESTORE_PATH).ok()?;
    serde_json::from_slice::<PendingRestore>(&data)
        .ok()
        .filter(|pending| !pending.files.is_empty())
}

pub fn write_pending_restore(manifest_hash: &str, files: &[String]) -> Result<()> {
    let pending = PendingRestore {
        manifest_hash: manifest_hash.to_string(),
        files: files.to_vec(),
    };

    if let Some(parent) = Path::new(PENDING_RESTORE_PATH).parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(PENDING_RESTORE_PATH, serde_json::to_vec_pretty(&pending)?)?;
    Ok(())
}

pub fn clear_pending_restore() {
    let _ = fs::remove_file(PENDING_RESTORE_PATH);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_legacy_manifest_values() {
        let manifest: Manifest =
            serde_json::from_str(r#"{"version":1,"files":{".env":"0123456789abcdef"}}"#).unwrap();

        assert_eq!(manifest.version, LEGACY_MANIFEST_VERSION);
        assert_eq!(
            manifest.files.get(".env"),
            Some(&FileEntry::Legacy("0123456789abcdef".to_string()))
        );
    }

    #[test]
    fn managed_manifest_round_trips_and_is_canonical() {
        let mut first = Manifest::new();
        first.files.insert(
            "z.env".to_string(),
            FileEntry::Managed(ManagedFile {
                blob_hash: "blob-z".to_string(),
                content_hash: "content-z".to_string(),
                encryption: FileEncryption::ProjectKey,
                members: Some(vec!["member-1".to_string()]),
            }),
        );
        first.files.insert(
            "a.env".to_string(),
            FileEntry::Managed(ManagedFile {
                blob_hash: "blob-a".to_string(),
                content_hash: "content-a".to_string(),
                encryption: FileEncryption::ProjectKey,
                members: None,
            }),
        );

        let encoded = serde_json::to_string(&first).unwrap();
        let decoded: Manifest = serde_json::from_str(&encoded).unwrap();

        assert_eq!(decoded, first);
        assert!(encoded.find("a.env").unwrap() < encoded.find("z.env").unwrap());
        assert_eq!(
            compute_manifest_content_hash(&first),
            compute_manifest_content_hash(&decoded)
        );
    }
}

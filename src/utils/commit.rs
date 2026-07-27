use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

use crate::commands::crypto::{decrypt_bytes_with_key, encrypt_bytes_with_key};

use super::manifest::get_project_key;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commit {
    pub version: u8,
    pub parent: Option<String>,
    pub timestamp: u64,
    pub message: String,
    pub manifest_hash: String,
    pub author: Option<String>,
}

impl Commit {
    pub fn new(
        parent: Option<String>,
        message: String,
        manifest_hash: String,
        author: Option<String>,
    ) -> Self {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            version: 1,
            parent,
            timestamp,
            message,
            manifest_hash,
            author,
        }
    }
}

const COMMITS_DIR: &str = ".envoy/cache/commits";
const HEAD_PATH: &str = ".envoy/HEAD";
const REMOTE_HEAD_PATH: &str = ".envoy/refs/remotes/origin/HEAD";

pub fn read_head() -> Option<String> {
    fs::read_to_string(HEAD_PATH)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn write_head(commit_hash: &str) -> Result<()> {
    if let Some(parent) = Path::new(HEAD_PATH).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(HEAD_PATH, commit_hash)?;
    Ok(())
}

pub fn read_remote_head() -> Option<String> {
    fs::read_to_string(REMOTE_HEAD_PATH)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn write_remote_head(commit_hash: &str) -> Result<()> {
    if let Some(parent) = Path::new(REMOTE_HEAD_PATH).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(REMOTE_HEAD_PATH, commit_hash)?;
    Ok(())
}

pub fn save_commit(commit: &Commit) -> Result<String> {
    let manifest_key = get_project_key()?;

    let plaintext = serde_json::to_vec(commit)
        .map_err(|e| anyhow::anyhow!("Failed to serialize commit: {}", e))?;

    let encrypted = encrypt_bytes_with_key(&plaintext, &manifest_key)?;

    let mut hasher = Sha256::new();
    hasher.update(&encrypted);
    let hash_hex = hex::encode(hasher.finalize());

    fs::create_dir_all(COMMITS_DIR)
        .map_err(|e| anyhow::anyhow!("Failed to create commits directory: {}", e))?;

    let path = format!("{}/{}.blob", COMMITS_DIR, hash_hex);
    fs::write(&path, encrypted)
        .map_err(|e| anyhow::anyhow!("Failed to write commit {}: {}", &hash_hex[..8], e))?;

    Ok(hash_hex)
}

pub fn save_commit_blob(commit_hash: &str, encrypted_data: &[u8]) -> Result<()> {
    fs::create_dir_all(COMMITS_DIR)?;
    let path = format!("{}/{}.blob", COMMITS_DIR, commit_hash);
    fs::write(&path, encrypted_data)?;
    Ok(())
}

pub fn load_commit(commit_hash: &str) -> Result<Commit> {
    let manifest_key = get_project_key()?;

    let path = format!("{}/{}.blob", COMMITS_DIR, commit_hash);

    if !Path::new(&path).exists() {
        bail!(
            "Commit {} not found locally. Run `envy pull` to fetch it.",
            &commit_hash[..8]
        );
    }

    let encrypted = fs::read(&path)
        .map_err(|e| anyhow::anyhow!("Failed to read commit {}: {}", &commit_hash[..8], e))?;

    let plaintext = match decrypt_bytes_with_key(&encrypted, &manifest_key) {
        Ok(plain) => plain,
        Err(_) => {
            if let Ok(project) = crate::utils::project_config::load_project_config() {
                let _ = crate::utils::session::clear_session(&project.project_id);
            }
            bail!(
                "Failed to decrypt commit {}. The passphrase may be incorrect.",
                &commit_hash[..8]
            );
        }
    };

    let commit: Commit = serde_json::from_slice(&plaintext)
        .map_err(|e| anyhow::anyhow!("Failed to parse commit {}: {}", &commit_hash[..8], e))?;

    if commit.version != 1 {
        bail!(
            "Unsupported commit version {}. Please update envy.",
            commit.version
        );
    }

    Ok(commit)
}

pub fn commit_exists(commit_hash: &str) -> bool {
    let path = format!("{}/{}.blob", COMMITS_DIR, commit_hash);
    Path::new(&path).exists()
}

pub fn commit_blob_path(commit_hash: &str) -> std::path::PathBuf {
    Path::new(COMMITS_DIR).join(format!("{}.blob", commit_hash))
}

pub fn walk_history(start_hash: &str, limit: Option<usize>) -> Result<Vec<(String, Commit)>> {
    let mut history = Vec::new();
    let mut current = Some(start_hash.to_string());
    let mut count = 0;

    while let Some(hash) = current {
        if let Some(max) = limit
            && count >= max
        {
            break;
        }

        let commit = load_commit(&hash)?;
        current = commit.parent.clone();
        history.push((hash, commit));
        count += 1;
    }

    Ok(history)
}

pub fn commits_ahead_of_remote() -> Result<Vec<String>> {
    let local_head = match read_head() {
        Some(h) => h,
        None => return Ok(vec![]),
    };

    let remote_head = read_remote_head();

    let mut commits_to_push = Vec::new();
    let mut current = Some(local_head);

    while let Some(hash) = current {
        if Some(&hash) == remote_head.as_ref() {
            break;
        }

        commits_to_push.push(hash.clone());

        if let Ok(commit) = load_commit(&hash) {
            current = commit.parent;
        } else {
            break;
        }
    }

    Ok(commits_to_push)
}

pub fn find_common_ancestor(local_head: &str, remote_head: &str) -> Result<Option<String>> {
    let mut local_ancestors = std::collections::HashSet::new();
    let mut current = Some(local_head.to_string());

    while let Some(hash) = current {
        local_ancestors.insert(hash.clone());
        if let Ok(commit) = load_commit(&hash) {
            current = commit.parent;
        } else {
            break;
        }
    }

    let mut current = Some(remote_head.to_string());
    while let Some(hash) = current {
        if local_ancestors.contains(&hash) {
            return Ok(Some(hash));
        }
        if let Ok(commit) = load_commit(&hash) {
            current = commit.parent;
        } else {
            break;
        }
    }

    Ok(None)
}

pub fn get_head_manifest_hash() -> Option<String> {
    let head = read_head()?;
    let commit = load_commit(&head).ok()?;
    Some(commit.manifest_hash)
}

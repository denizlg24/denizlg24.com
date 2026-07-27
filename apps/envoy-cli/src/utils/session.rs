use anyhow::bail;
use argon2::password_hash::rand_core::RngCore;
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::OsRng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use once_cell::sync::OnceCell;

use super::paths::envoy_home_dir;

static SESSION_KEY: OnceCell<[u8; 32]> = OnceCell::new();
static PASSPHRASE_OVERRIDE: OnceCell<Mutex<Option<String>>> = OnceCell::new();

pub fn set_passphrase_override(passphrase: Option<String>) {
    let mutex = PASSPHRASE_OVERRIDE.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().unwrap();
    *guard = passphrase;
}

pub fn take_passphrase_override() -> Option<String> {
    let mutex = PASSPHRASE_OVERRIDE.get_or_init(|| Mutex::new(None));
    let mut guard = mutex.lock().unwrap();
    guard.take()
}

pub fn clear_passphrase_override() {
    set_passphrase_override(None);
}

fn session_key_path() -> PathBuf {
    let mut path = envoy_home_dir().expect("Envoy home dir");
    path.push(".session_key");
    path
}

fn get_or_init_session_key() -> &'static [u8; 32] {
    SESSION_KEY.get_or_init(|| {
        let path = session_key_path();

        if path.exists()
            && let Ok(data) = fs::read(&path)
            && data.len() == 32
        {
            let mut key = [0u8; 32];
            key.copy_from_slice(&data);
            return key;
        }

        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);

        if let Some(parent) = path.parent()
            && let Err(e) = fs::create_dir_all(parent)
        {
            eprintln!("Warning: Failed to create session directory: {}", e);
        }

        if let Err(e) = fs::write(&path, key) {
            eprintln!("Warning: Failed to persist session key: {}", e);
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }

        key
    })
}

const SESSION_TTL_SECS: u64 = 15 * 60;

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub project_id: String,
    #[serde(alias = "encrypted_manifest_key")]
    pub manifest_key: Vec<u8>,
    pub expires_at: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct SessionStore {
    sessions: HashMap<String, Session>,
}

fn session_path() -> PathBuf {
    let mut path = envoy_home_dir().expect("Envoy home dir");
    path.push("sessions.json");
    path
}

fn lock_session_store() -> anyhow::Result<std::fs::File> {
    let mut path = envoy_home_dir()?;
    fs::create_dir_all(&path)?;
    path.push("sessions.lock");
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)?;
    file.lock_exclusive()?;
    Ok(file)
}

fn load_store() -> anyhow::Result<SessionStore> {
    let path = session_path();
    if !path.exists() {
        return Ok(SessionStore::default());
    }

    let data = fs::read(&path)?;
    let store: SessionStore = serde_json::from_slice(&data)?;
    Ok(store)
}

fn save_store(store: &SessionStore) -> anyhow::Result<()> {
    let path = session_path();
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Invalid session store path"))?;
    fs::create_dir_all(parent)?;

    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(&serde_json::to_vec_pretty(store)?)?;
    temporary.as_file().sync_all()?;
    temporary.persist(&path).map_err(|error| error.error)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

pub fn clear_session(project_id: &str) -> anyhow::Result<()> {
    let lock = lock_session_store()?;
    let mut store = load_store()?;
    store.sessions.remove(project_id);
    let result = save_store(&store);
    FileExt::unlock(&lock)?;
    result
}

pub fn load_session(project_id: &str) -> anyhow::Result<Option<Session>> {
    let lock = lock_session_store()?;
    let mut store = load_store()?;

    if let Some(session) = store.sessions.get(project_id) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();

        if session.expires_at < now || session.project_id != project_id {
            store.sessions.remove(project_id);
            save_store(&store)?;
            FileExt::unlock(&lock)?;
            return Ok(None);
        }

        let key = match decrypt_manifest_key(
            &session.manifest_key,
            &session.project_id,
            session.expires_at,
        ) {
            Ok(key) => key,
            Err(_) => {
                // Session key rotated or blob corrupted — drop it and re-prompt.
                store.sessions.remove(project_id);
                save_store(&store)?;
                FileExt::unlock(&lock)?;
                return Ok(None);
            }
        };

        let final_session = Session {
            project_id: project_id.to_string(),
            manifest_key: key,
            expires_at: session.expires_at,
        };

        FileExt::unlock(&lock)?;
        Ok(Some(final_session))
    } else {
        FileExt::unlock(&lock)?;
        Ok(None)
    }
}

pub fn save_session(project_id: &str, manifest_key: &[u8]) -> anyhow::Result<()> {
    let lock = lock_session_store()?;
    let mut store = load_store()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    store
        .sessions
        .retain(|_, session| session.expires_at >= now);
    let expires_at = now + SESSION_TTL_SECS;

    let encrypted_key = encrypt_manifest_key(manifest_key, project_id, expires_at)?;

    let session = Session {
        project_id: project_id.to_string(),
        manifest_key: encrypted_key,
        expires_at,
    };

    store.sessions.insert(project_id.to_string(), session);
    let result = save_store(&store);
    FileExt::unlock(&lock)?;
    result
}

use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};

const SESSION_BLOB_VERSION: u8 = 1;
const SESSION_VERSION_LEN: usize = 1;
const SESSION_NONCE_LEN: usize = 24;
const SESSION_HEADER_LEN: usize = SESSION_VERSION_LEN + SESSION_NONCE_LEN;

fn encrypt_manifest_key(
    manifest_key: &[u8],
    project_id: &str,
    expires_at: u64,
) -> anyhow::Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new(get_or_init_session_key().into());

    let mut nonce = [0u8; SESSION_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let aad = format!("{}:{}", project_id, expires_at);

    let ciphertext = match cipher.encrypt(
        XNonce::from_slice(&nonce),
        Payload {
            msg: manifest_key,
            aad: aad.as_bytes(),
        },
    ) {
        Ok(cipher) => cipher,
        Err(error) => bail!(error),
    };

    let mut out = Vec::with_capacity(SESSION_HEADER_LEN + ciphertext.len());
    out.push(SESSION_BLOB_VERSION);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);

    Ok(out)
}

fn decrypt_manifest_key(
    encrypted: &[u8],
    project_id: &str,
    expires_at: u64,
) -> anyhow::Result<Vec<u8>> {
    if encrypted.len() < SESSION_HEADER_LEN {
        anyhow::bail!("Invalid session blob: too short");
    }

    let version = encrypted[0];
    if version != SESSION_BLOB_VERSION {
        anyhow::bail!("Unsupported session blob version: {}", version);
    }

    let nonce_start = SESSION_VERSION_LEN;
    let ciphertext_start = nonce_start + SESSION_NONCE_LEN;

    let nonce = &encrypted[nonce_start..ciphertext_start];
    let ciphertext = &encrypted[ciphertext_start..];

    let cipher = XChaCha20Poly1305::new(get_or_init_session_key().into());

    let aad = format!("{}:{}", project_id, expires_at);

    let plaintext = match cipher.decrypt(
        XNonce::from_slice(nonce),
        Payload {
            msg: ciphertext,
            aad: aad.as_bytes(),
        },
    ) {
        Ok(plain) => plain,
        Err(error) => bail!(error),
    };

    Ok(plaintext)
}

pub fn derive_manifest_key_from_passphrase(
    passphrase: &str,
    project_id: &str,
) -> anyhow::Result<Vec<u8>> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(project_id.as_bytes());
    let hash = hasher.finalize();
    let salt: [u8; 16] = hash[..16].try_into().unwrap();

    let argon2 = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(19456, 2, 1, Some(32))
            .map_err(|e| anyhow::anyhow!("Failed to create Argon2 params: {}", e))?,
    );
    let pass = passphrase.as_bytes();
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(pass, &salt, &mut key)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?;
    Ok(key.to_vec())
}

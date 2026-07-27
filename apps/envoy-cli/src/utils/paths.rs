use std::path::{Path, PathBuf};

use anyhow::{Result, bail};

pub fn envoy_home_dir() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("ENVOY_HOME") {
        let path = PathBuf::from(path);
        if path.as_os_str().is_empty() {
            bail!("ENVOY_HOME cannot be empty.");
        }
        return Ok(path);
    }

    let mut path =
        dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Could not determine home directory"))?;
    path.push(".envoy");
    Ok(path)
}

pub fn normalize_path(path: &str) -> String {
    let path = path.trim();

    let normalized = path.replace('\\', "/");

    let normalized = normalized
        .strip_prefix("./")
        .or_else(|| normalized.strip_prefix(".\\"))
        .unwrap_or(&normalized)
        .to_string();

    let normalized = normalized.trim_start_matches('/');

    let parts: Vec<&str> = normalized.split('/').filter(|p| !p.is_empty()).collect();

    parts.join("/")
}

pub fn to_native_path(normalized: &str) -> PathBuf {
    Path::new(normalized).to_path_buf()
}

pub fn validate_project_path(path: &str) -> Result<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || Path::new(trimmed).is_absolute() {
        bail!("File path must be relative to the project.");
    }

    let normalized = normalize_path(trimmed);
    if normalized.is_empty()
        || normalized == "."
        || normalized == ".."
        || normalized.starts_with("../")
        || normalized.split('/').any(|part| part == "..")
        || normalized == ".envoy"
        || normalized.starts_with(".envoy/")
    {
        bail!("File path must stay inside the project and outside '.envoy'.");
    }

    Ok(normalized)
}

pub fn ensure_parent_exists(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
        && !parent.exists()
    {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path() {
        assert_eq!(normalize_path(".env"), ".env");
        assert_eq!(normalize_path("./.env"), ".env");
        assert_eq!(normalize_path(".\\.env"), ".env");
        assert_eq!(normalize_path("./config/.env"), "config/.env");
        assert_eq!(normalize_path(".\\config\\.env"), "config/.env");
        assert_eq!(normalize_path("config/.env"), "config/.env");
        assert_eq!(normalize_path("config\\.env"), "config/.env");
        assert_eq!(normalize_path("/config/.env"), "config/.env");
        assert_eq!(normalize_path("\\config\\.env"), "config/.env");
        assert_eq!(normalize_path("  .env  "), ".env");
        assert_eq!(normalize_path("./foo//bar/.env"), "foo/bar/.env");
    }

    #[test]
    fn validates_safe_project_paths() {
        assert_eq!(
            validate_project_path("./config/.env").unwrap(),
            "config/.env"
        );
        assert!(validate_project_path("../outside.env").is_err());
        assert!(validate_project_path("config/../../outside.env").is_err());
        assert!(validate_project_path(".envoy/config.toml").is_err());
        assert!(validate_project_path("").is_err());
    }
}

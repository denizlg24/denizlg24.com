use anyhow::{Result, bail};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ProjectConfig {
    pub project_id: String,
    pub version: u8,
    pub name: Option<String>,
    pub remotes: std::collections::HashMap<String, String>,
    pub default_remote: String,
}

pub fn load_project_config() -> Result<ProjectConfig> {
    let contents = std::fs::read_to_string(".envoy/config.toml")?;
    let config: ProjectConfig = toml::from_str(&contents)?;

    if config.version != 1 {
        bail!("Unsupported project config version {}", config.version);
    }

    if !config.remotes.contains_key(&config.default_remote) {
        bail!("Default remote '{}' not defined", config.default_remote);
    }

    Ok(config)
}

pub fn get_remote_url(config: &ProjectConfig, name: Option<&str>) -> Result<String> {
    let remote = name.unwrap_or(&config.default_remote);
    config
        .remotes
        .get(remote)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Remote '{}' not found", remote))
}

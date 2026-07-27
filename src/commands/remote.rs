use anyhow::{Result, bail};
use console::style;
use std::fs;

use crate::utils::{project_config::load_project_config, ui::print_success};

pub fn add_remote(name: &str, url: &str) -> Result<()> {
    let _project = load_project_config()?;

    let path = ".envoy/config.toml";
    let contents = fs::read_to_string(path)?;
    let mut value: toml::Value = toml::from_str(&contents)?;

    let remotes = value
        .get_mut("remotes")
        .and_then(|v| v.as_table_mut())
        .ok_or_else(|| anyhow::anyhow!("Missing [remotes] section"))?;

    if remotes.contains_key(name) {
        bail!("Remote '{}' already exists", name);
    }

    remotes.insert(name.to_string(), toml::Value::String(url.to_string()));

    fs::write(path, toml::to_string_pretty(&value)?)?;

    print_success(&format!(
        "Added remote {} {}",
        style(format!("'{}'", name)).cyan().bold(),
        style(format!("→ {}", url)).dim()
    ));
    Ok(())
}

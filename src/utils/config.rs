use anyhow::Result;
use std::fs;

use super::paths::envoy_home_dir;
use super::ui::{print_info, print_success};

pub fn save_token(token: &str) -> Result<()> {
    let dir = envoy_home_dir()?;

    fs::create_dir_all(&dir)?;

    let mut file = dir.clone();
    file.push("config.toml");

    let contents = format!("api_token = \"{}\"\n", token);

    fs::write(&file, contents)?;

    Ok(())
}

use anyhow::bail;

pub fn load_token() -> Result<String> {
    let mut path = envoy_home_dir()?;
    path.push("config.toml");

    let contents = fs::read_to_string(&path).map_err(|_| anyhow::anyhow!("Not logged in"))?;

    for line in contents.lines() {
        if let Some(value) = line.strip_prefix("api_token = ") {
            return Ok(value.trim().trim_matches('"').to_string());
        }
    }

    bail!("api_token not found in config")
}

pub fn logout() -> Result<()> {
    let mut path = envoy_home_dir()?;
    path.push("config.toml");

    if path.exists() {
        fs::remove_file(&path)?;
        print_success("Logged out of Envoy.");
    } else {
        print_info("Already logged out.");
    }

    Ok(())
}

pub fn auth_server_url() -> String {
    "https://envoy.denizlg24.com/api".to_string()
}

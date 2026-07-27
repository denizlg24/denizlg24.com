use anyhow::{Result, bail};
use std::fs;

use super::paths::envoy_home_dir;
use super::ui::{print_info, print_success};

const API_TOKEN_ENV: &str = "ENVOY_API_TOKEN";

fn normalize_api_token(token: String) -> Result<String> {
    let token = token.trim();
    if token.is_empty() {
        bail!("{API_TOKEN_ENV} cannot be empty");
    }
    Ok(token.to_owned())
}

pub fn save_token(token: &str) -> Result<()> {
    let dir = envoy_home_dir()?;

    fs::create_dir_all(&dir)?;

    let mut file = dir.clone();
    file.push("config.toml");

    let contents = format!("api_token = \"{}\"\n", token);

    fs::write(&file, contents)?;

    Ok(())
}

pub fn load_token() -> Result<String> {
    match std::env::var(API_TOKEN_ENV) {
        Ok(token) => return normalize_api_token(token),
        Err(std::env::VarError::NotUnicode(_)) => {
            bail!("{API_TOKEN_ENV} must contain valid UTF-8")
        }
        Err(std::env::VarError::NotPresent) => {}
    }

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

    if std::env::var_os(API_TOKEN_ENV).is_some() {
        print_info("ENVOY_API_TOKEN remains active in this environment.");
    }

    Ok(())
}

pub fn auth_server_url() -> String {
    "https://envoy.denizlg24.com/api".to_string()
}

#[cfg(test)]
mod tests {
    use super::normalize_api_token;

    #[test]
    fn trims_automation_tokens() {
        assert_eq!(normalize_api_token(" token \n".into()).unwrap(), "token");
    }

    #[test]
    fn rejects_empty_automation_tokens() {
        assert!(normalize_api_token(" \n".into()).is_err());
    }
}

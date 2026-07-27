use reqwest::Client;
use std::fs;
use std::path::Path;

use crate::{
    api_contracts::CreateProjectResponse,
    commands::auth::login,
    utils::{
        config::{auth_server_url, load_token},
        manifest::{Manifest, save_manifest, write_applied},
        session::{derive_manifest_key_from_passphrase, save_session},
        ui::{
            create_spinner, print_header, print_info, print_kv, print_kv_highlight, print_success,
            print_warn,
        },
    },
};

pub async fn ensure_logged_in() -> anyhow::Result<String> {
    match load_token() {
        Ok(token) => Ok(token),
        Err(_) => {
            login().await?;
            load_token()
        }
    }
}

use std::fs::OpenOptions;
use std::io::Write;

pub fn ensure_gitignore() -> anyhow::Result<()> {
    let path = Path::new(".gitignore");

    let envoy_block = r#"
# Envoy - Local state
.envoy/cache/
.envoy/latest
.envoy/HEAD
.envoy/refs/

# Envoy - Config
!.envoy/config.toml

"#;

    let existing = if path.exists() {
        fs::read_to_string(path)?
    } else {
        String::new()
    };

    // Older versions wrote the wrong config filename; repair it in place.
    if existing.contains("!.envoy/config.json") {
        fs::write(
            path,
            existing.replace("!.envoy/config.json", "!.envoy/config.toml"),
        )?;
        return Ok(());
    }

    if existing.contains(".envoy/cache/") {
        return Ok(());
    }

    let mut file = OpenOptions::new().create(true).append(true).open(path)?;

    if !existing.ends_with('\n') && !existing.is_empty() {
        writeln!(file)?;
    }

    writeln!(file, "{}", envoy_block)?;

    Ok(())
}

pub async fn init_project(name: Option<String>, passphrase: &str) -> anyhow::Result<()> {
    let api_token = ensure_logged_in().await?;

    let root = Path::new(".envoy");

    let spinner = create_spinner("Creating project...");

    let client = Client::new();
    let res: CreateProjectResponse = client
        .post(format!("{}/projects", auth_server_url()))
        .bearer_auth(&api_token)
        .send()
        .await?
        .json::<CreateProjectResponse>()
        .await?;

    let project_id = res.project_id;

    fs::create_dir(root)?;
    fs::create_dir(root.join("cache"))?;
    fs::create_dir(root.join("cache").join("commits"))?;
    fs::create_dir_all(root.join("refs").join("remotes").join("origin"))?;

    let project_name = name.unwrap_or_else(|| "My Envoy Project".to_string());
    let server_url = auth_server_url().to_owned();
    let config = format!(
        r#"
version = 1
project_id = "{}"
name = "{}"

default_remote = "origin"

[remotes]
origin = "{}"


"#,
        project_id, project_name, server_url
    );

    fs::write(root.join("config.toml"), config)?;
    ensure_gitignore()?;

    let encrypted_project_key = derive_manifest_key_from_passphrase(passphrase, &project_id)?;
    save_session(&project_id, &encrypted_project_key)?;

    let manifest = Manifest::new();

    let manifest_hash = save_manifest(&manifest)?;

    write_applied(&manifest_hash)?;

    spinner.finish_and_clear();

    print_header("Project Initialized");
    print_kv_highlight("Name", &project_name);
    print_kv("Project ID", &project_id);
    println!();
    print_kv("Passphrase", passphrase);
    print_warn("Save this passphrase securely! You'll need it for push/pull/status commands.");
    println!();
    print_success("Ready to use!");
    print_info(&format!(
        "Run {} to stage your first file.",
        console::style("`envy add -i .env`").cyan()
    ));

    Ok(())
}

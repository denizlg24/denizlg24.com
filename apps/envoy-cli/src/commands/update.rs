use anyhow::{Result, anyhow};
use console::style;
use serde::Deserialize;
use std::path::{Path, PathBuf};

use crate::utils::ui::{
    create_spinner, print_header, print_info, print_kv, print_success, print_warn,
};

const REPO: &str = "denizlg24/envoy";
const USER_AGENT: &str = "envy-cli";

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

pub async fn update() -> Result<()> {
    let spinner = create_spinner("Checking for updates...");

    let release = fetch_latest_release().await?;
    let latest = release.tag_name.trim_start_matches('v');

    spinner.finish_and_clear();

    if latest == CURRENT_VERSION {
        print_success(&format!("Already up to date (v{})", CURRENT_VERSION));
        return Ok(());
    }

    print_header("Update Available");
    print_kv("Current:", &format!("v{}", CURRENT_VERSION));
    println!(
        "  {} {}",
        style("Latest:").dim(),
        style(format!("v{}", latest)).yellow().bold()
    );

    let asset_name = platform_asset_name()?;
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| anyhow!("No release asset for this platform"))?;

    println!();
    let extracted_binary = download_and_extract(&asset.browser_download_url).await?;

    let spinner = create_spinner("Applying update...");
    replace_self(&extracted_binary)?;
    spinner.finish_and_clear();

    // Clean up temporary binary
    let _ = std::fs::remove_file(&extracted_binary);

    print_success("Update complete!");
    Ok(())
}

async fn fetch_latest_release() -> Result<Release> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", REPO);

    let client = reqwest::Client::new();
    let res = client
        .get(url)
        .header("User-Agent", USER_AGENT)
        .send()
        .await?
        .error_for_status()?
        .json::<Release>()
        .await?;

    Ok(res)
}

fn platform_asset_name() -> Result<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("envoy-aarch64-apple-darwin.tar.gz"),
        ("macos", "x86_64") => Ok("envoy-x86_64-apple-darwin.tar.gz"),
        ("linux", "x86_64") => Ok("envoy-x86_64-unknown-linux-musl.tar.gz"),
        ("windows", "x86_64") => Ok("envoy-x86_64-pc-windows-msvc.zip"),
        _ => Err(anyhow!("Unsupported platform")),
    }
}

async fn download_and_extract(url: &str) -> Result<PathBuf> {
    let tmp = tempfile::tempdir()?;
    let archive_path = tmp.path().join("archive");

    let spinner = create_spinner("Downloading update...");

    let bytes = reqwest::get(url).await?.bytes().await?;
    spinner.set_message("Extracting archive...".to_string());
    tokio::fs::write(&archive_path, &bytes).await?;

    let url_owned = url.to_string();
    let archive_clone = archive_path.clone();
    let tmp_path = tmp.path().to_path_buf();

    let binary_in_tmp = tokio::task::spawn_blocking(move || -> Result<PathBuf> {
        if url_owned.ends_with(".tar.gz") {
            extract_tar_gz(&archive_clone, &tmp_path)?;
        } else if url_owned.ends_with(".zip") {
            extract_zip(&archive_clone, &tmp_path)?;
        } else {
            return Err(anyhow!("Unknown archive format"));
        }
        let binary = find_binary(&tmp_path)?;

        Ok(binary)
    })
    .await??;

    let persistent_path = std::env::temp_dir().join(format!("envy-update-{}", std::process::id()));

    tokio::fs::copy(&binary_in_tmp, &persistent_path).await?;

    spinner.finish_and_clear();

    print_success("Downloaded and extracted");

    Ok(persistent_path)
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<()> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = std::fs::File::open(archive)?;
    let decoder = GzDecoder::new(file);
    let mut archive = Archive::new(decoder);
    archive.unpack(dest)?;
    Ok(())
}

fn extract_zip(archive: &Path, dest: &Path) -> Result<()> {
    use zip::ZipArchive;

    let file = std::fs::File::open(archive)?;
    let mut zip = ZipArchive::new(file)?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let out = dest.join(entry.name());

        if entry.is_dir() {
            std::fs::create_dir_all(&out)?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut outfile = std::fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut outfile)?;
        }
    }

    Ok(())
}

fn find_binary(dir: &Path) -> Result<PathBuf> {
    let exe_name = if cfg!(windows) { "envy.exe" } else { "envy" };

    for entry in walkdir::WalkDir::new(dir) {
        let entry = entry?;
        if entry.file_name() == exe_name {
            return Ok(entry.path().to_path_buf());
        }
    }

    Err(anyhow!("Binary not found in archive"))
}

fn replace_self(new_binary: &Path) -> Result<()> {
    let current = std::env::current_exe()?;

    let backup = current.with_extension("old");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(new_binary)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(new_binary, perms)?;
    }

    if current.exists() {
        let _ = std::fs::rename(&current, &backup);
    }

    std::fs::copy(new_binary, &current)?;

    let _ = std::fs::remove_file(backup);
    Ok(())
}

pub async fn check_for_update() -> Option<String> {
    let release = fetch_latest_release().await.ok()?;
    let latest = release.tag_name.trim_start_matches('v').to_string();

    if latest != CURRENT_VERSION {
        Some(latest)
    } else {
        None
    }
}

pub fn print_update_notification(latest_version: &str) {
    println!();
    print_warn(&format!(
        "Update available: v{} → v{}",
        CURRENT_VERSION, latest_version
    ));
    print_info("Run `envy update` to update");
}

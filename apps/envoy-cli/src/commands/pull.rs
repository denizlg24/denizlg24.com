use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;

use crate::{
    commands::crypto::{decrypt_bytes, decrypt_file_bytes},
    utils::{
        commit::{
            commit_exists, load_commit, read_head, read_remote_head, write_head, write_remote_head,
        },
        config::load_token,
        manifest::{
            FileEntry, Manifest, clear_pending_restore, get_project_key, load_manifest,
            load_manifest_by_hash, read_applied, read_pending_restore, set_manifest, write_applied,
            write_pending_restore,
        },
        paths::{ensure_parent_exists, to_native_path, validate_project_path},
        project_config::{get_remote_url, load_project_config},
        storage::{download_blob, download_commit, download_manifest, fetch_remote_head},
        ui::{
            PassphraseResult, create_progress_bar, create_spinner, print_header, print_info,
            print_kv, print_success, print_warn, prompt_file_passphrase,
        },
    },
};
use console::style;

pub async fn pull(remote: Option<&str>) -> anyhow::Result<()> {
    let token = load_token()?;
    let project = load_project_config()?;
    let server = get_remote_url(&project, remote)?;

    let client = reqwest::Client::new();

    let remote_head_result =
        fetch_remote_head(&client, &server, &token, &project.project_id).await?;

    if let Some(ref remote_head) = remote_head_result {
        return pull_with_commits(&client, &server, &token, &project.project_id, remote_head).await;
    }

    // Fall back to legacy manifest-based pull
    legacy_pull(&client, &server, &token, &project.project_id).await
}

#[derive(Default)]
struct RestoreOutcome {
    restored: usize,
    deleted: usize,
    failed: Vec<String>,
}

fn obsolete_paths(previous: &Manifest, next: &Manifest) -> Vec<String> {
    previous
        .files
        .keys()
        .filter(|path| !next.files.contains_key(*path))
        .cloned()
        .collect()
}

fn remove_obsolete_files(previous: Option<&Manifest>, next: &Manifest) -> anyhow::Result<usize> {
    let Some(previous) = previous else {
        return Ok(0);
    };

    let mut deleted = 0;
    for path in obsolete_paths(previous, next) {
        let safe_path = validate_project_path(&path)?;
        let native_path = to_native_path(&safe_path);
        if native_path.exists() {
            if let Some(expected_hash) = previous.files.get(&path).and_then(FileEntry::content_hash)
            {
                let current = std::fs::read(&native_path)?;
                let current_hash = hex::encode(Sha256::digest(current));
                if current_hash != expected_hash {
                    anyhow::bail!(
                        "Refusing to delete locally modified file '{}'. Stage or restore it first.",
                        safe_path
                    );
                }
            }
            std::fs::remove_file(&native_path).map_err(|error| {
                anyhow::anyhow!("Failed to delete tracked file '{}': {}", safe_path, error)
            })?;
            deleted += 1;
        }
    }

    Ok(deleted)
}

async fn download_missing_blobs(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    project_id: &str,
    manifest: &Manifest,
) -> anyhow::Result<usize> {
    let pb = create_progress_bar(manifest.files.len() as u64);
    let mut downloaded = 0;

    for entry in manifest.files.values() {
        let hash = entry.blob_hash();
        let path = Path::new(".envoy/cache").join(format!("{}.blob", hash));

        if path.exists() {
            pb.inc(1);
            continue;
        }

        pb.set_message(format!("Downloading {}...", &hash[..8]));
        download_blob(client, server, token, project_id, hash).await?;

        downloaded += 1;
        pb.inc(1);
    }

    pb.finish_and_clear();

    if downloaded > 0 {
        print_success(&format!("Downloaded {} file(s).", downloaded));
    }

    Ok(downloaded)
}

async fn restore_files(
    manifest: &Manifest,
    only: Option<&HashSet<String>>,
) -> anyhow::Result<RestoreOutcome> {
    let mut outcome = RestoreOutcome::default();

    let targets: Vec<(&String, &FileEntry)> = manifest
        .files
        .iter()
        .filter(|(path, _)| only.is_none_or(|set| set.contains(*path)))
        .collect();

    if targets.is_empty() {
        return Ok(outcome);
    }

    let pb = create_progress_bar(targets.len() as u64);
    pb.set_message("Restoring files...");

    let project_key = if targets
        .iter()
        .any(|(_, entry)| matches!(entry, FileEntry::Managed(_)))
    {
        Some(get_project_key()?)
    } else {
        None
    };

    for (file_path, entry) in targets {
        let hash = entry.blob_hash();
        let blob_path = Path::new(".envoy/cache").join(format!("{}.blob", hash));
        let encrypted = match tokio::fs::read(&blob_path).await {
            Ok(bytes) => bytes,
            Err(e) => {
                pb.suspend(|| {
                    print_warn(&format!("Failed to read blob for '{}': {}", file_path, e));
                });
                outcome.failed.push(file_path.clone());
                pb.inc(1);
                continue;
            }
        };

        pb.suspend(|| {
            println!();
        });

        let plaintext = match entry {
            FileEntry::Managed(_) => decrypt_file_bytes(
                &encrypted,
                project_key
                    .as_deref()
                    .expect("project key is loaded for managed files"),
            ),
            FileEntry::Legacy(_) => {
                let passphrase = match prompt_file_passphrase(file_path) {
                    Ok(PassphraseResult::Passphrase(pass)) => pass,
                    Ok(PassphraseResult::Skip) => {
                        pb.suspend(|| {
                            print_info(&format!("Skipping '{}'", file_path));
                        });
                        outcome.failed.push(file_path.clone());
                        pb.inc(1);
                        continue;
                    }
                    Err(e) => {
                        pb.suspend(|| {
                            print_warn(&format!(
                                "Failed to read passphrase for '{}': {}",
                                file_path, e
                            ));
                        });
                        outcome.failed.push(file_path.clone());
                        pb.inc(1);
                        continue;
                    }
                };
                decrypt_bytes(&encrypted, &passphrase)
            }
        };

        match plaintext {
            Ok(plaintext) => {
                let normalized = match validate_project_path(file_path) {
                    Ok(path) => path,
                    Err(error) => {
                        pb.suspend(|| {
                            print_warn(&format!("Refusing unsafe path '{}': {}", file_path, error));
                        });
                        outcome.failed.push(file_path.clone());
                        pb.inc(1);
                        continue;
                    }
                };
                let target_path = to_native_path(&normalized);

                if let Err(e) = ensure_parent_exists(&target_path) {
                    pb.suspend(|| {
                        print_warn(&format!(
                            "Failed to create directory for '{}': {}",
                            file_path, e
                        ));
                    });
                    outcome.failed.push(file_path.clone());
                    pb.inc(1);
                    continue;
                }

                if let Err(e) = tokio::fs::write(&target_path, plaintext).await {
                    pb.suspend(|| {
                        print_warn(&format!(
                            "Failed to write '{}': {}",
                            target_path.display(),
                            e
                        ));
                    });
                    outcome.failed.push(file_path.clone());
                    pb.inc(1);
                    continue;
                }

                outcome.restored += 1;
            }
            Err(_) => {
                pb.suspend(|| {
                    print_warn(&format!("Wrong passphrase for '{}', skipping", file_path));
                });
                outcome.failed.push(file_path.clone());
            }
        }

        pb.inc(1);
    }

    pb.finish_and_clear();

    Ok(outcome)
}

/// Records restore results: the applied marker only advances when every file
/// was restored; otherwise the failures are queued for the next pull.
fn finish_restore(manifest_hash: &str, outcome: &RestoreOutcome) -> anyhow::Result<()> {
    if outcome.restored > 0 {
        print_success(&format!("Restored {} file(s).", outcome.restored));
    }
    if outcome.deleted > 0 {
        print_success(&format!("Deleted {} removed file(s).", outcome.deleted));
    }

    if outcome.failed.is_empty() {
        clear_pending_restore();
        write_applied(manifest_hash)?;
    } else {
        write_pending_restore(manifest_hash, &outcome.failed)?;
        print_warn(&format!(
            "{} file(s) were not restored (skipped or wrong passphrase).",
            outcome.failed.len()
        ));
        print_info(&format!(
            "Run {} to retry them.",
            style("`envy pull`").cyan()
        ));
    }

    Ok(())
}

fn pending_files_for(manifest_hash: &str) -> Option<HashSet<String>> {
    read_pending_restore()
        .filter(|pending| pending.manifest_hash == manifest_hash)
        .map(|pending| pending.files.into_iter().collect())
}

async fn pull_with_commits(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    project_id: &str,
    remote_head: &str,
) -> anyhow::Result<()> {
    let local_remote_head = read_remote_head();
    let local_head = read_head();

    let heads_synced = local_remote_head.as_deref() == Some(remote_head)
        && local_head.as_deref() == Some(remote_head);

    if heads_synced {
        if read_pending_restore().is_none() {
            print_success("Already up to date.");
            return Ok(());
        }

        // Commits are synced but some files failed to restore last time.
        let latest_commit = load_commit(remote_head)?;
        let manifest_hash = latest_commit.manifest_hash;
        let manifest = load_manifest_by_hash(&manifest_hash)?;
        let only = pending_files_for(&manifest_hash);

        let count = only.as_ref().map_or(manifest.files.len(), HashSet::len);
        print_header(&format!("Retrying {} unrestored file(s)", count));

        download_missing_blobs(client, server, token, project_id, &manifest).await?;
        let outcome = restore_files(&manifest, only.as_ref()).await?;
        finish_restore(&manifest_hash, &outcome)?;

        return Ok(());
    }

    print_header("Fetching commits");

    let mut commits_to_download = Vec::new();
    let mut current_hash = Some(remote_head.to_string());

    while let Some(hash) = current_hash {
        if commit_exists(&hash) {
            break; // We have this commit and all ancestors
        }
        commits_to_download.push(hash.clone());

        let spinner = create_spinner(&format!("Fetching commit {}...", &hash[..8]));
        download_commit(client, server, token, project_id, &hash).await?;
        spinner.finish_and_clear();

        let commit = load_commit(&hash)?;
        current_hash = commit.parent;
    }

    if !commits_to_download.is_empty() {
        print_success(&format!("Fetched {} commit(s).", commits_to_download.len()));
    }

    let latest_commit = load_commit(remote_head)?;
    let manifest_hash = &latest_commit.manifest_hash;

    let manifest_blob_path = Path::new(".envoy/cache").join(format!("{}.blob", manifest_hash));

    if !manifest_blob_path.exists() {
        let spinner = create_spinner("Downloading manifest...");
        download_manifest(client, server, token, project_id, manifest_hash).await?;
        spinner.finish_and_clear();
    }

    let previous_manifest = read_applied().and_then(|hash| load_manifest_by_hash(&hash).ok());

    set_manifest(manifest_hash)?;

    let manifest = load_manifest()?;
    let mut outcome = if manifest.files.is_empty() {
        RestoreOutcome::default()
    } else {
        print_header(&format!("Pulling {} file(s)", manifest.files.len()));

        download_missing_blobs(client, server, token, project_id, &manifest).await?;

        let only = pending_files_for(manifest_hash);
        restore_files(&manifest, only.as_ref()).await?
    };
    outcome.deleted = remove_obsolete_files(previous_manifest.as_ref(), &manifest)?;

    write_head(remote_head)?;
    write_remote_head(remote_head)?;
    finish_restore(manifest_hash, &outcome)?;

    println!();
    print_kv("HEAD", &remote_head[..12]);
    print_success(&format!("Updated to commit {}.", &remote_head[..8]));

    Ok(())
}

/// Legacy pull for backwards compatibility
async fn legacy_pull(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    project_id: &str,
) -> anyhow::Result<()> {
    let manifest_hash = tokio::fs::read_to_string(".envoy/latest")
        .await?
        .trim()
        .to_string();

    let applied_matches = read_applied().as_deref() == Some(manifest_hash.as_str());
    if applied_matches && read_pending_restore().is_none() {
        print_success("Already up to date.");
        return Ok(());
    }

    let manifest_blob_path = Path::new(".envoy/cache").join(format!("{}.blob", manifest_hash));

    if !manifest_blob_path.exists() {
        let spinner = create_spinner("Downloading manifest...");
        download_manifest(client, server, token, project_id, &manifest_hash).await?;
        spinner.finish_and_clear();
    }

    let previous_manifest = read_applied()
        .filter(|hash| hash != &manifest_hash)
        .and_then(|hash| load_manifest_by_hash(&hash).ok());
    let manifest = load_manifest()?;
    let mut outcome = if manifest.files.is_empty() {
        RestoreOutcome::default()
    } else {
        print_header(&format!("Pulling {} file(s)", manifest.files.len()));

        download_missing_blobs(client, server, token, project_id, &manifest).await?;

        let only = pending_files_for(&manifest_hash);
        restore_files(&manifest, only.as_ref()).await?
    };
    outcome.deleted = remove_obsolete_files(previous_manifest.as_ref(), &manifest)?;

    finish_restore(&manifest_hash, &outcome)?;

    println!();
    print_kv("Manifest", &manifest_hash[..12]);
    print_success(&format!("Updated to manifest {}.", &manifest_hash[..8]));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::manifest::FileEntry;

    #[test]
    fn identifies_files_deleted_by_new_manifest() {
        let mut previous = Manifest::new();
        previous
            .files
            .insert(".env".to_string(), FileEntry::Legacy("one".to_string()));
        previous.files.insert(
            ".env.production".to_string(),
            FileEntry::Legacy("two".to_string()),
        );

        let mut next = Manifest::new();
        next.files.insert(
            ".env.production".to_string(),
            FileEntry::Legacy("two".to_string()),
        );

        assert_eq!(obsolete_paths(&previous, &next), vec![".env".to_string()]);
    }
}

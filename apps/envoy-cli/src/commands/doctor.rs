use std::path::Path;

use console::style;

use crate::utils::{
    commit::{commit_exists, commits_ahead_of_remote, read_head, read_remote_head},
    config::load_token,
    manifest::{get_current_manifest_hash, load_manifest, read_applied, read_pending_restore},
    project_config::{get_remote_url, load_project_config},
    storage::fetch_remote_head,
    ui::{print_error, print_header, print_info, print_kv, print_success, print_warn},
};

struct DoctorReport {
    warnings: usize,
    errors: usize,
}

impl DoctorReport {
    fn new() -> Self {
        Self {
            warnings: 0,
            errors: 0,
        }
    }

    fn ok(&self, message: &str) {
        print_success(message);
    }

    fn warn(&mut self, message: &str) {
        self.warnings += 1;
        print_warn(message);
    }

    fn error(&mut self, message: &str) {
        self.errors += 1;
        print_error(message);
    }
}

fn short_hash(hash: &str) -> String {
    hash.chars().take(12).collect()
}

fn cache_blob_exists(hash: &str) -> bool {
    Path::new(".envoy/cache")
        .join(format!("{}.blob", hash))
        .exists()
}

async fn check_backend_health(client: &reqwest::Client, server: &str, report: &mut DoctorReport) {
    let health_url = format!("{}/health", server.trim_end_matches('/'));

    match client.get(&health_url).send().await {
        Ok(response) if response.status().is_success() => {
            report.ok("Backend health endpoint is reachable.");
        }
        Ok(response) => {
            report.warn(&format!(
                "Backend health returned HTTP {} at {}.",
                response.status(),
                health_url
            ));
        }
        Err(error) => {
            report.warn(&format!(
                "Backend health endpoint is not reachable at {}: {}",
                health_url, error
            ));
        }
    }
}

pub async fn doctor(remote: Option<&str>) -> anyhow::Result<()> {
    print_header("Envoy Doctor");

    let mut report = DoctorReport::new();

    if !Path::new(".envoy").exists() {
        report.error("Not an Envoy project. Run `envy init` first.");
        print_summary(&report);
        return Ok(());
    }
    report.ok("Project directory exists.");

    if Path::new(".gitignore").exists() {
        match crate::commands::init::ensure_gitignore() {
            Ok(()) => report.ok(".gitignore covers Envoy local state."),
            Err(error) => report.warn(&format!("Could not update .gitignore: {}", error)),
        }
    }

    let token = match load_token() {
        Ok(token) => {
            report.ok("Authentication token found.");
            Some(token)
        }
        Err(error) => {
            report.error(&format!(
                "Authentication token missing or invalid: {}",
                error
            ));
            None
        }
    };

    let project = match load_project_config() {
        Ok(project) => {
            report.ok("Project config loaded.");
            print_kv("Project", &project.project_id);
            if let Some(name) = &project.name {
                print_kv("Name", name);
            }
            Some(project)
        }
        Err(error) => {
            report.error(&format!("Project config is invalid: {}", error));
            None
        }
    };

    let server = match project
        .as_ref()
        .map(|project| get_remote_url(project, remote))
    {
        Some(Ok(server)) => {
            report.ok("Remote config resolved.");
            print_kv("Remote", &server);
            Some(server)
        }
        Some(Err(error)) => {
            report.error(&format!("Remote config is invalid: {}", error));
            None
        }
        None => None,
    };

    let client = reqwest::Client::new();
    if let Some(server) = &server {
        check_backend_health(&client, server, &mut report).await;
    }

    let local_head = read_head();
    let local_remote_head = read_remote_head();
    let current_manifest_hash = get_current_manifest_hash();
    let applied_manifest_hash = read_applied();

    println!();
    print_kv(
        "HEAD",
        local_head
            .as_deref()
            .map(short_hash)
            .as_deref()
            .unwrap_or("none"),
    );
    print_kv(
        "origin/HEAD",
        local_remote_head
            .as_deref()
            .map(short_hash)
            .as_deref()
            .unwrap_or("none"),
    );
    print_kv(
        "Manifest",
        current_manifest_hash
            .as_deref()
            .map(short_hash)
            .as_deref()
            .unwrap_or("none"),
    );

    if let Some(hash) = &local_head {
        if commit_exists(hash) {
            report.ok("Local HEAD commit exists in cache.");
        } else {
            report.error(&format!(
                "Local HEAD commit {} is missing from cache.",
                short_hash(hash)
            ));
        }
    }

    if let Some(hash) = &current_manifest_hash {
        if cache_blob_exists(hash) {
            report.ok("Current manifest blob exists in cache.");
        } else {
            report.error(&format!(
                "Current manifest blob {} is missing from cache.",
                short_hash(hash)
            ));
        }
    } else {
        report.warn("No current manifest reference found.");
    }

    match (&applied_manifest_hash, &current_manifest_hash) {
        (Some(applied), Some(current)) if applied == current => {
            report.ok("Applied manifest matches current manifest.");
        }
        (Some(applied), Some(current)) => {
            report.warn(&format!(
                "Applied manifest {} differs from current manifest {}.",
                short_hash(applied),
                short_hash(current)
            ));
        }
        (None, Some(_)) => report.warn("No applied manifest marker found."),
        _ => {}
    }

    match read_pending_restore() {
        Some(pending) => {
            report.warn(&format!(
                "{} file(s) from the last pull were not restored.",
                pending.files.len()
            ));
            print_info(&format!("Run {} to retry.", style("`envy pull`").cyan()));
        }
        None => report.ok("No files pending restore."),
    }

    match load_manifest() {
        Ok(manifest) => {
            report.ok("Manifest decrypts successfully.");
            print_kv("Tracked files", &manifest.files.len().to_string());

            let missing_blobs: Vec<_> = manifest
                .files
                .iter()
                .filter(|(_, entry)| !cache_blob_exists(entry.blob_hash()))
                .collect();

            if missing_blobs.is_empty() {
                report.ok("All tracked file blobs exist in cache.");
            } else {
                report.error(&format!(
                    "{} tracked file blob(s) are missing from cache.",
                    missing_blobs.len()
                ));
                for (path, entry) in missing_blobs.iter().take(5) {
                    print_info(&format!("{} -> {}", path, short_hash(entry.blob_hash())));
                }
                if missing_blobs.len() > 5 {
                    print_info(&format!("...and {} more.", missing_blobs.len() - 5));
                }
            }
        }
        Err(error) => {
            report.warn(&format!(
                "Could not decrypt or parse the manifest: {}",
                error
            ));
            print_info("Pass `--passphrase` or refresh the session to inspect tracked file blobs.");
        }
    }

    if let (Some(token), Some(project), Some(server)) = (&token, &project, &server) {
        match fetch_remote_head(&client, server, token, &project.project_id).await {
            Ok(server_head) => {
                report.ok("Remote HEAD request succeeded.");
                match server_head {
                    Some(head) => {
                        print_kv("Server HEAD", &short_hash(&head));

                        if local_remote_head.as_ref() != Some(&head) {
                            report.warn("Local origin/HEAD is behind or differs from the server.");
                            print_info(&format!("Run {}", style("`envy pull`").cyan()));
                        }

                        if local_head.as_ref() != Some(&head) {
                            report.warn("Local HEAD differs from server HEAD.");
                        }
                    }
                    None => {
                        report.warn("Server has no HEAD yet.");
                    }
                }
            }
            Err(error) => {
                report.error(&format!("Remote HEAD request failed: {}", error));
            }
        }
    }

    match commits_ahead_of_remote() {
        Ok(commits) if commits.is_empty() => report.ok("No unpushed local commits detected."),
        Ok(commits) => {
            report.warn(&format!(
                "{} local commit(s) are not recorded in origin/HEAD.",
                commits.len()
            ));
            print_info(&format!("Run {}", style("`envy push`").cyan()));
        }
        Err(error) => {
            report.warn(&format!(
                "Could not inspect local commit history: {}",
                error
            ));
        }
    }

    print_summary(&report);

    Ok(())
}

fn print_summary(report: &DoctorReport) {
    println!();
    if report.errors == 0 && report.warnings == 0 {
        print_success("Doctor found no issues.");
    } else {
        print_kv("Errors", &report.errors.to_string());
        print_kv("Warnings", &report.warnings.to_string());
    }
}

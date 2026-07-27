use crate::utils::{
    commit::{commits_ahead_of_remote, get_head_manifest_hash, read_head, read_remote_head},
    config::load_token,
    manifest::{
        compute_manifest_content_hash, get_current_manifest_hash, load_manifest,
        load_manifest_by_hash, read_pending_restore,
    },
    project_config::{get_remote_url, load_project_config},
    storage::fetch_remote_head,
    ui::{print_header, print_info, print_kv, print_success, print_warn},
};
use console::style;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::Path};

use crate::utils::manifest::{FileEntry, Manifest};
use crate::utils::paths::{to_native_path, validate_project_path};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

fn staged_changes(head: Option<&Manifest>, index: &Manifest) -> Vec<(String, ChangeKind)> {
    let paths: BTreeSet<_> = head
        .into_iter()
        .flat_map(|manifest| manifest.files.keys())
        .chain(index.files.keys())
        .cloned()
        .collect();

    paths
        .into_iter()
        .filter_map(|path| {
            let old = head.and_then(|manifest| manifest.files.get(&path));
            let new = index.files.get(&path);
            let kind = match (old, new) {
                (None, Some(_)) => Some(ChangeKind::Added),
                (Some(_), None) => Some(ChangeKind::Deleted),
                (Some(old), Some(new)) if !entries_match(old, new) => Some(ChangeKind::Modified),
                _ => None,
            }?;
            Some((path, kind))
        })
        .collect()
}

fn working_changes(index: &Manifest) -> Vec<(String, ChangeKind)> {
    index
        .files
        .iter()
        .filter_map(|(path, entry)| {
            let safe_path = validate_project_path(path).ok()?;
            let native_path = to_native_path(&safe_path);
            let kind = match fs::read(native_path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => ChangeKind::Deleted,
                Ok(content)
                    if entry
                        .content_hash()
                        .is_some_and(|hash| hash != hex::encode(Sha256::digest(&content))) =>
                {
                    ChangeKind::Modified
                }
                _ => return None,
            };
            Some((path.clone(), kind))
        })
        .collect()
}

fn entries_match(left: &FileEntry, right: &FileEntry) -> bool {
    match (left, right) {
        (FileEntry::Managed(left), FileEntry::Managed(right)) => {
            left.content_hash == right.content_hash
                && left.encryption == right.encryption
                && left.members == right.members
        }
        (FileEntry::Legacy(left), FileEntry::Legacy(right)) => left == right,
        _ => false,
    }
}

fn print_changes(header: &str, changes: &[(String, ChangeKind)]) {
    if changes.is_empty() {
        return;
    }
    println!();
    println!("{}", style(header).bold());
    for (path, kind) in changes {
        let label = match kind {
            ChangeKind::Added => "new file:",
            ChangeKind::Modified => "modified:",
            ChangeKind::Deleted => "deleted:",
        };
        println!("  {:<12} {}", style(label).yellow(), path);
    }
}

pub async fn status() -> anyhow::Result<()> {
    let project = load_project_config()?;

    print_header("Envoy Status");
    print_kv("Project", &project.project_id);

    let current_manifest_hash = get_current_manifest_hash();
    let manifest = load_manifest()?;

    let local_head = read_head();
    let local_remote_head = read_remote_head();
    let head_manifest_hash = get_head_manifest_hash();

    let server_remote_head = {
        if let Ok(token) = load_token() {
            if let Ok(server) = get_remote_url(&project, None) {
                let client = reqwest::Client::new();
                fetch_remote_head(&client, &server, &token, &project.project_id)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some(ref hash) = current_manifest_hash {
        print_kv("Manifest", &hash[..12]);
    }

    print_kv("Files", &manifest.files.len().to_string());

    println!();

    if let Some(ref head) = local_head {
        print_kv("HEAD", &head[..12]);
    }

    if let Some(ref remote) = local_remote_head {
        print_kv("origin/HEAD", &remote[..12]);
    }

    let is_behind_remote =
        server_remote_head.is_some() && local_remote_head.as_ref() != server_remote_head.as_ref();

    let has_new_remote_commits =
        server_remote_head.is_some() && local_head.as_ref() != server_remote_head.as_ref();

    let head_manifest = head_manifest_hash
        .as_ref()
        .and_then(|hash| load_manifest_by_hash(hash).ok());
    let staged = staged_changes(head_manifest.as_ref(), &manifest);
    let unstaged = working_changes(&manifest);
    let has_uncommitted_changes = !staged.is_empty() || !unstaged.is_empty();

    // Keep the canonical manifest comparison as a fallback for unsupported
    // future entry types.
    let manifest_content_changed = {
        let current_content_hash = compute_manifest_content_hash(&manifest);
        head_manifest
            .as_ref()
            .map(|head| compute_manifest_content_hash(head) != current_content_hash)
            .unwrap_or(!manifest.files.is_empty())
    };

    let commits_ahead = commits_ahead_of_remote().unwrap_or_default();
    let has_unpushed_commits = !commits_ahead.is_empty();

    let pending_restore = read_pending_restore();

    print_changes("Changes to be committed:", &staged);
    print_changes("Changes not staged for commit:", &unstaged);

    let mut missing_blobs = 0;
    for entry in manifest.files.values() {
        let hash = entry.blob_hash();
        let path = Path::new(".envoy/cache").join(format!("{}.blob", hash));
        if !path.exists() {
            missing_blobs += 1;
        }
    }

    println!();

    if has_unpushed_commits {
        print_info(&format!(
            "Your branch is {} commit(s) ahead of 'origin'.",
            commits_ahead.len()
        ));
    }

    if missing_blobs > 0 {
        print_warn("State: MISSING DATA");
        print_info(&format!(
            "{} file(s) missing locally. Run {}",
            missing_blobs,
            style("`envy pull`").cyan()
        ));
    } else if is_behind_remote || (has_new_remote_commits && local_head.is_none()) {
        print_warn("State: BEHIND REMOTE");
        print_info(&format!(
            "Remote has new commits. Run {} to sync.",
            style("`envy pull`").cyan()
        ));
    } else if let Some(ref pending) = pending_restore {
        print_warn("State: PARTIAL RESTORE");
        print_info(&format!(
            "{} file(s) could not be restored on the last pull. Run {} to retry.",
            pending.files.len(),
            style("`envy pull`").cyan()
        ));
    } else if has_uncommitted_changes || manifest_content_changed {
        print_warn("State: UNCOMMITTED CHANGES");
        if manifest.files.is_empty() && head_manifest_hash.is_some() {
            print_info(&format!(
                "All files removed. Run {} to record deletion.",
                style("`envy commit -m \"message\"`").cyan()
            ));
        } else if local_head.is_none() {
            print_info(&format!(
                "Run {} to create your first commit.",
                style("`envy commit -m \"message\"`").cyan()
            ));
        } else {
            print_info(&format!(
                "Run {} to commit your changes.",
                style("`envy commit -m \"message\"`").cyan()
            ));
        }
    } else if has_unpushed_commits {
        print_warn("State: UNPUSHED COMMITS");
        print_info(&format!(
            "Run {} to sync with remote.",
            style("`envy push`").cyan()
        ));
    } else if local_head.is_none() && manifest.files.is_empty() && server_remote_head.is_none() {
        print_info("State: EMPTY");
        print_info(&format!(
            "Run {} to encrypt your first file.",
            style("`envy encrypt -i .env`").cyan()
        ));
    } else {
        print_success("State: UP TO DATE");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::manifest::{FileEncryption, ManagedFile};

    fn managed(blob: &str, content: &str) -> FileEntry {
        FileEntry::Managed(ManagedFile {
            blob_hash: blob.to_string(),
            content_hash: content.to_string(),
            encryption: FileEncryption::ProjectKey,
            members: None,
        })
    }

    #[test]
    fn staged_changes_classify_add_modify_and_delete() {
        let mut head = Manifest::new();
        head.files
            .insert("deleted.env".to_string(), managed("one", "one"));
        head.files
            .insert("modified.env".to_string(), managed("two", "two"));

        let mut index = Manifest::new();
        index
            .files
            .insert("modified.env".to_string(), managed("three", "three"));
        index
            .files
            .insert("added.env".to_string(), managed("four", "four"));

        assert_eq!(
            staged_changes(Some(&head), &index),
            vec![
                ("added.env".to_string(), ChangeKind::Added),
                ("deleted.env".to_string(), ChangeKind::Deleted),
                ("modified.env".to_string(), ChangeKind::Modified),
            ]
        );
    }

    #[test]
    fn re_encryption_with_same_content_is_not_modified() {
        assert!(entries_match(
            &managed("random-one", "same"),
            &managed("random-two", "same")
        ));
    }
}

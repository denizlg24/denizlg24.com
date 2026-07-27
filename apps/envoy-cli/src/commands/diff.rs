use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use anyhow::Result;
use console::style;
use sha2::{Digest, Sha256};
use similar::{ChangeTag, TextDiff};

use crate::{
    commands::crypto::decrypt_file_bytes,
    utils::{
        commit::get_head_manifest_hash,
        manifest::{FileEntry, Manifest, get_project_key, load_manifest, load_manifest_by_hash},
        paths::{to_native_path, validate_project_path},
        ui::{print_info, print_warn},
    },
};

#[derive(Clone, Copy)]
enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

struct FileChange {
    path: String,
    kind: ChangeKind,
    old: Option<Vec<u8>>,
    new: Option<Vec<u8>>,
    access_changed: bool,
}

pub fn diff(cached: bool, show_secrets: bool) -> Result<()> {
    let index = load_manifest()?;
    let changes = if cached {
        cached_changes(&index)?
    } else {
        working_tree_changes(&index)?
    };

    if changes.is_empty() {
        print_info(if cached {
            "No staged changes."
        } else {
            "No unstaged changes."
        });
        return Ok(());
    }

    if show_secrets {
        print_warn("Showing decrypted secret values in terminal output.");
    }

    for change in changes {
        print_change(&change, show_secrets);
    }

    Ok(())
}

fn cached_changes(index: &Manifest) -> Result<Vec<FileChange>> {
    let head = match get_head_manifest_hash() {
        Some(hash) => load_manifest_by_hash(&hash)?,
        None => Manifest::new(),
    };
    let paths = all_paths(&head, index);
    let mut changes = Vec::new();

    for path in paths {
        let old_entry = head.files.get(&path);
        let new_entry = index.files.get(&path);
        if entries_match(old_entry, new_entry) {
            continue;
        }

        changes.push(FileChange {
            path,
            kind: match (old_entry, new_entry) {
                (None, Some(_)) => ChangeKind::Added,
                (Some(_), None) => ChangeKind::Deleted,
                _ => ChangeKind::Modified,
            },
            old: old_entry.and_then(decrypt_managed_entry),
            new: new_entry.and_then(decrypt_managed_entry),
            access_changed: access_changed(old_entry, new_entry),
        });
    }

    Ok(changes)
}

fn working_tree_changes(index: &Manifest) -> Result<Vec<FileChange>> {
    let mut changes = Vec::new();

    for (path, entry) in &index.files {
        let Ok(safe_path) = validate_project_path(path) else {
            continue;
        };
        let native_path = to_native_path(&safe_path);
        let current = fs::read(&native_path).ok();
        let kind = match current.as_ref() {
            None => Some(ChangeKind::Deleted),
            Some(bytes) => entry
                .content_hash()
                .is_some_and(|hash| hash != hex::encode(Sha256::digest(bytes)))
                .then_some(ChangeKind::Modified),
        };

        if let Some(kind) = kind {
            changes.push(FileChange {
                path: path.clone(),
                kind,
                old: decrypt_managed_entry(entry),
                new: current,
                access_changed: false,
            });
        }
    }

    Ok(changes)
}

fn all_paths(left: &Manifest, right: &Manifest) -> BTreeSet<String> {
    left.files
        .keys()
        .chain(right.files.keys())
        .cloned()
        .collect()
}

fn entries_match(left: Option<&FileEntry>, right: Option<&FileEntry>) -> bool {
    match (left, right) {
        (Some(FileEntry::Managed(left)), Some(FileEntry::Managed(right))) => {
            left.content_hash == right.content_hash
                && left.encryption == right.encryption
                && left.members == right.members
        }
        (Some(FileEntry::Legacy(left)), Some(FileEntry::Legacy(right))) => left == right,
        (None, None) => true,
        _ => false,
    }
}

fn access_changed(left: Option<&FileEntry>, right: Option<&FileEntry>) -> bool {
    match (left, right) {
        (Some(FileEntry::Managed(left)), Some(FileEntry::Managed(right))) => {
            left.members != right.members
        }
        _ => false,
    }
}

fn decrypt_managed_entry(entry: &FileEntry) -> Option<Vec<u8>> {
    if !matches!(entry, FileEntry::Managed(_)) {
        return None;
    }

    let encrypted = fs::read(format!(".envoy/cache/{}.blob", entry.blob_hash())).ok()?;
    let project_key = get_project_key().ok()?;
    decrypt_file_bytes(&encrypted, &project_key).ok()
}

fn print_change(change: &FileChange, show_secrets: bool) {
    println!();
    println!(
        "{}",
        style(format!("diff --envoy a/{0} b/{0}", change.path))
            .bold()
            .cyan()
    );

    match change.kind {
        ChangeKind::Added => println!("{}", style("new file").green()),
        ChangeKind::Modified => println!("{}", style("modified").yellow()),
        ChangeKind::Deleted => println!("{}", style("deleted file").red()),
    }
    if change.access_changed {
        println!("{}", style("access policy changed").magenta());
    }

    match (&change.old, &change.new) {
        (old, new) if show_secrets && (old.is_some() || new.is_some()) => {
            print_text_diff(
                old.as_deref().unwrap_or_default(),
                new.as_deref().unwrap_or_default(),
            );
        }
        (old, new) if !show_secrets => print_redacted_diff(old.as_deref(), new.as_deref()),
        _ => {
            print_info("Encrypted content changed; plaintext diff is unavailable for legacy data.")
        }
    }
}

fn print_text_diff(old: &[u8], new: &[u8]) {
    let (Ok(old), Ok(new)) = (std::str::from_utf8(old), std::str::from_utf8(new)) else {
        print_info("Binary content changed.");
        return;
    };

    for change in TextDiff::from_lines(old, new).iter_all_changes() {
        let (sign, color) = match change.tag() {
            ChangeTag::Delete => ("-", console::Color::Red),
            ChangeTag::Insert => ("+", console::Color::Green),
            ChangeTag::Equal => (" ", console::Color::White),
        };
        print!("{}{}", style(sign).fg(color), style(change).fg(color));
    }
}

fn print_redacted_diff(old: Option<&[u8]>, new: Option<&[u8]>) {
    let old = match old {
        Some(content) => parse_env(content),
        None => Some(BTreeMap::new()),
    };
    let new = match new {
        Some(content) => parse_env(content),
        None => Some(BTreeMap::new()),
    };
    let (Some(old), Some(new)) = (old, new) else {
        print_info("Content changed (values hidden; use --show-secrets to reveal text).");
        return;
    };

    let keys: BTreeSet<_> = old.keys().chain(new.keys()).cloned().collect();
    for key in keys {
        match (old.get(&key), new.get(&key)) {
            (None, Some(_)) => println!("{}", style(format!("+{}=<redacted>", key)).green()),
            (Some(_), None) => println!("{}", style(format!("-{}=<redacted>", key)).red()),
            (Some(left), Some(right)) if left != right => {
                println!("{}", style(format!("-{}=<redacted>", key)).red());
                println!("{}", style(format!("+{}=<redacted>", key)).green());
            }
            _ => {}
        }
    }
}

fn parse_env(content: &[u8]) -> Option<BTreeMap<String, String>> {
    let content = std::str::from_utf8(content).ok()?;
    let mut values = BTreeMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (key, value) = line.split_once('=')?;
        let key = key.trim();
        if key.is_empty()
            || !key
                .chars()
                .all(|character| character == '_' || character.is_ascii_alphanumeric())
        {
            return None;
        }
        values.insert(key.to_string(), value.to_string());
    }

    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_env_without_exposing_values() {
        let parsed = parse_env(b"# ignored\nexport API_KEY=secret=value\nEMPTY=\n").unwrap();

        assert_eq!(
            parsed.get("API_KEY").map(String::as_str),
            Some("secret=value")
        );
        assert_eq!(parsed.get("EMPTY").map(String::as_str), Some(""));
    }

    #[test]
    fn rejects_non_env_text_for_redacted_output() {
        assert!(parse_env(b"not an env file").is_none());
        assert!(parse_env(&[0xff]).is_none());
    }

    #[test]
    fn managed_entries_match_by_plaintext_hash() {
        let entry = |blob: &str| {
            FileEntry::Managed(crate::utils::manifest::ManagedFile {
                blob_hash: blob.to_string(),
                content_hash: "same-content".to_string(),
                encryption: crate::utils::manifest::FileEncryption::ProjectKey,
                members: None,
            })
        };

        assert!(entries_match(Some(&entry("one")), Some(&entry("two"))));
    }
}

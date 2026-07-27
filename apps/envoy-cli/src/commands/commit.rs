use console::style;
use std::time::{Duration, UNIX_EPOCH};

use crate::utils::{
    commit::{Commit, get_head_manifest_hash, read_head, save_commit, walk_history, write_head},
    manifest::{
        compute_manifest_content_hash, load_manifest, load_manifest_by_hash, save_manifest,
    },
    ui::{print_header, print_info, print_kv, print_success},
};

pub fn commit(message: &str, author: Option<String>) -> anyhow::Result<()> {
    let manifest = load_manifest()?;

    let current_content_hash = compute_manifest_content_hash(&manifest);

    // Check if there are actual changes compared to HEAD
    // We compare content hashes, not blob hashes, because encryption produces different
    // ciphertext each time due to random nonces
    if let Some(head_manifest_hash) = get_head_manifest_hash()
        && let Ok(head_manifest) = load_manifest_by_hash(&head_manifest_hash)
    {
        let head_content_hash = compute_manifest_content_hash(&head_manifest);
        if current_content_hash == head_content_hash {
            print_info("Nothing to commit, working tree clean.");
            return Ok(());
        }
    }

    let manifest_hash = save_manifest(&manifest)?;

    let parent = read_head();

    let commit = Commit::new(parent, message.to_string(), manifest_hash.clone(), author);

    let commit_hash = save_commit(&commit)?;

    write_head(&commit_hash)?;

    print_header("Commit created");
    print_kv("Commit", &commit_hash[..12]);
    print_kv("Manifest", &manifest_hash[..12]);
    print_kv("Files", &manifest.files.len().to_string());
    print_success(&format!("\"{}\"", message));

    Ok(())
}

pub fn log(max_count: usize) -> anyhow::Result<()> {
    let head = read_head();

    if head.is_none() {
        print_info("No commits yet.");
        return Ok(());
    }

    let commits = walk_history(&head.unwrap(), Some(max_count))?;

    if commits.is_empty() {
        print_info("No commits found.");
        return Ok(());
    }

    println!();
    for (hash, commit) in commits {
        print_commit_entry(&hash, &commit);
    }

    Ok(())
}

fn print_commit_entry(hash: &str, commit: &Commit) {
    println!(
        "{} {}",
        style("commit").yellow().bold(),
        style(&hash[..12]).yellow()
    );

    if let Some(ref author) = commit.author {
        println!("Author: {}", author);
    }

    let datetime = format_timestamp(commit.timestamp);
    println!("Date:   {}", datetime);

    println!();
    println!("    {}", commit.message);
    println!();
}

fn format_timestamp(timestamp: u64) -> String {
    let commit_time = UNIX_EPOCH + Duration::from_secs(timestamp);
    let now = std::time::SystemTime::now();

    if let Ok(duration) = now.duration_since(commit_time) {
        let secs = duration.as_secs();
        if secs < 60 {
            format!("{} seconds ago", secs)
        } else if secs < 3600 {
            format!("{} minutes ago", secs / 60)
        } else if secs < 86400 {
            format!("{} hours ago", secs / 3600)
        } else if secs < 604800 {
            format!("{} days ago", secs / 86400)
        } else if secs < 2592000 {
            format!("{} weeks ago", secs / 604800)
        } else {
            format!("{} months ago", secs / 2592000)
        }
    } else {
        timestamp.to_string()
    }
}

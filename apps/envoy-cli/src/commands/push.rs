use std::path::Path;

use crate::utils::{
    commit::{
        commit_blob_path, commits_ahead_of_remote, load_commit, read_head, read_remote_head,
        write_remote_head,
    },
    config::load_token,
    manifest::{FileEntry, load_manifest, load_manifest_by_hash, save_manifest, write_applied},
    project_config::{get_remote_url, load_project_config},
    storage::{
        fetch_remote_head, set_blob_access, update_remote_head, upload_blob, upload_commit,
        upload_manifest,
    },
    ui::{
        create_progress_bar, print_error, print_header, print_info, print_kv, print_success,
        print_warn,
    },
};
use console::style;

pub async fn push(remote: Option<&str>) -> anyhow::Result<()> {
    let token = load_token()?;
    let project = load_project_config()?;
    let server = get_remote_url(&project, remote)?;

    let manifest = load_manifest()?;
    let client = reqwest::Client::new();

    let local_head = read_head();

    if local_head.is_none() {
        print_warn("No commits yet.");
        print_info(&format!(
            "Run {} first, then push.",
            style("`envy commit -m \"message\"`").cyan()
        ));
        print_info("Falling back to legacy manifest-only push...");
        return legacy_push(&client, &server, &token, &project.project_id, &manifest).await;
    }

    let local_head = local_head.unwrap();

    let remote_head_result =
        fetch_remote_head(&client, &server, &token, &project.project_id).await?;

    if let Some(ref server_head) = remote_head_result {
        let our_remote_head = read_remote_head();
        if our_remote_head.as_ref() != Some(server_head) {
            print_warn("Remote has new commits.");
            print_info(&format!(
                "Run {} first to sync.",
                style("`envy pull`").cyan()
            ));
            return Ok(());
        }
    }

    let commits_to_push = commits_ahead_of_remote()?;

    if commits_to_push.is_empty() {
        print_success("Everything up to date.");
        return Ok(());
    }

    let mut manifest_hashes = std::collections::HashSet::new();
    let mut blobs = std::collections::BTreeMap::new();

    // Walk oldest to newest so the latest commit's access policy wins when a
    // content-addressed blob appears in more than one commit.
    for commit_hash in commits_to_push.iter().rev() {
        let commit = load_commit(commit_hash)?;
        let pushed_manifest = load_manifest_by_hash(&commit.manifest_hash)?;
        manifest_hashes.insert(commit.manifest_hash);
        for entry in pushed_manifest.files.values() {
            blobs.insert(entry.blob_hash().to_string(), entry.clone());
        }
    }

    let total = blobs.len();
    let mut uploaded = 0;
    if total > 0 {
        print_header(&format!("Pushing {} file(s)", total));

        let pb = create_progress_bar(total as u64);

        for (hash, entry) in &blobs {
            let blob_path = Path::new(".envoy/cache").join(format!("{}.blob", hash));

            if !blob_path.exists() {
                anyhow::bail!("Missing blob {}", hash);
            }

            pb.set_message(format!("Uploading {}...", &hash[..8]));
            upload_blob(
                &client,
                &server,
                &token,
                &project.project_id,
                hash,
                &blob_path,
            )
            .await?;

            if let FileEntry::Managed(file) = entry {
                set_blob_access(
                    &client,
                    &server,
                    &token,
                    &project.project_id,
                    hash,
                    file.members.as_deref(),
                )
                .await?;
            }

            uploaded += 1;
            pb.inc(1);
        }

        pb.finish_and_clear();
    }

    print_header(&format!("Pushing {} commit(s)", commits_to_push.len()));
    let total_uploads = commits_to_push.len() + manifest_hashes.len() + 1; // commits + manifests + HEAD update
    let pb = create_progress_bar(total_uploads as u64);

    for manifest_hash in &manifest_hashes {
        pb.set_message(format!("Uploading manifest {}...", &manifest_hash[..8]));
        let manifest_blob_path = Path::new(".envoy/cache").join(format!("{}.blob", manifest_hash));
        upload_manifest(
            &client,
            &server,
            &token,
            &project.project_id,
            manifest_hash,
            &manifest_blob_path,
        )
        .await?;
        pb.inc(1);
    }

    for commit_hash in commits_to_push.iter().rev() {
        pb.set_message(format!("Uploading commit {}...", &commit_hash[..8]));
        let commit_path = commit_blob_path(commit_hash);

        upload_commit(
            &client,
            &server,
            &token,
            &project.project_id,
            commit_hash,
            &commit_path,
        )
        .await?;
        pb.inc(1);
    }

    pb.set_message("Updating remote HEAD...");
    let expected_head = remote_head_result.clone();
    match update_remote_head(
        &client,
        &server,
        &token,
        &project.project_id,
        &local_head,
        expected_head.as_deref(),
    )
    .await
    {
        Ok(_) => {
            write_remote_head(&local_head)?;
        }
        Err(e) => {
            print_error(&format!("Failed to update remote HEAD: {}", e));
            print_warn("Remote may have been updated by someone else.");
            print_info(&format!("Run {} first.", style("`envy pull`").cyan()));
            return Err(e);
        }
    }
    pb.inc(1);
    pb.finish_and_clear();

    let head_commit = load_commit(&local_head)?;
    write_applied(&head_commit.manifest_hash)?;

    println!();
    if uploaded > 0 {
        print_success(&format!("Uploaded {} file(s).", uploaded));
    }
    print_success(&format!("Pushed {} commit(s).", commits_to_push.len()));
    print_kv("HEAD", &local_head[..12]);

    Ok(())
}

async fn legacy_push(
    client: &reqwest::Client,
    server: &str,
    token: &str,
    project_id: &str,
    manifest: &crate::utils::manifest::Manifest,
) -> anyhow::Result<()> {
    let total = manifest.files.len();
    let mut uploaded = 0;

    if total > 0 {
        print_header(&format!("Pushing {} file(s)", total));

        let pb = create_progress_bar(total as u64);

        for entry in manifest.files.values() {
            let hash = entry.blob_hash();
            let blob_path = Path::new(".envoy/cache").join(format!("{}.blob", hash));

            if !blob_path.exists() {
                anyhow::bail!("Missing blob {}", hash);
            }

            pb.set_message(format!("Uploading {}...", &hash[..8]));
            upload_blob(client, server, token, project_id, hash, &blob_path).await?;

            uploaded += 1;
            pb.inc(1);
        }

        pb.finish_and_clear();
    }

    let pb = create_progress_bar(3);
    pb.set_message("Saving manifest...");
    let manifest_hash = save_manifest(manifest)?;
    pb.inc(1);
    let manifest_blob_path = Path::new(".envoy/cache").join(format!("{}.blob", manifest_hash));

    upload_manifest(
        client,
        server,
        token,
        project_id,
        &manifest_hash,
        &manifest_blob_path,
    )
    .await?;
    pb.inc(1);
    write_applied(&manifest_hash)?;
    pb.finish_and_clear();

    println!();
    if uploaded > 0 {
        print_success(&format!("Uploaded {} file(s).", uploaded));
    }
    print_success("Manifest saved.");
    print_kv("Manifest", &manifest_hash[..12]);

    Ok(())
}

use console::style;

use crate::utils::{
    manifest::{FileEntry, load_manifest, save_manifest},
    paths::validate_project_path,
    ui::{print_header, print_info, print_success},
};

enum AccessChange<'a> {
    Grant(&'a str),
    Revoke(&'a str),
    Unrestrict,
}

fn apply_change(
    file: &mut crate::utils::manifest::ManagedFile,
    change: AccessChange<'_>,
) -> anyhow::Result<()> {
    match change {
        AccessChange::Grant(user_id) => {
            let members = file.members.get_or_insert_with(Vec::new);
            if !members.iter().any(|member| member == user_id) {
                members.push(user_id.to_string());
                members.sort();
                members.dedup();
            }
        }
        AccessChange::Revoke(user_id) => {
            let members = file.members.as_mut().ok_or_else(|| {
                anyhow::anyhow!(
                    "The file is unrestricted. Grant the intended members first to create an allowlist."
                )
            })?;
            members.retain(|member| member != user_id);
        }
        AccessChange::Unrestrict => file.members = None,
    }
    Ok(())
}

fn update_access(path: &str, change: AccessChange<'_>) -> anyhow::Result<()> {
    let normalized = validate_project_path(path)?;
    let mut manifest = load_manifest()?;
    let entry = manifest
        .files
        .get_mut(&normalized)
        .ok_or_else(|| anyhow::anyhow!("File '{}' is not tracked.", normalized))?;

    let FileEntry::Managed(file) = entry else {
        anyhow::bail!(
            "'{}' uses legacy per-file encryption. Run `envy add -i {}` before managing access.",
            normalized,
            normalized
        );
    };

    apply_change(file, change)?;

    manifest.upgrade();
    save_manifest(&manifest)?;
    Ok(())
}

pub fn grant(path: &str, user_id: &str) -> anyhow::Result<()> {
    update_access(path, AccessChange::Grant(user_id))?;
    print_success(&format!("Granted '{}' access to '{}'.", user_id, path));
    print_info("Commit and push to publish this access policy.");
    Ok(())
}

pub fn revoke(path: &str, user_id: &str) -> anyhow::Result<()> {
    update_access(path, AccessChange::Revoke(user_id))?;
    print_success(&format!("Revoked '{}' access to '{}'.", user_id, path));
    print_info("Commit and push to publish this access policy.");
    Ok(())
}

pub fn unrestrict(path: &str) -> anyhow::Result<()> {
    update_access(path, AccessChange::Unrestrict)?;
    print_success(&format!("'{}' is available to every project member.", path));
    print_info("Commit and push to publish this access policy.");
    Ok(())
}

pub fn list(path: &str) -> anyhow::Result<()> {
    let normalized = validate_project_path(path)?;
    let manifest = load_manifest()?;
    let entry = manifest
        .files
        .get(&normalized)
        .ok_or_else(|| anyhow::anyhow!("File '{}' is not tracked.", normalized))?;
    let FileEntry::Managed(file) = entry else {
        anyhow::bail!("'{}' uses legacy project-wide access.", normalized);
    };

    print_header(&format!("Access: {}", normalized));
    match &file.members {
        None => print_info("Every project member"),
        Some(members) if members.is_empty() => print_info("Project owner only"),
        Some(members) => {
            print_info("Project owner, plus:");
            for member in members {
                println!("  {} {}", style("•").cyan(), member);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::utils::manifest::{FileEncryption, ManagedFile};

    use super::*;

    #[test]
    fn grant_list_is_sorted_and_unique() {
        let mut file = ManagedFile {
            blob_hash: "blob".to_string(),
            content_hash: "content".to_string(),
            encryption: FileEncryption::ProjectKey,
            members: Some(vec!["b".to_string()]),
        };
        apply_change(&mut file, AccessChange::Grant("a")).unwrap();
        apply_change(&mut file, AccessChange::Grant("b")).unwrap();

        assert_eq!(file.members, Some(vec!["a".to_string(), "b".to_string()]));
    }

    #[test]
    fn revoke_from_unrestricted_requires_an_allowlist() {
        let mut file = ManagedFile {
            blob_hash: "blob".to_string(),
            content_hash: "content".to_string(),
            encryption: FileEncryption::ProjectKey,
            members: None,
        };

        assert!(apply_change(&mut file, AccessChange::Revoke("member")).is_err());
        assert_eq!(file.members, None);
    }

    #[test]
    fn unrestrict_removes_explicit_policy() {
        let mut file = ManagedFile {
            blob_hash: "blob".to_string(),
            content_hash: "content".to_string(),
            encryption: FileEncryption::ProjectKey,
            members: Some(vec!["member".to_string()]),
        };

        apply_change(&mut file, AccessChange::Unrestrict).unwrap();
        assert_eq!(file.members, None);
    }
}

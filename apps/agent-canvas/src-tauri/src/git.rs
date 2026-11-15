use super::*;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    status: String,
    recent_commits: String,
    diff_stat: String,
}

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .env("PATH", cli_path())
        .env("GIT_OPTIONAL_LOCKS", "0")
        .args(["-C", cwd])
        .args(args)
        .output()
        .map_err(err)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

#[tauri::command]
pub async fn git_snapshot(
    state: tauri::State<'_, State>,
    id: String,
) -> Result<GitSnapshot, String> {
    let cwd = state
        .agents
        .lock()
        .map_err(err)?
        .get(&id)
        .ok_or("Agent is no longer available")?
        .cwd
        .clone();
    tauri::async_runtime::spawn_blocking(move || inspect(&cwd))
        .await
        .map_err(err)?
}

fn inspect(cwd: &str) -> Result<GitSnapshot, String> {
    Ok(GitSnapshot {
        status: git(
            cwd,
            &["status", "--short", "--branch", "--untracked-files=normal"],
        )?,
        // A new repository has no HEAD yet; status still remains useful.
        recent_commits: git(cwd, &["log", "-5", "--format=%h %s"]).unwrap_or_default(),
        diff_stat: git(cwd, &["diff", "HEAD", "--stat"]).unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_branch_staged_and_untracked_files() {
        let dir = std::env::temp_dir().join(format!("canvas-git-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let cwd = dir.to_str().unwrap();
        git(cwd, &["init", "-b", "canvas-test"]).unwrap();
        std::fs::write(dir.join("staged.txt"), "new\n").unwrap();
        git(cwd, &["add", "staged.txt"]).unwrap();
        std::fs::write(dir.join("untracked.txt"), "new\n").unwrap();
        let snapshot = inspect(cwd).unwrap();
        assert!(snapshot.status.contains("canvas-test"));
        assert!(snapshot.status.contains("A  staged.txt"));
        assert!(snapshot.status.contains("?? untracked.txt"));
        assert!(snapshot.recent_commits.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

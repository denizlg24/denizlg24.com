use super::*;
use std::process::{Command, Output as ProcessOutput};

const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_FILES: usize = 1000;
const MAX_DIFF_BYTES: usize = 400_000;
const MAX_COUNTED_BYTES: u64 = 1_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChanges {
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<FileChange>,
    files_truncated: bool,
    commits: Vec<Commit>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    path: String,
    old_path: Option<String>,
    status: char,
    staged: bool,
    /// Has work-tree changes not yet in the index (untracked files included).
    unstaged: bool,
    additions: Option<u32>,
    deletions: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    hash: String,
    subject: String,
    when: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    diff: String,
    binary: bool,
    truncated: bool,
}

fn run(cwd: &str, args: &[&str]) -> Result<ProcessOutput, String> {
    Command::new("git")
        .env("PATH", cli_path())
        // Never wait on a credential or editor prompt nobody can answer.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .stdin(std::process::Stdio::null())
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .args(["-C", cwd, "-c", "core.quotepath=off"])
        .args(args)
        .output()
        .map_err(err)
}

fn git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let output = run(cwd, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string())
}

fn agent_cwd(state: &State, id: &str) -> Result<String, String> {
    Ok(state
        .agents
        .lock()
        .map_err(err)?
        .get(id)
        .ok_or("Agent is no longer available")?
        .cwd
        .clone())
}

fn toplevel(cwd: &str) -> Result<String, String> {
    git(cwd, &["rev-parse", "--show-toplevel"]).map_err(|e| {
        if e.contains("not a git repository") {
            "Not a Git repository".into()
        } else {
            e
        }
    })
}

// A repository without commits has no HEAD; diffing against the empty tree
// shows every staged file as an addition instead of failing.
fn base(root: &str) -> &'static str {
    if git(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok() {
        "HEAD"
    } else {
        EMPTY_TREE
    }
}

#[tauri::command]
pub async fn git_changes(state: tauri::State<'_, State>, id: String) -> Result<GitChanges, String> {
    let cwd = agent_cwd(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || changes(&cwd))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn git_file_diff(
    state: tauri::State<'_, State>,
    id: String,
    path: String,
    old_path: Option<String>,
    untracked: bool,
) -> Result<FileDiff, String> {
    let cwd = agent_cwd(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        file_diff(&cwd, &path, old_path.as_deref(), untracked)
    })
    .await
    .map_err(err)?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GitAction {
    Stage { paths: Vec<String> },
    Unstage { paths: Vec<String> },
    Discard { paths: Vec<String> },
    Commit { message: String },
    Fetch,
    Pull,
    Push,
}

#[tauri::command]
pub async fn git_action(
    state: tauri::State<'_, State>,
    id: String,
    action: GitAction,
) -> Result<String, String> {
    let cwd = agent_cwd(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || perform(&cwd, action))
        .await
        .map_err(err)?
}

fn checked(paths: &[String]) -> Result<Vec<&str>, String> {
    if paths.is_empty() || paths.iter().any(|p| !inside_repository(p)) {
        return Err("Invalid repository path".into());
    }
    Ok(paths.iter().map(String::as_str).collect())
}

fn perform(cwd: &str, action: GitAction) -> Result<String, String> {
    let root = toplevel(cwd)?;
    let with = |head: &[&str], paths: &[&str]| -> Result<String, String> {
        let mut args = head.to_vec();
        args.push("--");
        args.extend(paths);
        git(&root, &args)
    };
    match action {
        GitAction::Stage { paths } => with(&["add", "--all"], &checked(&paths)?),
        GitAction::Unstage { paths } => {
            let paths = checked(&paths)?;
            if base(&root) == "HEAD" {
                with(&["restore", "--staged"], &paths)
            } else {
                with(&["rm", "--cached", "-r", "--quiet"], &paths)
            }
        }
        GitAction::Discard { paths } => {
            for path in checked(&paths)? {
                let tracked = git(&root, &["ls-files", "--error-unmatch", "--", path]).is_ok();
                let committed = base(&root) == "HEAD"
                    && git(&root, &["cat-file", "-e", &format!("HEAD:{path}")]).is_ok();
                if committed {
                    with(
                        &["restore", "--source=HEAD", "--staged", "--worktree"],
                        &[path],
                    )?;
                } else {
                    if tracked {
                        with(&["rm", "--cached", "-r", "--quiet"], &[path])?;
                    }
                    with(&["clean", "-f", "-d"], &[path])?;
                }
            }
            Ok(String::new())
        }
        GitAction::Commit { message } => {
            if message.trim().is_empty() {
                return Err("Write a commit message".into());
            }
            git(&root, &["commit", "-m", message.trim()])
        }
        GitAction::Fetch => git(&root, &["fetch", "--prune"]),
        GitAction::Pull => git(&root, &["pull", "--ff-only"]),
        GitAction::Push => {
            let has_upstream = git(&root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_ok();
            if has_upstream {
                git(&root, &["push"])
            } else {
                git(&root, &["push", "-u", "origin", "HEAD"])
            }
        }
    }
}

fn changes(cwd: &str) -> Result<GitChanges, String> {
    let root = toplevel(cwd)?;
    let status = git(
        &root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
        ],
    )?;
    let mut result = parse_status(&status);
    let counts = parse_numstat(
        &git(&root, &["diff", base(&root), "-M", "--numstat", "-z"]).unwrap_or_default(),
    );
    for file in &mut result.files {
        if file.status == '?' {
            if let Some(lines) = count_lines(&Path::new(&root).join(&file.path)) {
                file.additions = Some(lines);
                file.deletions = Some(0);
            }
        } else if let Some(&(additions, deletions)) = counts.get(&file.path) {
            file.additions = additions;
            file.deletions = deletions;
        }
    }
    // A new repository has no history yet; status remains useful without it.
    result.commits = git(&root, &["log", "-8", "--format=%h%x1f%s%x1f%cr%x1e"])
        .unwrap_or_default()
        .split('\x1e')
        .filter_map(|entry| {
            let mut parts = entry.trim().splitn(3, '\x1f');
            Some(Commit {
                hash: parts.next().filter(|h| !h.is_empty())?.into(),
                subject: parts.next()?.into(),
                when: parts.next()?.into(),
            })
        })
        .collect();
    Ok(result)
}

fn parse_status(raw: &str) -> GitChanges {
    let mut result = GitChanges {
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        files: Vec::new(),
        files_truncated: false,
        commits: Vec::new(),
    };
    let mut tokens = raw.split('\0');
    while let Some(entry) = tokens.next() {
        let (kind, rest) = entry.split_once(' ').unwrap_or((entry, ""));
        let change = match kind {
            "#" => {
                if let Some(head) = rest.strip_prefix("branch.head ") {
                    result.branch = (head != "(detached)").then(|| head.into());
                } else if let Some(upstream) = rest.strip_prefix("branch.upstream ") {
                    result.upstream = Some(upstream.into());
                } else if let Some(ab) = rest.strip_prefix("branch.ab ") {
                    for part in ab.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            result.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            result.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                continue;
            }
            "1" | "2" | "u" => {
                let fields_before_path = match kind {
                    "1" => 6,
                    "2" => 7,
                    _ => 8,
                };
                let mut parts = rest.splitn(fields_before_path + 2, ' ');
                let mut xy = parts.next().unwrap_or_default().chars();
                let index = xy.next().unwrap_or('.');
                let worktree = xy.next().unwrap_or('.');
                let path = parts
                    .nth(fields_before_path)
                    .unwrap_or_default()
                    .to_string();
                let old_path = (kind == "2").then(|| tokens.next().unwrap_or_default().into());
                FileChange {
                    path,
                    old_path,
                    status: if kind == "u" {
                        'U'
                    } else if "ARCD".contains(index) || worktree == '.' {
                        index
                    } else {
                        worktree
                    },
                    staged: kind != "u" && index != '.',
                    unstaged: kind == "u" || worktree != '.',
                    additions: None,
                    deletions: None,
                }
            }
            "?" => FileChange {
                path: rest.into(),
                old_path: None,
                status: '?',
                staged: false,
                unstaged: true,
                additions: None,
                deletions: None,
            },
            _ => continue,
        };
        if result.files.len() == MAX_FILES {
            result.files_truncated = true;
            break;
        }
        result.files.push(change);
    }
    result
}

type LineCounts = HashMap<String, (Option<u32>, Option<u32>)>;

fn parse_numstat(raw: &str) -> LineCounts {
    let mut counts = HashMap::new();
    let mut tokens = raw.split('\0');
    while let Some(entry) = tokens.next() {
        let mut parts = entry.splitn(3, '\t');
        let (Some(additions), Some(deletions), Some(path)) =
            (parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        // Renames leave the path field empty and follow it with old and new paths.
        let path = if path.is_empty() {
            tokens.next();
            tokens.next().unwrap_or_default()
        } else {
            path
        };
        counts.insert(
            path.to_string(),
            (additions.parse().ok(), deletions.parse().ok()),
        );
    }
    counts
}

fn count_lines(path: &Path) -> Option<u32> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_COUNTED_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count();
    let unterminated = bytes.last().is_some_and(|&b| b != b'\n');
    Some((newlines + usize::from(unterminated)) as u32)
}

fn inside_repository(path: &str) -> bool {
    let path = Path::new(path);
    !path.as_os_str().is_empty()
        && path.is_relative()
        && path
            .components()
            .all(|c| matches!(c, std::path::Component::Normal(_)))
}

fn file_diff(
    cwd: &str,
    path: &str,
    old_path: Option<&str>,
    untracked: bool,
) -> Result<FileDiff, String> {
    if !inside_repository(path) || old_path.is_some_and(|p| !inside_repository(p)) {
        return Err("Invalid repository path".into());
    }
    let root = toplevel(cwd)?;
    let output = if untracked {
        // --no-index exits 1 whenever the files differ, which is always here.
        run(
            &root,
            &[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-index",
                "--",
                "/dev/null",
                path,
            ],
        )?
    } else {
        let mut args = vec![
            "diff",
            base(&root),
            "-M",
            "--no-color",
            "--no-ext-diff",
            "--",
            path,
        ];
        args.extend(old_path);
        run(&root, &args)?
    };
    if output.status.code().is_none_or(|code| code > 1) {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let truncated = output.stdout.len() > MAX_DIFF_BYTES;
    let mut end = output.stdout.len().min(MAX_DIFF_BYTES);
    if truncated {
        end = output.stdout[..end]
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(end, |n| n + 1);
    }
    let diff = String::from_utf8_lossy(&output.stdout[..end]).into_owned();
    Ok(FileDiff {
        binary: diff
            .lines()
            .any(|l| l.starts_with("Binary files ") && l.ends_with(" differ")),
        diff,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository() -> (PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("canvas-git-{}", Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        let cwd = dir.to_str().unwrap().to_string();
        git(&cwd, &["init", "-b", "canvas-test"]).unwrap();
        git(&cwd, &["config", "user.email", "canvas@example.com"]).unwrap();
        git(&cwd, &["config", "user.name", "Canvas"]).unwrap();
        (dir, cwd)
    }

    #[test]
    fn reports_staged_untracked_and_counts_before_first_commit() {
        let (dir, cwd) = repository();
        std::fs::write(dir.join("staged.txt"), "one\ntwo\n").unwrap();
        git(&cwd, &["add", "staged.txt"]).unwrap();
        std::fs::write(dir.join("nested/untracked.txt"), "a\nb\nc").unwrap();
        let result = changes(dir.join("nested").to_str().unwrap()).unwrap();
        assert_eq!(result.branch.as_deref(), Some("canvas-test"));
        assert!(result.commits.is_empty());
        let staged = result
            .files
            .iter()
            .find(|f| f.path == "staged.txt")
            .unwrap();
        assert_eq!((staged.status, staged.staged), ('A', true));
        assert_eq!((staged.additions, staged.deletions), (Some(2), Some(0)));
        let untracked = result
            .files
            .iter()
            .find(|f| f.path == "nested/untracked.txt")
            .unwrap();
        assert_eq!((untracked.status, untracked.additions), ('?', Some(3)));
        let diff = file_diff(&cwd, "nested/untracked.txt", None, true).unwrap();
        assert!(diff.diff.contains("+c"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reports_renames_modifications_and_history() {
        let (dir, cwd) = repository();
        std::fs::write(dir.join("old name.txt"), "same\ncontent\nhere\n").unwrap();
        std::fs::write(dir.join("edit.txt"), "before\n").unwrap();
        git(&cwd, &["add", "."]).unwrap();
        git(&cwd, &["commit", "-m", "Initial"]).unwrap();
        git(&cwd, &["mv", "old name.txt", "new name.txt"]).unwrap();
        std::fs::write(dir.join("edit.txt"), "after\nmore\n").unwrap();
        let result = changes(&cwd).unwrap();
        assert_eq!(result.commits[0].subject, "Initial");
        let renamed = result
            .files
            .iter()
            .find(|f| f.path == "new name.txt")
            .unwrap();
        assert_eq!(renamed.status, 'R');
        assert_eq!(renamed.old_path.as_deref(), Some("old name.txt"));
        let edited = result.files.iter().find(|f| f.path == "edit.txt").unwrap();
        assert_eq!((edited.status, edited.staged), ('M', false));
        assert_eq!((edited.additions, edited.deletions), (Some(2), Some(1)));
        let diff = file_diff(&cwd, "edit.txt", None, false).unwrap();
        assert!(diff.diff.contains("-before") && diff.diff.contains("+after"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stages_unstages_commits_and_discards() {
        let (dir, cwd) = repository();
        std::fs::write(dir.join("tracked.txt"), "one\n").unwrap();
        perform(
            &cwd,
            GitAction::Stage {
                paths: vec!["tracked.txt".into()],
            },
        )
        .unwrap();
        perform(
            &cwd,
            GitAction::Commit {
                message: "first".into(),
            },
        )
        .unwrap();
        std::fs::write(dir.join("tracked.txt"), "two\n").unwrap();
        std::fs::write(dir.join("new.txt"), "new\n").unwrap();
        perform(
            &cwd,
            GitAction::Stage {
                paths: vec!["new.txt".into()],
            },
        )
        .unwrap();
        let staged = changes(&cwd).unwrap();
        let new = staged.files.iter().find(|f| f.path == "new.txt").unwrap();
        assert!(new.staged && !new.unstaged);
        perform(
            &cwd,
            GitAction::Unstage {
                paths: vec!["new.txt".into()],
            },
        )
        .unwrap();
        assert!(!changes(&cwd).unwrap().files.iter().any(|f| f.staged));
        std::fs::write(dir.join("added.txt"), "added\n").unwrap();
        perform(
            &cwd,
            GitAction::Stage {
                paths: vec!["added.txt".into()],
            },
        )
        .unwrap();
        perform(
            &cwd,
            GitAction::Discard {
                paths: vec!["added.txt".into()],
            },
        )
        .unwrap();
        assert!(!dir.join("added.txt").exists());
        perform(
            &cwd,
            GitAction::Discard {
                paths: vec!["tracked.txt".into(), "new.txt".into()],
            },
        )
        .unwrap();
        assert!(changes(&cwd).unwrap().files.is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.join("tracked.txt")).unwrap(),
            "one\n"
        );
        assert!(perform(
            &cwd,
            GitAction::Discard {
                paths: vec!["../x".into()]
            }
        )
        .is_err());
        assert!(perform(
            &cwd,
            GitAction::Commit {
                message: " ".into()
            }
        )
        .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_paths_outside_the_repository() {
        let (dir, cwd) = repository();
        assert!(file_diff(&cwd, "../outside", None, true).is_err());
        assert!(file_diff(&cwd, "/etc/hosts", None, true).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

use std::{fs, path::Path, process::Command};

fn run(project: &Path, home: &Path, arguments: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_envy"))
        .args(arguments)
        .current_dir(project)
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("ENVOY_HOME", home.join(".envoy"))
        .env("ENVOY_NO_UPDATE_CHECK", "1")
        .env("NO_COLOR", "1")
        .output()
        .unwrap()
}

fn assert_success(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "command failed\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    stdout.into_owned()
}

fn prepare_project() -> (tempfile::TempDir, tempfile::TempDir) {
    let project = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    fs::create_dir_all(project.path().join(".envoy/cache/commits")).unwrap();
    fs::write(
        project.path().join(".envoy/config.toml"),
        r#"
version = 1
project_id = "00000000-0000-0000-0000-000000000001"
name = "CLI test"
default_remote = "origin"

[remotes]
origin = "http://127.0.0.1:9/api"
"#,
    )
    .unwrap();
    (project, home)
}

#[test]
fn add_diff_commit_and_remove_follow_git_like_workflow() {
    let (project, home) = prepare_project();
    let env_path = project.path().join(".env");
    fs::write(&env_path, "API_KEY=first\nUNCHANGED=value\n").unwrap();

    assert_success(&run(
        project.path(),
        home.path(),
        &["add", ".env", "-p", "project-secret"],
    ));
    let staged = assert_success(&run(
        project.path(),
        home.path(),
        &["diff", "--cached", "-p", "project-secret"],
    ));
    assert!(staged.contains("new file"));
    assert!(staged.contains("API_KEY=<redacted>"));
    assert!(!staged.contains("first"));

    assert_success(&run(
        project.path(),
        home.path(),
        &[
            "commit",
            "-m",
            "initial",
            "--author",
            "test",
            "-p",
            "project-secret",
        ],
    ));

    fs::write(&env_path, "API_KEY=second\nUNCHANGED=value\nNEW_KEY=new\n").unwrap();
    let working = assert_success(&run(
        project.path(),
        home.path(),
        &["diff", "-p", "project-secret"],
    ));
    assert!(working.contains("modified"));
    assert!(working.contains("NEW_KEY=<redacted>"));
    assert!(!working.contains("second"));

    assert_success(&run(
        project.path(),
        home.path(),
        &["rm", ".env", "-p", "project-secret"],
    ));
    assert!(!env_path.exists());

    let deletion = assert_success(&run(
        project.path(),
        home.path(),
        &["diff", "--cached", "-p", "project-secret"],
    ));
    assert!(deletion.contains("deleted file"));
}

#[test]
fn legacy_encrypt_command_remains_available() {
    let (project, home) = prepare_project();
    fs::write(project.path().join(".env"), "LEGACY_SECRET=value\n").unwrap();

    // A real project gets this session during `envy init`; prime it with the
    // offline `add` path so this test does not require the production API.
    assert_success(&run(
        project.path(),
        home.path(),
        &["add", "-i", ".env", "-p", "project-secret"],
    ));

    assert_success(&run(
        project.path(),
        home.path(),
        &["encrypt", "-i", ".env", "-p", "legacy-file-passphrase"],
    ));

    let latest = fs::read_to_string(project.path().join(".envoy/latest")).unwrap();
    let blob = fs::read(project.path().join(format!(".envoy/cache/{}.blob", latest))).unwrap();
    assert_eq!(blob[0], 2, "manifest remains project-key encrypted");
}

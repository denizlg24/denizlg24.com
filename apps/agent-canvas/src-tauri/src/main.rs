#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod model;
mod options;
#[cfg(debug_assertions)]
mod smoke;
mod telemetry;
use model::Agent;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
use uuid::Uuid;

type Agents = Arc<Mutex<HashMap<String, Agent>>>;
#[derive(Default)]
struct Output {
    next: u64,
    bytes: usize,
    chunks: VecDeque<(u64, Vec<u8>)>,
}
impl Output {
    fn push(&mut self, b: Vec<u8>) {
        self.next += 1;
        self.bytes += b.len();
        self.chunks.push_back((self.next, b));
        while self.bytes > 2_000_000 {
            if let Some((_, b)) = self.chunks.pop_front() {
                self.bytes -= b.len();
            }
        }
    }
}
struct Session {
    pid: Option<u32>,
    stop_requested: Arc<AtomicBool>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    output: Arc<Mutex<Output>>,
    alive: Arc<AtomicBool>,
}
impl Session {
    fn terminate(&self) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Ok(());
        }
        self.stop_requested.store(true, Ordering::Release);
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            // A PTY child is a session leader. Signal its process group too,
            // so tool processes do not outlive a stopped agent.
            unsafe {
                if libc::getpgid(pid as i32) == pid as i32 {
                    libc::kill(-(pid as i32), libc::SIGHUP);
                }
            }
        }
        if let Err(e) = self.killer.lock().map_err(err)?.kill() {
            #[cfg(unix)]
            if e.raw_os_error() == Some(libc::ESRCH) {
                return Ok(());
            }
            if !self.alive.load(Ordering::Acquire) {
                return Ok(());
            }
            return Err(err(e));
        }
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            let alive = self.alive.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(1));
                if alive.load(Ordering::Acquire) {
                    unsafe {
                        if libc::getpgid(pid as i32) == pid as i32 {
                            libc::kill(-(pid as i32), libc::SIGKILL);
                        } else {
                            libc::kill(pid as i32, libc::SIGKILL);
                        }
                    }
                }
            });
        }
        Ok(())
    }
}
#[derive(Default)]
struct State {
    agents: Agents,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}
fn cli_path() -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    dirs.extend([
        home().join(".local/bin"),
        home().join(".bun/bin"),
        home().join(".npm-global/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    std::env::join_paths(dirs).unwrap_or_default()
}
fn resolve(provider: &str) -> Result<PathBuf, String> {
    if !["codex", "claude"].contains(&provider) {
        return Err("Choose Codex or Claude".into());
    }
    let mut dirs: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    dirs.extend([
        home().join(".local/bin"),
        home().join(".bun/bin"),
        home().join(".npm-global/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    for d in dirs {
        let p = d.join(provider);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(format!(
        "{provider} is not installed. Install and sign in to its CLI, then try again."
    ))
}
fn codex_home(dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(err)?;
    let source = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".codex"));
    for name in [
        "auth.json",
        "config.toml",
        "AGENTS.md",
        "skills",
        "plugins",
        "rules",
        "vendor_imports",
    ] {
        let from = source.join(name);
        let to = dest.join(name);
        if from.exists() && !to.exists() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(from, to).map_err(err)?;
            #[cfg(windows)]
            {
                if from.is_dir() {
                    std::os::windows::fs::symlink_dir(from, to).map_err(err)?;
                } else {
                    std::os::windows::fs::symlink_file(from, to).map_err(err)?;
                }
            }
        }
    }
    Ok(())
}
#[tauri::command]
fn providers() -> HashMap<String, bool> {
    ["codex", "claude"]
        .into_iter()
        .map(|p| (p.into(), resolve(p).is_ok()))
        .collect()
}
#[tauri::command]
fn snapshot(state: tauri::State<State>) -> Result<Vec<Agent>, String> {
    Ok(state
        .agents
        .lock()
        .map_err(err)?
        .values()
        .cloned()
        .collect())
}
#[tauri::command]
fn create_agent(
    app: tauri::AppHandle,
    state: tauri::State<State>,
    provider: String,
    cwd: String,
    options: Option<options::LaunchOptions>,
) -> Result<Agent, String> {
    let data_root = app.path().app_local_data_dir().map_err(err)?;
    launch(
        &state,
        &data_root,
        provider,
        cwd,
        None,
        options.unwrap_or_default(),
    )
}
fn launch(
    state: &State,
    data_root: &Path,
    provider: String,
    cwd: String,
    prompt: Option<&str>,
    options: options::LaunchOptions,
) -> Result<Agent, String> {
    let extra_args = options.arguments(&provider)?;
    let exe = resolve(&provider)?;
    let directory =
        std::fs::canonicalize(&cwd).map_err(|e| format!("Cannot open directory: {e}"))?;
    if !directory.is_dir() {
        return Err("Choose a directory".into());
    }
    let cwd = directory.to_string_lossy().into_owned();
    let id = Uuid::new_v4().to_string();
    let data = data_root.join("sessions").join(&id);
    let hook_dir = data.join("hooks");
    std::fs::create_dir_all(&hook_dir).map_err(err)?;
    let mut cmd = CommandBuilder::new(exe);
    cmd.cwd(&directory);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("PATH", cli_path());
    // The manager may itself be launched from an agent terminal.
    for key in [
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "CODEX_THREAD_ID",
        "CODEX_SESSION_ID",
    ] {
        cmd.env_remove(key);
    }
    let log_dir = if provider == "codex" {
        let ch = data.join("codex");
        codex_home(&ch)?;
        cmd.env("CODEX_HOME", &ch);
        cmd.args(["--no-daemon", "--no-alt-screen"]);
        ch.join("sessions")
    } else {
        cmd.args([
            "--session-id",
            &id,
            "--settings",
            &telemetry::claude_settings(&std::env::current_exe().map_err(err)?, &hook_dir)
                .to_string(),
        ]);
        let ch = std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".claude"));
        let project: String = cwd
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        ch.join("projects").join(project)
    };
    cmd.args(extra_args);
    if let Some(prompt) = prompt {
        cmd.arg(prompt);
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 32,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(err)?;
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Could not launch {provider}: {e}"))?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;
    let killer = child.clone_killer();
    let output = Arc::new(Mutex::new(Output::default()));
    let alive = Arc::new(AtomicBool::new(true));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let session = Arc::new(Session {
        stop_requested: stop_requested.clone(),
        pid: child.process_id(),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
        output: output.clone(),
        alive: alive.clone(),
    });
    let mut agent = Agent::root(&id, &provider, &cwd);
    agent.settings = Some(options);
    state
        .agents
        .lock()
        .map_err(err)?
        .insert(id.clone(), agent.clone());
    state
        .sessions
        .lock()
        .map_err(err)?
        .insert(id.clone(), session);
    let out = output.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut b = [0; 8192];
        loop {
            match reader.read(&mut b) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if let Ok(mut o) = out.lock() {
                        o.push(b[..n].to_vec());
                    }
                }
            }
        }
    });
    let agents = state.agents.clone();
    let root = agent.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        alive.store(false, Ordering::Release);
        if let Ok(mut agents) = agents.lock() {
            for a in agents.values_mut().filter(|a| a.root_id == root.id) {
                if a.status == "done" {
                    continue;
                }
                a.status = if stop_requested.load(Ordering::Acquire)
                    || status.as_ref().is_ok_and(|s| s.success())
                {
                    "stopped"
                } else {
                    "error"
                }
                .into();
                a.activity = match &status {
                    Ok(s) => format!("CLI exited ({s})"),
                    Err(e) => format!("CLI exited: {e}"),
                };
            }
        }
    });
    let agents = state.agents.clone();
    let root = agent.clone();
    let alive = state.sessions.lock().map_err(err)?[&id].alive.clone();
    let stopping = state.sessions.lock().map_err(err)?[&id]
        .stop_requested
        .clone();
    std::thread::spawn(move || {
        let mut tracker = telemetry::Tracker::default();
        while alive.load(Ordering::Acquire) && !stopping.load(Ordering::Acquire) {
            if let Ok(mut a) = agents.lock() {
                if !alive.load(Ordering::Acquire) || stopping.load(Ordering::Acquire) {
                    break;
                }
                tracker.poll(&root, &log_dir, &hook_dir, &mut a);
            }
            std::thread::sleep(Duration::from_millis(700));
        }
    });
    Ok(agent)
}
fn session(state: &State, id: &str) -> Result<Arc<Session>, String> {
    state
        .sessions
        .lock()
        .map_err(err)?
        .get(id)
        .cloned()
        .ok_or_else(|| "Terminal is no longer available".into())
}
#[tauri::command]
fn write_terminal(state: tauri::State<State>, id: String, data: String) -> Result<(), String> {
    let s = session(&state, &id)?;
    if !s.alive.load(Ordering::Acquire) {
        return Err("CLI has exited".into());
    }
    let mut w = s.writer.lock().map_err(err)?;
    w.write_all(data.as_bytes()).map_err(err)?;
    w.flush().map_err(err)
}
#[tauri::command]
fn resize_terminal(
    state: tauri::State<State>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let s = session(&state, &id)?;
    let result = s
        .master
        .lock()
        .map_err(err)?
        .resize(PtySize {
            cols: cols.clamp(2, 500),
            rows: rows.clamp(2, 200),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(err);
    result
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalRead {
    chunks: Vec<Vec<u8>>,
    cursor: u64,
    truncated: bool,
}
#[tauri::command]
fn read_terminal(
    state: tauri::State<State>,
    id: String,
    after: u64,
) -> Result<TerminalRead, String> {
    let s = session(&state, &id)?;
    let o = s.output.lock().map_err(err)?;
    let selected: Vec<_> = o
        .chunks
        .iter()
        .filter(|(n, _)| *n > after)
        .take(32)
        .collect();
    Ok(TerminalRead {
        cursor: selected.last().map(|(n, _)| *n).unwrap_or(after),
        chunks: selected.iter().map(|(_, b)| b.clone()).collect(),
        truncated: o.chunks.front().is_some_and(|(n, _)| after + 1 < *n),
    })
}
#[tauri::command]
fn stop_agent(state: tauri::State<State>, id: String) -> Result<(), String> {
    let s = session(&state, &id)?;
    s.terminate()?;
    forget_root(&state, &id)
}
fn forget_root(state: &State, id: &str) -> Result<(), String> {
    state
        .agents
        .lock()
        .map_err(err)?
        .retain(|_, a| a.root_id != id);
    state.sessions.lock().map_err(err)?.remove(id);
    Ok(())
}
fn capture_hook() -> bool {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--capture-hook") {
        return false;
    }
    if let Some(dir) = args.get(2) {
        let mut data = Vec::new();
        if std::io::stdin()
            .take(1024 * 1024)
            .read_to_end(&mut data)
            .is_ok()
        {
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = Path::new(dir).join(format!("{stamp:030}-{}.json", Uuid::new_v4()));
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, &data).is_ok() {
                let _ = std::fs::rename(tmp, path);
            }
        }
    }
    true
}
fn main() {
    #[cfg(debug_assertions)]
    {
        let args: Vec<_> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("--smoke") {
            smoke::run(&args);
            return;
        }
    }
    if capture_hook() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            options::available_models,
            providers,
            snapshot,
            create_agent,
            read_terminal,
            write_terminal,
            resize_terminal,
            stop_agent
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Agents")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<State>();
                if let Ok(sessions) = state.sessions.lock() {
                    for s in sessions.values() {
                        let _ = s.terminate();
                    }
                };
            }
        });
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[test]
    fn stop_forgets_root_and_every_descendant() {
        let state = State::default();
        for (id, root, parent) in [
            ("a", "a", None),
            ("b", "a", Some("a")),
            ("c", "a", Some("b")),
            ("other", "other", None),
        ] {
            let mut agent = Agent::root(id, "codex", "/tmp");
            agent.root_id = root.into();
            agent.parent_id = parent.map(String::from);
            state.agents.lock().unwrap().insert(id.into(), agent);
        }
        forget_root(&state, "a").unwrap();
        let agents = state.agents.lock().unwrap();
        assert_eq!(agents.len(), 1);
        assert!(agents.contains_key("other"));
    }
    #[cfg(unix)]
    #[test]
    fn stop_terminates_even_when_hangup_is_ignored() {
        use std::io::BufRead;
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "trap '' HUP; printf 'ready\n'; sleep 30"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = std::io::BufReader::new(pair.master.try_clone_reader().unwrap());
        let mut ready = String::new();
        reader.read_line(&mut ready).unwrap();
        assert!(ready.contains("ready"));
        let s = Session {
            pid: child.process_id(),
            stop_requested: Arc::new(AtomicBool::new(false)),
            writer: Mutex::new(pair.master.take_writer().unwrap()),
            master: Mutex::new(pair.master),
            killer: Mutex::new(child.clone_killer()),
            output: Arc::new(Mutex::new(Output::default())),
            alive: Arc::new(AtomicBool::new(true)),
        };
        s.terminate().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut exited = false;
        while std::time::Instant::now() < deadline {
            if child.try_wait().unwrap().is_some() {
                exited = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        s.alive.store(false, Ordering::Release);
        if !exited {
            unsafe {
                libc::kill(s.pid.unwrap() as i32, libc::SIGKILL);
            }
        }
        assert!(exited, "Stop must terminate an unresponsive CLI");
    }
}

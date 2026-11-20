#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod delegation;
mod git;
mod mcp;
mod model;
mod options;
mod persistence;
#[cfg(debug_assertions)]
mod smoke;
mod telemetry;
use model::Agent;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
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
#[derive(Default, Clone, Serialize, Deserialize)]
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
    reader_done: Arc<AtomicBool>,
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
    archived: Mutex<HashMap<String, Output>>,
    storage: Mutex<Option<PathBuf>>,
    checkpoint: Mutex<()>,
    lifecycle: Mutex<()>,
    notices: delegation::Notices,
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
    let agent = launch(
        &state,
        &data_root,
        provider,
        cwd,
        None,
        options.unwrap_or_default(),
    )?;
    Ok(persistence::checkpoint_launch(&state, agent))
}
fn launch(
    state: &State,
    data_root: &Path,
    provider: String,
    cwd: String,
    prompt: Option<&str>,
    options: options::LaunchOptions,
) -> Result<Agent, String> {
    let _lifecycle = state.lifecycle.lock().map_err(err)?;
    launch_with_parent(
        state,
        data_root,
        provider,
        cwd,
        prompt,
        options,
        Lineage::Root,
    )
}
fn launch_child(
    state: &State,
    data_root: &Path,
    parent: &Agent,
    name: &str,
    prompt: &str,
) -> Result<Agent, String> {
    let _lifecycle = state.lifecycle.lock().map_err(err)?;
    if !state.agents.lock().map_err(err)?.contains_key(&parent.id)
        || !session(state, &parent.id)?.alive.load(Ordering::Acquire)
    {
        return Err("Parent CLI has stopped".into());
    }
    launch_with_parent(
        state,
        data_root,
        parent.provider.clone(),
        parent.cwd.clone(),
        Some(prompt),
        parent.settings.clone().unwrap_or_default(),
        Lineage::Child(parent, name),
    )
}
#[tauri::command]
fn resume_agent(
    app: tauri::AppHandle,
    state: tauri::State<State>,
    id: String,
) -> Result<Agent, String> {
    let data_root = app.path().app_local_data_dir().map_err(err)?;
    let _lifecycle = state.lifecycle.lock().map_err(err)?;
    let previous = state
        .agents
        .lock()
        .map_err(err)?
        .get(&id)
        .cloned()
        .ok_or("Agent is no longer on the canvas")?;
    if !previous.has_terminal {
        return Err("Native subagents have no CLI session to resume".into());
    }
    if session(&state, &id).is_ok_and(|s| s.alive.load(Ordering::Acquire)) {
        return Err("This CLI is already running".into());
    }
    let agent = launch_with_parent(
        &state,
        &data_root,
        previous.provider.clone(),
        previous.cwd.clone(),
        None,
        previous.settings.clone().unwrap_or_default(),
        Lineage::Resume(&previous),
    )?;
    Ok(persistence::checkpoint_launch(&state, agent))
}
#[tauri::command]
fn rename_agent(state: tauri::State<State>, id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 100 || name.chars().any(char::is_control) {
        return Err("Names need 1–100 printable characters".into());
    }
    state
        .agents
        .lock()
        .map_err(err)?
        .get_mut(&id)
        .ok_or("Agent is no longer on the canvas")?
        .name = name.into();
    persistence::save(&state)
}
enum Lineage<'a> {
    Root,
    Child(&'a Agent, &'a str),
    Resume(&'a Agent),
}
fn launch_with_parent(
    state: &State,
    data_root: &Path,
    provider: String,
    cwd: String,
    prompt: Option<&str>,
    options: options::LaunchOptions,
    lineage: Lineage,
) -> Result<Agent, String> {
    let (parent, resume) = match lineage {
        Lineage::Root => (None, None),
        Lineage::Child(agent, name) => (Some((agent, name)), None),
        Lineage::Resume(agent) => (None, Some(agent)),
    };
    let extra_args = options.arguments(&provider)?;
    let codex_session = match resume {
        Some(previous) if provider == "codex" => Some(previous.session_id.clone().ok_or(
            "Codex never recorded a session for this agent, so there is nothing to resume",
        )?),
        _ => None,
    };
    let exe = resolve(&provider)?;
    let directory =
        std::fs::canonicalize(&cwd).map_err(|e| format!("Cannot open directory: {e}"))?;
    if !directory.is_dir() {
        return Err("Choose a directory".into());
    }
    let cwd = directory.to_string_lossy().into_owned();
    let id = resume.map_or_else(|| Uuid::new_v4().to_string(), |a| a.id.clone());
    let data = data_root.join("sessions").join(&id);
    let hook_dir = data.join("hooks");
    // The previous run's Stop and SessionEnd events would otherwise be
    // replayed onto the resumed session and mark it finished at once.
    if resume.is_some() && hook_dir.is_dir() {
        std::fs::remove_dir_all(&hook_dir).map_err(err)?;
    }
    std::fs::create_dir_all(&hook_dir).map_err(err)?;
    let mut cmd = CommandBuilder::new(exe);
    if codex_session.is_some() {
        cmd.arg("resume");
    }
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
            if resume.is_some() {
                "--resume"
            } else {
                "--session-id"
            },
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
    mcp::configure(
        &mut cmd,
        &provider,
        data_root,
        &id,
        options.native_subagents,
    )?;
    cmd.args(extra_args);
    if let Some(session) = &codex_session {
        cmd.arg(session);
    }
    if let Some(prompt) = prompt {
        cmd.arg("--");
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
    // A resumed CLI continues the saved buffer so open terminals keep their
    // cursor instead of replaying everything.
    let mut previous_output = Output::default();
    if resume.is_some() {
        if let Some(old) = state.sessions.lock().map_err(err)?.remove(&id) {
            previous_output = old.output.lock().map_err(err)?.clone();
        } else if let Some(saved) = state.archived.lock().map_err(err)?.remove(&id) {
            previous_output = saved;
        }
        previous_output.push(b"\r\n\x1b[2m-- resumed --\x1b[0m\r\n".to_vec());
    }
    let output = Arc::new(Mutex::new(previous_output));
    let reader_done = Arc::new(AtomicBool::new(false));
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
        reader_done: reader_done.clone(),
    });
    let mut agent = match resume {
        Some(previous) => {
            let mut agent = previous.clone();
            agent.status = "starting".into();
            agent.activity = "Resuming session".into();
            agent.transcript.clear();
            agent.telemetry_error = None;
            agent.checkpoint_warning = None;
            agent
        }
        None => Agent::root(&id, &provider, &cwd),
    };
    agent.settings = Some(options);
    if let Some((parent, name)) = parent {
        agent.parent_id = Some(parent.id.clone());
        agent.root_id = parent.root_id.clone();
        agent.name = name.into();
    }
    {
        let mut agents = state.agents.lock().map_err(err)?;
        // Transcripts are re-read from the start of the session logs.
        if resume.is_some() {
            let native = terminal_dependents(&agents, &id);
            for a in agents.values_mut().filter(|a| native.contains(&a.id)) {
                a.transcript.clear();
            }
        }
        agents.insert(id.clone(), agent.clone());
    }
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
        reader_done.store(true, Ordering::Release);
    });
    let agents = state.agents.clone();
    let root = agent.clone();
    let exit_notices = state.notices.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        alive.store(false, Ordering::Release);
        if let Ok(mut agents) = agents.lock() {
            let ids = terminal_dependents(&agents, &root.id);
            for a in agents.values_mut().filter(|a| ids.contains(&a.id)) {
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
            if !stop_requested.load(Ordering::Acquire) {
                if let Some(child) = agents.get(&root.id).filter(|a| a.status == "error") {
                    delegation::notify(&exit_notices, child);
                }
            }
        }
    });
    let agents = state.agents.clone();
    let root = agent.clone();
    let alive = state.sessions.lock().map_err(err)?[&id].alive.clone();
    let stopping = state.sessions.lock().map_err(err)?[&id]
        .stop_requested
        .clone();
    let terminal = state.sessions.lock().map_err(err)?[&id].clone();
    // A resumed child is the owner continuing by hand; never auto-close it.
    let auto_finish = resume.is_none();
    let notices = state.notices.clone();
    std::thread::spawn(move || {
        let mut tracker = telemetry::Tracker::default();
        while alive.load(Ordering::Acquire) && !stopping.load(Ordering::Acquire) {
            if let Ok(mut a) = agents.lock() {
                if !alive.load(Ordering::Acquire) || stopping.load(Ordering::Acquire) {
                    break;
                }
                tracker.poll(&root, &log_dir, &hook_dir, &mut a);
                if auto_finish && tracker.finish_child(&root, &log_dir, &mut a) {
                    if let Some(child) = a.get(&root.id) {
                        delegation::notify(&notices, child);
                    }
                    let terminal = terminal.clone();
                    std::thread::spawn(move || {
                        let _ = terminal.terminate();
                    });
                    break;
                }
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
struct TerminalRead {
    chunks: Vec<Vec<u8>>,
    cursor: u64,
    truncated: bool,
}
// Raw bytes instead of JSON: [cursor u64 LE][truncated u8][output]. A JSON
// array spends four characters per byte on a busy TUI's redraws.
#[tauri::command]
fn read_terminal(
    state: tauri::State<State>,
    id: String,
    after: u64,
) -> Result<tauri::ipc::Response, String> {
    let page = if let Ok(session) = session(&state, &id) {
        terminal_page(&*session.output.lock().map_err(err)?, after)
    } else {
        let archived = state.archived.lock().map_err(err)?;
        terminal_page(
            archived.get(&id).ok_or("Saved terminal is unavailable")?,
            after,
        )
    };
    Ok(tauri::ipc::Response::new(encode_page(&page)))
}
fn encode_page(page: &TerminalRead) -> Vec<u8> {
    let length: usize = page.chunks.iter().map(Vec::len).sum();
    let mut bytes = Vec::with_capacity(9 + length);
    bytes.extend_from_slice(&page.cursor.to_le_bytes());
    bytes.push(u8::from(page.truncated));
    for chunk in &page.chunks {
        bytes.extend_from_slice(chunk);
    }
    bytes
}
fn terminal_page(o: &Output, after: u64) -> TerminalRead {
    let rewound = after > o.next;
    let after = if rewound { 0 } else { after };
    let selected: Vec<_> = o
        .chunks
        .iter()
        .filter(|(n, _)| *n > after)
        .take(32)
        .collect();
    TerminalRead {
        cursor: selected.last().map(|(n, _)| *n).unwrap_or(after),
        chunks: selected.iter().map(|(_, b)| b.clone()).collect(),
        truncated: rewound || o.chunks.front().is_some_and(|(n, _)| after + 1 < *n),
    }
}

#[tauri::command]
fn stop_agent(state: tauri::State<State>, id: String) -> Result<(), String> {
    let _lifecycle = state.lifecycle.lock().map_err(err)?;
    let ids = descendant_ids(&*state.agents.lock().map_err(err)?, &id);
    for (sid, terminal) in state.sessions.lock().map_err(err)?.iter() {
        if ids.contains(sid) {
            terminal.terminate()?;
        }
    }
    forget_root(&state, &id)?;
    persistence::save(&state)
}
// Restarting through the exit request runs the RunEvent::Exit shutdown, so
// live CLIs are stopped and the canvas is saved before the new build starts.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.request_restart();
}
fn shutdown(state: &State) -> Result<(), String> {
    // Keep the host alive long enough for the termination watchdog and child
    // waiters. Otherwise a CLI that ignores hangup could outlive app exit.
    let _lifecycle = state.lifecycle.lock().map_err(err)?;
    let mut failure = persistence::save(state).err();
    let terminals: Vec<_> = state
        .sessions
        .lock()
        .map_err(err)?
        .values()
        .cloned()
        .collect();
    for terminal in &terminals {
        if let Err(error) = terminal.terminate() {
            failure.get_or_insert(error);
        }
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while terminals
        .iter()
        .any(|s| s.alive.load(Ordering::Acquire) || !s.reader_done.load(Ordering::Acquire))
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(Duration::from_millis(20));
    }
    if let Err(error) = persistence::save(state) {
        failure.get_or_insert(error);
    }
    failure.map_or(Ok(()), Err)
}
// Independent PTYs have their own exit watcher. A parent's exit only ends
// its own terminal and headless workers, never a sibling terminal's subtree.
fn terminal_dependents(
    agents: &HashMap<String, Agent>,
    id: &str,
) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::from([id.to_string()]);
    loop {
        let previous = ids.len();
        for agent in agents.values() {
            if !agent.has_terminal && agent.parent_id.as_ref().is_some_and(|p| ids.contains(p)) {
                ids.insert(agent.id.clone());
            }
        }
        if previous == ids.len() {
            return ids;
        }
    }
}
fn descendant_ids(agents: &HashMap<String, Agent>, id: &str) -> std::collections::HashSet<String> {
    let mut ids = std::collections::HashSet::from([id.to_string()]);
    loop {
        let previous = ids.len();
        for agent in agents.values() {
            if agent.parent_id.as_ref().is_some_and(|p| ids.contains(p)) {
                ids.insert(agent.id.clone());
            }
        }
        if previous == ids.len() {
            return ids;
        }
    }
}
fn forget_root(state: &State, id: &str) -> Result<(), String> {
    let mut agents = state.agents.lock().map_err(err)?;
    let ids = descendant_ids(&agents, id);
    agents.retain(|key, _| !ids.contains(key));
    state
        .sessions
        .lock()
        .map_err(err)?
        .retain(|key, _| !ids.contains(key));
    state
        .archived
        .lock()
        .map_err(err)?
        .retain(|key, _| !ids.contains(key));
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
    let arguments: Vec<_> = std::env::args_os().collect();
    if arguments.get(1).is_some_and(|arg| arg == "--canvas-mcp") {
        if let (Some(bus), Some(sender)) = (arguments.get(2), arguments.get(3)) {
            mcp::run(Path::new(bus), &sender.to_string_lossy());
        }
        return;
    }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(State::default())
        .setup(|app| {
            let path = app.path().app_local_data_dir()?.join("canvas-state.json");
            persistence::restore(&app.state::<State>(), path).map_err(std::io::Error::other)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut ticks = 0u32;
                loop {
                    std::thread::sleep(Duration::from_millis(700));
                    let state = handle.state::<State>();
                    let storage_path = state.storage.lock().ok().and_then(|s| s.clone());
                    if let Some(path) = storage_path {
                        if let Some(bus) = path.parent() {
                            if let Err(e) = delegation::poll(&state, bus) {
                                eprintln!("Canvas delegation: {e}");
                            }
                            if let Err(e) = delegation::deliver(&state, bus) {
                                eprintln!("Canvas notices: {e}");
                            }
                        }
                    }
                    ticks += 1;
                    if !ticks.is_multiple_of(3) {
                        continue;
                    }
                    if let Err(e) = persistence::save(&handle.state::<State>()) {
                        eprintln!("Could not checkpoint canvas: {e}");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            options::available_models,
            git::git_changes,
            git::git_file_diff,
            git::git_action,
            restart_app,
            providers,
            snapshot,
            create_agent,
            resume_agent,
            rename_agent,
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
                if let Err(e) = shutdown(&state) {
                    eprintln!("Could not close canvas sessions: {e}");
                }
            }
        });
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    #[test]
    fn parent_exit_does_not_cross_an_independent_terminal_boundary() {
        let mut agents = HashMap::new();
        for (id, parent, terminal) in [
            ("root", None, true),
            ("native", Some("root"), false),
            ("managed", Some("root"), true),
            ("managed-native", Some("managed"), false),
        ] {
            let mut agent = Agent::root(id, "codex", "/tmp");
            agent.parent_id = parent.map(String::from);
            agent.has_terminal = terminal;
            agents.insert(id.into(), agent);
        }
        assert_eq!(
            terminal_dependents(&agents, "root"),
            std::collections::HashSet::from(["root".into(), "native".into()])
        );
        assert_eq!(
            terminal_dependents(&agents, "managed"),
            std::collections::HashSet::from(["managed".into(), "managed-native".into()])
        );
    }
    #[test]
    fn shutdown_waits_for_final_reader_bytes_before_saving() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "exit 0"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        child.wait().unwrap();
        let output = Arc::new(Mutex::new(Output::default()));
        let reader_done = Arc::new(AtomicBool::new(false));
        let state = State::default();
        let dir = std::env::temp_dir().join(format!("canvas-reader-{}", Uuid::new_v4()));
        persistence::restore(&state, dir.join("state.json")).unwrap();
        state
            .agents
            .lock()
            .unwrap()
            .insert("root".into(), Agent::root("root", "codex", "/tmp"));
        state.sessions.lock().unwrap().insert(
            "root".into(),
            Arc::new(Session {
                pid: None,
                stop_requested: Arc::new(AtomicBool::new(false)),
                writer: Mutex::new(pair.master.take_writer().unwrap()),
                master: Mutex::new(pair.master),
                killer: Mutex::new(child.clone_killer()),
                output: output.clone(),
                alive: Arc::new(AtomicBool::new(false)),
                reader_done: reader_done.clone(),
            }),
        );
        let reader = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            output.lock().unwrap().push(b"FINAL_PTY_BYTES".to_vec());
            reader_done.store(true, Ordering::Release);
        });
        shutdown(&state).unwrap();
        reader.join().unwrap();
        let restored = State::default();
        persistence::restore(&restored, dir.join("state.json")).unwrap();
        assert_eq!(
            restored.archived.lock().unwrap()["root"].chunks[0].1,
            b"FINAL_PTY_BYTES"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn terminal_pages_resume_without_replay_and_recover_from_ahead_checkpoints() {
        let mut output = Output::default();
        for i in 0..40 {
            output.push(vec![i]);
        }
        let first = terminal_page(&output, 0);
        assert_eq!(first.cursor, 32);
        assert_eq!(first.chunks.len(), 32);
        let next = terminal_page(&output, first.cursor);
        assert_eq!(next.cursor, 40);
        assert_eq!(next.chunks[0], vec![32]);
        assert!(terminal_page(&output, next.cursor).chunks.is_empty());
        let rewound = terminal_page(&output, 50);
        assert!(rewound.truncated);
        assert_eq!(rewound.cursor, 32);
        output.push(vec![0; 2_000_000]);
        let expired = terminal_page(&output, 0);
        assert!(expired.truncated);
        assert_eq!(expired.cursor, 41);
        assert_eq!(expired.chunks.len(), 1);
        let encoded = encode_page(&next);
        assert_eq!(u64::from_le_bytes(encoded[..8].try_into().unwrap()), 40);
        assert_eq!(encoded[8], 0);
        assert_eq!(&encoded[9..], (32..40).collect::<Vec<u8>>());
    }

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
            reader_done: Arc::new(AtomicBool::new(true)),
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

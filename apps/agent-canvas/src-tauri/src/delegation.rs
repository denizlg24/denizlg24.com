use super::*;
use serde_json::{json, Value};

pub fn request(bus: &Path, sender: &str, name: &str, args: &Value) -> Result<Value, String> {
    let id = Uuid::new_v4().to_string();
    let requests = bus.join("requests");
    std::fs::create_dir_all(&requests).map_err(err)?;
    let temporary = requests.join(format!("{id}.tmp"));
    std::fs::write(
        &temporary,
        json!({ "sender": sender, "name": name, "arguments": args }).to_string(),
    )
    .map_err(err)?;
    let pending = requests.join(format!("{id}.json"));
    std::fs::rename(temporary, &pending).map_err(err)?;
    let reply = requests.join(format!("{id}.reply"));
    let start = std::time::Instant::now();
    loop {
        match std::fs::read(&reply) {
            Ok(bytes) => {
                let _ = std::fs::remove_file(reply);
                let response: Value = serde_json::from_slice(&bytes).map_err(err)?;
                if let Some(error) = response["error"].as_str() {
                    return Err(error.into());
                }
                return Ok(response["result"].clone());
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(err(e)),
        }
        if start.elapsed() > Duration::from_secs(30) {
            // Remove an unclaimed request to avoid a delayed surprise launch.
            let _ = std::fs::remove_file(pending);
            return Err(
                "Canvas did not respond in time; inspect list_threads before retrying".into(),
            );
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn execute(state: &State, bus: &Path, request: &Value) -> Result<Value, String> {
    let sender = request["sender"].as_str().ok_or("Missing sender")?;
    let parent = state
        .agents
        .lock()
        .map_err(err)?
        .get(sender)
        .cloned()
        .ok_or("Parent session is no longer available")?;
    if !session(state, sender)?.alive.load(Ordering::Acquire) {
        return Err("Parent CLI has exited".into());
    }
    let args = &request["arguments"];
    match request["name"].as_str().unwrap_or_default() {
        "spawn_agent" => {
            let prompt = args["task"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.len() <= 64_000)
                .ok_or("Task must contain 1–64000 bytes")?;
            let name = args["name"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.len() <= 100)
                .ok_or("Name must contain 1–100 bytes")?;
            let agent = launch_child(state, bus, &parent, name, prompt)?;
            let agent = persistence::checkpoint_launch(state, agent);
            Ok(
                json!({ "thread_id": agent.id, "name": agent.name, "status": agent.status, "terminal": true, "checkpointWarning": agent.checkpoint_warning }),
            )
        }
        _ => Err("Unknown canvas request".into()),
    }
}

pub fn poll(state: &State, bus: &Path) -> Result<(), String> {
    let requests = bus.join("requests");
    std::fs::create_dir_all(&requests).map_err(err)?;
    for entry in std::fs::read_dir(&requests).map_err(err)? {
        let path = entry.map_err(err)?.path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let claimed = path.with_extension("working");
        if std::fs::rename(&path, &claimed).is_err() {
            continue;
        }
        let result = std::fs::read(&claimed)
            .map_err(err)
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).map_err(err))
            .and_then(|request| execute(state, bus, &request));
        let response = match result {
            Ok(value) => json!({ "result": value }),
            Err(error) => json!({ "error": error }),
        };
        let temporary = path.with_extension("reply.tmp");
        std::fs::write(&temporary, response.to_string()).map_err(err)?;
        std::fs::rename(temporary, path.with_extension("reply")).map_err(err)?;
        std::fs::remove_file(claimed).map_err(err)?;
    }
    Ok(())
}

/// Completed subagents waiting to be announced to their parent's terminal.
pub type Notices = Arc<Mutex<Vec<Notice>>>;
pub struct Notice {
    pub parent: String,
    pub child: String,
    pub text: String,
}

pub fn notify(notices: &Notices, child: &Agent) {
    let Some(parent) = child.parent_id.clone() else {
        return;
    };
    let outcome = if child.status == "error" {
        "exited with an error"
    } else {
        "finished"
    };
    let summary: String = child
        .last_message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect();
    let text = format!(
        "[agent_canvas] Subagent \"{}\" ({}) {outcome}: {summary}",
        child.name, child.id
    );
    if let Ok(mut list) = notices.lock() {
        list.push(Notice {
            parent,
            child: child.id.clone(),
            text,
        });
    }
}

pub fn delivered_marker(bus: &Path, child: &str) -> PathBuf {
    bus.join("delivered").join(child)
}

// Typed into the parent only between turns. Mid-turn the CLI may be showing
// an approval prompt, and an Enter would answer it.
pub fn deliver(state: &State, bus: &Path) -> Result<(), String> {
    let pending: Vec<Notice> = std::mem::take(&mut *state.notices.lock().map_err(err)?);
    if pending.is_empty() {
        return Ok(());
    }
    let mut keep = Vec::new();
    let mut batches: HashMap<String, Vec<String>> = HashMap::new();
    {
        let agents = state.agents.lock().map_err(err)?;
        for notice in pending {
            // wait_for_threads already handed this result to the parent.
            if delivered_marker(bus, &notice.child).exists() {
                continue;
            }
            let Some(parent) = agents.get(&notice.parent) else {
                continue;
            };
            let alive =
                session(state, &notice.parent).is_ok_and(|s| s.alive.load(Ordering::Acquire));
            if !alive {
                continue;
            }
            if parent.status == "idle" {
                batches.entry(notice.parent).or_default().push(notice.text);
            } else {
                keep.push(notice);
            }
        }
    }
    for (parent, texts) in batches {
        let message = format!("{} Use get_thread for the full result.", texts.join(" "));
        let terminal = session(state, &parent)?;
        // Enter goes separately: a TUI that sees one burst treats it as a
        // paste and turns the trailing return into a newline.
        for (bytes, pause) in [(message.as_bytes(), 150), (b"\r".as_slice(), 0)] {
            let mut writer = terminal.writer.lock().map_err(err)?;
            writer.write_all(bytes).map_err(err)?;
            writer.flush().map_err(err)?;
            drop(writer);
            std::thread::sleep(Duration::from_millis(pause));
        }
        if let Some(a) = state.agents.lock().map_err(err)?.get_mut(&parent) {
            a.status = "working".into();
            a.activity = "Reading subagent results".into();
        }
    }
    state.notices.lock().map_err(err)?.extend(keep);
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::io::Read as _;
    #[test]
    fn notices_wait_for_an_idle_parent_and_skip_results_already_waited_for() {
        let bus = std::env::temp_dir().join(format!("canvas-notice-{}", Uuid::new_v4()));
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 200,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new("/bin/cat");
        cmd.env("TERM", "dumb");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let state = State::default();
        let mut parent = Agent::root("parent", "claude", "/tmp");
        parent.status = "working".into();
        state.agents.lock().unwrap().insert("parent".into(), parent);
        state.sessions.lock().unwrap().insert(
            "parent".into(),
            Arc::new(Session {
                pid: child.process_id(),
                stop_requested: Arc::new(AtomicBool::new(false)),
                writer: Mutex::new(pair.master.take_writer().unwrap()),
                master: Mutex::new(pair.master),
                killer: Mutex::new(child.clone_killer()),
                output: Arc::new(Mutex::new(Output::default())),
                alive: Arc::new(AtomicBool::new(true)),
                reader_done: Arc::new(AtomicBool::new(true)),
            }),
        );
        let mut scout = Agent::root("scout", "claude", "/tmp");
        scout.parent_id = Some("parent".into());
        scout.name = "Scout".into();
        scout.status = "done".into();
        scout.last_message = "Found   the\nentry point.".into();
        let mut waited = scout.clone();
        waited.id = "waited".into();
        notify(&state.notices, &scout);
        notify(&state.notices, &waited);
        deliver(&state, &bus).unwrap();
        assert_eq!(state.notices.lock().unwrap().len(), 2, "held mid-turn");
        std::fs::create_dir_all(bus.join("delivered")).unwrap();
        std::fs::write(delivered_marker(&bus, "waited"), b"").unwrap();
        state
            .agents
            .lock()
            .unwrap()
            .get_mut("parent")
            .unwrap()
            .status = "idle".into();
        deliver(&state, &bus).unwrap();
        assert!(state.notices.lock().unwrap().is_empty());
        assert_eq!(state.agents.lock().unwrap()["parent"].status, "working");
        let mut seen = String::new();
        let mut buffer = [0; 4096];
        while !seen.contains("full result") {
            let n = reader.read(&mut buffer).unwrap();
            seen.push_str(&String::from_utf8_lossy(&buffer[..n]));
        }
        assert!(seen.contains("Subagent \"Scout\" (scout) finished: Found the entry point."));
        assert!(!seen.contains("(waited)"));
        state.sessions.lock().unwrap()["parent"]
            .terminate()
            .unwrap();
        let _ = std::fs::remove_dir_all(bus);
    }
}

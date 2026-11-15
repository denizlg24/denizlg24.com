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

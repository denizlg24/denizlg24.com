//! Session-local stdio MCP. The desktop and every CLI share an atomic on-disk
//! directory, so communication also survives desktop/CLI restarts.
use super::*;
use serde_json::{json, Value};
use std::io::BufRead;

#[derive(Deserialize)]
struct AgentMetadata {
    agents: HashMap<String, Agent>,
}
fn agents(bus: &Path) -> Result<HashMap<String, Agent>, String> {
    let reader =
        std::io::BufReader::new(std::fs::File::open(bus.join("canvas-state.json")).map_err(err)?);
    let metadata: AgentMetadata = serde_json::from_reader(reader).map_err(err)?;
    Ok(metadata.agents)
}
fn messages(directory: &Path) -> Result<Vec<Value>, String> {
    let mut messages = Vec::new();
    for file in std::fs::read_dir(directory).map_err(err)? {
        let path = file.map_err(err)?.path();
        if path.extension().is_some_and(|e| e == "json") {
            messages.push(serde_json::from_slice(&std::fs::read(path).map_err(err)?).map_err(err)?);
        }
    }
    Ok(messages)
}
fn next_sequence(directory: &Path) -> Result<u64, String> {
    let path = directory.join(".sequence");
    let counter = match std::fs::read_to_string(&path) {
        Ok(value) => value.parse::<u64>().ok(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(err(e)),
    };
    let previous = match counter {
        Some(value) => value,
        None => messages(directory)?
            .iter()
            .filter_map(|m| m["sequence"].as_u64())
            .max()
            .unwrap_or(0),
    };
    let next = previous.checked_add(1).ok_or("Inbox sequence exhausted")?;
    let temporary = directory.join(format!(".sequence-{}.tmp", Uuid::new_v4()));
    let mut file = std::fs::File::create(&temporary).map_err(err)?;
    file.write_all(next.to_string().as_bytes()).map_err(err)?;
    file.sync_all().map_err(err)?;
    std::fs::rename(temporary, path).map_err(err)?;
    Ok(next)
}

fn inbox(bus: &Path, id: &str) -> Result<PathBuf, String> {
    // Never permit a tool argument to become an arbitrary filesystem path.
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b':')
    {
        return Err("Invalid thread ID".into());
    }
    Ok(bus.join("messages").join(id))
}

fn call(bus: &Path, sender: &str, name: &str, args: &Value) -> Result<Value, String> {
    let threads = agents(bus)?;
    if !threads.contains_key(sender) {
        return Err("Sender session is no longer on the canvas".into());
    }
    match name {
        "spawn_agent" => delegation::request(bus, sender, name, args),
        "get_thread" => {
            let id = args["thread_id"].as_str().ok_or("thread_id is required")?;
            let thread = threads.get(id).ok_or("Unknown canvas thread")?;
            Ok(json!({ "id": thread.id, "status": thread.status, "activity": thread.activity, "transcript": thread.transcript, "terminal": thread.has_terminal }))
        }
        "list_threads" => Ok(json!(threads
            .values()
            .map(|a| json!({
                "id": a.id, "parentId": a.parent_id, "provider": a.provider,
                "name": a.name, "status": a.status, "cwd": a.cwd, "activity": a.activity, "terminal": a.has_terminal, "isSelf": a.id == sender
            }))
            .collect::<Vec<_>>())),
        "send_message" => {
            let target = args["thread_id"].as_str().ok_or("thread_id is required")?;
            if !threads.contains_key(target) {
                return Err("Recipient is not on the canvas".into());
            }
            let text = args["message"].as_str().ok_or("message is required")?;
            if text.is_empty() || text.len() > 64_000 {
                return Err("Message must contain 1–64000 bytes".into());
            }
            let directory = inbox(bus, target)?;
            std::fs::create_dir_all(&directory).map_err(err)?;
            let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(directory.join(".lock")).map_err(err)?;
            lock.lock().map_err(err)?;
            let sequence = next_sequence(&directory)?;
            let id = Uuid::new_v4().to_string();
            let message = json!({ "sequence": sequence, "id": id, "from": sender, "to": target, "message": text,
                "createdAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(err)?.as_millis() });
            let temporary = directory.join(format!("{id}.tmp"));
            std::fs::write(&temporary, serde_json::to_vec(&message).map_err(err)?).map_err(err)?;
            std::fs::rename(temporary, directory.join(format!("{id}.json"))).map_err(err)?;
            Ok(
                json!({ "messageId": id, "delivered": true, "delivery": "inbox", "recipientMustRead": true }),
            )
        }
        "read_messages" => {
            let directory = inbox(bus, sender)?;
            std::fs::create_dir_all(&directory).map_err(err)?;
            let mut messages = messages(&directory)?;
            messages.sort_by_key(|m| {
                (
                    m["sequence"].as_u64().unwrap_or(0),
                    m["id"].as_str().unwrap_or_default().to_string(),
                )
            });
            // Cursor-based reads are repeatable: reading never deletes a message.
            let after = args["after"].as_str().unwrap_or_default();
            let start = if after.is_empty() {
                0
            } else {
                messages
                    .iter()
                    .position(|m| m["id"] == after)
                    .ok_or("Unknown message cursor")?
                    + 1
            };
            let page: Vec<_> = messages.into_iter().skip(start).take(100).collect();
            Ok(
                json!({ "cursor": page.last().and_then(|m| m["id"].as_str()).unwrap_or(after), "messages": page }),
            )
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn response(bus: &Path, sender: &str, request: Value) -> Option<Value> {
    let id = request.get("id")?.clone(); // Notifications never receive a response.
    let result = match request["method"].as_str().unwrap_or_default() {
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"].as_str().filter(|v| ["2024-11-05", "2025-03-26", "2025-06-18"].contains(v)).unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "agent-canvas", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Use agent_canvas spawn_agent for delegation so subagents run in real visible CLI terminals, inherit this session's model and permissions, and close on task completion. Use get_thread to check their results. Communicate with other canvas sessions using list_threads, send_message and read_messages. Messages are queued in persistent inboxes; read yours periodically and before finishing. Delivery does not interrupt a recipient or type into its terminal. Your sender identity is bound to this CLI session."
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": [
            { "name": "spawn_agent", "description": "Delegate a task to an independent interactive CLI subagent with a real canvas terminal. Inherits provider, directory, model and permissions. Returns its thread ID immediately; check get_thread for completion and result. Prefer this to built-in transcript-only delegation.", "inputSchema": { "type": "object", "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 100 }, "task": { "type": "string", "minLength": 1, "maxLength": 64000 } }, "required": ["name", "task"], "additionalProperties": false } },
            { "name": "get_thread", "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false }, "description": "Get a canvas thread status and transcript, including completed subagent results.", "inputSchema": { "type": "object", "properties": { "thread_id": { "type": "string" } }, "required": ["thread_id"], "additionalProperties": false } },
            { "name": "list_threads", "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false }, "description": "List all agent canvas sessions and their current status.", "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } },
            { "name": "send_message", "description": "Send a persistent message to another canvas thread's inbox. The recipient reads it using read_messages.", "inputSchema": { "type": "object", "properties": { "thread_id": { "type": "string" }, "message": { "type": "string", "minLength": 1, "maxLength": 64000 } }, "required": ["thread_id", "message"], "additionalProperties": false } },
            { "name": "read_messages", "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false }, "description": "Read up to 100 inbox messages after an optional cursor. Pass the returned cursor to get subsequent messages.", "inputSchema": { "type": "object", "properties": { "after": { "type": "string" } }, "additionalProperties": false } }
        ] }),
        "tools/call" => {
            match call(
                bus,
                sender,
                request["params"]["name"].as_str().unwrap_or_default(),
                &request["params"]["arguments"],
            ) {
                Ok(value) => json!({ "content": [{ "type": "text", "text": value.to_string() }] }),
                Err(error) => {
                    json!({ "isError": true, "content": [{ "type": "text", "text": error }] })
                }
            }
        }
        _ => {
            return Some(
                json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } }),
            )
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

pub fn run(bus: &Path, sender: &str) {
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    loop {
        let mut line = String::new();
        match input.by_ref().take(1_000_001).read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) if line.len() > 1_000_000 => break,
            Ok(_) => {}
        }
        let reply = match serde_json::from_str(&line) {
            Ok(request) => response(bus, sender, request),
            Err(_) => Some(
                json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } }),
            ),
        };
        if let Some(reply) = reply {
            if writeln!(output, "{reply}")
                .and_then(|_| output.flush())
                .is_err()
            {
                break;
            }
        }
    }
}

pub fn configure(
    cmd: &mut CommandBuilder,
    provider: &str,
    bus: &Path,
    id: &str,
) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(err)?
        .to_string_lossy()
        .into_owned();
    let args = json!(["--canvas-mcp", bus.to_string_lossy(), id]);
    if provider == "codex" {
        // All new canvas delegates need their own PTYs. Route delegation
        // through this server rather than provider-internal headless workers.
        cmd.args([
            "-c",
            "features.multi_agent=false",
            "-c",
            "features.multi_agent_v2=false",
        ]);
        cmd.args([
            "-c",
            &format!("mcp_servers.agent_canvas.command={}", json!(executable)),
        ]);
        cmd.args(["-c", &format!("mcp_servers.agent_canvas.args={args}")]);
    } else {
        cmd.args(["--disallowedTools", "Agent,Task"]);
        cmd.args(["--mcp-config", &json!({ "mcpServers": { "agent_canvas": { "type": "stdio", "command": executable, "args": args } } }).to_string()]);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn threads_exchange_durable_messages_with_independent_cursors() {
        let bus = std::env::temp_dir().join(format!("canvas-mcp-{}", Uuid::new_v4()));
        let state = State::default();
        persistence::restore(&state, bus.join("canvas-state.json")).unwrap();
        state.agents.lock().unwrap().extend([
            ("a".into(), Agent::root("a", "codex", "/tmp")),
            ("b".into(), Agent::root("b", "claude", "/tmp")),
        ]);
        persistence::save(&state).unwrap();
        let sent = call(
            &bus,
            "a",
            "send_message",
            &json!({ "thread_id": "b", "message": "hello from Codex" }),
        )
        .unwrap();
        let received = call(&bus, "b", "read_messages", &json!({})).unwrap();
        assert_eq!(received["messages"][0]["message"], "hello from Codex");
        assert_eq!(received["messages"][0]["from"], "a");
        assert_eq!(received["cursor"], sent["messageId"]);
        let next = call(
            &bus,
            "b",
            "read_messages",
            &json!({ "after": received["cursor"] }),
        )
        .unwrap();
        assert_eq!(next["messages"], json!([]));
        // Simulate a sender dying while the old in-place counter write had
        // truncated it. The next accepted message must stay after this cursor.
        let counter = bus.join("messages/b/.sequence");
        std::fs::write(&counter, "").unwrap();
        for index in 0..20 {
            call(
                &bus,
                "a",
                "send_message",
                &json!({ "thread_id": "b", "message": format!("message {index}") }),
            )
            .unwrap();
        }
        let later = call(
            &bus,
            "b",
            "read_messages",
            &json!({ "after": received["cursor"] }),
        )
        .unwrap();
        let messages = later["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 20);
        for (index, message) in messages.iter().enumerate() {
            assert_eq!(message["sequence"], (index + 2) as u64);
            assert_eq!(message["message"], format!("message {index}"));
        }
        assert_eq!(
            call(&bus, "a", "read_messages", &json!({})).unwrap()["messages"],
            json!([])
        );
        assert!(call(
            &bus,
            "a",
            "send_message",
            &json!({ "thread_id": "../outside", "message": "x" })
        )
        .is_err());
        assert!(response(&bus, "a", json!({ "method": "notifications/initialized" })).is_none());
        let init = response(&bus, "a", json!({ "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(
            call(&bus, "a", "list_threads", &json!({}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );
        let last_cursor = later["cursor"].clone();
        for (index, corrupt) in [None, Some("invalid")].into_iter().enumerate() {
            match corrupt {
                Some(value) => std::fs::write(&counter, value).unwrap(),
                None => std::fs::remove_file(&counter).unwrap(),
            }
            call(
                &bus,
                "a",
                "send_message",
                &json!({"thread_id":"b", "message":format!("recovered {index}")}),
            )
            .unwrap();
        }
        let recovered = call(&bus, "b", "read_messages", &json!({"after": last_cursor})).unwrap();
        assert_eq!(recovered["messages"].as_array().unwrap().len(), 2);
        assert_eq!(recovered["messages"][0]["sequence"], 22);
        assert_eq!(recovered["messages"][1]["sequence"], 23);
        std::fs::remove_dir_all(bus).unwrap();
    }
}

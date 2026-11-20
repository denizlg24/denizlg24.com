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

const RESULT_LIMIT: usize = 8_000;
const TRANSCRIPT_TAIL: usize = 6_000;
fn finished(status: &str) -> bool {
    ["done", "stopped", "error"].contains(&status)
}
fn tail(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(limit)).collect()
}
fn summary(a: &Agent) -> Value {
    json!({
        "id": a.id, "name": a.name, "status": a.status, "activity": a.activity,
        "result": tail(&a.last_message, RESULT_LIMIT), "terminal": a.has_terminal
    })
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
            let mut reply = summary(thread);
            // The transcript is opt-in and bounded: returning all of it on every
            // check is what used to fill a parent's context.
            if args["include_transcript"].as_bool() == Some(true) {
                reply["transcript"] = json!(tail(&thread.transcript, TRANSCRIPT_TAIL));
            }
            Ok(reply)
        }
        "wait_for_threads" => {
            let requested: Option<Vec<String>> = args["thread_ids"].as_array().map(|ids| {
                ids.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            });
            let targets: Vec<String> = match requested {
                Some(ids) if !ids.is_empty() => ids,
                _ => threads
                    .values()
                    .filter(|a| a.parent_id.as_deref() == Some(sender) && !finished(&a.status))
                    .map(|a| a.id.clone())
                    .collect(),
            };
            let timeout = args["timeout_seconds"].as_u64().unwrap_or(900).clamp(5, 3600);
            let deadline = std::time::Instant::now() + Duration::from_secs(timeout);
            loop {
                let current = agents(bus)?;
                let done = targets
                    .iter()
                    .all(|id| current.get(id).is_none_or(|a| finished(&a.status)));
                if done || std::time::Instant::now() >= deadline {
                    let results: Vec<Value> = targets
                        .iter()
                        .map(|id| match current.get(id) {
                            Some(a) => {
                                if finished(&a.status) {
                                    let marker = delegation::delivered_marker(bus, id);
                                    if let Some(dir) = marker.parent() {
                                        let _ = std::fs::create_dir_all(dir);
                                    }
                                    let _ = std::fs::write(marker, b"");
                                }
                                summary(a)
                            }
                            None => json!({ "id": id, "status": "removed" }),
                        })
                        .collect();
                    return Ok(json!({ "allFinished": done, "threads": results }));
                }
                std::thread::sleep(Duration::from_secs(1));
            }
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
            "instructions": "Use agent_canvas spawn_agent for delegation so subagents run in real visible CLI terminals, inherit this session's model and permissions, and close on task completion. Never poll get_thread in a loop. Either keep working (when a subagent finishes, the canvas types a one-line notice into your prompt as soon as your turn ends), or call wait_for_threads once to block until your subagents finish and receive their results. get_thread returns a thread's final reply; ask for include_transcript only when that is not enough. Communicate with other canvas sessions using list_threads, send_message and read_messages. Messages are queued in persistent inboxes; read yours periodically and before finishing. Delivery does not interrupt a recipient or type into its terminal. Your sender identity is bound to this CLI session."
        }),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": [
            { "name": "spawn_agent", "description": "Delegate a task to an independent interactive CLI subagent with a real canvas terminal. Inherits provider, directory, model and permissions. Returns its thread ID immediately; you are notified in your prompt when it finishes, or call wait_for_threads. Prefer this to built-in transcript-only delegation.", "inputSchema": { "type": "object", "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 100 }, "task": { "type": "string", "minLength": 1, "maxLength": 64000 } }, "required": ["name", "task"], "additionalProperties": false } },
            { "name": "get_thread", "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false }, "description": "Get a canvas thread's status and its final reply. include_transcript adds the last 6000 characters of its transcript.", "inputSchema": { "type": "object", "properties": { "thread_id": { "type": "string" }, "include_transcript": { "type": "boolean" } }, "required": ["thread_id"], "additionalProperties": false } },
            { "name": "wait_for_threads", "annotations": { "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false }, "description": "Block until the given threads (default: your unfinished subagents) finish, then return each one's status and final reply. One call replaces polling.", "inputSchema": { "type": "object", "properties": { "thread_ids": { "type": "array", "items": { "type": "string" } }, "timeout_seconds": { "type": "integer", "minimum": 5, "maximum": 3600 } }, "additionalProperties": false } },
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

// Every tool through which Claude Code starts a headless worker. Workflow
// was missing here once, and every delegated task became a transcript-only card.
pub const CLAUDE_NATIVE_DELEGATION: &str = "Agent,Task,Workflow";
const DELEGATION_PROMPT: &str = "You are running inside Agents, a canvas that gives every agent its own terminal. To delegate work, call the agent_canvas spawn_agent tool: each subagent gets a visible, interactive CLI terminal and closes itself when its task is complete. Do not poll get_thread: when a subagent finishes, a one-line notice is typed into your prompt after your current turn, or call wait_for_threads once to block until your subagents are done.";

pub fn configure(
    cmd: &mut CommandBuilder,
    provider: &str,
    bus: &Path,
    id: &str,
    native_subagents: bool,
) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(err)?
        .to_string_lossy()
        .into_owned();
    let args = json!(["--canvas-mcp", bus.to_string_lossy(), id]);
    if provider == "codex" {
        if !native_subagents {
            cmd.args([
                "-c",
                "features.multi_agent=false",
                "-c",
                "features.multi_agent_v2=false",
            ]);
        }
        cmd.args([
            "-c",
            &format!("mcp_servers.agent_canvas.command={}", json!(executable)),
        ]);
        cmd.args(["-c", &format!("mcp_servers.agent_canvas.args={args}")]);
        // wait_for_threads blocks for up to an hour; Codex's default is 60 s.
        cmd.args(["-c", "mcp_servers.agent_canvas.tool_timeout_sec=3700"]);
    } else {
        if !native_subagents {
            cmd.args(["--disallowedTools", CLAUDE_NATIVE_DELEGATION]);
            cmd.args(["--append-system-prompt", DELEGATION_PROMPT]);
        }
        cmd.env("MCP_TOOL_TIMEOUT", "3700000");
        cmd.args(["--mcp-config", &json!({ "mcpServers": { "agent_canvas": { "type": "stdio", "command": executable, "args": args } } }).to_string()]);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn arguments(provider: &str, native: bool) -> Vec<String> {
        let mut cmd = CommandBuilder::new("cli");
        configure(&mut cmd, provider, Path::new("/tmp/bus"), "id", native).unwrap();
        cmd.get_argv()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }
    #[test]
    fn thread_reads_return_the_reply_not_the_transcript() {
        let bus = std::env::temp_dir().join(format!("canvas-wait-{}", Uuid::new_v4()));
        let state = State::default();
        persistence::restore(&state, bus.join("canvas-state.json")).unwrap();
        let parent = Agent::root("p", "claude", "/tmp");
        let mut child = Agent::root("c", "claude", "/tmp");
        child.parent_id = Some("p".into());
        child.status = "done".into();
        child.transcript = "x".repeat(150_000);
        child.last_message = "RESULT".into();
        state
            .agents
            .lock()
            .unwrap()
            .extend([("p".into(), parent), ("c".into(), child)]);
        persistence::save(&state).unwrap();
        let thread = call(&bus, "p", "get_thread", &json!({ "thread_id": "c" })).unwrap();
        assert_eq!(thread["result"], "RESULT");
        assert!(thread.get("transcript").is_none());
        let full = call(
            &bus,
            "p",
            "get_thread",
            &json!({ "thread_id": "c", "include_transcript": true }),
        )
        .unwrap();
        assert_eq!(full["transcript"].as_str().unwrap().len(), TRANSCRIPT_TAIL);
        let waited = call(
            &bus,
            "p",
            "wait_for_threads",
            &json!({ "thread_ids": ["c"], "timeout_seconds": 5 }),
        )
        .unwrap();
        assert_eq!(waited["allFinished"], true);
        assert_eq!(waited["threads"][0]["result"], "RESULT");
        assert!(delegation::delivered_marker(&bus, "c").exists());
        std::fs::remove_dir_all(bus).unwrap();
    }
    #[test]
    fn canvas_launches_block_every_native_delegation_tool() {
        let claude = arguments("claude", false);
        let blocked = claude
            .iter()
            .position(|a| a == "--disallowedTools")
            .map(|i| claude[i + 1].split(',').collect::<Vec<_>>())
            .unwrap();
        assert!(["Agent", "Task", "Workflow"]
            .iter()
            .all(|tool| blocked.contains(tool)));
        assert!(claude.iter().any(|a| a == "--append-system-prompt"));
        assert!(!arguments("claude", true)
            .iter()
            .any(|a| a == "--disallowedTools"));
        assert!(arguments("codex", false)
            .iter()
            .any(|a| a == "features.multi_agent_v2=false"));
        assert!(!arguments("codex", true)
            .iter()
            .any(|a| a.starts_with("features.multi_agent")));
    }
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

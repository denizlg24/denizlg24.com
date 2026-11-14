//! Incremental readers for local CLI transcripts. Unknown usage stays unknown.
use crate::model::Agent;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

#[derive(Default)]
struct Cursor {
    offset: u64,
    pending: Vec<u8>,
    agent_id: Option<String>,
}
#[derive(Default)]
pub struct Tracker {
    cursors: HashMap<PathBuf, Cursor>,
    sessions: HashMap<String, String>,
    // Claude may log one assistant message in multiple blocks: replace usage by message id.
    usage: HashMap<(String, String), (u64, u64, u64)>,
    hooks: HashSet<PathBuf>,
}
fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}
fn cut(s: &str) -> String {
    s.chars().take(180).collect()
}
fn files(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .max_depth(8)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && e.path().extension().is_some_and(|x| x == "jsonl"))
        .map(|e| e.into_path())
        .collect()
}
impl Tracker {
    pub fn poll(
        &mut self,
        root: &Agent,
        log_dir: &Path,
        hook_dir: &Path,
        agents: &mut HashMap<String, Agent>,
    ) {
        let paths = if root.provider == "codex" {
            files(log_dir)
        } else {
            let mut paths = files(&log_dir.join(&root.id));
            let main = log_dir.join(format!("{}.jsonl", root.id));
            if main.exists() {
                paths.insert(0, main);
            }
            paths
        };
        for path in paths {
            if let Err(e) = self.read(&path, root, agents) {
                if let Some(a) = agents.get_mut(&root.id) {
                    a.telemetry_error = Some(format!("Session tracking: {e}"));
                }
            }
        }
        if root.provider == "claude" {
            if let Ok(entries) = std::fs::read_dir(hook_dir) {
                let mut entries: Vec<_> = entries
                    .filter_map(Result::ok)
                    .map(|e| e.path())
                    .filter(|p| {
                        p.extension().is_some_and(|x| x == "json") && !self.hooks.contains(p)
                    })
                    .collect();
                entries.sort();
                for path in entries {
                    if let Ok(raw) = std::fs::read(&path) {
                        if let Ok(v) = serde_json::from_slice::<Value>(&raw) {
                            self.hook(root, &v, agents);
                            self.hooks.insert(path);
                        }
                    }
                }
            }
        }
    }
    fn read(
        &mut self,
        path: &Path,
        root: &Agent,
        agents: &mut HashMap<String, Agent>,
    ) -> std::io::Result<()> {
        let mut cursor = self.cursors.remove(path).unwrap_or_default();
        let mut f = File::open(path)?;
        if f.metadata()?.len() < cursor.offset {
            cursor = Cursor::default();
        }
        f.seek(SeekFrom::Start(cursor.offset))?;
        let mut bytes = Vec::new();
        f.take(1024 * 1024).read_to_end(&mut bytes)?;
        cursor.offset += bytes.len() as u64;
        cursor.pending.extend(bytes);
        let end = cursor
            .pending
            .iter()
            .rposition(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(0);
        let ready: Vec<u8> = cursor.pending.drain(..end).collect();
        for line in ready.split(|b| *b == b'\n') {
            if let Ok(v) = serde_json::from_slice::<Value>(line) {
                if root.provider == "codex" {
                    self.codex(root, &v, &mut cursor.agent_id, agents);
                } else {
                    self.claude(root, path, &v, agents);
                }
            }
        }
        self.cursors.insert(path.to_owned(), cursor);
        Ok(())
    }
    fn child(
        &self,
        root: &Agent,
        id: &str,
        parent: &str,
        name: &str,
        agents: &mut HashMap<String, Agent>,
    ) {
        agents.entry(id.into()).or_insert_with(|| {
            let mut a = Agent::root(id, &root.provider, &root.cwd);
            a.root_id = root.id.clone();
            a.parent_id = Some(parent.into());
            a.name = if name.is_empty() {
                "Subagent".into()
            } else {
                name.into()
            };
            a.status = "working".into();
            a.activity = "Starting task".into();
            a
        });
    }
    fn codex(
        &mut self,
        root: &Agent,
        v: &Value,
        file_agent: &mut Option<String>,
        agents: &mut HashMap<String, Agent>,
    ) {
        let p = &v["payload"];
        if v["type"] == "session_meta" {
            // Spawned rollouts begin with their own identity, then replay parent
            // history (including the parent's session_meta). Identity is per file.
            if file_agent.is_some() {
                return;
            }
            let sid = s(p, "id");
            let spawn = &p["source"]["subagent"]["thread_spawn"];
            let parent_sid = s(spawn, "parent_thread_id");
            let id = if parent_sid.is_empty() {
                root.id.clone()
            } else {
                format!("{}:{sid}", root.id)
            };
            if !parent_sid.is_empty() {
                let parent = self
                    .sessions
                    .get(&parent_sid)
                    .cloned()
                    .unwrap_or_else(|| format!("{}:{parent_sid}", root.id));
                self.child(root, &id, &parent, &s(spawn, "agent_nickname"), agents);
            }
            self.sessions.insert(sid.clone(), id.clone());
            // Resolve children discovered before their parent's file.
            let placeholder = format!("{}:{sid}", root.id);
            for a in agents.values_mut() {
                if a.parent_id.as_deref() == Some(&placeholder) {
                    a.parent_id = Some(id.clone());
                }
            }
            if let Some(a) = agents.get_mut(&id) {
                a.session_id = Some(sid);
                if a.status == "starting" {
                    a.status = "idle".into();
                    a.activity = "Ready".into();
                }
            }
            *file_agent = Some(id);
        }
        let Some(a) = file_agent.as_ref().and_then(|id| agents.get_mut(id)) else {
            return;
        };
        if v["type"] == "event_msg" {
            match p["type"].as_str().unwrap_or("") {
                "task_started" => {
                    a.status = "working".into();
                    a.activity = "Thinking".into();
                }
                "task_complete" | "task_completed" => {
                    a.status = if a.parent_id.is_some() {
                        "done"
                    } else {
                        "idle"
                    }
                    .into();
                    a.activity = "Turn complete".into();
                }
                "turn_aborted" => {
                    a.status = "idle".into();
                    a.activity = "Interrupted".into();
                }
                "agent_message" => {
                    let t = s(p, "message");
                    a.activity = cut(&t);
                    a.append(&t);
                }
                "token_count" => {
                    let u = &p["info"]["total_token_usage"];
                    if !u.is_null() {
                        a.input_tokens = u["input_tokens"].as_u64();
                        a.output_tokens = u["output_tokens"].as_u64();
                        a.cached_tokens = u["cached_input_tokens"].as_u64();
                    }
                    a.context_tokens = p["info"]["last_token_usage"]["total_tokens"]
                        .as_u64()
                        .or(a.context_tokens);
                    a.context_window = p["info"]["model_context_window"]
                        .as_u64()
                        .or(a.context_window);
                    if !p["rate_limits"].is_null() {
                        a.rate_limits = Some(p["rate_limits"].clone());
                    }
                }
                _ => {}
            }
        }
        if v["type"] == "response_item" {
            match p["type"].as_str().unwrap_or("") {
                "function_call" | "custom_tool_call" => {
                    a.status = "working".into();
                    a.activity = format!("Running {}", s(p, "name"));
                    a.append(&format!("› {} {}", s(p, "name"), cut(&s(p, "arguments"))));
                }
                "message" if p["role"] == "assistant" || p["role"] == "user" => {
                    if let Some(items) = p["content"].as_array() {
                        for item in items {
                            if let Some(t) = item["text"].as_str() {
                                a.append(t);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    fn claude(
        &mut self,
        root: &Agent,
        path: &Path,
        v: &Value,
        agents: &mut HashMap<String, Agent>,
    ) {
        let aid = path
            .file_stem()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .strip_prefix("agent-");
        let id = aid
            .map(|id| format!("{}:{id}", root.id))
            .unwrap_or(root.id.clone());
        if aid.is_some() {
            self.child(root, &id, &root.id, "Subagent", agents);
        }
        let Some(a) = agents.get_mut(&id) else { return };
        a.session_id = Some(root.id.clone());
        match v["type"].as_str().unwrap_or("") {
            "user" => {
                a.status = "working".into();
                a.activity = "Thinking".into();
                if let Some(t) = v["message"]["content"].as_str() {
                    a.append(&format!("› {t}"));
                }
            }
            "assistant" => {
                let m = &v["message"];
                if let Some(items) = m["content"].as_array() {
                    for item in items {
                        match item["type"].as_str().unwrap_or("") {
                            "text" => {
                                let t = s(item, "text");
                                a.append(&t);
                                a.activity = cut(&t);
                            }
                            "tool_use" => {
                                a.status = "working".into();
                                a.activity = format!("Running {}", s(item, "name"));
                                a.append(&format!(
                                    "› {} {}",
                                    s(item, "name"),
                                    cut(&item["input"].to_string())
                                ));
                            }
                            "thinking" => {
                                a.status = "working".into();
                                a.activity = "Thinking".into();
                            }
                            _ => {}
                        }
                    }
                }
                let u = &m["usage"];
                if !u.is_null() {
                    let cache = u["cache_read_input_tokens"].as_u64().unwrap_or(0);
                    let input = u["input_tokens"].as_u64().unwrap_or(0)
                        + u["cache_creation_input_tokens"].as_u64().unwrap_or(0)
                        + cache;
                    self.usage.insert(
                        (id.clone(), s(m, "id")),
                        (input, u["output_tokens"].as_u64().unwrap_or(0), cache),
                    );
                    let total = self
                        .usage
                        .iter()
                        .filter(|((key, _), _)| key == &id)
                        .fold((0, 0, 0), |x, (_, u)| (x.0 + u.0, x.1 + u.1, x.2 + u.2));
                    a.input_tokens = Some(total.0);
                    a.output_tokens = Some(total.1);
                    a.cached_tokens = Some(total.2);
                    a.context_tokens = Some(input);
                }
                if m["stop_reason"] == "end_turn" {
                    a.status = "idle".into();
                }
            }
            "system" if v["subtype"] == "turn_duration" => {
                a.status = "idle".into();
                a.activity = "Turn complete".into();
            }
            "cost-state" => {
                a.cost = v["totalCostUSD"].as_f64();
            }
            _ => {}
        }
    }
    fn hook(&mut self, root: &Agent, v: &Value, agents: &mut HashMap<String, Agent>) {
        let event = s(v, "hook_event_name");
        let aid = s(v, "agent_id");
        // Some Claude builds emit Stop for internal hook evaluators with no
        // Start event, type, or transcript. They are not CLI subagent sessions.
        if event == "SubagentStop"
            && s(v, "agent_type").is_empty()
            && !agents.contains_key(&format!("{}:{aid}", root.id))
            && !Path::new(&s(v, "agent_transcript_path")).is_file()
        {
            return;
        }
        let id = if aid.is_empty() {
            root.id.clone()
        } else {
            format!("{}:{aid}", root.id)
        };
        if !aid.is_empty() {
            self.child(root, &id, &root.id, &s(v, "agent_type"), agents);
        }
        let Some(a) = agents.get_mut(&id) else { return };
        if !s(v, "agent_type").is_empty() {
            a.name = s(v, "agent_type");
        }
        match event.as_str() {
            "SessionStart" => {
                a.status = "idle".into();
                a.activity = "Ready".into();
            }
            "UserPromptSubmit" | "SubagentStart" => {
                a.status = "working".into();
                a.activity = "Thinking".into();
            }
            "PreToolUse" => {
                a.status = "working".into();
                a.activity = format!("Running {}", s(v, "tool_name"));
            }
            "PermissionRequest" => {
                a.status = "waiting".into();
                a.activity = "Approval needed in terminal".into();
            }
            "PostToolUse" | "PostToolUseFailure" => {
                a.status = "working".into();
                a.activity = "Thinking".into();
            }
            "Stop" => {
                a.status = "idle".into();
                a.activity = "Turn complete".into();
            }
            "SubagentStop" => {
                a.status = "done".into();
                a.activity = cut(&s(v, "last_assistant_message"));
            }
            "SessionEnd" => {
                a.status = "stopped".into();
                a.activity = "Session ended".into();
            }
            "Notification" if v["notification_type"] == "permission_prompt" => {
                a.status = "waiting".into();
                a.activity = "Approval needed in terminal".into();
            }
            _ => {}
        }
    }
}

pub fn claude_settings(exe: &Path, hooks: &Path) -> Value {
    let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    let command = format!(
        "{} --capture-hook {}",
        quote(&exe.to_string_lossy()),
        quote(&hooks.to_string_lossy())
    );
    let mut map = serde_json::Map::new();
    for event in [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
        "SubagentStart",
        "SubagentStop",
        "Stop",
        "Notification",
    ] {
        map.insert(
            event.into(),
            json!([{"matcher":"","hooks":[{"type":"command","command":command,"timeout":5}]}]),
        );
    }
    json!({"hooks":map})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_children_and_usage() {
        let root = Agent::root("root", "codex", "/tmp");
        let mut agents = HashMap::from([("root".into(), root.clone())]);
        let mut t = Tracker::default();
        let mut child = None;
        let mut parent = None;
        t.codex(&root,&json!({"type":"session_meta","payload":{"id":"c","source":{"subagent":{"thread_spawn":{"parent_thread_id":"p","agent_nickname":"Scout"}}}}}),&mut child,&mut agents);
        t.codex(
            &root,
            &json!({"type":"session_meta","payload":{"id":"p","source":"cli"}}),
            &mut parent,
            &mut agents,
        );
        assert_eq!(agents["root:c"].parent_id.as_deref(), Some("root"));
        t.codex(
            &root,
            &json!({"type":"session_meta","payload":{"id":"p","source":"cli"}}),
            &mut child,
            &mut agents,
        );
        assert_eq!(child.as_deref(), Some("root:c"));
        t.codex(&root,&json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":12},"last_token_usage":{"total_tokens":80},"model_context_window":200000},"rate_limits":{"primary":{"used_percent":4}}}}),&mut child,&mut agents);
        assert_eq!(agents["root:c"].input_tokens, Some(100));
        assert_eq!(agents["root:c"].context_tokens, Some(80));
        assert!(agents["root"].input_tokens.is_none());
    }
    #[test]
    fn claude_usage_dedup_and_hooks() {
        let root = Agent::root("r", "claude", "/tmp");
        let mut agents = HashMap::from([("r".into(), root.clone())]);
        let mut t = Tracker::default();
        let v = json!({"type":"assistant","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":20},"content":[]}});
        t.claude(&root, Path::new("r.jsonl"), &v, &mut agents);
        t.claude(&root, Path::new("r.jsonl"), &v, &mut agents);
        assert_eq!(agents["r"].input_tokens, Some(30));
        assert_eq!(agents["r"].output_tokens, Some(5));
        t.hook(
            &root,
            &json!({"hook_event_name":"SubagentStart","agent_id":"a","agent_type":"Explore"}),
            &mut agents,
        );
        assert_eq!(agents["r:a"].parent_id.as_deref(), Some("r"));
        t.hook(
            &root,
            &json!({"hook_event_name":"PermissionRequest","agent_id":"a"}),
            &mut agents,
        );
        assert_eq!(agents["r:a"].status, "waiting");
        t.hook(
            &root,
            &json!({"hook_event_name":"SubagentStop","agent_id":"a"}),
            &mut agents,
        );
        assert_eq!(agents["r:a"].status, "done");
    }
    #[test]
    #[ignore = "Requires opt-in local smoke reports: AGENT_CANVAS_REPLAY_DIR"]
    fn replay_live_cli_reports() {
        let base = std::env::var("AGENT_CANVAS_REPLAY_DIR").expect("report directory");
        for provider in ["codex", "claude"] {
            let report = Path::new(&base).join(format!("agent-canvas-{provider}3-report.json"));
            let saved: Vec<Agent> =
                serde_json::from_slice(&std::fs::read(&report).unwrap()).unwrap();
            let root = saved
                .iter()
                .find(|a| a.parent_id.is_none())
                .unwrap()
                .clone();
            let mut agents =
                HashMap::from([(root.id.clone(), Agent::root(&root.id, provider, &root.cwd))]);
            let data = report
                .with_extension("data")
                .join("sessions")
                .join(&root.id);
            let logs = if provider == "codex" {
                data.join("codex/sessions")
            } else {
                home_claude_projects().join(
                    root.cwd
                        .chars()
                        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                        .collect::<String>(),
                )
            };
            let mut tracker = Tracker::default();
            tracker.poll(&root, &logs, &data.join("hooks"), &mut agents);
            let children: Vec<_> = agents.values().filter(|a| a.parent_id.is_some()).collect();
            assert_eq!(children.len(), 1, "{provider}: one real child");
            let child = children[0];
            assert_eq!(child.parent_id.as_deref(), Some(root.id.as_str()));
            assert!(
                child.transcript.contains("CANVAS_CHILD_OK"),
                "{provider}: child transcript"
            );
            assert!(
                child.input_tokens.unwrap_or(0) > 0,
                "{provider}: child usage"
            );
            assert_eq!(child.status, "done", "{provider}: child completion");
            assert!(agents[&root.id].transcript.contains("CANVAS_ROOT_OK"));
            println!("{provider}: root + connected child, completed, transcript and measured usage verified");
        }
    }
    fn home_claude_projects() -> PathBuf {
        std::env::var_os("CLAUDE_CONFIG_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap()).join(".claude"))
            .join("projects")
    }
    #[test]
    fn partial_lines_wait_for_newline() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("r.jsonl");
        let root = Agent::root("r", "claude", "/tmp");
        let mut agents = HashMap::from([("r".into(), root.clone())]);
        let mut t = Tracker::default();
        std::fs::write(
            &path,
            b"{\"type\":\"user\",\"message\":{\"content\":\"hello",
        )
        .unwrap();
        t.read(&path, &root, &mut agents).unwrap();
        assert!(agents["r"].transcript.is_empty());
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"\"}}\n")
            .unwrap();
        t.read(&path, &root, &mut agents).unwrap();
        assert!(agents["r"].transcript.contains("hello"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}

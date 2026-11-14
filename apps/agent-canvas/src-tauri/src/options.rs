use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};
#[derive(Clone, Default, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchOptions {
    pub model: String,
    pub reasoning: String,
    pub permissions: String,
}
impl LaunchOptions {
    pub fn arguments(&self, provider: &str) -> Result<Vec<String>, String> {
        let mut args = Vec::new();
        let model = self.model.trim();
        if !model.is_empty() {
            if model.len() > 200 || model.starts_with('-') || model.chars().any(char::is_control) {
                return Err("Invalid model ID".into());
            }
            args.extend(["--model".into(), model.into()]);
        }
        if !self.reasoning.is_empty() {
            if !["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
                .contains(&self.reasoning.as_str())
            {
                return Err("Unsupported reasoning effort".into());
            }
            if provider == "codex" {
                args.extend([
                    "--config".into(),
                    format!("model_reasoning_effort=\"{}\"", self.reasoning),
                ]);
            } else {
                args.extend(["--effort".into(), self.reasoning.clone()]);
            }
        }
        match self.permissions.as_str() {
            "" | "default" => {}
            "read-only" => {
                if provider == "codex" {
                    args.extend(["--sandbox".into(), "read-only".into()]);
                } else {
                    args.extend(["--permission-mode".into(), "plan".into()]);
                }
            }
            "bypass" => args.push(
                if provider == "codex" {
                    "--dangerously-bypass-approvals-and-sandbox"
                } else {
                    "--dangerously-skip-permissions"
                }
                .into(),
            ),
            _ => return Err("Unsupported permission mode".into()),
        }
        Ok(args)
    }
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    pub reasoning: Vec<String>,
}
#[tauri::command]
pub async fn available_models(provider: String) -> Result<Vec<ModelOption>, String> {
    tauri::async_runtime::spawn_blocking(move || models(&provider))
        .await
        .map_err(super::err)?
}
fn models(provider: &str) -> Result<Vec<ModelOption>, String> {
    if provider == "claude" {
        return Ok([
            ("fable", "Fable"),
            ("opus", "Opus"),
            ("sonnet", "Sonnet"),
            ("haiku", "Haiku"),
        ]
        .into_iter()
        .map(|(id, label)| ModelOption {
            id: id.into(),
            label: label.into(),
            reasoning: ["low", "medium", "high", "xhigh", "max"]
                .map(String::from)
                .to_vec(),
        })
        .collect());
    }
    let mut child = Command::new(super::resolve(provider)?)
        .arg("app-server")
        .env("PATH", super::cli_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(super::err)?;
    let mut input = child.stdin.take().ok_or("No model-list input")?;
    let output = child.stdout.take().ok_or("No model-list output")?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let result = (|| -> Result<Vec<ModelOption>, String> {
            writeln!(input,"{}",json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"agent_canvas","version":"0.1.0"}}})).map_err(super::err)?;
            input.flush().map_err(super::err)?;
            for line in BufReader::new(output).lines() {
                let v: Value =
                    serde_json::from_str(&line.map_err(super::err)?).map_err(super::err)?;
                if v["id"] == 1 {
                    writeln!(input, "{}", json!({"method":"initialized","params":{}}))
                        .map_err(super::err)?;
                    writeln!(
                        input,
                        "{}",
                        json!({"id":2,"method":"model/list","params":{}})
                    )
                    .map_err(super::err)?;
                    input.flush().map_err(super::err)?;
                }
                if v["id"] == 2 {
                    let models = v["result"]["data"]
                        .as_array()
                        .ok_or("Model list unavailable")?;
                    return Ok(models
                        .iter()
                        .filter(|m| m["hidden"] != true)
                        .map(|m| ModelOption {
                            id: m["model"].as_str().unwrap_or_default().into(),
                            label: m["displayName"].as_str().unwrap_or_default().into(),
                            reasoning: m["supportedReasoningEfforts"]
                                .as_array()
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|v| {
                                            v["reasoningEffort"].as_str().map(String::from)
                                        })
                                        .collect()
                                })
                                .unwrap_or_default(),
                        })
                        .collect());
                }
            }
            Err("Model-list connection closed".into())
        })();
        let _ = send.send(result);
    });
    let result = receive
        .recv_timeout(Duration::from_secs(12))
        .map_err(|_| "Model list timed out. Enter a model ID or use CLI default.".to_string());
    let _ = child.kill();
    let _ = child.wait();
    result?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_provider_flags() {
        let o = LaunchOptions {
            model: "custom-model".into(),
            reasoning: "high".into(),
            permissions: "bypass".into(),
        };
        assert_eq!(
            o.arguments("codex").unwrap(),
            [
                "--model",
                "custom-model",
                "--config",
                "model_reasoning_effort=\"high\"",
                "--dangerously-bypass-approvals-and-sandbox"
            ]
        );
        assert_eq!(
            o.arguments("claude").unwrap(),
            [
                "--model",
                "custom-model",
                "--effort",
                "high",
                "--dangerously-skip-permissions"
            ]
        );
        assert!(LaunchOptions::default()
            .arguments("codex")
            .unwrap()
            .is_empty());
        assert!(LaunchOptions {
            permissions: "oops".into(),
            ..Default::default()
        }
        .arguments("codex")
        .is_err());
    }
    #[test]
    #[ignore = "Requires installed, authenticated Codex; lists metadata only"]
    fn installed_codex_catalog() {
        let list = models("codex").unwrap();
        assert!(!list.is_empty());
        assert!(list.iter().all(|m| !m.id.is_empty()));
        println!("{} installed Codex models available", list.len());
    }
}

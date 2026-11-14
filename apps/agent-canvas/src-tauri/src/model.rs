use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    #[serde(default)]
    pub settings: Option<crate::options::LaunchOptions>,
    pub id: String,
    pub root_id: String,
    pub parent_id: Option<String>,
    pub session_id: Option<String>,
    pub provider: String,
    pub name: String,
    pub cwd: String,
    pub status: String,
    pub activity: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_tokens: Option<u64>,
    pub context_tokens: Option<u64>,
    pub context_window: Option<u64>,
    pub cost: Option<f64>,
    pub rate_limits: Option<Value>,
    pub transcript: String,
    pub telemetry_error: Option<String>,
}
impl Agent {
    pub fn root(id: &str, provider: &str, cwd: &str) -> Self {
        Self {
            settings: None,
            id: id.into(),
            root_id: id.into(),
            parent_id: None,
            session_id: None,
            provider: provider.into(),
            name: if provider == "codex" {
                "Codex"
            } else {
                "Claude"
            }
            .into(),
            cwd: cwd.into(),
            status: "starting".into(),
            activity: "Opening CLI".into(),
            input_tokens: None,
            output_tokens: None,
            cached_tokens: None,
            context_tokens: None,
            context_window: None,
            cost: None,
            rate_limits: None,
            transcript: String::new(),
            telemetry_error: None,
        }
    }
    pub fn append(&mut self, text: &str) {
        self.transcript.push_str(text);
        self.transcript.push('\n');
        if self.transcript.len() > 200_000 {
            let mut boundary = self.transcript.len() - 160_000;
            while !self.transcript.is_char_boundary(boundary) {
                boundary += 1;
            }
            self.transcript.drain(..boundary);
        }
    }
}

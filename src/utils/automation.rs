use std::{
    collections::{HashMap, VecDeque},
    io::{self, IsTerminal, Read},
    sync::{Mutex, OnceLock},
};

use anyhow::{Context, Result, bail};

use crate::utils::paths::normalize_path;

const KNOWN_KEYS: &[&str] = &[
    "author",
    "count",
    "github",
    "input",
    "message",
    "name",
    "nickname",
    "passphrase",
    "remote",
    "url",
    "user_id",
];

#[derive(Default)]
struct AutomationInput {
    values: HashMap<String, VecDeque<String>>,
    fallback: VecDeque<String>,
    file_passphrases: HashMap<String, String>,
    file_passphrase_all: Option<String>,
    file_passphrase_overrides: HashMap<String, String>,
    file_passphrase_all_override: Option<String>,
}

impl AutomationInput {
    fn parse(input: &str) -> Result<Self> {
        let mut parsed = Self::default();

        for (index, raw_line) in input.lines().enumerate() {
            let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
            if line.is_empty() {
                continue;
            }

            let Some((raw_key, value)) = line.split_once('=') else {
                parsed.fallback.push_back(line.to_string());
                continue;
            };

            let key = raw_key.trim();
            if let Some(path) = key.strip_prefix("file:") {
                if path.is_empty() {
                    bail!("Piped input line {} has an empty file path", index + 1);
                }

                if path == "*" {
                    parsed.file_passphrase_all = Some(value.to_string());
                } else {
                    parsed
                        .file_passphrases
                        .insert(normalize_path(path), value.to_string());
                }
                continue;
            }

            let key = key.to_ascii_lowercase();
            if !KNOWN_KEYS.contains(&key.as_str()) {
                bail!(
                    "Unknown piped input key '{}' on line {}",
                    raw_key,
                    index + 1
                );
            }

            parsed
                .values
                .entry(key)
                .or_default()
                .push_back(value.to_string());
        }

        Ok(parsed)
    }

    fn take_value(&mut self, key: &str) -> Option<String> {
        self.values
            .get_mut(&key.to_ascii_lowercase())
            .and_then(VecDeque::pop_front)
    }

    fn take_value_or_fallback(&mut self, key: &str) -> Option<String> {
        self.take_value(key).or_else(|| self.fallback.pop_front())
    }

    fn take_file_passphrase(&mut self, path: &str) -> Option<String> {
        let path = normalize_path(path);
        self.file_passphrase_overrides
            .remove(&path)
            .or_else(|| self.file_passphrase_all_override.clone())
            .or_else(|| self.file_passphrases.remove(&path))
            .or_else(|| self.file_passphrase_all.clone())
            .or_else(|| self.fallback.pop_front())
    }
}

static AUTOMATION_INPUT: OnceLock<Mutex<AutomationInput>> = OnceLock::new();

fn input() -> &'static Mutex<AutomationInput> {
    AUTOMATION_INPUT.get_or_init(|| Mutex::new(AutomationInput::default()))
}

pub fn initialize() -> Result<()> {
    if io::stdin().is_terminal() {
        return Ok(());
    }

    let mut buffer = String::new();
    io::stdin()
        .read_to_string(&mut buffer)
        .context("Failed to read piped input")?;

    let parsed = AutomationInput::parse(&buffer)?;
    let _ = AUTOMATION_INPUT.set(Mutex::new(parsed));
    Ok(())
}

pub fn take_value(key: &str) -> Option<String> {
    input().lock().ok()?.take_value(key)
}

pub fn take_value_or_fallback(key: &str) -> Option<String> {
    input().lock().ok()?.take_value_or_fallback(key)
}

pub fn take_fallback() -> Option<String> {
    input().lock().ok()?.fallback.pop_front()
}

pub fn set_file_passphrase_overrides(
    entries: impl IntoIterator<Item = (String, String)>,
    all: Option<String>,
) {
    if let Ok(mut input) = input().lock() {
        for (path, passphrase) in entries {
            input
                .file_passphrase_overrides
                .insert(normalize_path(&path), passphrase);
        }

        if all.is_some() {
            input.file_passphrase_all_override = all;
        }
    }
}

pub fn take_file_passphrase(path: &str) -> Option<String> {
    input().lock().ok()?.take_file_passphrase(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_named_values_and_preserves_equals_in_values() {
        let mut input = AutomationInput::parse(
            "passphrase=project=secret\nfile:.env=file=secret\nmessage=Ship it\n",
        )
        .unwrap();

        assert_eq!(
            input.take_value("passphrase").as_deref(),
            Some("project=secret")
        );
        assert_eq!(
            input.take_file_passphrase("./.env").as_deref(),
            Some("file=secret")
        );
        assert_eq!(input.take_value("message").as_deref(), Some("Ship it"));
    }

    #[test]
    fn uses_exact_file_passphrase_before_wildcard() {
        let mut input =
            AutomationInput::parse("file:*=shared\nfile:config/.env=specific\n").unwrap();

        assert_eq!(
            input.take_file_passphrase(".\\config\\.env").as_deref(),
            Some("specific")
        );
        assert_eq!(
            input.take_file_passphrase(".env.local").as_deref(),
            Some("shared")
        );
    }

    #[test]
    fn command_line_file_passphrases_override_piped_values() {
        let mut input =
            AutomationInput::parse("file:*=piped-shared\nfile:.env=piped-specific\n").unwrap();
        input.file_passphrase_all_override = Some("argument-shared".to_string());
        input
            .file_passphrase_overrides
            .insert(normalize_path(".env"), "argument-specific".to_string());

        assert_eq!(
            input.take_file_passphrase(".env").as_deref(),
            Some("argument-specific")
        );
        assert_eq!(
            input.take_file_passphrase(".env.production").as_deref(),
            Some("argument-shared")
        );
    }

    #[test]
    fn retains_plain_lines_as_positional_fallbacks() {
        let mut input = AutomationInput::parse("first\nsecond\n").unwrap();

        assert_eq!(
            input.take_value_or_fallback("name").as_deref(),
            Some("first")
        );
        assert_eq!(
            input.take_value_or_fallback("passphrase").as_deref(),
            Some("second")
        );
    }

    #[test]
    fn rejects_unknown_named_keys() {
        let error = AutomationInput::parse("pasphrase=typo\n")
            .err()
            .unwrap()
            .to_string();

        assert!(error.contains("Unknown piped input key 'pasphrase'"));
    }
}

use console::{StyledObject, style};
use dialoguer::Input;
use indicatif::{ProgressBar, ProgressStyle};
use std::io::{self, IsTerminal};

use crate::utils::automation;

pub const ICON_SUCCESS: &str = "✓";
pub const ICON_ERROR: &str = "✗";
pub const ICON_INFO: &str = "𝙞";
pub const ICON_ARROW: &str = "→";
pub const ICON_WARN: &str = "!";
pub const ICON_BULLET: &str = "•";

pub fn is_interactive() -> bool {
    io::stdin().is_terminal()
}

pub fn success_prefix() -> StyledObject<&'static str> {
    style(ICON_SUCCESS).green().bold()
}

pub fn error_prefix() -> StyledObject<&'static str> {
    style(ICON_ERROR).red().bold()
}

pub fn info_prefix() -> StyledObject<&'static str> {
    style(ICON_INFO).cyan()
}

pub fn warn_prefix() -> StyledObject<&'static str> {
    style(ICON_WARN).yellow().bold()
}

pub fn arrow_prefix() -> StyledObject<&'static str> {
    style(ICON_ARROW).cyan().bold()
}

pub fn bullet_prefix() -> StyledObject<&'static str> {
    style(ICON_BULLET).dim()
}

pub fn print_success(message: &str) {
    println!("{} {}", success_prefix(), style(message).green());
}

pub fn print_error(message: &str) {
    eprintln!("{} {}", error_prefix(), style(message).red());
}

pub fn print_info(message: &str) {
    println!("{} {}", info_prefix(), style(message).dim());
}

pub fn print_warn(message: &str) {
    println!("{} {}", warn_prefix(), style(message).yellow());
}

pub fn print_header(title: &str) {
    println!("\n{} {}", arrow_prefix(), style(title).bold());
    println!();
}

pub fn print_kv(key: &str, value: &str) {
    println!("  {} {}", style(key).dim(), value);
}

pub fn print_kv_highlight(key: &str, value: &str) {
    println!("  {} {}", style(key).dim(), style(value).cyan());
}

pub fn print_kv_warn(key: &str, value: &str) {
    println!("  {} {}", style(key).dim(), style(value).yellow());
}

pub fn print_item(text: &str) {
    println!("  {} {}", bullet_prefix(), text);
}

pub fn create_spinner(message: &str) -> ProgressBar {
    let spinner = ProgressBar::new_spinner();
    spinner.set_style(
        ProgressStyle::default_spinner()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"])
            .template("{spinner:.cyan} {msg}")
            .unwrap(),
    );
    spinner.enable_steady_tick(std::time::Duration::from_millis(80));
    spinner.set_message(message.to_string());
    spinner
}

pub fn create_progress_bar(len: u64) -> ProgressBar {
    let pb = ProgressBar::new(len);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("━╸─"),
    );
    pb
}

pub fn prompt_input(prompt: &str) -> anyhow::Result<String> {
    if !is_interactive() {
        return automation::take_fallback()
            .ok_or_else(|| anyhow::anyhow!("No value was provided via stdin"));
    }

    use dialoguer::theme::ColorfulTheme;

    let theme = ColorfulTheme::default();

    let result: String = Input::with_theme(&theme)
        .with_prompt(prompt)
        .interact_text()?;

    Ok(result)
}

pub fn prompt_passphrase(prompt: &str, min_length: usize) -> anyhow::Result<String> {
    if !is_interactive() {
        let input = automation::take_value_or_fallback("passphrase")
            .ok_or_else(|| anyhow::anyhow!("No passphrase was provided via stdin"))?;

        if input.len() < min_length {
            anyhow::bail!("Passphrase must be at least {} characters long", min_length);
        }
        return Ok(input);
    }

    use dialoguer::{Password, theme::ColorfulTheme};

    let theme = ColorfulTheme::default();

    let result: String = Password::with_theme(&theme)
        .with_prompt(prompt)
        .validate_with(|input: &String| -> Result<(), String> {
            if input.len() < min_length {
                Err(format!(
                    "Passphrase must be at least {} characters long",
                    min_length
                ))
            } else {
                Ok(())
            }
        })
        .interact()?;

    Ok(result)
}

pub type InputValidator = fn(&String) -> Result<(), String>;

pub fn prompt_input_with_default(
    prompt: &str,
    default: &str,
    validator: Option<InputValidator>,
) -> anyhow::Result<String> {
    if !is_interactive() {
        let input = automation::take_fallback()
            .ok_or_else(|| anyhow::anyhow!("No value was provided via stdin"))?;
        let value = if input.is_empty() {
            default.to_string()
        } else {
            input
        };
        if let Some(validate_fn) = validator
            && let Err(e) = validate_fn(&value)
        {
            anyhow::bail!(e);
        }
        return Ok(value);
    }

    use console::style;
    use dialoguer::theme::ColorfulTheme;

    let theme = ColorfulTheme::default();
    let default_plain = default.to_string();
    let styled_default = style(&default_plain).dim().to_string();

    let result: String = if let Some(validate_fn) = validator {
        Input::with_theme(&theme)
            .with_prompt(prompt)
            .default(styled_default.clone())
            .validate_with(validate_fn)
            .interact_text()?
    } else {
        Input::with_theme(&theme)
            .with_prompt(prompt)
            .default(styled_default.clone())
            .interact_text()?
    };

    if result == styled_default || result.contains("\x1b[") || result.trim().is_empty() {
        Ok(default_plain)
    } else {
        Ok(result)
    }
}

pub fn generate_secure_passphrase(length: usize) -> String {
    use rand::Rng;
    const CHARSET: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+";

    let mut rng = rand::rng();
    (0..length)
        .map(|_| {
            let idx = rng.random_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

pub enum PassphraseResult {
    Passphrase(String),
    Skip,
}

pub fn prompt_file_passphrase(file_path: &str) -> anyhow::Result<PassphraseResult> {
    if !is_interactive() {
        let input = automation::take_file_passphrase(file_path).unwrap_or_default();
        if input.is_empty() || input.to_lowercase() == "skip" {
            return Ok(PassphraseResult::Skip);
        }
        return Ok(PassphraseResult::Passphrase(input));
    }

    use dialoguer::{Input, theme::ColorfulTheme};

    let theme = ColorfulTheme::default();

    println!(
        "  {} Enter passphrase for {} (or 'skip' to skip):",
        style(ICON_ARROW).cyan(),
        style(file_path).yellow()
    );

    let result: String = Input::with_theme(&theme)
        .with_prompt("Passphrase")
        .allow_empty(true)
        .interact_text()?;

    if result.is_empty() || result.to_lowercase() == "skip" {
        Ok(PassphraseResult::Skip)
    } else {
        Ok(PassphraseResult::Passphrase(result))
    }
}

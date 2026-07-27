use std::fs::remove_dir_all;
use std::path::Path;
use std::str::FromStr;

use clap::{Parser, Subcommand};

use crate::commands::update::{check_for_update, print_update_notification};
use crate::commands::{auth::logout_command, status::status};
use crate::utils::automation::{
    initialize as initialize_automation_input, set_file_passphrase_overrides, take_value,
    take_value_or_fallback,
};
use crate::utils::session::set_passphrase_override;
use crate::utils::ui::{
    generate_secure_passphrase, is_interactive, print_error, print_info, print_success,
    prompt_input_with_default,
};

pub mod commands;
pub mod utils;

#[derive(Parser)]
#[command(name = "envy")]
#[command(about = "Secure .env storage with client-side encryption")]
#[command(version)]
#[command(
    after_help = "Automation: pipe newline-delimited key=value input when arguments are omitted. Run `envy help <COMMAND>` and see skills/use-envoy/SKILL.md for accepted keys."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum RemoteCommand {
    Add {
        name: Option<String>,
        url: Option<String>,
    },
}

#[derive(Subcommand)]
enum MemberCommand {
    Add {
        github: Option<String>,
        #[arg(short, long)]
        nickname: Option<String>,
    },
    List {},
    Remove {
        user_id: Option<String>,
    },
    RemoveAll {},
}

#[derive(Subcommand)]
enum AccessCommand {
    Grant {
        input: Option<String>,
        user_id: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Revoke {
        input: Option<String>,
        user_id: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    List {
        input: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Unrestrict {
        input: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
}

#[derive(Clone, Debug)]
struct FilePassphraseArg {
    path: String,
    passphrase: String,
}

impl FromStr for FilePassphraseArg {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let Some((path, passphrase)) = value.split_once('=') else {
            return Err("expected FILE=PASSPHRASE".to_string());
        };

        if path.trim().is_empty() {
            return Err("file path cannot be empty".to_string());
        }

        Ok(Self {
            path: path.to_string(),
            passphrase: passphrase.to_string(),
        })
    }
}

#[derive(Subcommand)]
enum Commands {
    /// Stage a file using the project's single passphrase.
    Add {
        path: Option<String>,
        #[arg(short, long)]
        input: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    /// Legacy per-file passphrase encryption. Prefer `envy add`.
    Encrypt {
        path: Option<String>,
        #[arg(short, long)]
        input: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    #[command(visible_alias = "rm")]
    Remove {
        path: Option<String>,
        #[arg(short, long)]
        input: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
        /// Remove from tracking but keep the working-tree file.
        #[arg(long)]
        cached: bool,
    },
    // Decrypt {},
    Init {
        #[arg(short, long)]
        name: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Login {},
    Logout {},
    Update {},
    Push {
        remote: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Pull {
        remote: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
        #[arg(
            long = "file-passphrase",
            value_name = "FILE=PASSPHRASE",
            action = clap::ArgAction::Append
        )]
        file_passphrases: Vec<FilePassphraseArg>,
        #[arg(long, value_name = "PASSPHRASE")]
        file_passphrase_all: Option<String>,
    },
    Status {
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Doctor {
        remote: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    /// Show working-tree changes, or staged changes with --cached.
    Diff {
        #[arg(long)]
        cached: bool,
        /// Reveal plaintext values. By default Envoy redacts secret values.
        #[arg(long)]
        show_secrets: bool,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Remote {
        #[command(subcommand)]
        command: RemoteCommand,
    },
    Member {
        #[command(subcommand)]
        command: MemberCommand,
    },
    /// Manage which project members can download a tracked file.
    Access {
        #[command(subcommand)]
        command: AccessCommand,
    },
    Commit {
        #[arg(short, long)]
        message: Option<String>,
        #[arg(short, long)]
        author: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Log {
        #[arg(short, long)]
        count: Option<usize>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
}

fn optional_argument(cli_value: Option<String>, key: &str) -> Option<String> {
    cli_value.or_else(|| take_value(key))
}

fn required_argument(cli_value: Option<String>, key: &str) -> anyhow::Result<String> {
    cli_value
        .or_else(|| take_value_or_fallback(key))
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Missing '{}'. Pass it as an argument or pipe '{}=<value>'.",
                key,
                key
            )
        })
}

fn optional_number<T>(cli_value: Option<T>, key: &str) -> anyhow::Result<Option<T>>
where
    T: FromStr,
    T::Err: std::fmt::Display,
{
    if let Some(value) = cli_value {
        return Ok(Some(value));
    }

    match take_value(key) {
        Some(value) => value
            .parse::<T>()
            .map(Some)
            .map_err(|e| anyhow::anyhow!("Invalid piped value for '{}': {}", key, e)),
        None => Ok(None),
    }
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    initialize_automation_input()?;

    let is_update_command = matches!(cli.command, Commands::Update {});

    match cli.command {
        Commands::Update {} => {
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { commands::update::update().await });

            if let Err(e) = result {
                print_error(&format!("Update failed: {}", e));
                std::process::exit(1);
            }
        }
        Commands::Init {
            name: cli_name,
            passphrase: cli_passphrase,
        } => {
            let default_passphrase = generate_secure_passphrase(16);
            let root = Path::new(".envoy");

            if root.exists() {
                print_info("Envoy project already initialized.");
                return Ok(());
            }

            let project_name = if let Some(name) = optional_argument(cli_name, "name") {
                name
            } else if !is_interactive() {
                "My Envoy Project".to_string()
            } else {
                println!();
                match prompt_input_with_default("Enter project name", "My Envoy Project", None) {
                    Ok(name) => name,
                    Err(e) => {
                        print_error(&format!("Failed to read project name: {}", e));
                        std::process::exit(1);
                    }
                }
            };

            let passphrase = if let Some(pass) = optional_argument(cli_passphrase, "passphrase") {
                if pass.len() < 6 {
                    print_error("Passphrase must be at least 6 characters long");
                    std::process::exit(1);
                }
                pass
            } else {
                match prompt_input_with_default(
                    "Enter project passphrase",
                    &default_passphrase,
                    Some(|input: &String| {
                        if input.len() < 6 {
                            Err("Must be at least 6 characters long".to_string())
                        } else {
                            Ok(())
                        }
                    }),
                ) {
                    Ok(pass) => pass,
                    Err(e) => {
                        print_error(&format!("Failed to read passphrase: {}", e));
                        std::process::exit(1);
                    }
                }
            };

            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async {
                    commands::init::init_project(Some(project_name), &passphrase).await
                });

            if let Err(e) = result {
                print_error(&format!("Initialization failed: {}", e));
                let root = Path::new(".envoy");
                if root.exists() {
                    let _ = remove_dir_all(root);
                }
                std::process::exit(1);
            }
        }
        Commands::Login {} => {
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { commands::auth::login().await });

            if let Err(e) = result {
                print_error(&format!("Login failed: {}", e));
                std::process::exit(1);
            }
        }
        Commands::Logout {} => {
            logout_command()?;
        }
        Commands::Remote { command } => match command {
            RemoteCommand::Add { name, url } => {
                let name = required_argument(name, "name")?;
                let url = required_argument(url, "url")?;
                commands::remote::add_remote(&name, &url)?;
            }
        },
        Commands::Encrypt {
            path,
            input: cli_input,
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let default_passphrase = generate_secure_passphrase(16);
            let input = optional_argument(cli_input.or(path), "input")
                .unwrap_or_else(|| ".env".to_string());

            let passphrase = if let Some(pass) = optional_argument(cli_passphrase, "passphrase") {
                if pass.len() < 6 {
                    print_error("Passphrase must be at least 6 characters long");
                    std::process::exit(1);
                }
                pass
            } else {
                match prompt_input_with_default(
                    &format!("Enter passphrase to encrypt {}", input),
                    &default_passphrase,
                    Some(|input: &String| {
                        if input.len() < 6 {
                            Err("Must be at least 6 characters long".to_string())
                        } else {
                            Ok(())
                        }
                    }),
                ) {
                    Ok(pass) => pass,
                    Err(e) => {
                        print_error(&format!("Failed to read passphrase: {}", e));
                        std::process::exit(1);
                    }
                }
            };

            commands::crypto::encrypt_file(&input, &passphrase)?;
            print_success("File encrypted successfully");
        }
        Commands::Add {
            path,
            input: cli_input,
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let input = optional_argument(cli_input.or(path), "input")
                .unwrap_or_else(|| ".env".to_string());
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");
            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            commands::crypto::add_file(&input)?;
            print_success("File staged successfully");
        }

        // Deprecated since v0.1.5
        // Commands::Decrypt {} => {
        //     utils::initialized::check_initialized()?;
        //     let passphrase = Password::new().with_prompt("Enter passphrase").interact()?;

        //     commands::crypto::decrypt_files(&passphrase)?;
        //     print_success("File decrypted successfully");
        // }
        Commands::Push {
            remote: cli_remote,
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let remote = optional_argument(cli_remote, "remote");
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");

            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { commands::push::push(remote.as_deref()).await });

            if let Err(e) = result {
                print_error(&format!("Push failed: {}", e));
                std::process::exit(1);
            }
        }

        Commands::Remove {
            path,
            input: cli_input,
            passphrase: cli_passphrase,
            cached,
        } => {
            utils::initialized::check_initialized()?;
            let input = optional_argument(cli_input.or(path), "input")
                .unwrap_or_else(|| ".env".to_string());
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");
            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }
            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { commands::remove::remove_file(&input, cached) });

            if let Err(e) = result {
                print_error(&format!("Remove file failed: {}", e));
                std::process::exit(1);
            }
        }

        Commands::Pull {
            remote: cli_remote,
            passphrase: cli_passphrase,
            file_passphrases,
            file_passphrase_all,
        } => {
            utils::initialized::check_initialized()?;
            let remote = optional_argument(cli_remote, "remote");
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");
            set_file_passphrase_overrides(
                file_passphrases
                    .into_iter()
                    .map(|entry| (entry.path, entry.passphrase)),
                file_passphrase_all,
            );

            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            let result = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async { commands::pull::pull(remote.as_deref()).await });

            if let Err(e) = result {
                print_error(&format!("Pull failed: {}", e));
                std::process::exit(1);
            }
        }
        Commands::Status {
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");

            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;

            rt.block_on(status())?;
        }
        Commands::Doctor {
            remote: cli_remote,
            passphrase: cli_passphrase,
        } => {
            let remote = optional_argument(cli_remote, "remote");
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");
            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;

            rt.block_on(commands::doctor::doctor(remote.as_deref()))?;
        }
        Commands::Diff {
            cached,
            show_secrets,
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");
            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }
            commands::diff::diff(cached, show_secrets)?;
        }
        Commands::Member { command } => match command {
            MemberCommand::Add { github, nickname } => {
                utils::initialized::check_initialized()?;
                let github = required_argument(github, "github")?;
                let nickname = required_argument(nickname, "nickname")?;
                let username = utils::members::parse_github_username(&github)?;

                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(async {
                        let github_id = utils::members::resolve_github_user(&username).await?;
                        commands::member::add_member(github_id, &nickname).await
                    });

                if let Err(e) = result {
                    print_error(&format!("Add member failed: {}", e));
                    std::process::exit(1);
                }
            }
            MemberCommand::List {} => {
                utils::initialized::check_initialized()?;

                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(async { commands::member::list_members().await });

                if let Err(e) = result {
                    print_error(&format!("List members failed: {}", e));
                    std::process::exit(1);
                }
            }
            MemberCommand::Remove { user_id } => {
                utils::initialized::check_initialized()?;
                let user_id = required_argument(user_id, "user_id")?;

                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(async { commands::member::remove_member(&user_id).await });

                if let Err(e) = result {
                    print_error(&format!("Remove member failed: {}", e));
                    std::process::exit(1);
                }
            }
            MemberCommand::RemoveAll {} => {
                utils::initialized::check_initialized()?;

                let result = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(async { commands::member::remove_all_members().await });

                if let Err(e) = result {
                    print_error(&format!("Remove all members failed: {}", e));
                    std::process::exit(1);
                }
            }
        },
        Commands::Access { command } => {
            utils::initialized::check_initialized()?;
            match command {
                AccessCommand::Grant {
                    input,
                    user_id,
                    passphrase,
                } => {
                    let input = required_argument(input, "input")?;
                    let user_id = required_argument(user_id, "user_id")?;
                    let passphrase = optional_argument(passphrase, "passphrase");
                    if passphrase.is_some() {
                        set_passphrase_override(passphrase);
                    }
                    commands::access::grant(&input, &user_id)?;
                }
                AccessCommand::Revoke {
                    input,
                    user_id,
                    passphrase,
                } => {
                    let input = required_argument(input, "input")?;
                    let user_id = required_argument(user_id, "user_id")?;
                    let passphrase = optional_argument(passphrase, "passphrase");
                    if passphrase.is_some() {
                        set_passphrase_override(passphrase);
                    }
                    commands::access::revoke(&input, &user_id)?;
                }
                AccessCommand::List { input, passphrase } => {
                    let input = required_argument(input, "input")?;
                    let passphrase = optional_argument(passphrase, "passphrase");
                    if passphrase.is_some() {
                        set_passphrase_override(passphrase);
                    }
                    commands::access::list(&input)?;
                }
                AccessCommand::Unrestrict { input, passphrase } => {
                    let input = required_argument(input, "input")?;
                    let passphrase = optional_argument(passphrase, "passphrase");
                    if passphrase.is_some() {
                        set_passphrase_override(passphrase);
                    }
                    commands::access::unrestrict(&input)?;
                }
            }
        }
        Commands::Commit {
            message,
            author,
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let message = required_argument(message, "message")?;
            let author = optional_argument(author, "author");
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");

            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            if let Err(e) = commands::commit::commit(&message, author) {
                print_error(&format!("Commit failed: {}", e));
                std::process::exit(1);
            }
        }
        Commands::Log {
            count,
            passphrase: cli_passphrase,
        } => {
            utils::initialized::check_initialized()?;
            let count = optional_number(count, "count")?.unwrap_or(10);
            let cli_passphrase = optional_argument(cli_passphrase, "passphrase");

            if cli_passphrase.is_some() {
                set_passphrase_override(cli_passphrase);
            }

            if let Err(e) = commands::commit::log(count) {
                print_error(&format!("Log failed: {}", e));
                std::process::exit(1);
            }
        }
    }

    if !is_update_command && std::env::var_os("ENVOY_NO_UPDATE_CHECK").is_none() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        if let Some(latest) = rt.block_on(check_for_update()) {
            print_update_notification(&latest);
        }
    }
    Ok(())
}

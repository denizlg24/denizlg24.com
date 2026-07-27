use anyhow::{Ok, Result, bail};
use console::style;
use reqwest::Client;
use serde::Deserialize;
use tokio::time::{Duration, Instant, sleep};

use crate::utils::{
    config::{auth_server_url, load_token, logout, save_token},
    ui::{create_spinner, print_header, print_info, print_kv, print_success},
};

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum TokenResponse {
    Success {
        #[serde(rename = "apiToken")]
        api_token: String,
    },
    Pending {
        error: String,
    },
}

pub async fn login() -> Result<()> {
    if load_token().is_ok() {
        print_info("Already logged in");
        return Ok(());
    }

    let client = Client::new();

    let device: DeviceCodeResponse = client
        .post(format!("{}/auth/github/device", auth_server_url()))
        .send()
        .await?
        .json::<DeviceCodeResponse>()
        .await?;

    print_header("GitHub Authentication");
    print_kv("Open:", &device.verification_uri);
    println!(
        "  {} {}",
        style("Code:").dim(),
        style(&device.user_code).yellow().bold()
    );
    println!();

    let spinner = create_spinner("Waiting for authorization...");

    let deadline = Instant::now() + Duration::from_secs(device.expires_in);

    loop {
        if Instant::now() >= deadline {
            spinner.finish_and_clear();
            bail!("Authorization timed out");
        }

        sleep(Duration::from_secs(device.interval)).await;

        let response_text = client
            .post(format!("{}/auth/github/token", auth_server_url()))
            .json(&serde_json::json!({
                "device_code": device.device_code
            }))
            .send()
            .await?
            .text()
            .await?;

        let res: TokenResponse = serde_json::from_str(&response_text)?;
        match res {
            TokenResponse::Pending { error } => {
                if error == "slow_down" {
                    sleep(Duration::from_secs(device.interval + 5)).await;
                }
                continue;
            }

            TokenResponse::Success { api_token } => {
                spinner.finish_and_clear();
                print_success("Authentication successful!");
                save_token(&api_token)?;
                return Ok(());
            }
        }
    }
}

pub fn logout_command() -> Result<()> {
    logout()?;
    Ok(())
}

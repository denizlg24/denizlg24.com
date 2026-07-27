use console::style;
use serde::Deserialize;

use crate::utils::{
    config::{auth_server_url, load_token},
    project_config::load_project_config,
    ui::{create_spinner, print_header, print_info, print_kv, print_success},
};

#[derive(Deserialize)]
struct ProjectMemberResponse {
    #[serde(rename = "projectMember")]
    project_member: ProjectMember,
}

#[derive(Deserialize)]
struct ProjectMember {
    #[serde(rename = "userId")]
    user_id: String,
    role: String,
    #[serde(rename = "projectId")]
    #[allow(dead_code)]
    project_id: String,
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct ListMembersResponse {
    members: Vec<ProjectMember>,
}

#[derive(Deserialize)]
struct RemoveMemberResponse {
    #[allow(dead_code)]
    success: bool,
    #[serde(rename = "deletedMember")]
    deleted_member: ProjectMember,
}

#[derive(Deserialize)]
struct RemoveAllMembersResponse {
    #[allow(dead_code)]
    success: bool,
    #[serde(rename = "deletedCount")]
    deleted_count: u32,
}

async fn parse_api_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
    action: &str,
) -> anyhow::Result<T> {
    let status = response.status();
    let body = response.text().await?;

    if !status.is_success() {
        if body.trim().is_empty() {
            anyhow::bail!("{} failed with HTTP {}", action, status);
        }

        anyhow::bail!("{} failed with HTTP {}: {}", action, status, body);
    }

    serde_json::from_str(&body)
        .map_err(|e| anyhow::anyhow!("Failed to parse {} response: {}", action, e))
}

pub async fn add_member(github_id: u64, nickname: &str) -> anyhow::Result<()> {
    let token = load_token()?;
    let project = load_project_config()?;
    let client = reqwest::Client::new();

    let spinner = create_spinner(&format!("Adding member '{}'...", nickname));

    let response = client
        .post(format!(
            "{}/projects/{}/members",
            auth_server_url(),
            project.project_id
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "githubId": github_id.to_string(),
            "nickname": nickname
        }))
        .send()
        .await?;
    let response: ProjectMemberResponse = parse_api_response(response, "Add member").await?;

    spinner.finish_and_clear();

    let member = response.project_member;

    print_success("Member added successfully!");
    if let Some(nick) = &member.nickname {
        print_kv("Nickname", nick);
    }
    print_kv("User ID", &member.user_id);
    print_kv("Role", &member.role);

    Ok(())
}

pub async fn list_members() -> anyhow::Result<()> {
    let token = load_token()?;
    let project = load_project_config()?;
    let client = reqwest::Client::new();

    let spinner = create_spinner("Fetching project members...");

    let response = client
        .get(format!(
            "{}/projects/{}/members",
            auth_server_url(),
            project.project_id
        ))
        .bearer_auth(token)
        .send()
        .await?;
    let response: ListMembersResponse = parse_api_response(response, "List members").await?;

    spinner.finish_and_clear();

    let members = response.members;

    if members.is_empty() {
        print_info("No members found in this project");
        return Ok(());
    }

    print_header(&format!("Project Members ({})", members.len()));

    for member in members {
        if let Some(nickname) = &member.nickname {
            println!("  {} {}", style("•").cyan(), style(nickname).bold());
        } else {
            println!("  {} {}", style("•").cyan(), style("(no nickname)").dim());
        }
        println!(
            "    {} {}",
            style("ID:").dim(),
            style(&member.user_id).dim()
        );
        println!(
            "    {} {}",
            style("Role:").dim(),
            style(&member.role).yellow()
        );
        println!();
    }

    Ok(())
}

pub async fn remove_member(user_id: &str) -> anyhow::Result<()> {
    let token = load_token()?;
    let project = load_project_config()?;
    let client = reqwest::Client::new();

    let spinner = create_spinner(&format!(
        "Removing member {}...",
        &user_id[..8.min(user_id.len())]
    ));

    let response = client
        .delete(format!(
            "{}/projects/{}/members/{}",
            auth_server_url(),
            project.project_id,
            user_id
        ))
        .bearer_auth(token)
        .send()
        .await?;
    let response: RemoveMemberResponse = parse_api_response(response, "Remove member").await?;

    spinner.finish_and_clear();

    let deleted = response.deleted_member;

    print_success("Member removed.");
    print_kv("User ID", &deleted.user_id);
    if let Some(nickname) = &deleted.nickname {
        print_kv("Nickname", nickname);
    }

    Ok(())
}

pub async fn remove_all_members() -> anyhow::Result<()> {
    let token = load_token()?;
    let project = load_project_config()?;
    let client = reqwest::Client::new();

    let spinner = create_spinner("Removing all members...");

    let response = client
        .delete(format!(
            "{}/projects/{}/members",
            auth_server_url(),
            project.project_id
        ))
        .bearer_auth(token)
        .send()
        .await?;
    let response: RemoveAllMembersResponse =
        parse_api_response(response, "Remove all members").await?;

    spinner.finish_and_clear();

    print_success(&format!("Removed {} member(s).", response.deleted_count));

    Ok(())
}

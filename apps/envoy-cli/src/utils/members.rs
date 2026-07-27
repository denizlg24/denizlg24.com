pub fn parse_github_username(input: &str) -> anyhow::Result<String> {
    let input = input.trim();

    if input.contains("github.com") {
        let url = input.trim_end_matches('/');
        let username = url
            .split('/')
            .next_back()
            .ok_or_else(|| anyhow::anyhow!("Invalid GitHub URL"))?;
        Ok(username.to_string())
    } else {
        Ok(input.to_string())
    }
}

#[derive(serde::Deserialize)]
struct GithubUser {
    id: u64,
}

pub async fn resolve_github_user(username: &str) -> anyhow::Result<u64> {
    let url = format!("https://api.github.com/users/{}", username);

    let client = reqwest::Client::new();
    let res = client
        .get(url)
        .header("User-Agent", "envoy-cli")
        .send()
        .await?
        .error_for_status()?
        .json::<GithubUser>()
        .await?;

    Ok(res.id)
}

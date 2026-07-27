

import { GithubDeviceCodeSchema, GithubTokenResponseSchema, GithubUserSchema } from "@/schemas/github.schemas";
import { env } from "./env";

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH = "https://github.com/login";

export async function requestDeviceCode() {
  const res = await fetch(`${GITHUB_OAUTH}/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      scope: "read:user user:email",
    }),
  });

  const json = await res.json();
  return GithubDeviceCodeSchema.parse(json);
}

export async function pollAccessToken(deviceCode: string) {
  const res = await fetch(`${GITHUB_OAUTH}/oauth/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const json = await res.json();
  return GithubTokenResponseSchema.parse(json);
}

export async function fetchGithubUser(accessToken: string) {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  const json = await res.json();
  return GithubUserSchema.parse(json);
}

export async function fetchLatestRelease(owner: string, repo: string) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
    next: { revalidate: 3600 }
  });

  if (!res.ok) {
    return null;
  }

  const json = await res.json();
  return json.tag_name as string;
}
import { fetch } from "@tauri-apps/plugin-http";

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);

  const [cMajor, cMinor, cPatch] = parse(current);
  const [lMajor, lMinor, lPatch] = parse(latest);

  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

export async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/denizlg24/denizlg24-app/releases/latest",
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) return null;

    return (await response.json()) as GitHubRelease;
  } catch {
    return null;
  }
}

import { z } from "zod";

/**
 * The one thing the status page does on GitHub: turn an escalated incident
 * into an issue. `agent-fix` is what releases the repository agent — the
 * escalation fires the routine only when the issue carries it, and the
 * routine's daily sweep only takes issues that do — so removing it from the
 * defaults is the switch that puts the owner back in the loop.
 */
export const ESCALATION_LABELS = ["incident", "agent-fix"];

const issueSchema = z.object({
  number: z.number(),
  html_url: z.string(),
});

export function githubConfig() {
  const token = process.env.STATUS_GITHUB_TOKEN;
  if (!token) return null;
  const repo = process.env.STATUS_GITHUB_REPO ?? "denizlg24/denizlg24.com";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo };
}

export async function createIssue(input: {
  title: string;
  body: string;
  labels: string[];
}): Promise<{ number: number; url: string }> {
  const config = githubConfig();
  if (!config) throw new Error("GitHub escalation is not configured");
  const response = await fetch(
    `https://api.github.com/repos/${config.repo}/issues`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new Error(`GitHub refused the issue (HTTP ${response.status})`);
  const issue = issueSchema.parse(await response.json());
  return { number: issue.number, url: issue.html_url };
}

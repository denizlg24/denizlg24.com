import { z } from "zod";

/**
 * The repository agent is a Claude Code routine, started through its API
 * trigger. A routine's GitHub triggers only fire on pull request and release
 * events, so an issue can never start it; the escalation fires it directly
 * instead, with the issue named in the run's payload.
 */
const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
const FIRE_PATH = /^\/v1\/claude_code\/routines\/trig_\w+\/fire$/;

const fireSchema = z.object({ claude_code_session_url: z.string() });

/** Null unless both are set and the URL is a routine fire endpoint — the token goes nowhere else. */
export function routineConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const url = env.STATUS_ROUTINE_FIRE_URL;
  const token = env.STATUS_ROUTINE_FIRE_TOKEN;
  if (!url || !token || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (
    parsed.origin !== "https://api.anthropic.com" ||
    !FIRE_PATH.test(parsed.pathname)
  )
    return null;
  return { url: parsed.toString(), token };
}

export function routineFireText(issueUrl: string, incidentId: string) {
  return `Escalated issue: ${issueUrl}\nStatus page incident: ${incidentId}`;
}

/** Resolves to the session URL of the run it started. */
export async function fireRoutine(text: string): Promise<string> {
  const config = routineConfig();
  if (!config) throw new Error("The routine trigger is not configured");
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "anthropic-beta": ROUTINE_BETA,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`The routine refused the run (HTTP ${response.status})`);
  return fireSchema.parse(await response.json()).claude_code_session_url;
}

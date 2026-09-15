import { OAUTH_SUPERUSER_SCOPE } from "@repo/schemas/cloud";
import { z } from "zod";
import { describeEvidence, statusWord } from "./incidents";
import type { Incident, Service } from "./model";

/**
 * The triage run on denizlg24.com that every automatic incident starts. The
 * status page holds a service client for the web resource and asks the
 * authorization server for a five-minute token, exactly as the MCP server
 * does for its own upstreams; the run itself reaches back here through the
 * MCP server's status_* tools.
 */

export const AGENT_COOLDOWN_MS = 60 * 60_000;
const TOKEN_MARGIN_MS = 30_000;
const TIMEOUT_MS = 20_000;

const tokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
});
const runSchema = z.object({ run: z.object({ id: z.string() }) });

export function agentConfig() {
  const clientId = process.env.STATUS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.STATUS_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const apiOrigin =
    process.env.STATUS_CLOUD_API_URL ?? "https://api.denizlg24.com";
  return {
    clientId,
    clientSecret,
    issuer: (process.env.STATUS_AUTH_ISSUER ?? `${apiOrigin}/api/auth`).replace(
      /\/$/,
      "",
    ),
    web: (process.env.STATUS_WEB_URL ?? "https://denizlg24.com").replace(
      /\/$/,
      "",
    ),
    model: process.env.STATUS_AGENT_MODEL ?? "anthropic/claude-sonnet-5",
  };
}
export type AgentConfig = NonNullable<ReturnType<typeof agentConfig>>;

let cached: { resource: string; token: string; expiresAt: number } | null =
  null;

async function webToken(config: AgentConfig): Promise<string> {
  if (
    cached &&
    cached.resource === config.web &&
    cached.expiresAt - TOKEN_MARGIN_MS > Date.now()
  )
    return cached.token;
  const basic = btoa(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
  );
  const response = await fetch(`${config.issuer}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      resource: config.web,
      scope: OAUTH_SUPERUSER_SCOPE,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Token request failed (HTTP ${response.status})`);
  const body = tokenSchema.parse(await response.json());
  cached = {
    resource: config.web,
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
  };
  return body.access_token;
}

export function triagePrompt(
  incident: Incident,
  services: Service[],
  statusOrigin: string,
): string {
  const lines = services.map((service) => {
    const evidence = describeEvidence(service.evidence)
      .map((line) => `    - ${line}`)
      .join("\n");
    return `  - ${service.name} (id ${service.id}): ${statusWord(service.status)}${evidence ? `\n${evidence}` : ""}`;
  });
  return [
    `An automatic incident opened on the status page (${statusOrigin}) and you are its first responder.`,
    "",
    `Incident: ${incident._id}`,
    `Title: ${incident.title}`,
    `Started: ${incident.startedAt}`,
    "Services:",
    ...lines,
    "",
    "Confirmed down means three consecutive failed observations, outside any maintenance window. Your job: find out what happened, decide whether it needs solving, act within your tools, and record the outcome on the incident.",
    "",
    "Do this, in order:",
    "1. Read the current state: status_overview, status_incidents get on this incident, and status_service_samples for each service (the last 30 minutes with evidence). Note whether the service is already back.",
    "2. Diagnose with the infrastructure tools: cloud_ops_health and cloud_containers_list for the Pi; forge_target_by_slug, forge_deployments_list and forge_deployment_runtime_logs / forge_container_logs for a Forge app; cloud_activity_list for anything that changed just before the incident started. A deploy in progress, the Sunday 02:00 UTC host reboot, or a single upstream blip is a transient cause.",
    "3. Decide one verdict:",
    "   - transient: it recovered or will on its own and nothing is wrong. Say so.",
    "   - operational: something needs an operator action you can take — restart a container (cloud_container_restart), restart or roll back a deployment (forge_deployment_action), re-run a failed task (cloud_task_run). Take the narrowest action, then verify with a fresh status_overview.",
    "   - code: the cause is a defect in the code or configuration of this repository. Do not attempt to fix it here. Call status_incidents escalate with a Markdown body containing the diagnosis, the evidence lines, the log excerpts that matter, and the files or modules you suspect; a repository agent picks it up from the issue.",
    "4. Record it: status_incidents update with visibility private, state identified, the verdict field set, and the reasoning. If the cause is known and affects the public, add one short public identified update in plain language with no hostnames, ids or internal details.",
    "",
    "Rules: never change environment variables, delete anything, or touch data. Do not resolve the incident yourself; it resolves automatically once every service has been operational for five minutes. Do not open more than one escalation. If a tool fails, report that in the private update rather than guessing.",
  ].join("\n");
}

export async function startTriageRun(
  config: AgentConfig,
  prompt: string,
): Promise<string> {
  const token = await webToken(config);
  const response = await fetch(
    `${config.web}/api/admin/background-agent/runs`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt, model: config.model }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new Error(`Agent run refused (HTTP ${response.status})`);
  return runSchema.parse(await response.json()).run.id;
}

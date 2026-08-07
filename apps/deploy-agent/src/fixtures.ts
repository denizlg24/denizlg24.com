import {
  type AgentDeploymentRequest,
  agentDeploymentRequestSchema,
} from "@repo/schemas/cloud";

/**
 * Test-only. Parsed through the schema rather than cast, so a contract change
 * breaks the fixtures instead of letting the tests keep asserting on a shape
 * production no longer accepts.
 */
export function deploymentRequest(
  overrides: Partial<AgentDeploymentRequest> = {},
): AgentDeploymentRequest {
  return agentDeploymentRequestSchema.parse({
    deploymentId: crypto.randomUUID(),
    targetId: crypto.randomUUID(),
    projectSlug: "hello-world",
    kind: "preview",
    hostname: "hello-world-abc123.denizlg24.com",
    repository: {
      owner: "denizlg24",
      name: "hello-world",
      ref: "refs/heads/main",
      sha: "0".repeat(40),
    },
    build: {},
    runtime: {},
    timeouts: {},
    ...overrides,
  });
}

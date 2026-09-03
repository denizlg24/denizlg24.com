import type { AgentDeploymentRequest } from "@repo/schemas/cloud";

import type { BuildLog } from "./build-log";
import type { Exec } from "./exec";
import { execOrThrow } from "./exec";

const REGISTRY_PREFIX =
  /^ghcr\.io\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\/[a-z0-9][a-z0-9._-]*)+$/;
const DIGEST = /\bdigest:\s*(sha256:[0-9a-f]{64})\b/i;

export function assertRecoveryEnvironmentHmac(
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    throw new Error(
      "resolved environment does not match the signed recovery snapshot",
    );
  }
}

export interface PublishedRecoveryImage {
  /** Digest-only reference used by recovery and persisted in PostgreSQL. */
  reference: string;
  digest: string;
  deploymentTag: string;
}

export function recoveryImageRepository(
  prefix: string,
  projectSlug: string,
): string {
  const normalized = prefix.toLowerCase().replace(/\/+$/, "");
  if (!REGISTRY_PREFIX.test(normalized)) {
    throw new Error("RECOVERY_REGISTRY_PREFIX must be a private GHCR path");
  }
  return `${normalized}/${projectSlug}`;
}

/**
 * Publishes the exact image only after its container passed health. Docker is
 * authenticated out of band by the root-owned host setup; no registry secret
 * enters argv, logs, a deployment request, or this process's environment.
 */
export async function publishRecoveryImage(options: {
  exec: Exec;
  log: BuildLog;
  request: AgentDeploymentRequest;
  localImage: string;
  registryPrefix: string;
  signal: AbortSignal;
}): Promise<PublishedRecoveryImage> {
  const { request, exec, signal } = options;
  const repository = recoveryImageRepository(
    options.registryPrefix,
    request.projectSlug,
  );
  const deploymentTag = `${repository}:${request.deploymentId}-${request.repository.sha}`;

  await execOrThrow(exec, "tag recovery image", {
    command: ["docker", "tag", options.localImage, deploymentTag],
    signal,
    timeoutMs: 30_000,
  });
  const pushed = await execOrThrow(exec, "push recovery image", {
    command: ["docker", "push", deploymentTag],
    signal,
    timeoutMs: 15 * 60_000,
    onOutput: (chunk) => options.log.write(chunk),
    captureLimitBytes: 256 * 1024,
  });
  const digest = DIGEST.exec(`${pushed.stdout}\n${pushed.stderr}`)?.[1];
  if (!digest) {
    throw new Error("registry push did not return an immutable sha256 digest");
  }
  const normalizedDigest = digest.toLowerCase();
  const reference = `${repository}@${normalizedDigest}`;

  await execOrThrow(exec, "verify recovery image pull", {
    command: ["docker", "pull", reference],
    signal,
    timeoutMs: 10 * 60_000,
  });
  options.log.note(`published recovery image ${reference}`);
  return { reference, digest: normalizedDigest, deploymentTag };
}

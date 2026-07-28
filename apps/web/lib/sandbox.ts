import { Sandbox } from "@vercel/sandbox";

// Vercel Sandbox service wrapper. Tool code never imports @vercel/sandbox
// directly — the same rule llm-service.ts applies to provider SDKs — so
// lifetime, credential injection, and output truncation live in one place.

export const SANDBOX_RUNTIME = "node24";
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;
const SANDBOX_VCPUS = 2;
const SANDBOX_PORTS = [3000];
const MAX_OUTPUT_CHARS = 30_000;
const MAX_FILE_CHARS = 60_000;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BINARY_BYTES = 25 * 1024 * 1024;

/**
 * Host credentials forwarded into every sandbox.
 */
const FORWARDED_ENV_KEYS = [
  "MONGODB_URI",
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "CLOUD_API_BASE_URL",
  "CLOUD_API_TOKEN",
] as const;

export class SandboxConfigurationError extends Error {}

interface SandboxLease {
  sandbox: Sandbox;
  createdAt: number;
}

// Single-user system: one cache keyed by conversation, per the repo's
// "module-level caches keyed per session, not per user" convention.
const leases = new Map<string, SandboxLease>();

function sandboxName(conversationId: string): string {
  // Sandbox names are the lookup key for Sandbox.get, so they must survive a
  // cold serverless start with only the conversation id in hand.
  return `chat-${conversationId.replace(/[^a-zA-Z0-9-]/g, "").slice(-32)}`;
}

function forwardedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of FORWARDED_ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function credentials() {
  const token = process.env.VERCEL_TOKEN ?? process.env.VERCEL_OIDC_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId || !teamId) {
    // On Vercel the SDK reads VERCEL_OIDC_TOKEN itself; locally it needs all
    // three, so fall through to the SDK's own resolution rather than guessing.
    return undefined;
  }
  return { token, projectId, teamId };
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… output truncated at ${limit} characters …`;
}

export async function getSandbox(conversationId: string): Promise<Sandbox> {
  const existing = leases.get(conversationId);
  if (existing) return existing.sandbox;

  const name = sandboxName(conversationId);
  const creds = credentials();

  // A warm sandbox survives across serverless invocations even when this
  // module's cache does not, so always try to reattach before creating.
  try {
    const resumed = await Sandbox.get({ name, resume: true, ...creds });
    leases.set(conversationId, { sandbox: resumed, createdAt: Date.now() });
    return resumed;
  } catch {
    // No live sandbox under that name — fall through and create one.
  }

  try {
    const created = await Sandbox.create({
      name,
      runtime: SANDBOX_RUNTIME,
      timeout: SANDBOX_TIMEOUT_MS,
      ports: SANDBOX_PORTS,
      resources: { vcpus: SANDBOX_VCPUS },
      env: forwardedEnv(),
      ...creds,
    });
    leases.set(conversationId, { sandbox: created, createdAt: Date.now() });
    return created;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sandbox creation failed";
    if (/token|credential|unauthorized|forbidden/i.test(message)) {
      throw new SandboxConfigurationError(
        "Vercel Sandbox is not configured. Set VERCEL_TOKEN, VERCEL_PROJECT_ID, and VERCEL_TEAM_ID.",
      );
    }
    throw error;
  }
}

export interface SandboxCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runSandboxCommand(options: {
  conversationId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<SandboxCommandResult> {
  const sandbox = await getSandbox(options.conversationId);
  const timeoutMs = Math.min(
    options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    COMMAND_TIMEOUT_MS,
  );
  const finished = await sandbox.runCommand({
    cmd: options.command,
    args: options.args ?? [],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    timeoutMs,
  });
  const [stdout, stderr] = await Promise.all([
    finished.stdout(),
    finished.stderr(),
  ]);
  return {
    exitCode: finished.exitCode,
    stdout: truncate(stdout, MAX_OUTPUT_CHARS),
    stderr: truncate(stderr, MAX_OUTPUT_CHARS),
    // SIGKILL from the sandbox-enforced timeout surfaces as 137.
    timedOut: finished.exitCode === 137,
  };
}

export async function writeSandboxFiles(options: {
  conversationId: string;
  files: Array<{ path: string; content: string }>;
}): Promise<{ written: string[] }> {
  const sandbox = await getSandbox(options.conversationId);
  const files = options.files.map((file) => {
    const content = Buffer.from(file.content, "utf8");
    if (content.byteLength > MAX_WRITE_BYTES) {
      throw new Error(
        `"${file.path}" is ${content.byteLength} bytes; the per-file limit is ${MAX_WRITE_BYTES}.`,
      );
    }
    return { path: file.path, content };
  });
  await sandbox.writeFiles(files);
  return { written: files.map((file) => file.path) };
}

export async function readSandboxFile(options: {
  conversationId: string;
  path: string;
}): Promise<string> {
  const sandbox = await getSandbox(options.conversationId);
  const content = await sandbox.fs.readFile(options.path, "utf8");
  return truncate(content, MAX_FILE_CHARS);
}

/**
 * Read a sandbox file without converting it to UTF-8 or routing its bytes
 * through model-visible output. Use this for generated archives, images,
 * spreadsheets, PDFs, and other binary artifacts.
 */
export async function readSandboxFileBytes(options: {
  conversationId: string;
  path: string;
  maxBytes?: number;
}): Promise<Buffer> {
  const sandbox = await getSandbox(options.conversationId);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BINARY_BYTES;
  const stats = await sandbox.fs.stat(options.path);
  if (!stats.isFile()) {
    throw new Error(`"${options.path}" is not a file`);
  }
  if (stats.size > maxBytes) {
    throw new Error(
      `"${options.path}" is ${stats.size} bytes; the limit is ${maxBytes}.`,
    );
  }

  const content = await sandbox.fs.readFile(options.path);
  if (content.byteLength > maxBytes) {
    throw new Error(
      `"${options.path}" is ${content.byteLength} bytes; the limit is ${maxBytes}.`,
    );
  }
  return content;
}

export async function listSandboxFiles(options: {
  conversationId: string;
  path: string;
}): Promise<string[]> {
  const sandbox = await getSandbox(options.conversationId);
  const entries = await sandbox.fs.readdir(options.path, {
    withFileTypes: true,
  });
  return entries.map(
    (entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`,
  );
}

export async function sandboxPortUrl(options: {
  conversationId: string;
  port: number;
}): Promise<string> {
  const sandbox = await getSandbox(options.conversationId);
  return sandbox.domain(options.port);
}

export async function stopSandbox(conversationId: string): Promise<boolean> {
  const lease = leases.get(conversationId);
  leases.delete(conversationId);
  if (!lease) return false;
  await lease.sandbox.stop();
  return true;
}

export const SANDBOX_RUNTIME = "Bun + Python";
const SANDBOX_PROTOCOL_VERSION = 2;
const SANDBOX_TTL_SECONDS = 15 * 60;
const MAX_OUTPUT_CHARS = 30_000;
const MAX_FILE_CHARS = 60_000;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BINARY_BYTES = 25 * 1024 * 1024;

export class SandboxConfigurationError extends Error {}

interface SandboxLease {
  id: string;
  expiresAt: number;
}

const leases = new Map<string, SandboxLease>();
let healthCheck: Promise<void> | undefined;

function configuration(): { url: string; token: string } {
  const url = process.env.SANDBOX_API_URL?.replace(/\/$/, "");
  const token = process.env.SANDBOX_API_TOKEN;
  if (!url || !token) {
    throw new SandboxConfigurationError(
      "The code sandbox is not configured. SANDBOX_API_URL and SANDBOX_API_TOKEN are both required.",
    );
  }
  return { url, token };
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… output truncated at ${limit} characters …`;
}

async function sandboxRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { url, token } = configuration();
  const response = await fetch(`${url}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(COMMAND_TIMEOUT_MS + 10_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error || `Sandbox request failed with HTTP ${response.status}`,
    );
  }
  return response;
}

async function ensureCompatibleBackend(): Promise<void> {
  healthCheck ??= sandboxRequest("/healthz")
    .then(async (response) => {
      const body = (await response.json()) as { protocolVersion?: number };
      if (body.protocolVersion !== SANDBOX_PROTOCOL_VERSION) {
        throw new SandboxConfigurationError(
          `Sandbox protocol mismatch: web expects ${SANDBOX_PROTOCOL_VERSION}, backend reports ${body.protocolVersion ?? "none"}.`,
        );
      }
    })
    .catch((error) => {
      healthCheck = undefined;
      throw error;
    });
  return healthCheck;
}

async function session(conversationId: string): Promise<SandboxLease> {
  const existing = leases.get(conversationId);
  if (existing && existing.expiresAt > Date.now()) return existing;
  await ensureCompatibleBackend();
  const response = await sandboxRequest("/sessions", {
    method: "POST",
    body: JSON.stringify({ conversationId, ttlSeconds: SANDBOX_TTL_SECONDS }),
  });
  const result = (await response.json()) as { id: string; expiresAt: string };
  const lease = { id: result.id, expiresAt: Date.parse(result.expiresAt) };
  leases.set(conversationId, lease);
  return lease;
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
  timeoutMs?: number;
}): Promise<SandboxCommandResult> {
  const lease = await session(options.conversationId);
  const timeoutMs = Math.min(
    options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    COMMAND_TIMEOUT_MS,
  );
  const response = await sandboxRequest(`/sessions/${lease.id}/commands`, {
    method: "POST",
    body: JSON.stringify({
      command: options.command,
      args: options.args ?? [],
      ...(options.cwd ? { cwd: options.cwd } : {}),
      timeoutMs,
    }),
    signal: AbortSignal.timeout(timeoutMs + 10_000),
  });
  const result = (await response.json()) as SandboxCommandResult;
  return {
    ...result,
    stdout: truncate(result.stdout, MAX_OUTPUT_CHARS),
    stderr: truncate(result.stderr, MAX_OUTPUT_CHARS),
  };
}

export async function writeSandboxFiles(options: {
  conversationId: string;
  files: Array<{ path: string; content: string }>;
}): Promise<{ written: string[] }> {
  const lease = await session(options.conversationId);
  const files = options.files.map((file) => {
    const content = Buffer.from(file.content, "utf8");
    if (content.byteLength > MAX_WRITE_BYTES) {
      throw new Error(
        `"${file.path}" is ${content.byteLength} bytes; the per-file limit is ${MAX_WRITE_BYTES}.`,
      );
    }
    return { path: file.path, contentBase64: content.toString("base64") };
  });
  const response = await sandboxRequest(`/sessions/${lease.id}/files`, {
    method: "POST",
    body: JSON.stringify({ files }),
  });
  return (await response.json()) as { written: string[] };
}

export async function readSandboxFile(options: {
  conversationId: string;
  path: string;
}): Promise<string> {
  const bytes = await readSandboxFileBytes({
    ...options,
    maxBytes: MAX_FILE_CHARS * 4,
  });
  return truncate(bytes.toString("utf8"), MAX_FILE_CHARS);
}

export async function readSandboxFileBytes(options: {
  conversationId: string;
  path: string;
  maxBytes?: number;
}): Promise<Buffer> {
  const lease = await session(options.conversationId);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BINARY_BYTES;
  const response = await sandboxRequest(
    `/sessions/${lease.id}/files/${encodeURIComponent(options.path)}`,
  );
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(
      `"${options.path}" is ${declared} bytes; the limit is ${maxBytes}.`,
    );
  }
  const content = Buffer.from(await response.arrayBuffer());
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
  const lease = await session(options.conversationId);
  const response = await sandboxRequest(
    `/sessions/${lease.id}/files?path=${encodeURIComponent(options.path)}`,
  );
  return ((await response.json()) as { entries: string[] }).entries;
}

export async function sandboxPortUrl(options: {
  conversationId: string;
  port: number;
}): Promise<string> {
  const lease = await session(options.conversationId);
  const response = await sandboxRequest(
    `/sessions/${lease.id}/ports/${options.port}`,
  );
  return ((await response.json()) as { url: string }).url;
}

export async function stopSandbox(conversationId: string): Promise<boolean> {
  const lease = leases.get(conversationId);
  leases.delete(conversationId);
  if (!lease) return false;
  const response = await sandboxRequest(`/sessions/${lease.id}`, {
    method: "DELETE",
  });
  return ((await response.json()) as { stopped: boolean }).stopped;
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SandboxConfig } from "./config";
import type {
  CommandResult,
  CreateSessionInput,
  RunCommandInput,
  Session,
  WriteFilesInput,
} from "./contract";

const OWNER_LABEL = "com.denizlg24.sandbox.owner=agent-code-sandbox";
const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 25 * 1024 * 1024;
const MAX_WRITE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const PROXY_TTL_SECONDS = 5 * 60;

interface ProcessResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
}

type SpawnProcess = (
  argv: string[],
  options?: { stdin?: Uint8Array; timeoutMs?: number; maxOutputBytes?: number },
) => Promise<ProcessResult>;

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let kept = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (kept >= maxBytes) continue;
    const slice = value.subarray(0, maxBytes - kept);
    chunks.push(slice);
    kept += slice.byteLength;
  }
  return Buffer.concat(chunks);
}

export const spawnProcess: SpawnProcess = async (argv, options = {}) => {
  const process = Bun.spawn(argv, {
    stdin: options.stdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin && process.stdin) {
    process.stdin.write(options.stdin);
    process.stdin.end();
  }

  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        process.kill(9);
      }, options.timeoutMs)
    : undefined;
  const limit = options.maxOutputBytes ?? MAX_PROCESS_OUTPUT_BYTES;
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    readBounded(process.stdout, limit),
    readBounded(process.stderr, limit),
  ]);
  if (timer) clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
};

function sessionId(conversationId: string): string {
  return createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
}

function containerName(id: string): string {
  return `agent-sandbox-${id}`;
}

function workspacePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const absolute = normalized.startsWith("/")
    ? normalized
    : `/workspace/${normalized}`;
  if (absolute !== "/workspace" && !absolute.startsWith("/workspace/")) {
    throw new Error("Paths must stay inside /workspace");
  }
  const parts = absolute.split("/");
  if (parts.includes("..")) throw new Error("Paths may not contain '..'");
  return absolute;
}

function trimOutput(value: Buffer): string {
  const text = value.toString("utf8");
  return value.byteLength >= MAX_PROCESS_OUTPUT_BYTES
    ? `${text}\n… output truncated at ${MAX_PROCESS_OUTPUT_BYTES} bytes …`
    : text;
}

export class DockerSandboxRuntime {
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(
    readonly config: SandboxConfig,
    readonly processRunner: SpawnProcess = spawnProcess,
  ) {
    const timer = setInterval(() => {
      void this.reapExpired();
    }, 60_000);
    timer.unref();
  }

  async #docker(
    args: string[],
    options?: Parameters<SpawnProcess>[1],
  ): Promise<ProcessResult> {
    return this.processRunner(
      [this.config.dockerBinary, "--host", this.config.dockerHost, ...args],
      options,
    );
  }

  async #mustDocker(
    args: string[],
    options?: Parameters<SpawnProcess>[1],
  ): Promise<ProcessResult> {
    const result = await this.#docker(args, options);
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr.toString("utf8").trim() ||
          `docker ${args[0] ?? "command"} failed with ${result.exitCode}`,
      );
    }
    return result;
  }

  async #withSessionLock<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#locks.get(id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#locks.set(id, current);
    try {
      return await current;
    } finally {
      if (this.#locks.get(id) === current) this.#locks.delete(id);
    }
  }

  async health(): Promise<void> {
    const info = await this.#mustDocker([
      "info",
      "--format",
      "{{json .SecurityOptions}} {{json .Runtimes}}",
    ]);
    const detail = info.stdout.toString("utf8");
    if (this.config.requireRootless && !detail.includes("name=rootless")) {
      throw new Error(
        "Sandbox Docker daemon is not rootless; refusing to expose code execution",
      );
    }
    if (!detail.includes(`"${this.config.runtime}"`)) {
      throw new Error(
        `OCI runtime ${this.config.runtime} is not installed on the sandbox daemon`,
      );
    }
    await this.#mustDocker(["image", "inspect", this.config.image]);
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const id = sessionId(input.conversationId);
    return this.#withSessionLock(id, async () => {
      const name = containerName(id);
      const existing = await this.#docker([
        "inspect",
        "--format",
        '{{.State.Running}} {{index .Config.Labels "com.denizlg24.sandbox.expires-at"}}',
        name,
      ]);
      if (existing.exitCode === 0) {
        const [running, expiresAt] = existing.stdout
          .toString("utf8")
          .trim()
          .split(/\s+/, 2);
        if (running === "true" && expiresAt && Number(expiresAt) > Date.now()) {
          return {
            id,
            created: false,
            expiresAt: new Date(Number(expiresAt)).toISOString(),
          };
        }
        await this.#docker(["rm", "-f", name]);
      }

      await this.reapExpired();
      const count = await this.#mustDocker([
        "ps",
        "-q",
        "--filter",
        `label=${OWNER_LABEL}`,
      ]);
      const active = count.stdout
        .toString("utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      if (active.length >= this.config.maxSessions) {
        throw new Error("The sandbox is at its concurrent session limit");
      }

      const expiresAt = Date.now() + input.ttlSeconds * 1000;
      await this.#mustDocker([
        "run",
        "--detach",
        "--name",
        name,
        "--label",
        OWNER_LABEL,
        "--label",
        `com.denizlg24.sandbox.expires-at=${expiresAt}`,
        "--runtime",
        this.config.runtime,
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/workspace:rw,nosuid,nodev,size=536870912,mode=1770,uid=1000,gid=1000",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=134217728,mode=1777",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        `${this.config.memoryMb}m`,
        "--memory-swap",
        `${this.config.memoryMb}m`,
        "--cpus",
        String(this.config.cpus),
        "--pids-limit",
        String(this.config.pids),
        "--ulimit",
        "nofile=1024:1024",
        "--init",
        "--restart",
        "no",
        "--env",
        "HOME=/workspace",
        "--env",
        "TMPDIR=/tmp",
        this.config.image,
        "sleep",
        "infinity",
      ]);
      return {
        id,
        created: true,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    });
  }

  async stopSession(id: string): Promise<boolean> {
    if (!/^[a-f0-9]{32}$/.test(id)) return false;
    return this.#withSessionLock(id, async () => {
      const result = await this.#docker(["rm", "-f", containerName(id)]);
      return result.exitCode === 0;
    });
  }

  async runCommand(id: string, input: RunCommandInput): Promise<CommandResult> {
    return this.#withSessionLock(id, async () => {
      const cwd = workspacePath(input.cwd || "/workspace");
      const seconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
      const result = await this.#docker(
        [
          "exec",
          "--workdir",
          cwd,
          containerName(id),
          "timeout",
          "--signal=KILL",
          String(seconds),
          input.command,
          ...input.args,
        ],
        { timeoutMs: input.timeoutMs + 2_000 },
      );
      const timedOut =
        result.timedOut || result.exitCode === 124 || result.exitCode === 137;
      return {
        exitCode: timedOut ? 137 : result.exitCode,
        stdout: trimOutput(result.stdout),
        stderr: trimOutput(result.stderr),
        timedOut,
      };
    });
  }

  async writeFiles(id: string, input: WriteFilesInput): Promise<string[]> {
    let total = 0;
    const files = input.files.map((file) => {
      const size = Buffer.byteLength(file.contentBase64, "base64");
      if (size > MAX_WRITE_FILE_BYTES) {
        throw new Error(
          `"${file.path}" exceeds the ${MAX_WRITE_FILE_BYTES} byte limit`,
        );
      }
      total += size;
      return {
        path: workspacePath(file.path),
        contentBase64: file.contentBase64,
      };
    });
    if (total > MAX_WRITE_TOTAL_BYTES)
      throw new Error("Write batch is too large");
    const result = await this.#mustDocker(
      ["exec", "--interactive", containerName(id), "sandbox-file", "write"],
      {
        stdin: Buffer.from(JSON.stringify({ files })),
        maxOutputBytes: 64 * 1024,
      },
    );
    return JSON.parse(result.stdout.toString("utf8")) as string[];
  }

  async listFiles(id: string, path: string): Promise<string[]> {
    const result = await this.#mustDocker([
      "exec",
      containerName(id),
      "sandbox-file",
      "list",
      workspacePath(path),
    ]);
    return JSON.parse(result.stdout.toString("utf8")) as string[];
  }

  async readFile(id: string, path: string): Promise<Buffer> {
    const result = await this.#mustDocker(
      ["exec", containerName(id), "sandbox-file", "read", workspacePath(path)],
      { maxOutputBytes: MAX_READ_BYTES + 1 },
    );
    if (result.stdout.byteLength > MAX_READ_BYTES)
      throw new Error("File is too large");
    return result.stdout;
  }

  portUrl(id: string, port: number): string {
    if (port !== 3000) throw new Error("Only port 3000 is available");
    const expires = Math.floor(Date.now() / 1000) + PROXY_TTL_SECONDS;
    const payload = `${id}:${port}:${expires}`;
    const signature = createHmac("sha256", this.config.apiToken)
      .update(payload)
      .digest("base64url");
    return `${this.config.publicUrl.replace(/\/$/, "")}/sessions/${id}/ports/${port}/proxy/${expires}/${signature}/`;
  }

  verifyPortToken(
    id: string,
    port: number,
    expires: string,
    signature: string,
  ): boolean {
    if (!/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000)
      return false;
    const expected = createHmac("sha256", this.config.apiToken)
      .update(`${id}:${port}:${expires}`)
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      return false;
    }
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  async proxyPort(
    id: string,
    port: number,
    pathAndQuery: string,
  ): Promise<Response> {
    if (port !== 3000) throw new Error("Only port 3000 is available");
    const result = await this.#mustDocker(
      [
        "exec",
        containerName(id),
        "sandbox-http",
        `http://127.0.0.1:${port}/${pathAndQuery.replace(/^\//, "")}`,
      ],
      { timeoutMs: 30_000, maxOutputBytes: MAX_PREVIEW_BYTES + 64 * 1024 },
    );
    const newline = result.stdout.indexOf(10);
    if (newline < 0) throw new Error("Invalid response from sandbox server");
    const metadata = JSON.parse(
      result.stdout.subarray(0, newline).toString("utf8"),
    ) as {
      status: number;
      contentType?: string;
    };
    const body = Uint8Array.from(result.stdout.subarray(newline + 1)).buffer;
    if (body.byteLength > MAX_PREVIEW_BYTES) {
      throw new Error("Sandbox preview response is too large");
    }
    return new Response(body, {
      status: metadata.status,
      headers: {
        ...(metadata.contentType
          ? { "content-type": metadata.contentType }
          : {}),
        "content-security-policy":
          "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-downloads",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  }

  async reapExpired(): Promise<void> {
    const result = await this.#docker([
      "ps",
      "--all",
      "--format",
      '{{.Names}} {{index .Labels "com.denizlg24.sandbox.expires-at"}}',
      "--filter",
      `label=${OWNER_LABEL}`,
    ]);
    if (result.exitCode !== 0) return;
    const now = Date.now();
    for (const line of result.stdout.toString("utf8").trim().split("\n")) {
      const [name, expires] = line.split(/\s+/, 2);
      if (name?.startsWith("agent-sandbox-") && Number(expires) <= now) {
        await this.#docker(["rm", "-f", name]);
      }
    }
  }
}

export interface ExecOptions {
  command: readonly string[];
  cwd?: string;
  /** Merged over the agent's own environment, not a replacement for it. */
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
  captureLimitBytes?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

export type Exec = (options: ExecOptions) => Promise<ExecResult>;

const DEFAULT_CAPTURE_LIMIT = 64 * 1024;
const KILL_GRACE_MS = 5_000;

export class ExecError extends Error {
  readonly result: ExecResult;

  constructor(message: string, result: ExecResult) {
    super(message);
    this.name = "ExecError";
    this.result = result;
  }
}

/**
 * Keeps the tail rather than the head. Everything a command prints is already
 * in the build log; what this is for is the one-line failure message, and the
 * reason a command failed is at the end of its output, never at the start.
 */
class TailBuffer {
  #text = "";

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    this.#text += chunk;
    if (this.#text.length > this.limit) {
      this.#text = this.#text.slice(this.#text.length - this.limit);
    }
  }

  toString(): string {
    return this.#text;
  }
}

async function pump(
  stream: ReadableStream<Uint8Array> | undefined | null,
  sink: TailBuffer,
  onOutput: ((chunk: string) => void) | undefined,
): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text.length === 0) continue;
    sink.push(text);
    onOutput?.(text);
  }
  const tail = decoder.decode();
  if (tail.length > 0) {
    sink.push(tail);
    onOutput?.(tail);
  }
}

export const spawnExec: Exec = async (options) => {
  const limit = options.captureLimitBytes ?? DEFAULT_CAPTURE_LIMIT;
  const stdout = new TailBuffer(limit);
  const stderr = new TailBuffer(limit);

  const child = Bun.spawn({
    cmd: [...options.command],
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let aborted = false;
  let escalation: ReturnType<typeof setTimeout> | null = null;

  const kill = (): void => {
    if (escalation) return;
    child.kill();
    // A build container that ignores SIGTERM would otherwise hold the slot for
    // as long as it likes, which is exactly what the timeout exists to prevent.
    escalation = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    escalation.unref?.();
  };

  const onAbort = (): void => {
    aborted = true;
    kill();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  const deadline =
    options.timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          kill();
        }, options.timeoutMs);

  try {
    const [exitCode] = await Promise.all([
      child.exited,
      pump(
        child.stdout as ReadableStream<Uint8Array>,
        stdout,
        options.onOutput,
      ),
      pump(
        child.stderr as ReadableStream<Uint8Array>,
        stderr,
        options.onOutput,
      ),
    ]);
    return {
      exitCode,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      timedOut,
      aborted,
    };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (deadline) clearTimeout(deadline);
    if (escalation) clearTimeout(escalation);
  }
};

/**
 * `description` is what the failure is reported as, and it is written by us
 * rather than derived from `command` on purpose: a clone command carries an
 * installation token in its URL, and an error message is one of the places that
 * would otherwise happily print it.
 */
export async function execOrThrow(
  exec: Exec,
  description: string,
  options: ExecOptions,
): Promise<ExecResult> {
  const result = await exec(options);
  if (result.exitCode === 0) return result;
  if (result.aborted) throw new ExecError(`${description} cancelled`, result);
  if (result.timedOut) throw new ExecError(`${description} timed out`, result);
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(-2_000);
  throw new ExecError(
    detail
      ? `${description} failed (exit ${result.exitCode}): ${detail}`
      : `${description} failed (exit ${result.exitCode})`,
    result,
  );
}

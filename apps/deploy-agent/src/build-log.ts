import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const MIN_REDACTABLE_LENGTH = 8;
const FILE_HIGH_WATER_MARK = 8 * 1024;

export class BuildLogNotFoundError extends Error {
  constructor(deploymentId: string) {
    super(`No build log for deployment ${deploymentId}`);
    this.name = "BuildLogNotFoundError";
  }
}

export interface BuildLogOptions {
  path: string;
  maxBufferBytes?: number;
  now?: () => number;
}

export interface LineSink {
  write(line: string): void;
  end(): Promise<void>;
}

function fileSink(path: string): LineSink {
  const writer = Bun.file(path).writer({ highWaterMark: FILE_HIGH_WATER_MARK });
  return {
    write: (line) => {
      writer.write(`${line}\n`);
    },
    end: async () => {
      await writer.end();
    },
  };
}

/**
 * Line-buffered, and that is load-bearing rather than tidy: redaction runs per
 * line, so a token split across two reads of a subprocess's stdout would slip
 * through a chunk-wise filter. A secret never spans a newline.
 */
export class BuildLog {
  readonly #sink: LineSink;
  readonly #maxBufferBytes: number;
  readonly #now: () => number;
  readonly #secrets = new Set<string>();
  // `null` is the end sentinel. A build log contains blank lines, so an empty
  // string cannot be one.
  readonly #subscribers = new Set<(line: string | null) => void>();
  readonly #lines: string[] = [];
  #bufferedBytes = 0;
  #droppedLines = 0;
  #pending = "";
  #closed = false;

  constructor(
    options: BuildLogOptions,
    sink: LineSink = fileSink(options.path),
  ) {
    this.#sink = sink;
    this.#maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.#now = options.now ?? Date.now;
  }

  get closed(): boolean {
    return this.#closed;
  }

  get text(): string {
    return this.#lines.join("\n");
  }

  /**
   * Register a value that must never reach the log. Git prints the remote URL
   * in its own error messages, and that URL carries an installation token — so
   * "don't echo the clone command" is necessary and not sufficient.
   */
  protect(secret: string | null | undefined): void {
    if (!secret || secret.length < MIN_REDACTABLE_LENGTH) return;
    this.#secrets.add(secret);
  }

  write(chunk: string): void {
    if (this.#closed) return;
    this.#pending += chunk.replaceAll("\r\n", "\n");
    let index = this.#pending.indexOf("\n");
    while (index !== -1) {
      this.#emit(this.#pending.slice(0, index));
      this.#pending = this.#pending.slice(index + 1);
      index = this.#pending.indexOf("\n");
    }
  }

  /** An agent-authored line, marked so it reads apart from build output. */
  note(message: string): void {
    const stamp = new Date(this.#now()).toISOString();
    this.write(`[agent ${stamp}] ${message}\n`);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#pending.length > 0) {
      this.#emit(this.#pending);
      this.#pending = "";
    }
    this.#closed = true;
    for (const subscriber of [...this.#subscribers]) subscriber(null);
    this.#subscribers.clear();
    await this.#sink.end();
  }

  async *subscribe(signal?: AbortSignal): AsyncGenerator<string, void> {
    if (this.#droppedLines > 0) {
      yield `[agent] … ${this.#droppedLines} earlier lines dropped from the replay buffer`;
    }
    const queue: string[] = [...this.#lines];
    let ended = this.#closed;
    let wake: (() => void) | null = null;

    const subscriber = (line: string | null): void => {
      if (line === null) {
        ended = true;
      } else {
        queue.push(line);
      }
      wake?.();
    };
    const onAbort = (): void => {
      ended = true;
      wake?.();
    };

    if (!this.#closed) this.#subscribers.add(subscriber);
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        while (queue.length > 0) {
          const line = queue.shift();
          if (line === undefined) break;
          yield line;
        }
        if (ended || signal?.aborted) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
    } finally {
      this.#subscribers.delete(subscriber);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  #emit(rawLine: string): void {
    const line = this.#redact(rawLine);
    this.#sink.write(line);
    this.#lines.push(line);
    this.#bufferedBytes += line.length + 1;
    // The file keeps everything; this buffer only exists so a client attaching
    // mid-build sees what it missed, and an unbounded one turns a runaway build
    // into an OOM on a box that is also running every live deployment.
    while (
      this.#bufferedBytes > this.#maxBufferBytes &&
      this.#lines.length > 1
    ) {
      const dropped = this.#lines.shift();
      if (dropped === undefined) break;
      this.#bufferedBytes -= dropped.length + 1;
      this.#droppedLines += 1;
    }
    for (const subscriber of this.#subscribers) subscriber(line);
  }

  #redact(line: string): string {
    let redacted = line;
    for (const secret of this.#secrets) {
      redacted = redacted.replaceAll(secret, "***");
    }
    return redacted;
  }
}

export interface BuildLogStoreOptions {
  root: string;
  maxBufferBytes?: number;
  now?: () => number;
}

export class BuildLogStore {
  readonly #options: BuildLogStoreOptions;
  readonly #active = new Map<string, BuildLog>();

  constructor(options: BuildLogStoreOptions) {
    this.#options = options;
  }

  pathFor(deploymentId: string): string {
    return join(this.#options.root, `${deploymentId}.log`);
  }

  async open(deploymentId: string): Promise<BuildLog> {
    await mkdir(this.#options.root, { recursive: true });
    const log = new BuildLog({
      path: this.pathFor(deploymentId),
      maxBufferBytes: this.#options.maxBufferBytes,
      now: this.#options.now,
    });
    this.#active.set(deploymentId, log);
    return log;
  }

  get(deploymentId: string): BuildLog | null {
    return this.#active.get(deploymentId) ?? null;
  }

  async has(deploymentId: string): Promise<boolean> {
    if (this.#active.has(deploymentId)) return true;
    return Bun.file(this.pathFor(deploymentId)).exists();
  }

  async close(deploymentId: string): Promise<void> {
    const log = this.#active.get(deploymentId);
    if (!log) return;
    this.#active.delete(deploymentId);
    await log.close();
  }

  /**
   * Live for a running build, from the file for a finished one — both replaying
   * from the first line, so a client never has to have been watching to see why
   * a deploy failed.
   */
  async *stream(
    deploymentId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<string, void> {
    const live = this.#active.get(deploymentId);
    if (live) {
      yield* live.subscribe(signal);
      return;
    }
    const file = Bun.file(this.pathFor(deploymentId));
    if (!(await file.exists())) throw new BuildLogNotFoundError(deploymentId);
    const lines = (await file.text()).split("\n");
    // Every line is newline-terminated, so the split always leaves one empty
    // trailing element. Dropping every empty line instead would swallow the
    // blank lines build tools use for structure.
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) {
      if (signal?.aborted) return;
      yield line;
    }
  }
}

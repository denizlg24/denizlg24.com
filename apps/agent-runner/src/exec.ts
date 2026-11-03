const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface ExecOptions {
  stdin?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CommandRunner = (
  argv: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** A long-lived process whose stdout is consumed as it arrives. */
export interface StreamingProcess {
  stdout: AsyncIterable<string>;
  /** The last 16 KB of stderr, once the process has exited. */
  stderrTail(): Promise<string>;
  exited: Promise<number>;
  kill(): void;
}

export type StreamSpawner = (argv: string[]) => StreamingProcess;

async function* chunks(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let kept = 0;
  for await (const chunk of chunks(stream)) {
    if (kept >= maxBytes) continue;
    const slice = chunk.subarray(0, maxBytes - kept);
    kept += slice.byteLength;
    text += decoder.decode(slice, { stream: true });
  }
  return text + decoder.decode();
}

export const runCommand: CommandRunner = async (argv, options = {}) => {
  const child = Bun.spawn(argv, {
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });
  if (options.stdin !== undefined && child.stdin) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }
  let timedOut = false;
  const timer = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill(9);
      }, options.timeoutMs)
    : undefined;
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readBounded(child.stdout, MAX_OUTPUT_BYTES),
    readBounded(child.stderr, MAX_OUTPUT_BYTES),
  ]);
  if (timer) clearTimeout(timer);
  return { exitCode, stdout, stderr, timedOut };
};

const STDERR_TAIL_CHARS = 16_000;

export const spawnStream: StreamSpawner = (argv) => {
  const child = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let tail = "";
  const stderrDone = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of chunks(child.stderr)) {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(
        -STDERR_TAIL_CHARS,
      );
    }
  })();
  async function* lines(): AsyncIterable<string> {
    const decoder = new TextDecoder();
    for await (const chunk of chunks(child.stdout)) {
      yield decoder.decode(chunk, { stream: true });
    }
    const rest = decoder.decode();
    if (rest) yield rest;
  }
  return {
    stdout: lines(),
    stderrTail: async () => {
      await stderrDone;
      return tail;
    },
    exited: child.exited,
    kill: () => child.kill(),
  };
};

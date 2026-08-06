import {
  parseSmbAuditLine,
  type RecentWriter,
  RecentWriterIndex,
} from "@repo/cloud-core";

export interface AuditTailOptions {
  namespaceRoot: string;
  maxEntries?: number;
  ttlMs?: number;
  /** Overridable so the unit is testable without journald. */
  spawn?: () => { stdout: ReadableStream<Uint8Array>; kill(): void };
}

/**
 * Follows `smbd_audit` so adoption can ask who wrote a path.
 *
 * Reads journald rather than a log file because that is where Samba's LOCAL7
 * output actually lands on this host, and `--since now -f` means a restart
 * starts from the present instead of replaying hours of history into a cache
 * whose entries would all be past their TTL anyway.
 *
 * Deliberately best-effort. If journalctl is missing, exits, or produces
 * nothing, `writerOf` simply returns null and adoption falls back to the tree —
 * so a broken tailer degrades attribution rather than blocking projection.
 */
export class SmbAuditTail {
  readonly #index: RecentWriterIndex;
  readonly #options: AuditTailOptions;
  #process: { stdout: ReadableStream<Uint8Array>; kill(): void } | null = null;
  #stopped = false;

  constructor(options: AuditTailOptions) {
    this.#options = options;
    this.#index = new RecentWriterIndex({
      maxEntries: options.maxEntries,
      namespaceRoot: options.namespaceRoot,
      ttlMs: options.ttlMs,
    });
  }

  get size(): number {
    return this.#index.size;
  }

  writerOf(relativePath: string): RecentWriter | null {
    return this.#index.writerOf(relativePath);
  }

  start(): void {
    if (this.#process || this.#stopped) return;
    try {
      this.#process = this.#options.spawn
        ? this.#options.spawn()
        : Bun.spawn(
            [
              "journalctl",
              "-t",
              "smbd_audit",
              "-f",
              "-o",
              "cat",
              "--since",
              "now",
            ],
            { stderr: "ignore", stdout: "pipe" },
          );
    } catch (error) {
      console.warn(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          event: "audit-tail-unavailable",
        }),
      );
      return;
    }
    void this.#consume();
  }

  stop(): void {
    this.#stopped = true;
    this.#process?.kill();
    this.#process = null;
  }

  async #consume(): Promise<void> {
    const stream = this.#process?.stdout;
    if (!stream) return;
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          const event = parseSmbAuditLine(line);
          if (event) this.#index.record(event);
        }
        // A single unterminated line must not grow without bound if the stream
        // ever stops producing newlines.
        if (buffer.length > 64_000) buffer = "";
      }
    } catch {
      // Treated the same as no stream at all: attribution degrades to the tree.
    }
    if (!this.#stopped) {
      console.warn(JSON.stringify({ event: "audit-tail-ended" }));
      this.#process = null;
    }
  }
}

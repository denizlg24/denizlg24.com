import type { AgentUIMessage } from "@repo/schemas";
import type { RunnerWebApi } from "./web-client";

const MAX_BATCH = 200;

/**
 * Pending transcript upserts for one run. Messages are keyed by id, so a
 * newer version replaces one not yet sent, and a failed batch is put back
 * under anything that superseded it meanwhile.
 *
 * `seq` is wall-clock based rather than a counter: web ignores a batch whose
 * seq it has seen, and a runner restart re-attaching to the run must not
 * start again below the last seq it sent.
 */
export class TranscriptSink {
  readonly #pending = new Map<string, AgentUIMessage>();
  #lastSeq = 0;
  #flushing: Promise<void> | null = null;

  constructor(
    private readonly runId: string,
    private readonly web: Pick<RunnerWebApi, "events">,
    private readonly now: () => number = Date.now,
  ) {}

  add(messages: AgentUIMessage[]): void {
    for (const message of messages) this.#pending.set(message.id, message);
  }

  get size(): number {
    return this.#pending.size;
  }

  nextSeq(): number {
    this.#lastSeq = Math.max(this.now(), this.#lastSeq + 1);
    return this.#lastSeq;
  }

  /** Sends everything pending; throws on the first failed batch. */
  async flush(): Promise<void> {
    while (this.#flushing) await this.#flushing;
    this.#flushing = this.#drain().finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  async #drain(): Promise<void> {
    while (this.#pending.size > 0) {
      const batch = [...this.#pending.values()].slice(0, MAX_BATCH);
      for (const message of batch) this.#pending.delete(message.id);
      try {
        await this.web.events(this.runId, {
          seq: this.nextSeq(),
          messages: batch,
        });
      } catch (error) {
        for (const message of batch) {
          if (!this.#pending.has(message.id)) {
            this.#pending.set(message.id, message);
          }
        }
        throw error;
      }
    }
  }
}

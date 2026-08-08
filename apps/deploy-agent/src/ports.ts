export const PORT_RANGE_START = 20_000;
export const PORT_RANGE_END = 29_999;

const DEFAULT_ATTEMPTS = 50;

export type PortProbe = (port: number) => Promise<boolean>;

export interface PortAllocatorOptions {
  rangeStart?: number;
  rangeEnd?: number;
  attempts?: number;
  probe?: PortProbe;
  random?: () => number;
}

export class NoFreePortError extends Error {
  constructor(attempts: number) {
    super(`No free port found in ${attempts} attempts`);
    this.name = "NoFreePortError";
  }
}

/**
 * A successful connect means something is listening, which is the only fact
 * that matters — the listener may be a container this agent did not start, or
 * one left behind by a previous process, and either collides at `docker run`.
 */
export const connectProbe: PortProbe = async (port) => {
  try {
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: { data: () => {}, open: () => {}, error: () => {} },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
};

/**
 * Random rather than sequential. A sequential allocator hands back a port that
 * was freed seconds ago, while a client may still hold a keep-alive connection
 * to the container that had it — the new deployment then answers a request
 * meant for the old one.
 */
export class PortAllocator {
  readonly #rangeStart: number;
  readonly #rangeEnd: number;
  readonly #attempts: number;
  readonly #probe: PortProbe;
  readonly #random: () => number;
  readonly #reserved = new Map<number, string>();

  constructor(options: PortAllocatorOptions = {}) {
    this.#rangeStart = options.rangeStart ?? PORT_RANGE_START;
    this.#rangeEnd = options.rangeEnd ?? PORT_RANGE_END;
    this.#attempts = options.attempts ?? DEFAULT_ATTEMPTS;
    this.#probe = options.probe ?? connectProbe;
    this.#random = options.random ?? Math.random;
  }

  reservations(): ReadonlyMap<number, string> {
    return this.#reserved;
  }

  /**
   * Reserved for the deployment that holds it until it is explicitly released,
   * not just until the container starts. Between allocation and `docker run`
   * nothing is listening on the port, so the probe alone would hand the same
   * port to a concurrent build.
   */
  async allocate(owner: string): Promise<number> {
    const span = this.#rangeEnd - this.#rangeStart + 1;
    for (let attempt = 0; attempt < this.#attempts; attempt += 1) {
      const port = this.#rangeStart + Math.floor(this.#random() * span);
      if (this.#reserved.has(port)) continue;
      if (await this.#probe(port)) continue;
      // Re-checked after the await: the probe yields, and a concurrent
      // allocation could have taken this port while it was in flight.
      if (this.#reserved.has(port)) continue;
      this.#reserved.set(port, owner);
      return port;
    }
    throw new NoFreePortError(this.#attempts);
  }

  /** Adopts a port already in use — an agent restart re-reading live routes. */
  reserve(port: number, owner: string): void {
    this.#reserved.set(port, owner);
  }

  release(port: number | null | undefined): void {
    if (port === null || port === undefined) return;
    this.#reserved.delete(port);
  }

  releaseOwner(owner: string): void {
    for (const [port, holder] of this.#reserved) {
      if (holder === owner) this.#reserved.delete(port);
    }
  }
}

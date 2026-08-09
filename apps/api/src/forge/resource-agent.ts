import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  type ForgeResourceSnapshot,
  forgeResourceSnapshotSchema,
} from "@repo/schemas/cloud";

export interface ResourceAgentClientOptions {
  baseUrl: string;
  nodeId: string;
  secret: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_AGE_SECONDS = 60;

function hmacKey(secret: string): Buffer {
  return Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
}

function signatureFor(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/** Server-side HMAC client for the public, tunnel-fronted resource agent. */
export class ResourceAgentClient {
  readonly #baseUrl: string;
  readonly #nodeId: string;
  readonly #key: Buffer;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(options: ResourceAgentClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#nodeId = options.nodeId;
    this.#key = hmacKey(options.secret);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async health(): Promise<ForgeResourceSnapshot> {
    const timestamp = Math.floor(this.#now() / 1_000).toString();
    const response = await this.#fetch(`${this.#baseUrl}/resource/health`, {
      headers: {
        "X-Node-ID": this.#nodeId,
        "X-Timestamp": timestamp,
        "X-Signature": signatureFor(this.#key, `${this.#nodeId}${timestamp}`),
      },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Resource agent returned ${response.status}`);
    }
    const raw: unknown = JSON.parse(await response.text());
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Resource agent returned an invalid response");
    }
    const payload = raw as Record<string, unknown>;
    const signature = payload.signature;
    if (typeof signature !== "string") {
      throw new Error("Resource agent response signature is invalid");
    }
    // Verify the raw parsed object before Zod strips unknown keys or imposes
    // schema key order. Overwriting an existing property retains its original
    // insertion position, reproducing Go's compact JSON with an empty value.
    const expected = signatureFor(
      this.#key,
      JSON.stringify({ ...payload, signature: "" }),
    );
    if (!equalHex(signature, expected)) {
      throw new Error("Resource agent response signature is invalid");
    }
    const snapshot = forgeResourceSnapshotSchema.parse(payload);
    if (snapshot.nodeId !== this.#nodeId) {
      throw new Error("Resource agent returned the wrong node ID");
    }
    const age = Math.abs(Math.floor(this.#now() / 1_000) - snapshot.timestamp);
    if (age > MAX_RESPONSE_AGE_SECONDS) {
      throw new Error("Resource agent returned a stale response");
    }

    return snapshot;
  }
}

export function resourceAgentClientFromEnv(): ResourceAgentClient | null {
  const baseUrl = process.env.FORGE_RESOURCE_AGENT_URL?.trim();
  const nodeId = process.env.FORGE_RESOURCE_AGENT_NODE_ID?.trim();
  const secret = process.env.FORGE_RESOURCE_AGENT_SECRET?.trim();
  if (!baseUrl && !nodeId && !secret) return null;
  if (!baseUrl || !nodeId || !secret) {
    throw new Error(
      "FORGE_RESOURCE_AGENT_URL, FORGE_RESOURCE_AGENT_NODE_ID and FORGE_RESOURCE_AGENT_SECRET must be configured together",
    );
  }
  if (secret.length < 8) {
    throw new Error(
      "FORGE_RESOURCE_AGENT_SECRET must be at least 8 characters",
    );
  }
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("FORGE_RESOURCE_AGENT_URL must use http or https");
  }
  return new ResourceAgentClient({ baseUrl, nodeId, secret });
}

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_FETCH_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return last || "upload";
  } catch {
    return "upload";
  }
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family !== 6) return true;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "::1") return true;
  const mapped = normalized.match(/^::ffff:(.+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(normalized);
}

// The model picks this URL, so it must not be usable to reach the Pi's own
// services, the Docker network, or a cloud metadata endpoint.
async function assertPublicUrl(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new Error(`Refusing to fetch a private address: ${host}`);
    }
    return;
  }
  const resolved = await lookup(host, { all: true }).catch(() => []);
  if (resolved.length === 0) {
    throw new Error(`Could not resolve ${host}`);
  }
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error(`Refusing to fetch a private address: ${host}`);
  }
}

// Redirects are followed by hand so every hop is re-checked; letting fetch
// follow them would let a public URL bounce to a private one.
export async function fetchPublic(initial: string): Promise<Response> {
  let target = new URL(initial);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(target.protocol)) {
      throw new Error("url must be an http or https URL");
    }
    await assertPublicUrl(target);
    const response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      target = new URL(location, target);
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects fetching ${initial}`);
}

export async function readCappedBody(
  response: Response,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FETCH_BYTES) {
    throw new Error(
      `File is ${declared} bytes; the limit is ${MAX_FETCH_BYTES}.`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel();
      throw new Error(`File exceeds the ${MAX_FETCH_BYTES} byte limit.`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { WorkspaceUnfurl } from "@repo/schemas";
import { pageMetadata } from "@/lib/fetch-url-metadata";
import { isPrivateAddress } from "@/lib/private-address";

/*
 * Bookmark unfurling fetches a URL someone else controls from inside the
 * server's network, so every connection is checked where it is made: the
 * socket's own DNS lookup refuses a name that resolves to any private,
 * loopback, link-local or CGNAT address, which leaves no window between a
 * check and the connect for a rebinding answer to slip through. A literal IP
 * never reaches a lookup and is checked directly. Redirects are followed by
 * hand, each hop through the same guard; the whole fetch has one deadline
 * and reads at most `MAX_HTML_BYTES` of an HTML answer.
 */

const MAX_HOPS = 5;
const TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 512 * 1024;

export class UnfurlRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnfurlRefused";
  }
}

type Resolve = (
  hostname: string,
  done: (error: Error | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolve: Resolve = (hostname, done) =>
  dnsLookup(hostname, { all: true }, (error, addresses) =>
    done(error, addresses ?? []),
  );

type LookupCallback = (
  error: Error | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** A `lookup` for `http.request` that answers only with public addresses. */
export function guardedLookup(resolve: Resolve = systemResolve) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: LookupCallback,
  ) => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, "");
      if (addresses.length === 0) {
        return callback(new UnfurlRefused(`Could not resolve ${hostname}`), "");
      }
      if (addresses.some((entry) => isPrivateAddress(entry.address))) {
        return callback(
          new UnfurlRefused(`${hostname} resolves to a private address`),
          "",
        );
      }
      const [first] = addresses;
      if (options.all || !first) return callback(null, addresses);
      callback(null, first.address, first.family);
    });
  };
}

function assertTarget(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnfurlRefused("Only http and https URLs unfurl");
  }
  if (url.username || url.password) {
    throw new UnfurlRefused("URLs with credentials do not unfurl");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) {
    throw new UnfurlRefused(`${host} is a private address`);
  }
}

function get(
  url: URL,
  signal: AbortSignal,
  resolve: Resolve | undefined,
): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(resolve),
        signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; denizlg24-workspace/1.0; +https://denizlg24.com)",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        },
      },
      resolvePromise,
    );
    request.on("error", reject);
    request.end();
  });
}

async function readHtml(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    size += buffer.byteLength;
    if (size >= MAX_HTML_BYTES) break;
  }
  response.destroy();
  return Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES).toString("utf8");
}

/** What a bookmark shows for `raw`: title, description, image, site. */
export async function unfurl(
  raw: string,
  options: { resolve?: Resolve } = {},
): Promise<WorkspaceUnfurl> {
  let target = new URL(raw);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    assertTarget(target);
    const response = await get(target, signal, options.resolve);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.destroy();
      target = new URL(location, target);
      continue;
    }
    const type = response.headers["content-type"] ?? "";
    if (status >= 400 || !type.includes("html")) {
      response.destroy();
      return { url: target.toString(), siteName: target.hostname };
    }
    const meta = pageMetadata(await readHtml(response), target.toString());
    return {
      url: target.toString(),
      ...(meta.title ? { title: meta.title.slice(0, 500) } : {}),
      ...(meta.description
        ? { description: meta.description.slice(0, 2000) }
        : {}),
      ...(meta.image && /^https?:/.test(meta.image)
        ? { image: meta.image }
        : {}),
      siteName: (meta.siteName ?? target.hostname).slice(0, 200),
    };
  }
  throw new UnfurlRefused("Too many redirects");
}

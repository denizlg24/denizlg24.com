import { lookup } from "node:dns/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { isPrivateAddress } from "./private-address";

export interface EgressProxyOptions {
  port: number;
  host?: string;
  /** Dev only: lets the browser reach loopback and the LAN. */
  allowPrivate?: boolean;
  onRefused?: (target: string, reason: string) => void;
  onError?: (error: unknown) => void;
}

export interface EgressProxy {
  readonly port: number;
  close(): Promise<void>;
}

const HEAD_LIMIT = 64 * 1024;
const CONNECT_TIMEOUT_MS = 15_000;

export class EgressRefused extends Error {
  constructor(
    readonly target: string,
    message: string,
  ) {
    super(message);
    this.name = "EgressRefused";
  }
}

function parseHostPort(
  authority: string,
  defaultPort: number,
): { host: string; port: number } | null {
  const bracketed = authority.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketed) {
    const host = bracketed[1] ?? "";
    return { host, port: bracketed[2] ? Number(bracketed[2]) : defaultPort };
  }
  const colon = authority.lastIndexOf(":");
  if (colon === -1) return { host: authority, port: defaultPort };
  const port = Number(authority.slice(colon + 1));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: authority.slice(0, colon), port };
}

/**
 * Resolves the name here so the address the browser reaches is the address
 * that was checked — a rebinding answer or a name that resolves inward is
 * refused before any packet leaves.
 */
export async function resolveEgress(
  host: string,
  allowPrivate: boolean,
): Promise<string> {
  const lowered = host.toLowerCase();
  if (lowered === "localhost" || lowered.endsWith(".localhost")) {
    if (!allowPrivate) throw new EgressRefused(host, "loopback");
  }
  const answers = await lookup(lowered, { all: true }).catch(() => []);
  if (answers.length === 0) throw new EgressRefused(host, "unresolved");
  if (!allowPrivate) {
    const inward = answers.find((answer) => isPrivateAddress(answer.address));
    if (inward) throw new EgressRefused(host, `private ${inward.address}`);
  }
  const preferred = answers.find((answer) => answer.family === 4) ?? answers[0];
  if (!preferred) throw new EgressRefused(host, "unresolved");
  return preferred.address;
}

interface ParsedHead {
  method: string;
  target: string;
  version: string;
  headers: string[];
  rest: Buffer;
}

function parseHead(buffer: Buffer): ParsedHead | null {
  const end = buffer.indexOf("\r\n\r\n");
  if (end === -1) return null;
  const lines = buffer.subarray(0, end).toString("latin1").split("\r\n");
  const [requestLine = "", ...headers] = lines;
  const [method = "", target = "", version = "HTTP/1.1"] =
    requestLine.split(" ");
  return { method, target, version, headers, rest: buffer.subarray(end + 4) };
}

function refuse(socket: Socket, status: number, reason: string): void {
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function pipeBoth(client: Socket, upstream: Socket): void {
  client.pipe(upstream);
  upstream.pipe(client);
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
}

function connectUpstream(address: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const upstream = connect({ host: address, port });
    const timer = setTimeout(() => {
      upstream.destroy();
      reject(new Error("connect timeout"));
    }, CONNECT_TIMEOUT_MS);
    upstream.once("connect", () => {
      clearTimeout(timer);
      resolve(upstream);
    });
    upstream.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * The one way out of the container. Chromium is launched with this as its
 * proxy and `<-loopback>` in the bypass list, so every request — CONNECT for
 * TLS, absolute-form for plain HTTP — passes through `resolveEgress` first.
 * Plain HTTP is one request per connection: the proxy forces `Connection:
 * close` so a second request for another host can never ride an already
 * vetted socket.
 */
export function startEgressProxy(options: EgressProxyOptions): EgressProxy {
  const allowPrivate = options.allowPrivate ?? false;
  const report = (error: unknown) => options.onError?.(error);

  const handle = async (client: Socket, head: ParsedHead) => {
    if (head.method === "CONNECT") {
      const parsed = parseHostPort(head.target, 443);
      if (!parsed) return refuse(client, 400, "Bad Request");
      const address = await resolveEgress(parsed.host, allowPrivate);
      const upstream = await connectUpstream(address, parsed.port);
      client.write(`${head.version} 200 Connection Established\r\n\r\n`);
      if (head.rest.length > 0) upstream.write(head.rest);
      pipeBoth(client, upstream);
      return;
    }
    let url: URL;
    try {
      url = new URL(head.target);
    } catch {
      return refuse(client, 400, "Bad Request");
    }
    if (url.protocol !== "http:") return refuse(client, 400, "Bad Request");
    const port = url.port ? Number(url.port) : 80;
    const address = await resolveEgress(url.hostname, allowPrivate);
    const upstream = await connectUpstream(address, port);
    const headers = head.headers.filter(
      (line) => !/^(connection|proxy-connection|keep-alive):/i.test(line),
    );
    upstream.write(
      [
        `${head.method} ${url.pathname}${url.search} ${head.version}`,
        ...headers,
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    if (head.rest.length > 0) upstream.write(head.rest);
    pipeBoth(client, upstream);
  };

  const clients = new Set<Socket>();
  const server: Server = createServer((client) => {
    clients.add(client);
    client.once("close", () => clients.delete(client));
    let buffered = Buffer.alloc(0);
    client.on("error", report);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const head = parseHead(buffered);
      if (!head) {
        if (buffered.length > HEAD_LIMIT) refuse(client, 431, "Too Large");
        return;
      }
      client.off("data", onData);
      client.pause();
      handle(client, head)
        .then(() => client.resume())
        .catch((error: unknown) => {
          if (error instanceof EgressRefused) {
            options.onRefused?.(error.target, error.message);
            refuse(client, 403, "Forbidden");
          } else {
            report(error);
            refuse(client, 502, "Bad Gateway");
          }
        });
    };
    client.on("data", onData);
  });
  server.on("error", report);
  server.listen(options.port, options.host ?? "127.0.0.1");

  return {
    get port() {
      const address = server.address();
      return typeof address === "object" && address
        ? address.port
        : options.port;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        for (const client of clients) client.destroy();
      }),
  };
}

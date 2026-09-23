import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import {
  type EgressProxy,
  EgressRefused,
  resolveEgress,
  startEgressProxy,
} from "./egress-proxy";

let origin: ReturnType<typeof Bun.serve>;
let open: EgressProxy;
let closed: EgressProxy;
const refused: string[] = [];

beforeAll(() => {
  origin = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new Response(`hello ${new URL(request.url).pathname}`, {
        headers: { "x-seen-host": request.headers.get("host") ?? "" },
      }),
  });
  open = startEgressProxy({ port: 0, allowPrivate: true });
  closed = startEgressProxy({
    port: 0,
    allowPrivate: false,
    onRefused: (target) => refused.push(target),
  });
});

afterAll(async () => {
  await open.close();
  await closed.close();
  origin.stop(true);
});

function roundTrip(
  proxyPort: number,
  request: string,
  after?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: proxyPort });
    let received = "";
    socket.on("data", (chunk) => {
      received += chunk.toString("latin1");
      if (after && received.includes("200 Connection Established")) {
        socket.write(after);
        after = undefined;
      }
    });
    socket.on("close", () => resolve(received));
    socket.on("error", reject);
    socket.write(request);
    setTimeout(() => socket.destroy(), 3_000);
  });
}

describe("egress proxy", () => {
  test("forwards an absolute-form request and closes after it", async () => {
    const response = await roundTrip(
      open.port,
      `GET http://127.0.0.1:${origin.port}/one HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\nProxy-Connection: keep-alive\r\n\r\n`,
    );
    expect(response).toContain("HTTP/1.1 200");
    expect(response).toContain("hello /one");
  });

  test("tunnels CONNECT to the vetted address", async () => {
    const response = await roundTrip(
      open.port,
      `CONNECT 127.0.0.1:${origin.port} HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\n\r\n`,
      `GET /two HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
    );
    expect(response).toContain("200 Connection Established");
    expect(response).toContain("hello /two");
  });

  test("refuses private destinations when egress is locked down", async () => {
    const plain = await roundTrip(
      closed.port,
      `GET http://127.0.0.1:${origin.port}/three HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`,
    );
    expect(plain).toStartWith("HTTP/1.1 403");
    const tunnel = await roundTrip(
      closed.port,
      "CONNECT 10.0.0.1:443 HTTP/1.1\r\nHost: 10.0.0.1:443\r\n\r\n",
    );
    expect(tunnel).toStartWith("HTTP/1.1 403");
    const loopback = await roundTrip(
      closed.port,
      "CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n",
    );
    expect(loopback).toStartWith("HTTP/1.1 403");
    expect(refused).toEqual(["127.0.0.1", "10.0.0.1", "localhost"]);
  });

  test("only proxies http in absolute form", async () => {
    const response = await roundTrip(
      open.port,
      "GET ftp://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n",
    );
    expect(response).toStartWith("HTTP/1.1 400");
  });
});

describe("resolveEgress", () => {
  test("refuses loopback names and private literals", async () => {
    await expect(resolveEgress("localhost", false)).rejects.toBeInstanceOf(
      EgressRefused,
    );
    await expect(resolveEgress("192.168.0.10", false)).rejects.toThrow(
      "private 192.168.0.10",
    );
    await expect(resolveEgress("[::1]", false)).rejects.toBeInstanceOf(
      EgressRefused,
    );
  });

  test("passes a public literal through untouched", async () => {
    expect(await resolveEgress("1.1.1.1", false)).toBe("1.1.1.1");
    expect(await resolveEgress("127.0.0.1", true)).toBe("127.0.0.1");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { TerminalGateway } from "./gateway";
import {
  type TerminalProxySocketData,
  TerminalWebSocketProxy,
  terminalProxyWebsocket,
} from "./proxy";

const SECRET = "terminal-proxy-test-secret-at-least-32-bytes";

describe("terminal WebSocket proxy", () => {
  let upstream: ReturnType<typeof Bun.serve>;
  let api: ReturnType<typeof Bun.serve>;
  let gateway: TerminalGateway;

  beforeAll(() => {
    upstream = Bun.serve({
      fetch(request, server) {
        if (server.upgrade(request, { data: {} })) return undefined;
        return new Response("upgrade required", { status: 426 });
      },
      hostname: "127.0.0.1",
      port: 0,
      websocket: {
        data: {} as object,
        message(socket, message) {
          if (message === "close") {
            socket.close(4001, "upstream done");
            return;
          }
          socket.send(message);
        },
      },
    });
    gateway = new TerminalGateway({
      serverUrl: `ws://127.0.0.1:${upstream.port}`,
      ticketSecret: SECRET,
    });
    const proxy = new TerminalWebSocketProxy(gateway);
    api = Bun.serve<TerminalProxySocketData>({
      fetch: (request, server) => proxy.upgrade(request, server),
      hostname: "127.0.0.1",
      port: 0,
      websocket: terminalProxyWebsocket,
    });
  });

  afterAll(() => {
    api.stop(true);
    upstream.stop(true);
  });

  it("independently rejects invalid tickets", async () => {
    const response = await fetch(
      `http://127.0.0.1:${api.port}/?ticket=invalid`,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "TERMINAL_TICKET_INVALID",
        message: "Invalid or expired terminal ticket",
      },
    });
  });

  it("preserves text, binary, and upstream close codes", async () => {
    const { ticket } = await gateway.mint("operator");
    const socket = new WebSocket(
      `ws://127.0.0.1:${api.port}/?ticket=${ticket}`,
    );
    socket.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WS failed")), {
        once: true,
      });
    });

    const text = new Promise<string>((resolve) => {
      socket.addEventListener(
        "message",
        (event) => resolve(String(event.data)),
        { once: true },
      );
    });
    socket.send("ping");
    expect(await text).toBe("ping");

    const binary = new Promise<ArrayBuffer>((resolve) => {
      socket.addEventListener(
        "message",
        (event) => {
          if (event.data instanceof ArrayBuffer) resolve(event.data);
        },
        { once: true },
      );
    });
    socket.send(new Uint8Array([0, 1, 2, 255]));
    expect(new Uint8Array(await binary)).toEqual(
      new Uint8Array([0, 1, 2, 255]),
    );

    const closed = new Promise<CloseEvent>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event), {
        once: true,
      });
    });
    socket.send("close");
    expect(await closed).toMatchObject({
      code: 4001,
      reason: "upstream done",
    });
  });
});

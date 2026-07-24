import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalTicketService } from "@repo/cloud-core/terminal";

import { createTerminalService, type TerminalService } from "./service";
import { TmuxSessionManager } from "./sessions";

const TMUX_AVAILABLE =
  process.platform !== "win32" && Boolean(Bun.which("tmux"));
const SECRET = "terminal-integration-secret-at-least-32-bytes";

interface SocketProbe {
  close(): Promise<void>;
  sendBinary(value: string): void;
  sendControl(value: object): void;
  waitForControl(type: string): Promise<object>;
  waitForText(value: string, timeoutMs?: number): Promise<void>;
}

async function connect(url: string): Promise<SocketProbe> {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const decoder = new TextDecoder();
  let output = "";
  const controls: object[] = [];
  const waiters = new Set<() => void>();
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      try {
        const parsed: object = JSON.parse(event.data);
        controls.push(parsed);
      } catch {
        output += event.data;
      }
    } else if (event.data instanceof ArrayBuffer) {
      output += decoder.decode(event.data, { stream: true });
    }
    for (const wake of waiters) wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket failed")),
      {
        once: true,
      },
    );
  });

  async function waitUntil(
    predicate: () => boolean,
    timeoutMs = 10_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error("Timed out waiting for terminal data");
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, Math.min(remaining, 100));
        waiters.add(wake);
      });
    }
  }

  return {
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise<void>((resolve) => {
        socket.addEventListener("close", () => resolve(), { once: true });
        socket.close(1000, "test complete");
      });
    },
    sendBinary(value) {
      socket.send(new TextEncoder().encode(value));
    },
    sendControl(value) {
      socket.send(JSON.stringify(value));
    },
    async waitForControl(type) {
      await waitUntil(() =>
        controls.some(
          (control) =>
            "t" in control &&
            typeof control.t === "string" &&
            control.t === type,
        ),
      );
      const index = controls.findIndex(
        (control) => "t" in control && control.t === type,
      );
      const [control] = controls.splice(index, 1);
      if (!control) throw new Error("Control frame disappeared");
      return control;
    },
    waitForText(value, timeoutMs) {
      return waitUntil(() => output.includes(value), timeoutMs);
    },
  };
}

describe.skipIf(!TMUX_AVAILABLE)("terminal service with real tmux", () => {
  let directory = "";
  let manager: TmuxSessionManager;
  let service: TerminalService;
  let server: ReturnType<typeof Bun.serve>;
  let tickets: TerminalTicketService;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "cloud-terminal-test-"));
    manager = new TmuxSessionManager({
      cwd: directory,
      env: {
        HOME: directory,
        TMUX_TMPDIR: directory,
      },
      socketName: `test-${process.pid}-${crypto.randomUUID()}`,
    });
    tickets = new TerminalTicketService(SECRET);
    service = createTerminalService({
      heartbeatIntervalMs: 500,
      idleSessionMs: 24 * 60 * 60 * 1_000,
      sessions: manager,
      ticketService: tickets,
    });
    server = Bun.serve({
      fetch: service.fetch,
      hostname: "127.0.0.1",
      port: 0,
      websocket: service.websocket,
    });
  });

  afterAll(async () => {
    service.close();
    server.stop(true);
    await manager.killServer();
    await rm(directory, { force: true, recursive: true });
  });

  it("round-trips protocol frames and survives disconnect/reattach", async () => {
    const sessionId = `reattach-${process.pid}`;
    const firstTicket = await tickets.mint({
      sessionId,
      subject: "operator",
    });
    const first = await connect(
      `ws://127.0.0.1:${server.port}/ws?ticket=${firstTicket.ticket}`,
    );
    first.sendControl({ t: "resize", cols: 100, rows: 30 });
    first.sendControl({ t: "ping" });
    expect(await first.waitForControl("pong")).toEqual({ t: "pong" });
    first.sendBinary(
      "export CLOUD_TERMINAL_REATTACH=kept; printf 'FIRST:%s\\n' \"$CLOUD_TERMINAL_REATTACH\"\n",
    );
    await first.waitForText("FIRST:kept");
    await first.close();

    const secondTicket = await tickets.mint({
      sessionId,
      subject: "operator",
    });
    const second = await connect(
      `ws://127.0.0.1:${server.port}/ws?ticket=${secondTicket.ticket}`,
    );
    second.sendBinary("printf 'SECOND:%s\\n' \"$CLOUD_TERMINAL_REATTACH\"\n");
    await second.waitForText("SECOND:kept");
    second.sendControl({ t: "sessions" });
    const listed = await second.waitForControl("sessions");
    expect(listed).toMatchObject({
      t: "sessions",
      sessions: [{ id: sessionId }],
    });
    await second.close();
  }, 30_000);

  it("streams a flooding command without disconnecting", async () => {
    const sessionId = `flood-${process.pid}`;
    const { ticket } = await tickets.mint({
      sessionId,
      subject: "operator",
    });
    const probe = await connect(
      `ws://127.0.0.1:${server.port}/ws?ticket=${ticket}`,
    );
    probe.sendBinary("yes | head -c 2097152; printf '\\nFLOOD_COMPLETE\\n'\n");
    await probe.waitForText("FLOOD_COMPLETE", 20_000);
    await probe.close();
  }, 30_000);
});

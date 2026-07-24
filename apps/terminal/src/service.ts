import {
  TerminalTicketError,
  TerminalTicketReplayGuard,
  type TerminalTicketService,
} from "@repo/cloud-core/terminal";
import {
  type TerminalTicketClaims,
  terminalClientControlFrameSchema,
  terminalSessionIdSchema,
} from "@repo/schemas/cloud";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";

import { TerminalOutputBridge } from "./backpressure";
import {
  type AttachedTmuxClient,
  type TerminalSize,
  TmuxSessionManager,
} from "./sessions";

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 } as const;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_MISSED_HEARTBEATS = 2;
const REAP_INTERVAL_MS = 60 * 60 * 1_000;
const MAX_PENDING_OPEN_BYTES = 64 * 1_024;
const MAX_PENDING_INPUT_BYTES = 256 * 1_024;

interface TerminalSocketData {
  claims: TerminalTicketClaims;
}

interface SocketConnection {
  attachSequence: number;
  bridge?: TerminalOutputBridge;
  heartbeat?: ReturnType<typeof setInterval>;
  missedHeartbeats: number;
  pendingInput: Uint8Array[];
  pendingInputBytes: number;
  size: TerminalSize;
  terminal?: AttachedTmuxClient;
}

export interface TerminalServiceOptions {
  heartbeatIntervalMs?: number;
  idleSessionMs: number;
  replayGuard?: TerminalTicketReplayGuard;
  sessions?: TmuxSessionManager;
  ticketService: TerminalTicketService;
}

export interface TerminalService {
  close(): void;
  fetch(
    request: Request,
    server: Server<TerminalSocketData>,
  ): Promise<Response | undefined>;
  websocket: WebSocketHandler<TerminalSocketData>;
}

function bearerTicket(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

function closeReason(error: unknown): string {
  return error instanceof TerminalTicketError
    ? "Invalid or expired terminal ticket"
    : "Terminal service error";
}

export function createTerminalService(
  options: TerminalServiceOptions,
): TerminalService {
  const sessions = options.sessions ?? new TmuxSessionManager();
  const replayGuard = options.replayGuard ?? new TerminalTicketReplayGuard();
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const connections = new WeakMap<
    ServerWebSocket<TerminalSocketData>,
    SocketConnection
  >();
  const liveSockets = new Set<ServerWebSocket<TerminalSocketData>>();

  const sendControl = (
    socket: ServerWebSocket<TerminalSocketData>,
    frame: object,
  ) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(frame));
  };

  const attach = async (
    socket: ServerWebSocket<TerminalSocketData>,
    id: string,
  ) => {
    const connection = connections.get(socket);
    if (!connection) return;
    terminalSessionIdSchema.parse(id);
    const sequence = ++connection.attachSequence;
    connection.terminal?.close();
    connection.terminal = undefined;
    connection.bridge = undefined;
    const pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let bridge: TerminalOutputBridge | undefined;
    const terminal = await sessions.attach(id, {
      size: connection.size,
      onData(data) {
        if (bridge) {
          bridge.write(data);
          return;
        }
        if (pendingBytes + data.byteLength <= MAX_PENDING_OPEN_BYTES) {
          pending.push(data.slice());
          pendingBytes += data.byteLength;
        }
      },
      onExit() {
        const current = connections.get(socket);
        if (
          current &&
          current.attachSequence === sequence &&
          socket.readyState === 1
        ) {
          socket.close(1011, "Terminal client exited");
        }
      },
    });
    const current = connections.get(socket);
    if (!current || current.attachSequence !== sequence) {
      terminal.close();
      return;
    }
    bridge = new TerminalOutputBridge(
      {
        bufferedAmount: () => socket.getBufferedAmount(),
        send: (data) => {
          if (socket.readyState === 1) socket.send(data);
        },
      },
      terminal,
    );
    current.terminal = terminal;
    current.bridge = bridge;
    terminal.resize(current.size);
    for (const data of current.pendingInput) terminal.write(data);
    current.pendingInput = [];
    current.pendingInputBytes = 0;
    for (const data of pending) bridge.write(data);
  };

  const websocket: WebSocketHandler<TerminalSocketData> = {
    data: {} as TerminalSocketData,
    async open(socket) {
      const connection: SocketConnection = {
        attachSequence: 0,
        missedHeartbeats: 0,
        pendingInput: [],
        pendingInputBytes: 0,
        size: DEFAULT_TERMINAL_SIZE,
      };
      connections.set(socket, connection);
      liveSockets.add(socket);
      try {
        const id = socket.data.claims.sid ?? crypto.randomUUID();
        await attach(socket, id);
        connection.heartbeat = setInterval(() => {
          if (connection.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
            socket.close(4000, "Heartbeat timeout");
            return;
          }
          connection.missedHeartbeats += 1;
          sendControl(socket, { t: "ping" });
        }, heartbeatIntervalMs);
      } catch (error) {
        console.error("Terminal attach failed", error);
        socket.close(1011, "Unable to attach terminal");
      }
    },
    message(socket, message) {
      const connection = connections.get(socket);
      if (!connection) {
        socket.close(1011, "Terminal is not ready");
        return;
      }
      if (typeof message !== "string") {
        if (connection.terminal) {
          connection.terminal.write(message);
          return;
        }
        if (
          connection.pendingInputBytes + message.byteLength >
          MAX_PENDING_INPUT_BYTES
        ) {
          socket.close(1009, "Too much input before terminal opened");
          return;
        }
        connection.pendingInput.push(Uint8Array.from(message));
        connection.pendingInputBytes += message.byteLength;
        return;
      }
      let raw: object;
      try {
        raw = JSON.parse(message);
      } catch {
        socket.close(1008, "Invalid control frame");
        return;
      }
      const parsed = terminalClientControlFrameSchema.safeParse(raw);
      if (!parsed.success) {
        socket.close(1008, "Invalid control frame");
        return;
      }
      switch (parsed.data.t) {
        case "resize":
          connection.size = parsed.data;
          connection.terminal?.resize(parsed.data);
          break;
        case "ping":
          sendControl(socket, { t: "pong" });
          break;
        case "pong":
          connection.missedHeartbeats = 0;
          break;
        case "sessions":
          void sessions
            .list()
            .then((listed) =>
              sendControl(socket, { t: "sessions", sessions: listed }),
            )
            .catch((error) => {
              console.error("Terminal session listing failed", error);
              socket.close(1011, "Unable to list sessions");
            });
          break;
        case "attach":
          void attach(socket, parsed.data.id).catch((error) => {
            console.error("Terminal reattach failed", error);
            socket.close(1011, "Unable to attach terminal");
          });
          break;
      }
    },
    drain(socket) {
      connections.get(socket)?.bridge?.drain();
    },
    close(socket) {
      const connection = connections.get(socket);
      if (connection?.heartbeat) clearInterval(connection.heartbeat);
      connection?.terminal?.close();
      connections.delete(socket);
      liveSockets.delete(socket);
    },
  };

  const reaper = setInterval(() => {
    void sessions.reapIdle(options.idleSessionMs).catch((error) => {
      console.error("Idle terminal session reaping failed", error);
    });
  }, REAP_INTERVAL_MS);
  reaper.unref();

  return {
    close() {
      clearInterval(reaper);
      for (const socket of liveSockets) {
        socket.close(1001, "Terminal service shutting down");
      }
    },
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") {
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/ws") {
        const ticket = url.searchParams.get("ticket");
        if (!ticket) {
          return jsonError(
            "TERMINAL_TICKET_REQUIRED",
            "A terminal ticket is required",
            401,
          );
        }
        try {
          const claims = await options.ticketService.verify(
            ticket,
            replayGuard,
          );
          if (server.upgrade(request, { data: { claims } })) return undefined;
          return jsonError(
            "WEBSOCKET_UPGRADE_REQUIRED",
            "A WebSocket upgrade is required",
            426,
          );
        } catch (error) {
          return jsonError("TERMINAL_TICKET_INVALID", closeReason(error), 401);
        }
      }

      if (url.pathname === "/sessions" && request.method === "GET") {
        const ticket = bearerTicket(request);
        if (!ticket) {
          return jsonError(
            "TERMINAL_TICKET_REQUIRED",
            "A terminal ticket is required",
            401,
          );
        }
        try {
          await options.ticketService.verify(ticket, replayGuard);
        } catch (error) {
          return jsonError("TERMINAL_TICKET_INVALID", closeReason(error), 401);
        }
        try {
          return Response.json({ data: await sessions.list() });
        } catch (error) {
          console.error("Terminal session listing failed", error);
          return jsonError(
            "TERMINAL_SESSION_LIST_FAILED",
            "Unable to list terminal sessions",
            500,
          );
        }
      }

      if (
        url.pathname.startsWith("/sessions/") &&
        request.method === "DELETE"
      ) {
        const ticket = bearerTicket(request);
        if (!ticket) {
          return jsonError(
            "TERMINAL_TICKET_REQUIRED",
            "A terminal ticket is required",
            401,
          );
        }
        try {
          await options.ticketService.verify(ticket, replayGuard);
        } catch (error) {
          return jsonError("TERMINAL_TICKET_INVALID", closeReason(error), 401);
        }
        let id: string;
        try {
          const rawId = decodeURIComponent(
            url.pathname.slice("/sessions/".length),
          );
          id = terminalSessionIdSchema.parse(rawId);
        } catch {
          return jsonError(
            "TERMINAL_SESSION_INVALID",
            "Invalid terminal session",
            400,
          );
        }
        try {
          const exists = (await sessions.list()).some(
            (session) => session.id === id,
          );
          if (!exists) {
            return jsonError(
              "TERMINAL_SESSION_NOT_FOUND",
              "Terminal session not found",
              404,
            );
          }
          await sessions.kill(id);
          return Response.json({ data: { success: true } });
        } catch (error) {
          console.error("Terminal session deletion failed", error);
          return jsonError(
            "TERMINAL_SESSION_DELETE_FAILED",
            "Unable to delete terminal session",
            500,
          );
        }
      }

      return jsonError("NOT_FOUND", "Not found", 404);
    },
    websocket,
  };
}

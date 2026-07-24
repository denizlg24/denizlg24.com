import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import WebSocket, { type RawData } from "ws";

import type { TerminalGateway } from "./gateway";

const PROXY_HIGH_WATERMARK = 1024 * 1024;
const PROXY_LOW_WATERMARK = 256 * 1024;
const MAX_PENDING_CLIENT_BYTES = 256 * 1024;

interface PendingMessage {
  data: RawData;
  binary: boolean;
}

export interface TerminalProxySocketData {
  gatewayUrl: string;
  pending: PendingMessage[];
  pendingBytes: number;
  upstream?: WebSocket;
  upstreamPaused: boolean;
}

function validCloseCode(code: number): number {
  return code >= 1_000 &&
    code <= 4_999 &&
    code !== 1_004 &&
    code !== 1_005 &&
    code !== 1_006 &&
    code !== 1_015
    ? code
    : 1011;
}

function rawDataBytes(data: RawData): number {
  return Array.isArray(data)
    ? data.reduce((total, item) => total + item.byteLength, 0)
    : data.byteLength;
}

function sendToBrowser(
  socket: ServerWebSocket<TerminalProxySocketData>,
  data: RawData,
  binary: boolean,
): void {
  if (socket.readyState !== 1) return;
  if (!binary) {
    const text = Array.isArray(data)
      ? Buffer.concat(data).toString()
      : Buffer.isBuffer(data)
        ? data.toString()
        : Buffer.from(new Uint8Array(data)).toString();
    socket.send(text);
    return;
  }
  if (Array.isArray(data)) {
    socket.send(Buffer.concat(data));
    return;
  }
  socket.send(data);
}

export const terminalProxyWebsocket: WebSocketHandler<TerminalProxySocketData> =
  {
    data: {} as TerminalProxySocketData,
    open(socket) {
      const upstream = new WebSocket(socket.data.gatewayUrl);
      socket.data.upstream = upstream;
      upstream.binaryType = "arraybuffer";
      upstream.on("open", () => {
        for (const pending of socket.data.pending) {
          upstream.send(pending.data, { binary: pending.binary });
        }
        socket.data.pending = [];
        socket.data.pendingBytes = 0;
      });
      upstream.on("message", (data, binary) => {
        sendToBrowser(socket, data, binary);
        if (
          !socket.data.upstreamPaused &&
          socket.getBufferedAmount() > PROXY_HIGH_WATERMARK
        ) {
          socket.data.upstreamPaused = true;
          upstream.pause();
        }
      });
      upstream.on("close", (code, reason) => {
        if (socket.readyState === 1) {
          socket.close(validCloseCode(code), reason.toString().slice(0, 120));
        }
      });
      upstream.on("error", () => {
        console.error("Terminal upstream WebSocket error");
        if (socket.readyState === 1) {
          socket.close(1011, "Terminal upstream unavailable");
        }
      });
    },
    message(socket, message) {
      const binary = typeof message !== "string";
      const data: RawData =
        typeof message === "string" ? Buffer.from(message) : message;
      const upstream = socket.data.upstream;
      if (upstream?.readyState === WebSocket.OPEN) {
        if (
          upstream.bufferedAmount + rawDataBytes(data) >
          MAX_PENDING_CLIENT_BYTES
        ) {
          socket.close(1013, "Terminal server is not keeping up");
          return;
        }
        upstream.send(data, { binary });
        return;
      }
      const byteLength = rawDataBytes(data);
      if (socket.data.pendingBytes + byteLength > MAX_PENDING_CLIENT_BYTES) {
        socket.close(1009, "Too much data before terminal connection opened");
        return;
      }
      socket.data.pending.push({ binary, data });
      socket.data.pendingBytes += byteLength;
    },
    drain(socket) {
      if (
        socket.data.upstreamPaused &&
        socket.getBufferedAmount() < PROXY_LOW_WATERMARK
      ) {
        socket.data.upstreamPaused = false;
        socket.data.upstream?.resume();
      }
    },
    close(socket, code, reason) {
      const upstream = socket.data.upstream;
      if (
        upstream &&
        (upstream.readyState === WebSocket.OPEN ||
          upstream.readyState === WebSocket.CONNECTING)
      ) {
        upstream.close(validCloseCode(code), reason);
      }
    },
  };

export class TerminalWebSocketProxy {
  constructor(private readonly gateway: TerminalGateway) {}

  async upgrade(
    request: Request,
    server: Server<TerminalProxySocketData>,
  ): Promise<Response | undefined> {
    const ticket = new URL(request.url).searchParams.get("ticket");
    if (!ticket) {
      return Response.json(
        {
          error: {
            code: "TERMINAL_TICKET_REQUIRED",
            message: "A terminal ticket is required",
          },
        },
        { status: 401 },
      );
    }
    try {
      await this.gateway.verify(ticket);
    } catch {
      return Response.json(
        {
          error: {
            code: "TERMINAL_TICKET_INVALID",
            message: "Invalid or expired terminal ticket",
          },
        },
        { status: 401 },
      );
    }
    const upgraded = server.upgrade(request, {
      data: {
        gatewayUrl: this.gateway.websocketUrl(ticket),
        pending: [],
        pendingBytes: 0,
        upstreamPaused: false,
      },
    });
    if (upgraded) return undefined;
    return Response.json(
      {
        error: {
          code: "WEBSOCKET_UPGRADE_REQUIRED",
          message: "A WebSocket upgrade is required",
        },
      },
      { status: 426 },
    );
  }
}

"use client";

import "@xterm/xterm/css/xterm.css";
import {
  type TerminalServerControlFrame,
  terminalServerControlFrameSchema,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { apiWsUrl } from "@/lib/env";

const encoder = new TextEncoder();

type ConnectionState = "connecting" | "connected" | "closed";

export function TerminalClient({
  sessionId,
  onSessionEstablished,
}: {
  sessionId: string | null;
  onSessionEstablished: (sessionId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectedSessionRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  const sendResize = useCallback(() => {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    fitRef.current?.fit();
    if (terminal && socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          t: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    }
  }, []);

  const connect = useCallback(
    async (targetSessionId: string | null) => {
      const generation = ++generationRef.current;
      socketRef.current?.close();
      setState("connecting");
      setError(null);
      let minted: { ticket: string; sessionId: string };
      try {
        minted = await api.terminal.mint(targetSessionId ?? undefined);
      } catch (err) {
        if (generationRef.current === generation) {
          setState("closed");
          setError(errorMessage(err));
        }
        return;
      }
      if (generationRef.current !== generation) return;
      connectedSessionRef.current = minted.sessionId;
      onSessionEstablished(minted.sessionId);

      const socket = new WebSocket(
        apiWsUrl(
          `/api/ops/terminal/ws?ticket=${encodeURIComponent(minted.ticket)}`,
        ),
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      socket.onopen = () => {
        if (generationRef.current !== generation) return;
        setState("connected");
        terminalRef.current?.focus();
        sendResize();
      };
      socket.onmessage = (event) => {
        const terminal = terminalRef.current;
        if (typeof event.data === "string") {
          let frame: TerminalServerControlFrame;
          try {
            frame = terminalServerControlFrameSchema.parse(
              JSON.parse(event.data),
            );
          } catch {
            return;
          }
          if (frame.t === "ping") {
            socket.send(JSON.stringify({ t: "pong" }));
          }
          return;
        }
        terminal?.write(new Uint8Array(event.data as ArrayBuffer));
      };
      socket.onclose = () => {
        if (generationRef.current !== generation) return;
        setState("closed");
      };
      socket.onerror = () => {
        if (generationRef.current !== generation) return;
        setError("connection error");
      };
    },
    [onSessionEstablished, sendResize],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
      scrollback: 5000,
      theme: {
        background: "#191918",
        foreground: "#e8e7e2",
        cursor: "#e8e7e2",
        selectionBackground: "#3a3a38",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    fitRef.current = fit;
    fit.fit();

    const disposeData = terminal.onData((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(encoder.encode(data));
      }
    });
    const disposeBinary = terminal.onBinary((data) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        const bytes = new Uint8Array(data.length);
        for (let index = 0; index < data.length; index++) {
          bytes[index] = data.charCodeAt(index) & 0xff;
        }
        socket.send(bytes);
      }
    });

    const observer = new ResizeObserver(() => sendResize());
    observer.observe(container);

    return () => {
      generationRef.current++;
      observer.disconnect();
      disposeData.dispose();
      disposeBinary.dispose();
      socketRef.current?.close();
      socketRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [sendResize]);

  useEffect(() => {
    const socket = socketRef.current;
    const alreadyAttached =
      sessionId !== null &&
      connectedSessionRef.current === sessionId &&
      socket !== null &&
      socket.readyState <= WebSocket.OPEN;
    if (alreadyAttached) return;
    void connect(sessionId);
  }, [sessionId, connect]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded border bg-[#191918]">
      <div ref={containerRef} className="absolute inset-0 p-2" />
      {state !== "connected" && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {state === "connecting" ? "connecting…" : "disconnected"}
            {error && <span className="text-destructive"> — {error}</span>}
          </span>
          {state === "closed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void connect(sessionId)}
            >
              reconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

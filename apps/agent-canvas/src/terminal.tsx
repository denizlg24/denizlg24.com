import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import "@xterm/xterm/css/xterm.css";
export function AgentTerminal({
  id,
  dark,
  running = true,
}: {
  id: string;
  dark: boolean;
  running?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!element.current) return;
    let cancelled = false;
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    let resizeTimer: ReturnType<typeof setTimeout>;
    const css = getComputedStyle(document.documentElement);
    const term = new Terminal({
      cursorBlink: running,
      disableStdin: !running,
      screenReaderMode: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      scrollback: 8000,
      theme: {
        background: css.getPropertyValue("--background").trim(),
        foreground: css.getPropertyValue("--accent-strong").trim(),
        cursor: css.getPropertyValue("--accent-strong").trim(),
        selectionBackground: css.getPropertyValue("--muted").trim(),
      },
    });
    const serialize = new SerializeAddon();
    term.loadAddon(serialize);
    const storageKey = `agents:terminal:${id}`;
    const persist = () => {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            cursor,
            cols: term.cols,
            rows: term.rows,
            screen: serialize.serialize({ scrollback: 2000 }),
          }),
        );
      } catch (e) {
        report(`Could not save terminal screen: ${e}`);
      }
    };
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element.current);
    const report = (e: unknown) => {
      if (!cancelled) setError(String(e));
    };
    const size = () => {
      if (cancelled) return;
      fit.fit();
      if (running) api.resize(id, term.cols, term.rows).catch(report);
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(size, 80);
    });
    observer.observe(element.current);
    const input = term.onData((data) => {
      if (running) api.write(id, data).catch(report);
    });
    async function poll() {
      try {
        const data = await api.read(id, cursor);
        if (cancelled) return;
        if (data.truncated) {
          term.reset();
          term.writeln("\r\n[Earlier terminal output expired]\r\n");
        }
        const bytes = new Uint8Array(
          data.chunks.reduce((n, chunk) => n + chunk.length, 0),
        );
        let offset = 0;
        for (const chunk of data.chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        await new Promise<void>((resolve) =>
          term.write(bytes, () => {
            cursor = data.cursor;
            resolve();
          }),
        );
      } catch (e) {
        report(e);
      }
      if (!cancelled) timer = setTimeout(poll, 80);
    }
    setError("");
    let saved: {
      cursor: number;
      cols: number;
      rows: number;
      screen: string;
    } | null = null;
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (
        value &&
        Number.isSafeInteger(value.cursor) &&
        value.cursor >= 0 &&
        typeof value.screen === "string" &&
        Number.isInteger(value.cols) &&
        Number.isInteger(value.rows) &&
        value.cols >= 2 &&
        value.cols <= 500 &&
        value.rows >= 2 &&
        value.rows <= 200
      )
        saved = value;
    } catch {
      /* Recover from an invalid screen checkpoint using backend output. */
    }
    const start = () => {
      if (!cancelled) {
        size();
        term.focus();
        void poll();
      }
    };
    if (saved) {
      cursor = saved.cursor;
      term.resize(saved.cols, saved.rows);
      term.write(saved.screen, start);
    } else start();
    const checkpoint = setInterval(() => {
      term.write("", persist);
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      observer.disconnect();
      input.dispose();
      clearInterval(checkpoint);
      term.write("", () => {
        persist();
        term.dispose();
      });
    };
  }, [id, dark, running]);
  return (
    <div className="terminal-wrap">
      {error && (
        <div role="alert" className="terminal-error">
          {error}
        </div>
      )}
      <div
        ref={element}
        className="terminal-host"
        role="region"
        aria-label="Agent CLI terminal"
      />
    </div>
  );
}

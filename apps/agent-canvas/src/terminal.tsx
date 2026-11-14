import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { api } from "./bridge";
import "@xterm/xterm/css/xterm.css";
export function AgentTerminal({ id, dark }: { id: string; dark: boolean }) {
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
      cursorBlink: true,
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
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element.current);
    const report = (e: unknown) => {
      if (!cancelled) setError(String(e));
    };
    const size = () => {
      if (cancelled) return;
      fit.fit();
      api.resize(id, term.cols, term.rows).catch(report);
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(size, 80);
    });
    observer.observe(element.current);
    const input = term.onData((data) => {
      api.write(id, data).catch(report);
    });
    async function poll() {
      try {
        const data = await api.read(id, cursor);
        if (cancelled) return;
        if (data.truncated)
          term.writeln("\r\n[Earlier terminal output expired]\r\n");
        for (const chunk of data.chunks) term.write(new Uint8Array(chunk));
        cursor = data.cursor;
      } catch (e) {
        report(e);
      }
      if (!cancelled) timer = setTimeout(poll, 80);
    }
    setError("");
    size();
    term.focus();
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      observer.disconnect();
      input.dispose();
      term.dispose();
    };
  }, [id, dark]);
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

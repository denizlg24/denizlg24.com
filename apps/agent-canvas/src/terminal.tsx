import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { api, native } from "./bridge";
import "@xterm/xterm/css/xterm.css";

// Terminal.app's "Clear Dark" profile over its standard ANSI palette, so the
// CLIs look the way they do in the owner's own terminal.
export const terminalTheme: ITheme = {
  background: "#161616",
  foreground: "#e5e5e5",
  cursor: "#a6a6a6",
  cursorAccent: "#161616",
  selectionBackground: "#ffffff40",
  selectionInactiveBackground: "#ffffff26",
  black: "#000000",
  red: "#c23621",
  green: "#25bc24",
  yellow: "#adad27",
  blue: "#492ee1",
  magenta: "#d338d3",
  cyan: "#33bbc8",
  white: "#cbcccd",
  brightBlack: "#818383",
  brightRed: "#fc391f",
  brightGreen: "#31e722",
  brightYellow: "#eaec23",
  brightBlue: "#5833ff",
  brightMagenta: "#f935f8",
  brightCyan: "#14f0f0",
  brightWhite: "#e9ebeb",
};

type Saved = { cursor: number; cols: number; rows: number; screen: string };
function readSaved(key: string): Saved | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
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
      return value;
  } catch {
    // An invalid checkpoint falls back to the backend's output buffer.
  }
  return null;
}
const quotePath = (path: string) =>
  /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

export function AgentTerminal({
  id,
  running = true,
  active = false,
}: {
  id: string;
  running?: boolean;
  active?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const live = useRef(running);
  const [error, setError] = useState("");
  useEffect(() => {
    live.current = running;
    const term = terminal.current;
    if (!term) return;
    term.options.disableStdin = !running;
    term.options.cursorBlink = running;
  }, [running]);
  useEffect(() => {
    if (active) terminal.current?.focus();
  }, [active]);
  useEffect(() => {
    const host = element.current;
    if (!host) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let ptyTimer: ReturnType<typeof setTimeout>;
    let frame = 0;
    let cursor = 0;
    const report = (e: unknown) => {
      if (!cancelled) setError(String(e));
    };
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: live.current,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      disableStdin: !live.current,
      fontSize: 12,
      fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, Menlo, monospace',
      lineHeight: 1.12,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
      scrollback: 10000,
      scrollSensitivity: 1,
      fastScrollSensitivity: 6,
      smoothScrollDuration: 0,
      minimumContrastRatio: 1,
      drawBoldTextInBrightColors: true,
      theme: terminalTheme,
    });
    terminal.current = term;
    const serialize = new SerializeAddon();
    const fit = new FitAddon();
    term.loadAddon(serialize);
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(host);
    // Automated browsers keep the DOM renderer so tests can read the rows.
    if (!navigator.webdriver)
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // The DOM renderer stays in place when WebGL is unavailable.
      }
    // WebKit's inline predictions and autocorrect write into xterm's hidden
    // textarea, which xterm then replays to the PTY as extra input.
    for (const [name, value] of [
      ["autocorrect", "off"],
      ["autocapitalize", "off"],
      ["autocomplete", "off"],
      ["spellcheck", "false"],
      ["writingsuggestions", "false"],
    ])
      term.textarea?.setAttribute(name, value);
    const send = (data: string) => {
      if (live.current) api.write(id, data).catch(report);
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        send("\x1b\r");
        return false;
      }
      if (!e.metaKey) return true;
      if (e.key === "k") {
        term.clear();
        return false;
      }
      if (e.key === "c" && term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      const line: Record<string, string> = {
        ArrowLeft: "\x01",
        ArrowRight: "\x05",
        Backspace: "\x15",
      };
      if (line[e.key]) {
        send(line[e.key]);
        return false;
      }
      return e.key === "v";
    });
    const input = term.onData(send);
    const syncPty = term.onResize(({ cols, rows }) => {
      clearTimeout(ptyTimer);
      ptyTimer = setTimeout(() => {
        if (live.current) api.resize(id, cols, rows).catch(report);
      }, 90);
    });
    const size = () => {
      frame = 0;
      if (cancelled || !host.clientWidth || !host.clientHeight) return;
      const next = fit.proposeDimensions();
      if (
        next &&
        Number.isFinite(next.cols) &&
        Number.isFinite(next.rows) &&
        (next.cols !== term.cols || next.rows !== term.rows)
      )
        term.resize(Math.max(2, next.cols), Math.max(2, next.rows));
    };
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(size);
    });
    observer.observe(host);
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
    let idle = 0;
    async function poll() {
      let received = false;
      try {
        const page = await api.read(id, cursor);
        if (cancelled) return;
        if (page.truncated) {
          term.reset();
          term.writeln("\x1b[2m[Earlier terminal output expired]\x1b[0m");
        }
        received = page.data.length > 0 || page.cursor !== cursor;
        if (received)
          await new Promise<void>((resolve) =>
            term.write(page.data, () => {
              cursor = page.cursor;
              resolve();
            }),
          );
      } catch (e) {
        report(e);
      }
      if (cancelled) return;
      idle = received ? 0 : idle + 1;
      // Stay quick while output streams; back off once the CLI is quiet.
      const delay = !live.current
        ? 1000
        : idle < 10
          ? 40
          : Math.min(250, 40 + idle * 10);
      timer = setTimeout(poll, delay);
    }
    let unlistenDrop: (() => void) | undefined;
    const webview = (() => {
      try {
        return native ? getCurrentWebview() : null;
      } catch {
        return null;
      }
    })();
    if (webview)
      webview
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop" || !live.current) return;
          const scale = window.devicePixelRatio || 1;
          const x = event.payload.position.x / scale;
          const y = event.payload.position.y / scale;
          if (!host.contains(document.elementFromPoint(x, y))) return;
          send(`${event.payload.paths.map(quotePath).join(" ")} `);
          term.focus();
        })
        .then((unlisten) => {
          if (cancelled) unlisten();
          else unlistenDrop = unlisten;
        })
        .catch(() => {});
    setError("");
    const saved = readSaved(storageKey);
    const start = () => {
      if (cancelled) return;
      size();
      if (live.current) api.resize(id, term.cols, term.rows).catch(report);
      term.focus();
      void poll();
    };
    if (saved) {
      cursor = saved.cursor;
      term.resize(saved.cols, saved.rows);
      term.write(saved.screen, start);
    } else start();
    const checkpoint = setInterval(() => term.write("", persist), 2000);
    return () => {
      cancelled = true;
      terminal.current = null;
      clearTimeout(timer);
      clearTimeout(ptyTimer);
      cancelAnimationFrame(frame);
      clearInterval(checkpoint);
      observer.disconnect();
      input.dispose();
      syncPty.dispose();
      unlistenDrop?.();
      term.write("", () => {
        persist();
        term.dispose();
      });
    };
  }, [id]);
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

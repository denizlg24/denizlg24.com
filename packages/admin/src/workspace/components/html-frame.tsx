"use client";

import type { SpecScope } from "@repo/utils/ui-spec";
import { useEffect, useMemo, useRef, useState } from "react";
import { THEMED_VARIABLES } from "../appearance/theme-css";

/**
 * The frame's policy: inline script and style only, images from data:/blob:,
 * and no network at all. The script is handed the owner's data, so anything
 * that could carry it out — fetch, a remote image URL, a form — is refused.
 * A meta CSP cannot be loosened by the document it sits in.
 */
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

const BRIDGE = `
(() => {
  const listeners = new Set();
  const component = {
    data: {},
    resize(height) {
      parent.postMessage({ type: "component:resize", height: Number(height) }, "*");
    },
    onData(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  window.component = component;
  window.addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.type !== "component:data") return;
    component.data = event.data.data;
    for (const fn of listeners) { try { fn(component.data); } catch (e) { console.error(e); } }
    document.dispatchEvent(new CustomEvent("component:data", { detail: component.data }));
  });
  const observer = new ResizeObserver(() => {
    component.resize(Math.ceil(document.documentElement.scrollHeight));
  });
  addEventListener("DOMContentLoaded", () => observer.observe(document.body));
})();
`;

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function escapeStyle(source: string): string {
  return source.replace(/<\/style/gi, "<\\/style");
}

function themeRoot(): string {
  const style = getComputedStyle(document.documentElement);
  const vars = THEMED_VARIABLES.map((name) => {
    const value = style.getPropertyValue(name).trim();
    return value ? `${name}: ${value};` : "";
  }).join(" ");
  const font = getComputedStyle(document.body)
    .getPropertyValue("--theme-font-body")
    .trim();
  return `:root { ${vars} ${font ? `--theme-font-body: ${font};` : ""} color-scheme: ${style.colorScheme || "light"}; }`;
}

function documentFor(
  html: string,
  css: string,
  js: string,
  theme: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${theme}
html, body { margin: 0; background: transparent; color: var(--foreground); font-family: var(--theme-font-body, system-ui, sans-serif); font-size: 14px; line-height: 1.5; }
* { box-sizing: border-box; }
${escapeStyle(css)}</style><script>${BRIDGE}</script></head><body>${html}<script>${escapeScript(js)}</script></body></html>`;
}

/** Runs an html component in a sandboxed, network-less frame and feeds it the data scope. */
export function HtmlFrame({
  html,
  css,
  js,
  scope,
  height,
  themeKey,
}: {
  html: string;
  css: string;
  js: string;
  scope: SpecScope;
  height: number;
  /** Changes when the theme does, so the frame picks up new colours. */
  themeKey: string;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);

  const srcDoc = useMemo(
    () => documentFor(html, css, js, themeRoot()),
    [html, css, js, themeKey],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      const message: unknown = event.data;
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "component:resize" &&
        "height" in message &&
        typeof message.height === "number" &&
        Number.isFinite(message.height)
      ) {
        setMeasured(Math.max(40, Math.min(2000, Math.round(message.height))));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const post = () =>
    ref.current?.contentWindow?.postMessage(
      { type: "component:data", data: scope },
      "*",
    );

  useEffect(() => {
    post();
  }, [scope]);

  return (
    <iframe
      ref={ref}
      title="Component"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      onLoad={post}
      className="block w-full border-0 bg-transparent"
      style={{ height: measured ?? height }}
    />
  );
}

import type { SurfaceMount } from "@repo/schemas";
import { z } from "zod";

export const SURFACE_CHANNEL = "deniz-surface";

/**
 * Network is open on purpose: a surface may load any library, font or image.
 * What it cannot do is reach the host's origin — the frame never gets
 * allow-same-origin, so its only way to the owner's data is the bridge.
 */
const CSP = "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'";

export const SURFACE_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads";

export interface SurfaceTheme {
  scheme: "light" | "dark";
  vars: Record<string, string>;
}

export interface SurfaceDocumentInput {
  /** Sent once, in the hello that hands over the port; the host never sends it back. */
  nonce: string;
  surface: { id: string; name: string; mount: SurfaceMount };
  head: string;
  html: string;
  css: string;
  js: string;
  assets: Record<string, string>;
  state: Record<string, unknown>;
  theme: SurfaceTheme;
}

const ASSET_TOKEN = /\{\{\s*asset:([A-Za-z0-9][A-Za-z0-9._-]{0,63})\s*\}\}/g;

export function replaceAssetTokens(
  source: string,
  assets: Record<string, string>,
): string {
  return source.replace(ASSET_TOKEN, (token, name: string) =>
    Object.hasOwn(assets, name) ? assets[name] : token,
  );
}

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

function escapeStyle(source: string): string {
  return source.replace(/<\/style/gi, "<\\/style");
}

/** JSON that is safe inside an inline script, whatever strings it carries. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function rootRule(theme: SurfaceTheme): string {
  const vars = Object.entries(theme.vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return escapeStyle(`:root { ${vars} color-scheme: ${theme.scheme}; }`);
}

const BRIDGE = `
(() => {
  const CHANNEL = ${JSON.stringify(SURFACE_CHANNEL)};
  const init = __INIT__;
  const pending = new Map();
  let seq = 0;
  // Everything after the hello travels over this private port, so a page the
  // frame later navigates to inherits neither the port nor the nonce.
  const port = new MessageChannel();
  const post = (message) => port.port1.postMessage(message);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    post({ kind: "request", id, method, params });
  });
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const compact = (value) => {
    const out = {};
    for (const key of Object.keys(value)) if (value[key] !== undefined) out[key] = value[key];
    return out;
  };

  let state = clone(init.state) || {};
  let writes = Promise.resolve();
  const persist = (next) => {
    state = next;
    const snapshot = clone(next);
    const run = writes.then(() => request("state", { state: snapshot }));
    writes = run.catch(() => {});
    return run;
  };

  let theme = init.theme;
  const themeListeners = new Set();
  const applyTheme = (theme) => {
    const root = document.documentElement;
    for (const name of Object.keys(theme.vars)) root.style.setProperty(name, theme.vars[name]);
    root.style.colorScheme = theme.scheme;
    root.classList.toggle("dark", theme.scheme === "dark");
  };

  const deniz = {
    surface: Object.freeze(Object.assign({}, init.surface)),
    assets: Object.freeze(Object.assign({}, init.assets)),
    asset(name) { return Object.prototype.hasOwnProperty.call(init.assets, name) ? init.assets[name] : null; },
    get theme() { return theme; },
    onTheme(fn) { themeListeners.add(fn); return () => themeListeners.delete(fn); },
    call(tool, args) { return request("call", { tool, args: args || {} }); },
    read(resource, operation, args) { return deniz.call("catalog_read", compact({ resource, operation, args })); },
    write(resource, operation, args) { return deniz.call("catalog_write", compact({ resource, operation, args })); },
    destroy(resource, operation, args) { return deniz.call("catalog_destructive", compact({ resource, operation, args })); },
    search(query, opts) { return deniz.call("catalog_search", Object.assign({}, opts || {}, { query })); },
    describe(resource, operation) { return deniz.call("catalog_describe", compact({ resource, operation })); },
    state: {
      get() { return clone(state); },
      set(next) { return persist(clone(next) || {}); },
      patch(partial) { return persist(Object.assign({}, state, clone(partial) || {})); },
    },
    navigate(path) { return request("navigate", { path: String(path) }); },
    exit() { return request("exit"); },
  };
  Object.defineProperty(window, "deniz", { value: Object.freeze(deniz), configurable: false, writable: false });

  port.port1.onmessage = (event) => {
    const message = event.data;
    if (!message) return;
    if (message.kind === "response") {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.ok) waiting.resolve(message.result);
      else {
        const error = new Error(message.error && message.error.message ? message.error.message : "Request failed");
        error.payload = message.error ? message.error.payload : undefined;
        waiting.reject(error);
      }
    } else if (message.kind === "theme") {
      theme = message.theme;
      applyTheme(theme);
      for (const fn of themeListeners) { try { fn(message.theme); } catch (e) { console.error(e); } }
    }
  };
  parent.postMessage({ channel: CHANNEL, kind: "hello", nonce: init.nonce }, "*", [port.port2]);

  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.shiftKey && event.code === "KeyE") { event.preventDefault(); post({ kind: "exit" }); }
    else if (!event.shiftKey && event.code === "KeyP") { event.preventDefault(); post({ kind: "palette" }); }
  }, true);

  const queue = [];
  let timer = null;
  let reported = 0;
  const flush = () => {
    timer = null;
    const batch = queue.splice(0, 20);
    if (batch.length) post({ kind: "errors", errors: batch });
    if (queue.length) timer = setTimeout(flush, 1000);
  };
  const text = (value) => {
    if (value instanceof Error) return value.message || String(value);
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const report = (message, source) => {
    if (reported >= 200) return;
    reported++;
    const entry = { message: String(message || "Error").slice(0, 2000) };
    if (source) entry.source = String(source).slice(0, 500);
    queue.push(entry);
    if (!timer) timer = setTimeout(flush, 1000);
  };
  window.addEventListener("error", (event) => {
    if (event instanceof ErrorEvent) {
      report(event.error ? text(event.error) : event.message, event.filename ? event.filename + ":" + event.lineno + ":" + event.colno : undefined);
    } else if (event.target && event.target !== window) {
      const el = event.target;
      report("Failed to load " + (el.src || el.href || el.tagName), el.tagName ? el.tagName.toLowerCase() : undefined);
    }
  }, true);
  window.addEventListener("unhandledrejection", (event) => report(text(event.reason), "unhandledrejection"));
  const consoleError = console.error.bind(console);
  console.error = (...args) => {
    consoleError(...args);
    report(args.map(text).join(" "), "console.error");
  };
})();
`;

/** The frame's whole document: theme on :root, the surface's head and css, the bridge, its body and script. */
export function surfaceDocument(input: SurfaceDocumentInput): string {
  const sub = (source: string) => replaceAssetTokens(source, input.assets);
  const init = inlineJson({
    nonce: input.nonce,
    surface: input.surface,
    assets: input.assets,
    state: input.state,
    theme: input.theme,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${rootRule(input.theme)}
html, body { margin: 0; min-height: 100%; background: var(--background); color: var(--foreground); font-family: var(--theme-font-body, system-ui, sans-serif); }
* { box-sizing: border-box; }</style><script>${escapeScript(BRIDGE.replace("__INIT__", () => init))}</script>${sub(input.head)}<style>${escapeStyle(sub(input.css))}</style></head><body>${sub(input.html)}<script>${escapeScript(sub(input.js))}</script></body></html>`;
}

const errorEntrySchema = z.object({
  message: z.string().min(1).max(2000),
  source: z.string().max(500).optional(),
});
export type SurfaceErrorEntry = z.infer<typeof errorEntrySchema>;

/** The one window message a document sends: its nonce, with the port transferred. */
export const surfaceHelloSchema = z.object({
  channel: z.literal(SURFACE_CHANNEL),
  kind: z.literal("hello"),
  nonce: z.string(),
});

/** Everything the frame may say over its port. Anything else is dropped. */
export const surfaceInboundSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("request"),
    id: z.number().int().positive(),
    method: z.enum(["call", "state", "navigate", "exit"]),
    params: z.unknown(),
  }),
  z.object({
    kind: z.literal("errors"),
    errors: z.array(errorEntrySchema).min(1).max(20),
  }),
  z.object({ kind: z.literal("exit") }),
  z.object({ kind: z.literal("palette") }),
]);
export type SurfaceInbound = z.infer<typeof surfaceInboundSchema>;

export const navigateParamsSchema = z.object({
  path: z.string().max(2000),
});

const PATH_BASE = "http://surface.invalid";

/**
 * A bridge path under the dashboard root; anything that would leave it —
 * another origin, a scheme, or dot segments, percent-encoded or not — lands
 * on the root.
 */
export function dashboardPath(root: string, path: string): string {
  const trimmed = path.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[\\/]{2}/.test(trimmed)) {
    return root;
  }
  const underRoot =
    trimmed === root ||
    trimmed.startsWith(`${root}/`) ||
    trimmed.startsWith(`${root}?`) ||
    trimmed.startsWith(`${root}#`);
  const relative = underRoot ? trimmed.slice(root.length) : trimmed;
  const candidate = /^[?#]/.test(relative)
    ? `${root}${relative}`
    : `${root}${relative.startsWith("/") ? "" : "/"}${relative}`;

  let url: URL;
  let decoded: string;
  try {
    url = new URL(candidate, PATH_BASE);
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return root;
  }
  if (url.origin !== PATH_BASE) return root;
  if (/(^|[\\/])\.\.?([\\/]|$)/.test(decoded)) return root;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname !== root && !pathname.startsWith(`${root}/`)) return root;
  return `${pathname}${url.search}${url.hash}`;
}

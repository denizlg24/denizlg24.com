"use client";

import {
  type SurfaceState,
  surfaceCallSchema,
  surfaceStatePutSchema,
  type WorkspaceSurface,
} from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAdmin } from "../../provider";
import { useActiveTheme } from "../appearance/store";
import { THEMED_VARIABLES } from "../appearance/theme-css";
import { OPEN_COMMAND_PALETTE } from "../sidebar";
import {
  dashboardPath,
  navigateParamsSchema,
  SURFACE_CHANNEL,
  SURFACE_SANDBOX,
  type SurfaceErrorEntry,
  type SurfaceTheme,
  surfaceDocument,
  surfaceInboundSchema,
} from "./document";
import { useSurfaceStore } from "./store";

export type SurfaceFrameSource = Pick<
  WorkspaceSurface,
  "name" | "mount" | "head" | "html" | "css" | "js" | "assets" | "state"
> & {
  /** Empty for a surface not saved yet: bridge calls then refuse. */
  id: string;
  /** Stamped on error batches so the server can drop reports from older code. */
  rev: number;
};

const FONT_VARIABLES = ["--theme-font-body", "--theme-font-heading"];

function readTheme(): SurfaceTheme {
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const vars: Record<string, string> = {};
  for (const name of THEMED_VARIABLES) {
    const value = root.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  for (const name of FONT_VARIABLES) {
    const value = body.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  return {
    scheme: document.documentElement.classList.contains("dark")
      ? "dark"
      : "light",
    vars,
  };
}

function toolErrorMessage(result: unknown): string {
  if (typeof result === "object" && result !== null) {
    if ("error" in result && typeof result.error === "string") {
      return result.error;
    }
    if ("message" in result && typeof result.message === "string") {
      return result.message;
    }
  }
  return typeof result === "string" && result ? result : "Tool call failed";
}

type Outcome =
  | { ok: true; result: unknown }
  | { ok: false; error: { message: string; payload?: unknown } };

function failure(error: unknown): Outcome {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : "Request failed",
    },
  };
}

/**
 * Runs a surface: its document in a sandboxed frame (scripts, forms, popups —
 * never same-origin), and the host side of `window.deniz`. Every bridge
 * request is answered here with the owner's own client; the frame never holds
 * a credential.
 *
 * `preview` keeps state in memory, reports errors only to `onErrors`, and
 * ignores navigation, so editing never touches the saved surface's state.
 */
export function SurfaceFrame({
  surface,
  mode = "live",
  onErrors,
  onExit,
  className,
}: {
  surface: SurfaceFrameSource;
  mode?: "live" | "preview";
  onErrors?: (errors: SurfaceErrorEntry[]) => void;
  onExit?: () => void;
  className?: string;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const theme = useActiveTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<{ nonce: string; html: string } | null>(null);

  const stateRef = useRef<SurfaceState>(surface.state);
  const revRef = useRef(surface.rev);
  const nonceRef = useRef<string | null>(null);
  const handlers = useRef({ mode, onErrors, onExit });
  useEffect(() => {
    handlers.current = { mode, onErrors, onExit };
  });

  const { id, name, mount, head, html, css, js } = surface;
  const assets: Record<string, string> = Object.fromEntries(
    surface.assets.map((asset) => [asset.name, asset.url]),
  );
  const assetsKey = JSON.stringify(assets);
  const mountKey = JSON.stringify(mount);

  // The document is rebuilt only when code or assets change. State and theme
  // are read at build time and travel over the bridge afterwards, so neither
  // a state write nor a theme switch reloads the app.
  useEffect(() => {
    const nonce = crypto.randomUUID();
    setDoc({
      nonce,
      html: surfaceDocument({
        nonce,
        surface: { id, name, mount },
        head,
        html,
        css,
        js,
        assets,
        state: stateRef.current,
        theme: readTheme(),
      }),
    });
  }, [id, name, mountKey, head, html, css, js, assetsKey]);

  useEffect(() => {
    if (handlers.current.mode === "live") stateRef.current = surface.state;
  }, [surface.state]);

  useEffect(() => {
    revRef.current = surface.rev;
  }, [surface.rev]);

  useEffect(() => {
    nonceRef.current = doc?.nonce ?? null;
  }, [doc]);

  const postTheme = () => {
    if (!nonceRef.current) return;
    frame.current?.contentWindow?.postMessage(
      {
        channel: SURFACE_CHANNEL,
        nonce: nonceRef.current,
        kind: "theme",
        theme: readTheme(),
      },
      "*",
    );
  };

  useEffect(() => {
    postTheme();
  }, [theme]);

  useEffect(() => {
    if (!doc) return;
    const nonce = doc.nonce;
    const store = useSurfaceStore.getState();

    // Answered on the window that asked, and only while it still shows the
    // document that asked: request ids restart at 1 in every rebuilt frame.
    const respond = (target: Window, requestId: number, outcome: Outcome) => {
      if (
        frame.current?.contentWindow !== target ||
        nonceRef.current !== nonce
      ) {
        return;
      }
      target.postMessage(
        {
          channel: SURFACE_CHANNEL,
          nonce,
          kind: "response",
          id: requestId,
          ...outcome,
        },
        "*",
      );
    };

    const handle = async (
      method: string,
      params: unknown,
    ): Promise<Outcome> => {
      const live = handlers.current.mode === "live";
      switch (method) {
        case "call": {
          const parsed = surfaceCallSchema.safeParse(params);
          if (!parsed.success) {
            return failure(new Error(parsed.error.issues[0]?.message));
          }
          if (!id) return failure(new Error("Surface is not saved"));
          const { isError, result } = await store.call(
            client,
            id,
            parsed.data.tool,
            parsed.data.args,
          );
          return isError
            ? {
                ok: false,
                error: { message: toolErrorMessage(result), payload: result },
              }
            : { ok: true, result };
        }
        case "state": {
          const parsed = surfaceStatePutSchema.safeParse(params);
          if (!parsed.success) {
            return failure(new Error(parsed.error.issues[0]?.message));
          }
          if (!live || !id) {
            stateRef.current = parsed.data.state;
            return { ok: true, result: parsed.data.state };
          }
          const saved = await store.putState(client, id, parsed.data.state);
          stateRef.current = saved;
          return { ok: true, result: saved };
        }
        case "navigate": {
          const parsed = navigateParamsSchema.safeParse(params);
          if (!parsed.success) return failure(new Error("Invalid path"));
          if (live) {
            router.push(dashboardPath(routes.dashboardRoot, parsed.data.path));
          }
          return { ok: true, result: null };
        }
        case "exit":
          handlers.current.onExit?.();
          return { ok: true, result: null };
        default:
          return failure(new Error(`Unknown method ${method}`));
      }
    };

    const onMessage = (event: MessageEvent) => {
      const contentWindow = frame.current?.contentWindow;
      if (!contentWindow || event.source !== contentWindow) return;
      const raw: unknown = event.data;
      // The frame may navigate itself to any page, which then holds the same
      // window and passes the source check. Only our document knows the nonce.
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("nonce" in raw) ||
        raw.nonce !== nonce
      ) {
        return;
      }
      const parsed = surfaceInboundSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      switch (message.kind) {
        case "request":
          void handle(message.method, message.params)
            .catch(failure)
            .then((outcome) => respond(contentWindow, message.id, outcome));
          return;
        case "errors": {
          const { mode: current, onErrors: report } = handlers.current;
          report?.(message.errors);
          if (current === "live" && id) {
            void store
              .reportErrors(client, id, revRef.current, message.errors)
              .catch((error: unknown) =>
                console.error("Failed to report surface errors:", error),
              );
          }
          return;
        }
        case "exit":
          handlers.current.onExit?.();
          return;
        case "palette":
          window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE));
          return;
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [doc, id, client, router, routes.dashboardRoot]);

  return (
    <div className={cn("relative h-full w-full bg-background", className)}>
      {doc ? (
        <iframe
          key={doc.nonce}
          ref={frame}
          title={name}
          sandbox={SURFACE_SANDBOX}
          allow="fullscreen; clipboard-write"
          srcDoc={doc.html}
          onLoad={postTheme}
          className="block h-full w-full border-0 bg-transparent"
        />
      ) : null}
    </div>
  );
}

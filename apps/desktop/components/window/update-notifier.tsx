"use client";

import { Button } from "@repo/ui/button";
import type { Update } from "@tauri-apps/plugin-updater";
import { ArrowUpRight, Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { checkForUpdate } from "@/lib/updater";

const UPDATE_TOAST_ID = "app-update";

type InstallPhase = "idle" | "downloading" | "installing" | "error";

function formatMegabytes(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function firstNotesLine(body: string | undefined) {
  return body
    ?.split("\n")
    .map((line) => line.replace(/^#+\s*|^[-*]\s*/, "").trim())
    .find((line) => line.length > 0);
}

function UpdateToastContent({
  update,
  toastId,
}: {
  update: Update;
  toastId: string | number;
}) {
  const [phase, setPhase] = useState<InstallPhase>("idle");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notes = firstNotesLine(update.body);
  const busy = phase === "downloading" || phase === "installing";
  const progress = total ? Math.min(received / total, 1) : null;

  const install = async () => {
    setPhase("downloading");
    setError(null);
    setReceived(0);
    let downloaded = 0;

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setTotal(event.data.contentLength ?? null);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setReceived(downloaded);
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="w-full min-w-3xs overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
          <Download className="size-3" />
          Update available
        </span>
        {!busy && (
          <button
            type="button"
            aria-label="Dismiss"
            className="-mr-1 -mt-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
            onClick={() => toast.dismiss(toastId)}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="px-4 pt-2">
        <p className="text-sm font-medium leading-snug text-accent-strong">
          Version {update.version}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {update.currentVersion} &rarr; {update.version}
        </p>
        {notes && phase === "idle" && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground/80">
            {notes}
          </p>
        )}
        {error && (
          <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-destructive">
            {error}
          </p>
        )}
      </div>

      {busy ? (
        <div className="px-4 pb-3.5 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
              <Loader2 className="size-3 animate-spin" />
              {phase === "installing" ? "Installing" : "Downloading"}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {phase === "installing"
                ? "Restarting soon"
                : progress != null
                  ? `${Math.round(progress * 100)}%`
                  : formatMegabytes(received)}
            </span>
          </div>
          <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-foreground transition-[width] duration-200"
              style={{
                width:
                  phase === "installing"
                    ? "100%"
                    : `${Math.round((progress ?? 0) * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 pb-3.5 pt-3">
          <Button size="xs" className="rounded-sm" onClick={install}>
            {phase === "error" ? "Retry" : "Install & restart"}
            <ArrowUpRight />
          </Button>
          <button
            type="button"
            className="border-b px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => toast.dismiss(toastId)}
          >
            Later
          </button>
        </div>
      )}
    </div>
  );
}

export function showUpdateToast(update: Update) {
  toast.custom((id) => <UpdateToastContent update={update} toastId={id} />, {
    id: UPDATE_TOAST_ID,
    duration: Infinity,
  });
}

export function UpdateNotifier() {
  useEffect(() => {
    (async () => {
      try {
        const update = await checkForUpdate();
        if (update) showUpdateToast(update);
      } catch {
        // Silently fail outside Tauri context or when offline
      }
    })();
  }, []);

  return null;
}

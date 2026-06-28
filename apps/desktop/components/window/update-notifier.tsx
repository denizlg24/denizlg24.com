"use client";

import { Button } from "@repo/ui/button";
import { ArrowUpRight, Download, X } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import type { GitHubRelease } from "@/lib/update-checker";
import { fetchLatestRelease, isNewerVersion } from "@/lib/update-checker";

function UpdateToastContent({
  release,
  currentVersion,
  toastId,
  onDownload,
}: {
  release: GitHubRelease;
  currentVersion: string;
  toastId: string | number;
  onDownload: () => void;
}) {
  const nextVersion = release.tag_name.replace(/^v/, "");

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-sm min-w-3xs">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
          <Download className="size-3" />
          Update available
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          className="-mr-1 -mt-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
          onClick={() => toast.dismiss(toastId)}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="px-4 pt-2">
        <p className="text-sm font-medium leading-snug text-accent-strong">
          {release.name || `Version ${nextVersion}`}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {currentVersion} &rarr; {nextVersion}
        </p>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3.5 pt-3">
        <Button size="xs" className="rounded-sm" onClick={onDownload}>
          Download
          <ArrowUpRight />
        </Button>
        <button
          type="button"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground border-b px-2"
          onClick={() => toast.dismiss(toastId)}
        >
          Later
        </button>
      </div>
    </div>
  );
}

export function UpdateNotifier() {
  useEffect(() => {
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const currentVersion = await getVersion();

        const release = await fetchLatestRelease();
        if (!release) return;

        if (isNewerVersion(currentVersion, release.tag_name)) {
          const { open } = await import("@tauri-apps/plugin-shell");

          toast.custom(
            (id) => (
              <UpdateToastContent
                release={release}
                currentVersion={currentVersion}
                toastId={id}
                onDownload={() => open(release.html_url)}
              />
            ),
            { duration: Infinity },
          );
        }
      } catch {
        // Silently fail outside Tauri context
      }
    })();
  }, []);

  return null;
}

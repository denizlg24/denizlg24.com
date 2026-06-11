"use client";

import { ArrowDownToLine, X } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { GitHubRelease } from "@/lib/update-checker";
import { fetchLatestRelease, isNewerVersion } from "@/lib/update-checker";

function UpdateToastContent({
  release,
  toastId,
  onDownload,
}: {
  release: GitHubRelease;
  toastId: string | number;
  onDownload: () => void;
}) {
  return (
    <Card className="w-full py-0 shadow-md">
      <CardContent className="flex items-start gap-3 p-4">
        <ArrowDownToLine className="size-5 text-accent-strong mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-accent-strong font-semibold">
            {release.name || `Update ${release.tag_name} available`}
          </p>
          <p className="text-muted-foreground text-sm mt-1">
            A new version is available.
          </p>
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" onClick={onDownload}>
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.dismiss(toastId)}
            >
              Dismiss
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="text-foreground hover:text-accent transition-colors shrink-0"
          onClick={() => toast.dismiss(toastId)}
        >
          <X className="size-4" />
        </button>
      </CardContent>
    </Card>
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
                toastId={id}
                onDownload={() => open(release.html_url)}
              />
            ),
            { duration: 10000 },
          );
        }
      } catch {
        // Silently fail outside Tauri context
      }
    })();
  }, []);

  return null;
}

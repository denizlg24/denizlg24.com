"use client";

import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import { Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { showUpdateToast } from "@/components/window/update-notifier";
import { isTauri } from "@/lib/platform";
import { checkForUpdate } from "@/lib/updater";

type CheckState = "idle" | "checking" | "latest" | "error";

export function UpdateSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<CheckState>("idle");

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setVersion(await getVersion());
      } catch {}
    })();
  }, []);

  if (!isTauri()) return null;

  const handleCheck = async () => {
    setState("checking");
    try {
      const update = await checkForUpdate();
      if (update) {
        setState("idle");
        showUpdateToast(update);
      } else {
        setState("latest");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex flex-col gap-1 shrink-0">
        <Label className="text-sm font-medium">
          App version
          {version && (
            <span className="ml-1.5 tabular-nums text-muted-foreground">
              v{version}
            </span>
          )}
        </Label>
        <p className="text-xs text-muted-foreground">
          Updates download and install in place, then restart the app.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {state === "latest" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3" />
            Up to date
          </span>
        )}
        {state === "error" && (
          <span className="text-xs text-destructive">Check failed</span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-xs"
          onClick={handleCheck}
          disabled={state === "checking"}
        >
          {state === "checking" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Check for updates
        </Button>
      </div>
    </div>
  );
}

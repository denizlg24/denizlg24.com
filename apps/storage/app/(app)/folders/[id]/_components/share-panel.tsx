"use client";

import type { ShareExpiresIn } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { CopyButton, useCopy } from "@repo/ui/copy-button";
import { cn } from "@repo/ui/utils";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { APP_URL } from "@/lib/env";

const PRESETS: { value: ShareExpiresIn; label: string }[] = [
  { label: "30 min", value: "30m" },
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "No expiry", value: "never" },
];

/**
 * One click on a duration mints the link and puts it on the clipboard — there
 * is no second "create" step to forget.
 */
export function SharePanel({
  fileId,
  filename,
}: {
  fileId: string;
  filename: string;
}) {
  const [expiry, setExpiry] = useState<ShareExpiresIn | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, failed, copy } = useCopy(2_000);

  const create = async (value: ShareExpiresIn) => {
    setBusy(true);
    setError(null);
    setExpiry(value);
    setLink(null);
    try {
      const { token } = await api.createShare(fileId, value);
      const url = `${APP_URL}/s/${token}`;
      setLink(url);
      await copy(url);
    } catch (err) {
      setExpiry(null);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="truncate text-sm font-medium" title={filename}>
        {filename}
      </p>

      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            disabled={busy}
            onClick={() => void create(preset.value)}
            className={cn(
              "rounded border px-2 py-1 text-xs transition-colors disabled:opacity-60",
              expiry === preset.value
                ? "border-foreground/40 bg-muted font-medium"
                : "hover:bg-muted/60",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {busy && <p className="text-xs text-muted-foreground">Creating link…</p>}

      {link && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <input
              readOnly
              value={link}
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded border bg-muted/40 px-2 py-1 font-mono text-xs outline-none"
            />
            <CopyButton value={link} label="Copy share link" />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="Open link"
              asChild
            >
              <a href={link} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {copied && "copied · "}
            {expiry === "never"
              ? "no expiry"
              : `expires in ${PRESETS.find((preset) => preset.value === expiry)?.label.toLowerCase()}`}
          </p>
        </div>
      )}

      {failed && (
        <p className="text-xs text-destructive" role="alert">
          Clipboard unavailable — select the link to copy it
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

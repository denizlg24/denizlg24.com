"use client";

import {
  FORGE_PREVIEW_SHARE_QUERY,
  type ShareExpiresIn,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { useCopy } from "@repo/ui/copy-button";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { ExternalLink, Share2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";

const EXPIRIES: { value: ShareExpiresIn; label: string }[] = [
  { value: "30m", label: "30 minutes" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "No expiry" },
];

export function PreviewShare({
  deploymentId,
  hostname,
}: {
  deploymentId: string;
  hostname: string;
}) {
  const [busy, setBusy] = useState<ShareExpiresIn | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copied, failed, copy } = useCopy(2_000);

  const create = async (expiresIn: ShareExpiresIn) => {
    setBusy(expiresIn);
    setError(null);
    try {
      const { token } = await api.forge.createPreviewShare(
        deploymentId,
        expiresIn,
      );
      const url = new URL(`https://${hostname}/`);
      url.searchParams.set(FORGE_PREVIEW_SHARE_QUERY, token);
      const value = url.toString();
      setLink(value);
      await copy(value);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Share2 className="size-3.5" />
          share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-xs font-medium">Share preview</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Anyone with the link can browse this deployment until it expires.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1">
          {EXPIRIES.map((expiry) => (
            <button
              key={expiry.value}
              type="button"
              disabled={busy !== null}
              onClick={() => void create(expiry.value)}
              className="rounded border px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-60"
            >
              {busy === expiry.value ? "creating…" : expiry.label}
            </button>
          ))}
        </div>
        {link ? (
          <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs">
            <span className="min-w-0 flex-1 text-muted-foreground">
              {copied ? "copied to clipboard" : "link created"}
            </span>
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 hover:underline"
            >
              open <ExternalLink className="size-3" />
            </a>
          </div>
        ) : null}
        {failed ? (
          <p className="mt-2 text-xs text-destructive">
            Clipboard unavailable — open the link and copy its address.
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

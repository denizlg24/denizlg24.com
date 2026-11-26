"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Link2, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyText, setShared } from "./actions";

export function ShareControl({
  id,
  shareUrl,
  previewUrl,
  compact = false,
  onChange,
}: {
  id: string;
  shareUrl: string | null;
  previewUrl?: string;
  compact?: boolean;
  onChange?: (shareUrl: string | null) => void;
}) {
  const [url, setUrl] = useState(shareUrl);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function toggle(share: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await setShared(id, share);
      setUrl(result.shareUrl);
      onChange?.(result.shareUrl);
      if (share && result.shareUrl && (await copyText(result.shareUrl)))
        flash();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Sharing failed.");
    } finally {
      setBusy(false);
    }
  }

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <span className="share-control">
      {previewUrl ? (
        <Button asChild variant="outline" size={compact ? "xs" : "sm"}>
          <a href={previewUrl} target="_blank" rel="noopener">
            <ExternalLink aria-hidden /> Open
          </a>
        </Button>
      ) : null}
      {url ? (
        <>
          <Button
            variant="outline"
            size={compact ? "xs" : "sm"}
            onClick={async () => {
              if (await copyText(url)) flash();
              else setError("Copy failed. Select the link instead.");
            }}
          >
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            variant="ghost"
            size={compact ? "xs" : "sm"}
            onClick={() => void toggle(false)}
            disabled={busy}
          >
            <Link2Off aria-hidden /> Stop sharing
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size={compact ? "xs" : "sm"}
          onClick={() => void toggle(true)}
          disabled={busy}
        >
          <Link2 aria-hidden /> {busy ? "Creating link…" : "Share link"}
        </Button>
      )}
      {error ? (
        <span className="negative share-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

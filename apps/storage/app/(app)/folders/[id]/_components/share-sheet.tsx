"use client";

import type { ShareExpiresIn } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { CopyButton, useCopy } from "@repo/ui/copy-button";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { APP_URL } from "@/lib/env";

const EXPIRIES: { value: ShareExpiresIn; label: string }[] = [
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "Never", value: "never" },
];

/**
 * Sharing is one sheet for a file: choose how long the link lives, copy it.
 * Creating happens on "Copy link" — there is no second step to forget.
 */
export function ShareSheet({
  fileId,
  filename,
}: {
  fileId: string;
  filename: string;
}) {
  const [expiry, setExpiry] = useState<ShareExpiresIn>("7d");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, failed, copy } = useCopy(2_000);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.createShare(fileId, expiry);
      const url = `${APP_URL}/s/${token}`;
      setLink(url);
      await copy(url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Anyone with the link can view and download{" "}
        <span className="font-medium text-foreground">{filename}</span>. You can
        share it in a message, an email, wherever you like.
      </p>

      <div className="grid grid-cols-[1fr_auto] items-center gap-3">
        <Label htmlFor="share-expiry" className="text-sm">
          Link expires
        </Label>
        <Select
          value={expiry}
          onValueChange={(value) => setExpiry(value as ShareExpiresIn)}
          disabled={busy || link !== null}
        >
          <SelectTrigger id="share-expiry" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRIES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {link ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <input
              readOnly
              value={link}
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-sm outline-none"
            />
            <CopyButton value={link} label="Copy share link" />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Open link"
              asChild
            >
              <a href={link} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {copied && <Check className="size-3.5 text-status-good" />}
            {copied ? "Copied. " : ""}
            {expiry === "never"
              ? "This link never expires."
              : `This link stops working in ${EXPIRIES.find((option) => option.value === expiry)?.label.toLowerCase()}.`}
          </p>
        </div>
      ) : (
        <Button
          onClick={() => void create()}
          disabled={busy}
          className="self-start"
        >
          {busy ? "Creating link…" : "Copy link"}
        </Button>
      )}

      {failed && (
        <p className="text-sm text-destructive" role="alert">
          Couldn't copy automatically — select the link and copy it yourself.
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

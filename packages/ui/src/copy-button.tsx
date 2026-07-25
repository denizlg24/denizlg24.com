"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { cn } from "./utils";

// navigator.clipboard is undefined outside secure contexts and writeText
// rejects when permission is denied. Callers show secrets that are displayed
// exactly once, so a failed write has to surface instead of flashing a tick.
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        setCopied(false);
        setFailed(true);
        return false;
      }
      setFailed(false);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      if (resetMs > 0) {
        timer.current = setTimeout(() => setCopied(false), resetMs);
      }
      return true;
    },
    [resetMs],
  );

  return { copied, failed, copy };
}

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { copied, failed, copy } = useCopy();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={failed ? "Clipboard unavailable" : label}
      className={cn("size-7 shrink-0", className)}
      onClick={() => void copy(value)}
    >
      {copied ? (
        <Check className="size-3.5 text-status-good" />
      ) : (
        <Copy className={cn("size-3.5", failed && "text-destructive")} />
      )}
    </Button>
  );
}

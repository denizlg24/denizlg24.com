"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  // navigator.clipboard is undefined outside secure contexts and writeText
  // rejects when permission is denied; silently showing the copied tick would
  // let a secret be lost.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast.error("Copy failed — clipboard unavailable");
      return;
    }
    setCopied(true);
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7 shrink-0", className)}
      onClick={() => void copy()}
    >
      {copied ? (
        <Check className="size-3.5 text-status-good" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  );
}

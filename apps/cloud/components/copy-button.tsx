"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7 shrink-0", className)}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-status-good" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  );
}

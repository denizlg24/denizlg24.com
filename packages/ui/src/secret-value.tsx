"use client";

import { CopyButton } from "./copy-button";

export function SecretValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
          {value}
        </code>
        <CopyButton value={value} label={`Copy ${label}`} />
      </div>
    </div>
  );
}

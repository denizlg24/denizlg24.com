import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import {
  Check,
  CloudOff,
  Copy,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { copyText } from "../lib/clipboard";
import { formatCode, type GeneratedCode } from "../lib/totp";
import type { VaultEntry } from "../lib/types";
import { CountdownRing } from "./countdown-ring";

interface AccountRowProps {
  entry: VaultEntry;
  code: GeneratedCode | undefined;
  onEdit: () => void;
  onDelete: () => void;
}

export function AccountRow({ entry, code, onEdit, onDelete }: AccountRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!code) return;
    await copyText(code.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex items-center gap-2 px-3 py-2.5 border-b border-border/50 hover:bg-surface/50 transition-colors select-none">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-accent-strong truncate">
            {entry.label}
          </span>
          {(entry.pendingPush || !entry.serverId) && (
            <CloudOff
              className="size-3 shrink-0 text-muted-foreground/60"
              aria-label="Not yet synced"
            />
          )}
        </div>
        {entry.accountName && (
          <p className="text-[11px] text-muted-foreground/60 truncate">
            {entry.accountName}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        disabled={!code}
        aria-label={`Copy code for ${entry.label}`}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity disabled:cursor-default"
      >
        <span className="font-mono text-base tabular-nums tracking-[0.12em] text-accent-strong font-medium">
          {code ? formatCode(code.code) : "------"}
        </span>
        {copied ? (
          <Check className="size-3.5 text-accent" />
        ) : (
          <Copy className="size-3.5 text-muted-foreground/50" />
        )}
      </button>

      {code && (
        <CountdownRing remaining={code.remaining} period={code.period} />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${entry.label}`}
            className="size-7 shrink-0 text-muted-foreground"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-3.5 mr-2" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

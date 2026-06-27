"use client";

import type { IAuthenticatorAccount, IAuthenticatorCode } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Check, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAdmin } from "../provider";
import { CountdownRing } from "./countdown-ring";

interface AuthenticatorAccountRowProps {
  account: IAuthenticatorAccount;
  codeData: IAuthenticatorCode | undefined;
  onEdit: () => void;
  onDelete: () => void;
}

export function AuthenticatorAccountRow({
  account,
  codeData,
  onEdit,
  onDelete,
}: AuthenticatorAccountRowProps) {
  const { platform } = useAdmin();
  const [copied, setCopied] = useState(false);

  const code = codeData?.code ?? "------";
  const formattedCode = `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;

  const handleCopy = async () => {
    if (!codeData) return;
    await platform.copyText(codeData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-surface/50 transition-colors select-none sm:gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-accent-strong truncate">
            {account.label}
          </span>
          {account.accountName && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              {account.accountName}
            </span>
          )}
        </div>
        {account.issuer && account.issuer !== account.label && (
          <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">
            {account.issuer}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy code for ${account.label}`}
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity sm:gap-3"
      >
        <span className="font-mono text-lg tabular-nums tracking-[0.15em] text-accent-strong font-medium">
          {formattedCode}
        </span>
        {copied ? (
          <Check className="size-4 text-accent" />
        ) : (
          <Copy className="size-4 text-muted-foreground/50" />
        )}
      </button>

      {codeData && (
        <CountdownRing
          remaining={codeData.remaining}
          period={codeData.period}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Account actions"
            className="size-8 shrink-0 text-muted-foreground"
          >
            <MoreHorizontal className="size-4" />
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

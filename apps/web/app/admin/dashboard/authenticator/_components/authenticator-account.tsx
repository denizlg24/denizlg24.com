"use client";

import { Check, Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { IAuthenticatorAccount, IAuthenticatorCode } from "../types";
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
  const [copied, setCopied] = useState(false);

  const code = codeData?.code ?? "------";
  const formattedCode = `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;

  const handleCopy = async () => {
    if (!codeData) return;
    await navigator.clipboard.writeText(codeData.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex items-center gap-4 px-4 py-3 border-b border-border/50 hover:bg-surface/50 transition-colors select-none">
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
        className="flex items-center gap-3 cursor-pointer group/code hover:opacity-80 transition-opacity"
      >
        <span className="font-mono text-lg tabular-nums tracking-[0.15em] text-accent-strong font-medium">
          {formattedCode}
        </span>
        {copied ? (
          <Check className="size-3.5 text-accent" />
        ) : (
          <Copy className="size-3.5 text-muted-foreground opacity-0 group-hover/code:opacity-100 transition-opacity" />
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
            className="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
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

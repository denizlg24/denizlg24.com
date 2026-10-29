"use client";

import type { IAuthenticatorAccount, IAuthenticatorCode } from "@repo/schemas";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { ListRow } from "@repo/ui/list";
import { RowActions } from "@repo/ui/toolbar";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const code = codeData?.code ?? "------";
  const half = Math.ceil(code.length / 2);
  const formattedCode = `${code.slice(0, half)} ${code.slice(half)}`;

  const handleCopy = async () => {
    if (!codeData) return;
    try {
      await platform.copyText(codeData.code);
    } catch {
      toast.error("Copy failed");
      return;
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const subtitle = [
    account.issuer && account.issuer !== account.label ? account.issuer : null,
    account.accountName || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListRow
      onClick={handleCopy}
      aria-label={`Copy code for ${account.label}`}
      className="select-none py-2.5"
      title={<span className="font-medium">{account.label}</span>}
      description={subtitle || undefined}
      meta={
        <>
          <span className="font-mono text-lg font-medium tracking-[0.15em] text-accent-strong">
            {formattedCode}
          </span>
          {copied ? (
            <Check className="size-4 text-status-good" />
          ) : (
            <Copy className="size-4 opacity-0 transition-opacity group-hover/row:opacity-100" />
          )}
        </>
      }
      trailing={
        // Menu items portal out, but React still bubbles their clicks to the row.
        <span
          className="flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {codeData && (
            <CountdownRing
              remaining={codeData.remaining}
              period={codeData.period}
              size={28}
            />
          )}
          <RowActions label="Account actions">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </RowActions>
        </span>
      }
    />
  );
}

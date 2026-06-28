"use client";

import type { IEmailAccount } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@repo/ui/tooltip";
import { cn } from "@repo/ui/utils";
import { Inbox, Loader2, Plus, RefreshCw, Settings } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

interface AccountSidebarProps {
  accounts: IEmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  onShowAllAccounts: () => void;
  loading: boolean;
  onSyncComplete: () => void;
  onAddAccount: () => void;
  onEditAccount: (account: IEmailAccount) => void;
}

export function AccountSidebar({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onShowAllAccounts,
  loading,
  onSyncComplete,
  onAddAccount,
  onEditAccount,
}: AccountSidebarProps) {
  const { client } = useAdmin();
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSync = async (accountId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (syncingId) return;

    setSyncingId(accountId);
    try {
      await client.post<{ message: string }>(
        `email-accounts/${accountId}/sync`,
        {},
      );
      toast.success("Sync complete");
      onSyncComplete();
    } catch {
      toast.error("Failed to sync");
    }
    setSyncingId(null);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="hidden w-60 shrink-0 border-r flex-col h-full md:flex min-h-[calc(100vh-3rem)]">
        <div className="p-3 pb-0">
          <button
            type="button"
            onClick={onShowAllAccounts}
            className={cn(
              "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm font-medium transition-colors",
              selectedAccountId === null
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            <Inbox className="h-4 w-4 shrink-0" />
            All Inboxes
          </button>
        </div>

        <div className="px-3 py-1.5">
          <span className="px-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Accounts
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2.5 py-4">
              No accounts configured
            </p>
          ) : (
            <div className="space-y-0.5">
              {accounts.map((account) => {
                const isActive = selectedAccountId === account._id;
                const isSyncing = syncingId === account._id;

                return (
                  <div
                    key={account._id}
                    className={cn(
                      "group flex items-center gap-1 w-full px-2.5 py-2 rounded-md text-sm transition-colors cursor-pointer",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                    onClick={() => onSelectAccount(account._id)}
                  >
                    <div
                      className={cn(
                        "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {account.user[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm leading-tight">
                        {account.user.split("@")[0]}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground leading-tight mt-0.5">
                        {account.user}
                      </p>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditAccount(account);
                          }}
                        >
                          <Settings className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Edit</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 shrink-0"
                          onClick={(e) => handleSync(account._id, e)}
                          disabled={isSyncing}
                        >
                          {isSyncing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Sync</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-3 border-t shrink-0">
          <button
            type="button"
            onClick={onAddAccount}
            className="flex items-center gap-2 w-full px-2.5 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Account
          </button>
        </div>
      </div>
    </TooltipProvider>
  );
}

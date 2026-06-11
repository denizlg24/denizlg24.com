"use client";

import { Inbox, Loader2, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { denizApi } from "@/lib/api-wrapper";
import type { IEmailAccount } from "@/lib/data-types";
import { cn } from "@/lib/utils";

interface AccountSidebarProps {
  accounts: IEmailAccount[];
  selectedAccountId: string | null;
  onSelectAccount: (id: string) => void;
  onShowAllAccounts: () => void;
  loading: boolean;
  api: denizApi | null;
  onSyncComplete: () => void;
  onAddAccount: () => void;
}

export function AccountSidebar({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onShowAllAccounts,
  loading,
  api,
  onSyncComplete,
  onAddAccount,
}: AccountSidebarProps) {
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSync = async (accountId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!api || syncingId) return;

    setSyncingId(accountId);
    const result = await api.POST<{ message: string }>({
      endpoint: `email-accounts/${accountId}/sync`,
      body: {},
    });

    if ("code" in result) {
      toast.error("Failed to sync");
    } else {
      toast.success("Sync complete");
      onSyncComplete();
    }
    setSyncingId(null);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="w-56 shrink-0 border-r flex flex-col h-full">
        <div className="p-3 pb-2">
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
                      "group flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm transition-colors cursor-pointer",
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
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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

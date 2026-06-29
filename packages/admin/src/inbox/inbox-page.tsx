"use client";

import type {
  IEmail,
  IEmailAccount,
  IEmailAttachment,
  IFullEmail,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Inbox, Loader2, Mail, Pencil, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { AccountSidebar } from "./account-sidebar";
import { AddAccountDialog } from "./add-account-dialog";
import { ComposeDialog } from "./compose-dialog";
import { EmailDetail } from "./email-detail";
import { EmailList } from "./email-list";

export function InboxSkeleton() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function InboxPage() {
  const { client, slots } = useAdmin();

  const [accounts, setAccounts] = useState<IEmailAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const [selectedEmail, setSelectedEmail] = useState<IEmail | null>(null);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReplyTo, setComposeReplyTo] = useState<
    { address: string; subject: string } | undefined
  >(undefined);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const emailCache = useRef<Map<string, IFullEmail>>(new Map());
  const attachmentCache = useRef<Map<string, IEmailAttachment[]>>(new Map());
  const emailListCache = useRef<Map<string, IEmail[]>>(new Map());
  const didInitialSelect = useRef(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const result = await client.get<{ accounts: IEmailAccount[] }>(
        "email-accounts",
      );
      setAccounts(result.accounts);
      if (!didInitialSelect.current && result.accounts.length > 0) {
        didInitialSelect.current = true;
        setSelectedAccountId(result.accounts[0]._id);
      }
    } catch {
      // leave accounts as-is on failure
    } finally {
      setLoadingAccounts(false);
    }
  }, [client]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleSelectAccount = (id: string) => {
    setSelectedAccountId(id);
    setSelectedEmail(null);
  };

  const handleSelectEmail = (email: IEmail) => {
    setSelectedEmail(email);
  };

  const handleBack = () => {
    setSelectedEmail(null);
  };

  const handleCompose = (replyTo?: { address: string; subject: string }) => {
    setComposeReplyTo(replyTo);
    setComposeOpen(true);
  };

  const handleSyncComplete = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const selectedAccount = accounts.find((a) => a._id === selectedAccountId);

  return (
    <div className="flex h-full">
      <AccountSidebar
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelectAccount={handleSelectAccount}
        onShowAllAccounts={() => {
          setSelectedAccountId(null);
          setSelectedEmail(null);
        }}
        loading={loadingAccounts}
        onSyncComplete={handleSyncComplete}
        onAddAccount={() => setAddAccountOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col h-full">
        {selectedEmail && selectedAccountId ? (
          <EmailDetail
            email={selectedEmail}
            accountId={selectedAccountId}
            onBack={handleBack}
            onCompose={handleCompose}
            emailCache={emailCache}
            attachmentCache={attachmentCache}
          />
        ) : selectedAccountId && selectedAccount ? (
          <div className="flex flex-col h-full">
            <EmailList
              accountId={selectedAccountId}
              accountName={selectedAccount.user}
              onSelectEmail={handleSelectEmail}
              selectedEmailId={selectedEmail?._id ?? null}
              refreshTrigger={refreshTrigger}
              emailListCache={emailListCache}
              onBack={() => setSelectedAccountId(null)}
            />

            <div className="absolute bottom-6 right-6">
              <Button
                size="lg"
                className="rounded-full h-12 w-12 shadow-lg"
                onClick={() => handleCompose()}
              >
                <Pencil className="h-5 w-5" />
              </Button>
            </div>
          </div>
        ) : (
          <AccountsOverview
            accounts={accounts}
            loading={loadingAccounts}
            onSelectAccount={handleSelectAccount}
            onSyncComplete={handleSyncComplete}
            onCompose={() => handleCompose()}
          />
        )}
      </div>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        replyTo={composeReplyTo}
      />

      <AddAccountDialog
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
        onAccountAdded={fetchAccounts}
      />
    </div>
  );
}

function AccountsOverview({
  accounts,
  loading,
  onSelectAccount,
  onSyncComplete,
  onCompose,
}: {
  accounts: IEmailAccount[];
  loading: boolean;
  onSelectAccount: (id: string) => void;
  onSyncComplete: () => void;
  onCompose: () => void;
}) {
  const { client, slots } = useAdmin();
  const [syncingAll, setSyncingAll] = useState(false);

  const handleSyncAll = async () => {
    setSyncingAll(true);
    let succeeded = 0;
    let failed = 0;

    for (const account of accounts) {
      try {
        await client.post<{ message: string }>(
          `email-accounts/${account._id}/sync`,
          {},
        );
        succeeded++;
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      toast.success(`Synced ${succeeded} account${succeeded !== 1 ? "s" : ""}`);
    } else {
      toast.warning(`${succeeded} synced, ${failed} failed`);
    }
    onSyncComplete();
    setSyncingAll(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 py-3 border-b shrink-0 sm:px-6">
        <div className="flex items-center gap-2">
          {slots?.sidebarTrigger}
          <div>
            <h1 className="text-sm font-semibold">All Inboxes</h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {accounts.length} account{accounts.length !== 1 && "s"} connected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleSyncAll}
            disabled={syncingAll || accounts.length === 0}
          >
            {syncingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Sync All</span>
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onCompose}>
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Compose</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Inbox className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No email accounts</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Add email accounts from the web dashboard to start viewing your
                inbox here.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 sm:p-6">
            <div className="space-y-1">
              {accounts.map((account) => (
                <button
                  type="button"
                  key={account._id}
                  onClick={() => onSelectAccount(account._id)}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-lg hover:bg-muted/50 transition-colors text-left group"
                >
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
                    {account.user[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{account.user}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {account.host} &middot; {account.inboxName}
                    </p>
                  </div>
                  <Mail className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import type {
  IEmail,
  IEmailAccount,
  IEmailAttachment,
  IFullEmail,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { SplitView } from "@repo/ui/split-view";
import { FilterTabs, RowActions, ToolbarSpacer } from "@repo/ui/toolbar";
import { Inbox, Mail, Pencil, Plus, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { AddAccountDialog } from "./add-account-dialog";
import { ComposeDialog } from "./compose-dialog";
import { type ComposeDraft, EmailDetail } from "./email-detail";
import { EmailList, EmailListSkeleton } from "./email-list";

const LIST_WIDTH = "md:w-96";

function accountLabel(account: IEmailAccount) {
  return account.displayName || account.user.split("@")[0] || account.user;
}

export function InboxSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Inbox />}
        title="Inbox"
      />
      <PageToolbar>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </PageToolbar>
      <PageBody bleed className="flex">
        <SplitView
          listWidth={LIST_WIDTH}
          detailOpen={false}
          list={
            <div className="p-2">
              <EmailListSkeleton />
            </div>
          }
          detail={null}
        />
      </PageBody>
    </Page>
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
  const [editingAccount, setEditingAccount] = useState<IEmailAccount | null>(
    null,
  );
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft | undefined>(
    undefined,
  );
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const emailCache = useRef<Map<string, IFullEmail>>(new Map());
  const attachmentCache = useRef<Map<string, IEmailAttachment[]>>(new Map());
  const emailListCache = useRef<Map<string, IEmail[]>>(new Map());

  const fetchAccounts = useCallback(async () => {
    try {
      const result = await client.get<{ accounts: IEmailAccount[] }>(
        "email-accounts",
      );
      setAccounts(result.accounts);
      setSelectedAccountId((current) =>
        current && result.accounts.some((account) => account._id === current)
          ? current
          : (result.accounts[0]?._id ?? null),
      );
    } catch {
      // keep the accounts already shown
    } finally {
      setLoadingAccounts(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const selectedAccount = accounts.find((a) => a._id === selectedAccountId);

  const handleSelectAccount = (id: string) => {
    setSelectedAccountId(id);
    setSelectedEmail(null);
  };

  const handleCompose = (draft?: ComposeDraft) => {
    void fetchAccounts();
    setComposeDraft(draft);
    setComposeOpen(true);
  };

  const syncAccounts = async (targets: IEmailAccount[]) => {
    if (syncing || targets.length === 0) return;
    setSyncing(true);
    let failed = 0;
    for (const account of targets) {
      try {
        await client.post<{ message: string }>(
          `email-accounts/${account._id}/sync`,
          {},
        );
      } catch {
        failed++;
      }
    }
    setSyncing(false);
    if (failed === 0) toast.success("Synced");
    else if (failed === targets.length) toast.error("Sync failed");
    else toast.warning(`${targets.length - failed} synced, ${failed} failed`);
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleAccountSaved = async (account?: IEmailAccount) => {
    if (account) {
      setAccounts((current) =>
        current.some((item) => item._id === account._id)
          ? current.map((item) => (item._id === account._id ? account : item))
          : [account, ...current],
      );
      setSelectedAccountId((current) => current ?? account._id);
    }
    await fetchAccounts();
  };

  const handleAccountDeleted = async (accountId: string) => {
    emailListCache.current.delete(accountId);
    setAccounts((current) => current.filter((item) => item._id !== accountId));
    if (selectedAccountId === accountId) {
      setSelectedAccountId(null);
      setSelectedEmail(null);
    }
    await fetchAccounts();
  };

  const handleAccountDialogOpenChange = (open: boolean) => {
    if (open) {
      setAddAccountOpen(true);
      return;
    }
    setAddAccountOpen(false);
    setEditingAccount(null);
  };

  const accountDialogOpen = addAccountOpen || editingAccount !== null;

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Inbox />}
        title="Inbox"
      >
        {selectedAccount ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sync"
            disabled={syncing}
            onClick={() => void syncAccounts([selectedAccount])}
          >
            {syncing ? <Spinner className="size-3.5" /> : <RefreshCw />}
          </Button>
        ) : null}
        <RowActions label="Accounts">
          <DropdownMenuItem
            disabled={syncing || accounts.length === 0}
            onSelect={() => void syncAccounts(accounts)}
          >
            <RefreshCw />
            Sync all
          </DropdownMenuItem>
          {selectedAccount ? (
            <DropdownMenuItem
              onSelect={() => setEditingAccount(selectedAccount)}
            >
              <Settings />
              Edit {accountLabel(selectedAccount)}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setEditingAccount(null);
              setAddAccountOpen(true);
            }}
          >
            <Plus />
            Add account
          </DropdownMenuItem>
        </RowActions>
        <Button
          size="sm"
          disabled={accounts.length === 0}
          onClick={() => handleCompose()}
        >
          <Pencil />
          Compose
        </Button>
      </PageHeader>

      {accounts.length > 1 && selectedAccountId ? (
        <PageToolbar>
          <FilterTabs
            value={selectedAccountId}
            onChange={handleSelectAccount}
            options={accounts.map((account) => ({
              value: account._id,
              label: accountLabel(account),
            }))}
          />
          <ToolbarSpacer />
        </PageToolbar>
      ) : null}

      <PageBody bleed className="flex">
        {loadingAccounts ? (
          <SplitView
            listWidth={LIST_WIDTH}
            detailOpen={false}
            list={
              <div className="p-2">
                <EmailListSkeleton />
              </div>
            }
            detail={null}
          />
        ) : !selectedAccount ? (
          <EmptyState
            icon={<Inbox />}
            label="No accounts"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddAccountOpen(true)}
              >
                <Plus />
                Add account
              </Button>
            }
          />
        ) : (
          <SplitView
            listWidth={LIST_WIDTH}
            detailOpen={selectedEmail !== null}
            list={
              <EmailList
                key={`${selectedAccount._id}:${refreshTrigger}`}
                accountId={selectedAccount._id}
                onSelectEmail={setSelectedEmail}
                selectedEmailId={selectedEmail?._id ?? null}
                emailListCache={emailListCache}
                syncing={syncing}
                onSync={() => void syncAccounts([selectedAccount])}
              />
            }
            detail={
              selectedEmail ? (
                <EmailDetail
                  key={selectedEmail._id}
                  email={selectedEmail}
                  account={selectedAccount}
                  onBack={() => setSelectedEmail(null)}
                  onCompose={handleCompose}
                  emailCache={emailCache}
                  attachmentCache={attachmentCache}
                />
              ) : (
                <EmptyState icon={<Mail />} label="No message selected" />
              )
            }
          />
        )}
      </PageBody>

      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        draft={composeDraft}
      />

      <AddAccountDialog
        open={accountDialogOpen}
        onOpenChange={handleAccountDialogOpenChange}
        onAccountAdded={handleAccountSaved}
        onAccountDeleted={handleAccountDeleted}
        account={editingAccount}
      />
    </Page>
  );
}

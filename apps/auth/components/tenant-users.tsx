"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { OAuthClientSummary, TenantUser } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { tenantsApi } from "@/lib/tenants-api";
import { LoadError, SectionSkeleton, StackedRow, When } from "./account-parts";
import { PageSection, SectionEmpty } from "./shell-frame";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 250;

function personName(user: TenantUser): string {
  return user.name || user.username || user.email;
}

function clientNames(user: TenantUser, clients: OAuthClientSummary[]): string {
  if (user.clients.length === 0) return "—";
  return user.clients
    .map(
      (clientId) =>
        clients.find((client) => client.clientId === clientId)?.name ??
        clientId,
    )
    .join(", ");
}

function BlockDialog({
  user,
  appName,
  onOpenChange,
  onBlock,
}: {
  user: TenantUser | null;
  appName: string;
  onOpenChange: (open: boolean) => void;
  onBlock: (user: TenantUser, reason: string | undefined) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setReason("");
      setError(null);
    }
  }, [user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await onBlock(user, reason.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  };

  const name = user ? personName(user) : "";

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-base">
            Block {name} from {appName}?
          </DialogTitle>
          <DialogDescription>
            They're signed out of {appName} now and can't sign in to it again
            until you unblock them. Their deniz account and every other app are
            untouched.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="block-reason">Reason</Label>
            <Textarea
              id="block-reason"
              className="min-h-20"
              maxLength={500}
              aria-describedby="block-reason-hint"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id="block-reason-hint" className="text-xs text-muted-foreground">
              Optional. Kept with the block, not shown to them.
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" aria-busy={busy || undefined} disabled={busy}>
              {busy ? <Spinner aria-hidden="true" /> : null}
              Block
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserActions({
  user,
  appName,
  busy,
  onSignOut,
  onBlock,
  onUnblock,
}: {
  user: TenantUser;
  appName: string;
  busy: boolean;
  onSignOut: () => Promise<void>;
  onBlock: () => void;
  onUnblock: () => Promise<void>;
}) {
  return (
    <>
      {user.blocked ? null : (
        <ConfirmButton
          trigger={
            <Button size="sm" variant="ghost" disabled={busy}>
              Sign out
            </Button>
          }
          title={`Sign ${personName(user)} out of ${appName}?`}
          description={`Every client of ${appName} loses its tokens for them straight away. They can sign in again whenever they like; block them to stop that.`}
          actionLabel="Sign out"
          onConfirm={onSignOut}
        />
      )}
      {user.blocked ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void onUnblock()}
        >
          Unblock
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onBlock}>
          Block
        </Button>
      )}
    </>
  );
}

function Status({ user }: { user: TenantUser }) {
  return user.blocked ? (
    <Badge variant="outline">Blocked</Badge>
  ) : (
    <span className="text-xs text-muted-foreground">Active</span>
  );
}

export function TenantUsers({
  slug,
  appName,
  clients,
}: {
  slug: string;
  appName: string;
  clients: OAuthClientSummary[];
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<TenantUser | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchUsers = useCallback(
    () => tenantsApi.users(slug, { q, limit: PAGE_SIZE, offset }),
    [slug, q, offset],
  );
  const { data, error, loading, reload } = usePoll(fetchUsers, null);

  const act = async (user: TenantUser, action: () => Promise<void>) => {
    setBusyId(user.id);
    try {
      await action();
    } catch (err) {
      toast.error(errorMessage(err));
    }
    await reload();
    setBusyId(null);
  };

  const total = data?.total ?? 0;
  const firstShown = total === 0 ? 0 : offset + 1;
  const lastShown = Math.min(offset + PAGE_SIZE, total);

  const actionsFor = (user: TenantUser) => (
    <UserActions
      user={user}
      appName={appName}
      busy={busyId === user.id}
      onSignOut={() => act(user, () => tenantsApi.signOutUser(slug, user.id))}
      onBlock={() => setBlocking(user)}
      onUnblock={() => act(user, () => tenantsApi.unblockUser(slug, user.id))}
    />
  );

  return (
    <PageSection title="Users" count={data?.total}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="user-search" className="sr-only">
          Search users
        </Label>
        <Input
          id="user-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by username or email"
          className="max-w-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error && !data ? (
        <LoadError message={error} onRetry={() => void reload()} />
      ) : !data ? (
        <SectionSkeleton rows={4} />
      ) : data.users.length === 0 ? (
        <SectionEmpty>
          {q
            ? `Nobody matches "${q}". Search looks at usernames and email addresses.`
            : `Nobody has signed in to ${appName} yet. People show up here once they allow one of its clients to use their account.`}
        </SectionEmpty>
      ) : (
        <div
          aria-busy={loading || undefined}
          className={cn(
            "flex flex-col gap-3 transition-opacity",
            loading && "opacity-60",
          )}
        >
          <ul className="flex flex-col sm:hidden">
            {data.users.map((user) => (
              <StackedRow
                key={user.id}
                title={
                  <>
                    <span className="truncate">{personName(user)}</span>
                    {user.blocked ? (
                      <Badge variant="outline">Blocked</Badge>
                    ) : null}
                  </>
                }
                detail={
                  <>
                    <span className="break-all">{user.email}</span>
                    {" · last token "}
                    {user.lastIssuedAt ? (
                      <When value={user.lastIssuedAt} />
                    ) : (
                      "never"
                    )}
                  </>
                }
                actions={actionsFor(user)}
              />
            ))}
          </ul>
          <Table containerClassName="hidden sm:block">
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Two-factor
                </TableHead>
                <TableHead className="hidden md:table-cell">Clients</TableHead>
                <TableHead className="hidden lg:table-cell">
                  First allowed
                </TableHead>
                <TableHead>Last token</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.users.map((user) => (
                <TableRow
                  key={user.id}
                  className={cn(user.blocked && "text-muted-foreground")}
                >
                  <TableCell className="max-w-64">
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={cn(
                          "truncate",
                          user.blocked
                            ? "text-muted-foreground"
                            : "text-accent-strong",
                        )}
                      >
                        {personName(user)}
                        {user.username && user.username !== personName(user)
                          ? ` · ${user.username}`
                          : null}
                      </span>
                      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{user.email}</span>
                        {user.emailVerified ? null : (
                          <span className="shrink-0">unverified</span>
                        )}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {user.twoFactorEnabled ? "On" : "Off"}
                  </TableCell>
                  <TableCell className="hidden max-w-48 truncate text-xs text-muted-foreground md:table-cell">
                    {clientNames(user, clients)}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {user.firstGrantedAt ? (
                      <When value={user.firstGrantedAt} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {user.lastIssuedAt ? (
                      <When value={user.lastIssuedAt} />
                    ) : (
                      "Never"
                    )}
                  </TableCell>
                  <TableCell>
                    <Status user={user} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {actionsFor(user)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {total > PAGE_SIZE ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <p className="text-xs text-muted-foreground tabular-nums">
                {firstShown}–{lastShown} of {total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset + PAGE_SIZE >= total || loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <BlockDialog
        user={blocking}
        appName={appName}
        onOpenChange={(open) => {
          if (!open) setBlocking(null);
        }}
        onBlock={async (user, reason) => {
          await tenantsApi.blockUser(slug, user.id, reason ? { reason } : {});
          await reload();
        }}
      />
    </PageSection>
  );
}

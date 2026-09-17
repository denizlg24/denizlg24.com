"use client";

import { describeUserAgent } from "@repo/auth-ui/user-agent";
import { formatDateTime, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { TrustedDevicesSummary } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { PasskeyNameDialog } from "@/components/passkey-dialogs";
import { Shell } from "@/components/shell";
import { PageIntro, PageSection, SectionEmpty } from "@/components/shell-frame";
import { api, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { defaultPasskeyName, isPasskeyDismissed } from "@/lib/passkey";

type PasskeyRow = NonNullable<
  Awaited<ReturnType<typeof authClient.passkey.listUserPasskeys>>["data"]
>[number];

type SessionRow = NonNullable<
  Awaited<ReturnType<typeof authClient.listSessions>>["data"]
>[number];

interface SecurityData {
  passkeys: PasskeyRow[];
  trusted: TrustedDevicesSummary;
  sessions: SessionRow[];
  currentSessionToken: string | null;
}

async function loadSecurity(): Promise<SecurityData> {
  const [passkeys, trusted, sessions, current] = await Promise.all([
    authClient.passkey.listUserPasskeys(),
    api.trustedDevices(),
    authClient.listSessions(),
    authClient.getSession(),
  ]);
  if (passkeys.error) {
    throw new Error(passkeys.error.message ?? "Couldn't list passkeys");
  }
  if (sessions.error) {
    throw new Error(sessions.error.message ?? "Couldn't list sessions");
  }
  const currentSessionToken = current.data?.session.token ?? null;
  const rows = [...(sessions.data ?? [])].sort((a, b) => {
    if (a.token === currentSessionToken) return -1;
    if (b.token === currentSessionToken) return 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return {
    passkeys: passkeys.data ?? [],
    trusted,
    sessions: rows,
    currentSessionToken,
  };
}

function When({ value }: { value: Date | string }) {
  const stamp = new Date(value).toISOString();
  return (
    <time dateTime={stamp} title={formatDateTime(stamp)}>
      {formatRelative(stamp)}
    </time>
  );
}

function transportsLabel(transports: string | null | undefined): string {
  const list = transports?.split(",").filter(Boolean) ?? [];
  return list.length > 0 ? list.join(", ") : "—";
}

/** The phone layout of a row: two lines and the actions, one hairline apart. */
function StackedRow({
  title,
  detail,
  actions,
}: {
  title: ReactNode;
  detail: ReactNode;
  actions: ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 text-sm text-accent-strong">
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </li>
  );
}

function PasskeyActions({
  passkey,
  busy,
  onRename,
  onRemove,
}: {
  passkey: PasskeyRow;
  busy: boolean;
  onRename: () => void;
  onRemove: () => Promise<void>;
}) {
  return (
    <>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onRename}>
        Rename
      </Button>
      <ConfirmButton
        trigger={
          <Button size="sm" variant="ghost" disabled={busy}>
            Remove
          </Button>
        }
        title="Remove this passkey?"
        description={`"${passkey.name ?? passkey.id}" will no longer sign you in. The device keeps its copy, but it stops working here.`}
        actionLabel="Remove"
        onConfirm={onRemove}
      />
    </>
  );
}

function PasskeyList({
  passkeys,
  onChanged,
}: {
  passkeys: PasskeyRow[];
  onChanged: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState<PasskeyRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (passkey: PasskeyRow) => {
    setBusyId(passkey.id);
    const { error } = await authClient.passkey.deletePasskey({
      id: passkey.id,
    });
    if (error) toast.error(error.message ?? "Couldn't remove the passkey");
    await onChanged();
    setBusyId(null);
  };

  const kind = (passkey: PasskeyRow) =>
    passkey.backedUp ? "Synced" : "This device only";

  return (
    <>
      <ul className="flex flex-col sm:hidden">
        {passkeys.map((passkey) => (
          <StackedRow
            key={passkey.id}
            title={
              <>
                {passkey.name ?? "Unnamed passkey"}
                <Badge variant="outline">{kind(passkey)}</Badge>
              </>
            }
            detail={
              <>
                Added <When value={passkey.createdAt} />
                {" · "}
                <span className="font-mono">
                  {transportsLabel(passkey.transports)}
                </span>
              </>
            }
            actions={
              <PasskeyActions
                passkey={passkey}
                busy={busyId === passkey.id}
                onRename={() => setRenaming(passkey)}
                onRemove={() => remove(passkey)}
              />
            }
          />
        ))}
      </ul>
      <Table containerClassName="hidden sm:block">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="hidden md:table-cell">Transports</TableHead>
            <TableHead>Added</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {passkeys.map((passkey) => (
            <TableRow key={passkey.id}>
              <TableCell className="max-w-48 truncate text-accent-strong">
                {passkey.name ?? "Unnamed passkey"}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{kind(passkey)}</Badge>
              </TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                {transportsLabel(passkey.transports)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                <When value={passkey.createdAt} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <PasskeyActions
                    passkey={passkey}
                    busy={busyId === passkey.id}
                    onRename={() => setRenaming(passkey)}
                    onRemove={() => remove(passkey)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PasskeyNameDialog
        open={renaming !== null}
        title="Rename passkey"
        description="The name is only for telling your passkeys apart here."
        actionLabel="Rename"
        initialName={renaming?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (!renaming) return null;
          const { error } = await authClient.passkey.updatePasskey({
            id: renaming.id,
            name,
          });
          if (error) return error.message ?? "Couldn't rename the passkey";
          await onChanged();
          return null;
        }}
      />
    </>
  );
}

function SessionAction({
  session,
  current,
  busy,
  onRevoke,
}: {
  session: SessionRow;
  current: boolean;
  busy: boolean;
  onRevoke: () => Promise<void>;
}) {
  if (current) {
    return (
      <Button size="sm" variant="ghost" asChild>
        <a href="/logout">Sign out</a>
      </Button>
    );
  }
  return (
    <ConfirmButton
      trigger={
        <Button size="sm" variant="ghost" disabled={busy}>
          Sign out
        </Button>
      }
      title={`Sign out ${describeUserAgent(session.userAgent).label}?`}
      description="That device is signed out of every app straight away and has to sign in again."
      actionLabel="Sign out"
      onConfirm={onRevoke}
    />
  );
}

function SessionList({
  sessions,
  currentSessionToken,
  onChanged,
}: {
  sessions: SessionRow[];
  currentSessionToken: string | null;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const revoke = async (session: SessionRow) => {
    setBusyId(session.id);
    const { error } = await authClient.revokeSession({ token: session.token });
    if (error) toast.error(error.message ?? "Couldn't sign that device out");
    await onChanged();
    setBusyId(null);
  };

  return (
    <>
      <ul className="flex flex-col sm:hidden">
        {sessions.map((session) => {
          const current = session.token === currentSessionToken;
          return (
            <StackedRow
              key={session.id}
              title={
                <>
                  {describeUserAgent(session.userAgent).label}
                  {current ? (
                    <Badge variant="outline">This device</Badge>
                  ) : null}
                </>
              }
              detail={
                <>
                  Active <When value={session.updatedAt} />
                  {session.ipAddress ? (
                    <>
                      {" · "}
                      <span className="font-mono">{session.ipAddress}</span>
                    </>
                  ) : null}
                </>
              }
              actions={
                <SessionAction
                  session={session}
                  current={current}
                  busy={busyId === session.id}
                  onRevoke={() => revoke(session)}
                />
              }
            />
          );
        })}
      </ul>
      <Table containerClassName="hidden sm:block">
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead>IP</TableHead>
            <TableHead className="hidden md:table-cell">Signed in</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => {
            const current = session.token === currentSessionToken;
            return (
              <TableRow key={session.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <span className="text-accent-strong">
                      {describeUserAgent(session.userAgent).label}
                    </span>
                    {current ? (
                      <Badge variant="outline">This device</Badge>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {session.ipAddress || "—"}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                  <When value={session.createdAt} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <When value={session.updatedAt} />
                </TableCell>
                <TableCell className="text-right">
                  <SessionAction
                    session={session}
                    current={current}
                    busy={busyId === session.id}
                    onRevoke={() => revoke(session)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

function SecurityPanel() {
  const { data, error, reload } = usePoll(loadSecurity, null);
  const [adding, setAdding] = useState(false);

  const forgetTrustedDevices = useCallback(async () => {
    try {
      await api.revokeTrustedDevices();
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [reload]);

  const signOutOthers = useCallback(async () => {
    const { error: revokeError } = await authClient.revokeOtherSessions();
    if (revokeError) {
      toast.error(revokeError.message ?? "Couldn't sign the other devices out");
    }
    await reload();
  }, [reload]);

  const intro = (
    <PageIntro
      title="Security"
      description="What can reach your account right now."
    />
  );

  if (error) {
    return (
      <>
        {intro}
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <div>
          <Button variant="outline" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      </>
    );
  }

  const otherSessions =
    data?.sessions.filter(
      (session) => session.token !== data.currentSessionToken,
    ) ?? [];

  return (
    <>
      {intro}
      <PageSection
        id="passkeys"
        title="Passkeys"
        count={data?.passkeys.length}
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            Add passkey
          </Button>
        }
      >
        {!data ? (
          <SectionSkeleton rows={2} />
        ) : data.passkeys.length === 0 ? (
          <SectionEmpty>
            A passkey signs you in with Face ID, Touch ID or Windows Hello and
            answers both factors at once. Add one on each device you use.
          </SectionEmpty>
        ) : (
          <PasskeyList passkeys={data.passkeys} onChanged={reload} />
        )}
      </PageSection>

      <PageSection
        id="trusted-devices"
        title="Trusted devices"
        count={data?.trusted.count}
        actions={
          data && data.trusted.count > 0 ? (
            <ConfirmButton
              trigger={
                <Button size="sm" variant="outline">
                  Forget all
                </Button>
              }
              title="Forget every trusted device?"
              description={`${data.trusted.count} ${data.trusted.count === 1 ? "device" : "devices"} will be asked for a code at the next sign-in.`}
              actionLabel="Forget"
              onConfirm={forgetTrustedDevices}
            />
          ) : null
        }
      >
        {!data ? (
          <SectionSkeleton rows={1} />
        ) : data.trusted.count === 0 ? (
          <SectionEmpty>
            A trusted device skips the authenticator code for a while. Tick
            "Trust this device" at the code step to add one.
          </SectionEmpty>
        ) : (
          <p className="text-sm text-muted-foreground">
            {data.trusted.count === 1
              ? "One device skips the code."
              : `${data.trusted.count} devices skip the code.`}
            {data.trusted.nextExpiresAt ? (
              <>
                {" "}
                The next one lapses <When value={data.trusted.nextExpiresAt} />.
              </>
            ) : null}
          </p>
        )}
      </PageSection>

      <PageSection
        id="sessions"
        title="Sessions"
        count={data?.sessions.length}
        actions={
          otherSessions.length > 0 ? (
            <ConfirmButton
              trigger={
                <Button size="sm" variant="outline">
                  Sign out everywhere else
                </Button>
              }
              title="Sign out everywhere else?"
              description={`${otherSessions.length} other ${otherSessions.length === 1 ? "device is" : "devices are"} signed out straight away. This one stays signed in.`}
              actionLabel="Sign out others"
              onConfirm={signOutOthers}
            />
          ) : null
        }
      >
        {!data ? (
          <SectionSkeleton rows={2} />
        ) : data.sessions.length === 0 ? (
          <SectionEmpty>No devices are signed in.</SectionEmpty>
        ) : (
          <SessionList
            sessions={data.sessions}
            currentSessionToken={data.currentSessionToken}
            onChanged={reload}
          />
        )}
      </PageSection>

      <PasskeyNameDialog
        open={adding}
        title="Add a passkey"
        description="Name it after the device that will hold it. The browser asks for Face ID, Touch ID or a PIN next."
        actionLabel="Create passkey"
        initialName={defaultPasskeyName(navigator.userAgent)}
        onOpenChange={setAdding}
        onSubmit={async (name) => {
          const { error: passkeyError } = await authClient.passkey.addPasskey({
            name,
          });
          if (passkeyError) {
            return isPasskeyDismissed(passkeyError)
              ? "The browser closed the prompt before the passkey was made. Try again when you're ready."
              : (passkeyError.message ?? "Couldn't create the passkey");
          }
          await reload();
          return null;
        }}
      />
    </>
  );
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}

export default function SecurityPage() {
  return (
    <Shell>
      <SecurityPanel />
    </Shell>
  );
}

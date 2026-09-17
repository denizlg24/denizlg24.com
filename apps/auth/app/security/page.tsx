"use client";

import { formatRelative } from "@repo/cloud-ui/format";
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
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PasskeyNameDialog } from "@/components/passkey-dialogs";
import { Shell } from "@/components/shell";
import { api, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { defaultPasskeyName, isPasskeyDismissed } from "@/lib/passkey";

type PasskeyRow = NonNullable<
  Awaited<ReturnType<typeof authClient.passkey.listUserPasskeys>>["data"]
>[number];

interface SecurityData {
  passkeys: PasskeyRow[];
  trusted: TrustedDevicesSummary;
}

async function loadSecurity(): Promise<SecurityData> {
  const [passkeys, trusted] = await Promise.all([
    authClient.passkey.listUserPasskeys(),
    api.trustedDevices(),
  ]);
  if (passkeys.error) {
    throw new Error(passkeys.error.message ?? "Failed to list passkeys");
  }
  return { passkeys: passkeys.data ?? [], trusted };
}

function transportsLabel(transports: string | null | undefined): string {
  const list = transports?.split(",").filter(Boolean) ?? [];
  return list.length > 0 ? list.join(", ") : "—";
}

function PasskeyTableRow({
  passkey,
  onChanged,
}: {
  passkey: PasskeyRow;
  onChanged: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const { error } = await authClient.passkey.deletePasskey({
      id: passkey.id,
    });
    if (error) toast.error(error.message ?? "Failed to remove passkey");
    await onChanged();
    setBusy(false);
  };

  return (
    <TableRow>
      <TableCell className="text-xs">{passkey.name ?? "—"}</TableCell>
      <TableCell>
        <Badge variant="outline">
          {passkey.backedUp ? "synced" : "device"}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {transportsLabel(passkey.transports)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground tabular-nums">
        {formatRelative(new Date(passkey.createdAt).toISOString())}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setRenaming(true)}
          >
            rename
          </Button>
          <ConfirmButton
            trigger={
              <Button size="sm" variant="ghost" disabled={busy}>
                remove
              </Button>
            }
            title="Remove passkey"
            description={passkey.name ?? passkey.id}
            actionLabel="Remove"
            onConfirm={remove}
          />
        </div>
        <PasskeyNameDialog
          open={renaming}
          title="Rename passkey"
          actionLabel="Rename"
          initialName={passkey.name ?? ""}
          onOpenChange={setRenaming}
          onSubmit={async (name) => {
            const { error } = await authClient.passkey.updatePasskey({
              id: passkey.id,
              name,
            });
            if (error) return error.message ?? "Failed to rename passkey";
            await onChanged();
            return null;
          }}
        />
      </TableCell>
    </TableRow>
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

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-medium tracking-tight">
            passkeys{" "}
            <span className="text-muted-foreground tabular-nums">
              {data.passkeys.length}
            </span>
          </h1>
          <Button size="sm" onClick={() => setAdding(true)}>
            add
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>name</TableHead>
              <TableHead>kind</TableHead>
              <TableHead>transports</TableHead>
              <TableHead>added</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.passkeys.map((passkey) => (
              <PasskeyTableRow
                key={passkey.id}
                passkey={passkey}
                onChanged={reload}
              />
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="flex items-center justify-between">
        <h2 className="text-sm font-medium tracking-tight">
          trusted devices{" "}
          <span className="text-muted-foreground tabular-nums">
            {data.trusted.count}
          </span>
          {data.trusted.nextExpiresAt ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              lapses {formatRelative(data.trusted.nextExpiresAt)}
            </span>
          ) : null}
        </h2>
        {data.trusted.count > 0 ? (
          <ConfirmButton
            trigger={
              <Button size="sm" variant="ghost">
                forget all
              </Button>
            }
            title="Forget trusted devices"
            description={`${data.trusted.count} devices will be asked for a code again`}
            actionLabel="Forget"
            onConfirm={forgetTrustedDevices}
          />
        ) : null}
      </section>
      <PasskeyNameDialog
        open={adding}
        title="New passkey"
        actionLabel="Create"
        initialName={defaultPasskeyName(navigator.userAgent)}
        onOpenChange={setAdding}
        onSubmit={async (name) => {
          const { error: passkeyError } = await authClient.passkey.addPasskey({
            name,
          });
          if (passkeyError) {
            return isPasskeyDismissed(passkeyError)
              ? "Cancelled"
              : (passkeyError.message ?? "Failed to create passkey");
          }
          await reload();
          return null;
        }}
      />
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

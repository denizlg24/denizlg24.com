"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  OAuthClientCredentials,
  OAuthClientSummary,
  OAuthResourceSummary,
} from "@repo/schemas/cloud";
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
import {
  CreateClientDialog,
  CredentialsDialog,
} from "@/components/client-dialogs";
import { Shell } from "@/components/shell";
import { api, errorMessage } from "@/lib/api";

function resourceLabel(
  identifier: string,
  resources: OAuthResourceSummary[],
): string {
  return (
    resources.find((resource) => resource.identifier === identifier)?.name ??
    identifier
  );
}

function ClientRow({
  client,
  resources,
  onRotated,
  onChanged,
}: {
  client: OAuthClientSummary;
  resources: OAuthResourceSummary[];
  onRotated: (credentials: OAuthClientCredentials) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    }
    setBusy(false);
  };

  return (
    <TableRow className={client.disabled ? "opacity-50" : undefined}>
      <TableCell className="text-xs">{client.name ?? "—"}</TableCell>
      <TableCell>
        <Badge variant="outline">{client.kind}</Badge>
      </TableCell>
      <TableCell className="max-w-40 truncate font-mono text-xs text-muted-foreground">
        {client.clientId}
      </TableCell>
      <TableCell className="text-xs">
        {client.resources.length > 0
          ? client.resources
              .map((identifier) => resourceLabel(identifier, resources))
              .join(", ")
          : "—"}
      </TableCell>
      <TableCell className="text-xs tabular-nums">
        {client.activeGrants}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground tabular-nums">
        {client.lastIssuedAt ? formatRelative(client.lastIssuedAt) : "—"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {client.kind !== "dynamic" && !client.disabled ? (
            <ConfirmButton
              trigger={
                <Button size="sm" variant="ghost" disabled={busy}>
                  rotate
                </Button>
              }
              title="Rotate secret"
              description={client.name ?? client.clientId}
              actionLabel="Rotate"
              onConfirm={() =>
                run(async () =>
                  onRotated(await api.rotateClientSecret(client.clientId)),
                )
              }
            />
          ) : null}
          {client.disabled ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => api.setClientDisabled(client.clientId, false))
              }
            >
              enable
            </Button>
          ) : (
            <ConfirmButton
              trigger={
                <Button size="sm" variant="ghost" disabled={busy}>
                  disable
                </Button>
              }
              title="Disable client"
              description={`${client.name ?? client.clientId} — ${client.activeGrants} active grants revoked`}
              actionLabel="Disable"
              onConfirm={() =>
                run(() => api.setClientDisabled(client.clientId, true))
              }
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ClientsPanel() {
  const fetchClients = useCallback(() => api.clients(), []);
  const { data, error, reload } = usePoll(fetchClients, null);
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<OAuthClientCredentials | null>(
    null,
  );

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium tracking-tight">
          clients{" "}
          <span className="text-muted-foreground tabular-nums">
            {data.clients.length}
          </span>
        </h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          new
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>name</TableHead>
            <TableHead>kind</TableHead>
            <TableHead>client id</TableHead>
            <TableHead>resources</TableHead>
            <TableHead>grants</TableHead>
            <TableHead>issued</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.clients.map((client) => (
            <ClientRow
              key={client.clientId}
              client={client}
              resources={data.resources}
              onRotated={setCredentials}
              onChanged={reload}
            />
          ))}
        </TableBody>
      </Table>
      <CreateClientDialog
        open={creating}
        resources={data.resources}
        onOpenChange={setCreating}
        onCreate={async (input) => {
          const created = await api.createClient(input);
          setCreating(false);
          setCredentials(created);
          await reload();
        }}
      />
      <CredentialsDialog
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Shell>
      <ClientsPanel />
    </Shell>
  );
}

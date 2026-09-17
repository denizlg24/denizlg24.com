"use client";

import { formatDateTime, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  OAuthClientCredentials,
  OAuthClientSummary,
  OAuthResourceSummary,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import { useCallback, useState } from "react";
import {
  CreateClientDialog,
  CredentialsDialog,
} from "@/components/client-dialogs";
import {
  ClientSheet,
  KIND_LABELS,
  resourceName,
} from "@/components/client-sheet";
import { Shell } from "@/components/shell";
import { PageIntro, PageSection, SectionEmpty } from "@/components/shell-frame";
import { api } from "@/lib/api";

function ClientRow({
  client,
  resources,
  onOpen,
}: {
  client: OAuthClientSummary;
  resources: OAuthResourceSummary[];
  onOpen: () => void;
}) {
  return (
    <TableRow
      className={cn(
        "cursor-pointer",
        client.disabled && "text-muted-foreground",
      )}
      onClick={onOpen}
    >
      <TableCell className="max-w-56">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className={cn(
            "block max-w-full truncate rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            client.disabled ? "text-muted-foreground" : "text-accent-strong",
          )}
        >
          {client.name ?? "Unnamed client"}
        </button>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {KIND_LABELS[client.kind]}
      </TableCell>
      <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground md:table-cell">
        {client.resources.length > 0
          ? client.resources
              .map((identifier) => resourceName(identifier, resources))
              .join(", ")
          : "—"}
      </TableCell>
      <TableCell className="hidden text-xs tabular-nums sm:table-cell">
        {client.activeGrants}
      </TableCell>
      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
        {client.lastIssuedAt ? (
          <time
            dateTime={client.lastIssuedAt}
            title={formatDateTime(client.lastIssuedAt)}
          >
            {formatRelative(client.lastIssuedAt)}
          </time>
        ) : (
          "Never"
        )}
      </TableCell>
      <TableCell className="text-right">
        {client.disabled ? (
          <Badge variant="outline">Disabled</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Active</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function ClientsPanel() {
  const fetchClients = useCallback(() => api.clients(), []);
  const { data, error, reload } = usePoll(fetchClients, null);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<OAuthClientCredentials | null>(
    null,
  );

  // The sheet reads the row from the latest list, so an action it ran shows
  // its result without the sheet holding a stale copy.
  const selected =
    data?.clients.find((client) => client.clientId === selectedId) ?? null;

  const intro = (
    <PageIntro
      title="Clients"
      description="Apps and services that sign in with your account through OAuth."
      actions={<Button onClick={() => setCreating(true)}>New client</Button>}
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

  return (
    <>
      {intro}
      <PageSection title="Registered" count={data?.clients.length}>
        {!data ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : data.clients.length === 0 ? (
          <SectionEmpty
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                New client
              </Button>
            }
          >
            No clients yet. A client is an app or service that gets tokens for
            your account; create one to get its id and secret. Apps that
            register themselves, like Claude, appear here on their own.
          </SectionEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="hidden md:table-cell">
                  Resources
                </TableHead>
                <TableHead className="hidden sm:table-cell">Grants</TableHead>
                <TableHead className="hidden md:table-cell">
                  Last issued
                </TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.clients.map((client) => (
                <ClientRow
                  key={client.clientId}
                  client={client}
                  resources={data.resources}
                  onOpen={() => setSelectedId(client.clientId)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </PageSection>
      <ClientSheet
        client={selected}
        resources={data?.resources ?? []}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onRotated={setCredentials}
        onChanged={reload}
      />
      <CreateClientDialog
        open={creating}
        resources={data?.resources ?? []}
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
    </>
  );
}

export default function ClientsPage() {
  return (
    <Shell>
      <ClientsPanel />
    </Shell>
  );
}

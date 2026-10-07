"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import type {
  OAuthClientCredentials,
  OAuthClientSummary,
  OAuthResourceSummary,
} from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CopyButton } from "@repo/ui/copy-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import { useState } from "react";
import { toast } from "sonner";
import { AUTH_ISSUER, SDK_PACKAGE, tenantsApi } from "@/lib/tenants-api";
import { DetailRow, When } from "./account-parts";
import { CredentialsDialog } from "./client-dialogs";
import { KIND_LABELS, resourceName } from "./client-sheet";
import { PageSection, SectionEmpty } from "./shell-frame";
import { TenantClientDialog } from "./tenant-client-dialog";

function CopyableMono({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      <code className="min-w-0 break-all font-mono text-xs">{value}</code>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/** Everything an integration needs besides a client id, on one line. */
function IntegrationLine() {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <span>Connect with</span>
      <CopyableMono value={SDK_PACKAGE} label="Copy package name" />
      <span>using a client id below and the issuer</span>
      <CopyableMono value={AUTH_ISSUER} label="Copy issuer" />
    </p>
  );
}

function TenantClientSheet({
  slug,
  client,
  resources,
  onOpenChange,
  onChanged,
}: {
  slug: string;
  client: OAuthClientSummary | null;
  resources: OAuthResourceSummary[];
  onOpenChange: (open: boolean) => void;
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

  const label = client?.name ?? client?.clientId ?? "";

  return (
    <Sheet open={client !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        {client ? (
          <>
            <SheetHeader className="pr-10">
              <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                {client.name ?? "Unnamed client"}
                {client.disabled ? (
                  <Badge variant="outline">Disabled</Badge>
                ) : null}
              </SheetTitle>
              <SheetDescription>{KIND_LABELS[client.kind]}</SheetDescription>
            </SheetHeader>
            <dl className="flex flex-col overflow-y-auto px-4">
              <DetailRow label="Client id">
                <CopyableMono value={client.clientId} label="Copy client id" />
              </DetailRow>
              <DetailRow label="Issuer">
                <CopyableMono value={AUTH_ISSUER} label="Copy issuer" />
              </DetailRow>
              <DetailRow label="APIs">
                {client.resources.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {client.resources.map((identifier) => (
                      <li
                        key={identifier}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span>{resourceName(identifier, resources)}</span>
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {identifier}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </DetailRow>
              {client.kind !== "service" ? (
                <DetailRow label="Redirect URIs">
                  {client.redirectUris.length > 0 ? (
                    <ul className="flex flex-col gap-1 font-mono text-xs">
                      {client.redirectUris.map((uri) => (
                        <li key={uri} className="break-all">
                          {uri}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </DetailRow>
              ) : null}
              <DetailRow label="Active grants">
                <span className="tabular-nums">{client.activeGrants}</span>
              </DetailRow>
              <DetailRow label="Last token issued">
                {client.lastIssuedAt ? (
                  <When value={client.lastIssuedAt} />
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </DetailRow>
              <DetailRow label="Created">
                {client.createdAt ? <When value={client.createdAt} /> : "—"}
              </DetailRow>
            </dl>
            <SheetFooter className="border-t">
              {client.disabled ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      tenantsApi.setClientDisabled(
                        slug,
                        client.clientId,
                        false,
                      ),
                    )
                  }
                >
                  Enable
                </Button>
              ) : (
                <ConfirmButton
                  trigger={
                    <Button variant="outline" disabled={busy}>
                      Disable
                    </Button>
                  }
                  title="Disable this client?"
                  description={`"${label}" can't get tokens until it is enabled again. ${client.activeGrants} active ${client.activeGrants === 1 ? "grant is" : "grants are"} revoked now.`}
                  actionLabel="Disable"
                  onConfirm={() =>
                    run(() =>
                      tenantsApi.setClientDisabled(slug, client.clientId, true),
                    )
                  }
                />
              )}
              <ConfirmButton
                trigger={
                  <Button variant="outline" disabled={busy}>
                    Delete
                  </Button>
                }
                title="Delete this client?"
                description={`"${label}" stops working for good: its id and any secret are refused, and everyone signed in through it is signed out. This can't be undone.`}
                actionLabel="Delete client"
                onConfirm={() =>
                  run(() => tenantsApi.deleteClient(slug, client.clientId))
                }
              />
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

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
        {client.lastIssuedAt ? <When value={client.lastIssuedAt} /> : "Never"}
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

export function TenantClients({
  slug,
  clients,
  resources,
  onChanged,
}: {
  slug: string;
  clients: OAuthClientSummary[];
  resources: OAuthResourceSummary[];
  onChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<OAuthClientCredentials | null>(
    null,
  );
  const selected =
    clients.find((client) => client.clientId === selectedId) ?? null;
  const canCreate = resources.length > 0;

  const newClientButton = (variant: "default" | "outline") => (
    <Button
      size={variant === "default" ? "sm" : "default"}
      variant={variant}
      disabled={!canCreate}
      onClick={() => setCreating(true)}
    >
      New client
    </Button>
  );

  return (
    <PageSection
      title="Clients"
      count={clients.length}
      actions={clients.length > 0 ? newClientButton("default") : null}
    >
      <IntegrationLine />
      {clients.length === 0 ? (
        <SectionEmpty action={newClientButton("outline")}>
          {canCreate
            ? "No clients yet. A client is one piece of this app that signs people in, like its website or its phone app, or a server that calls its APIs. Create one to get its id."
            : "No clients yet. Add an API first: every client is issued tokens for at least one of this app's APIs."}
        </SectionEmpty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="hidden md:table-cell">APIs</TableHead>
              <TableHead className="hidden sm:table-cell">Grants</TableHead>
              <TableHead className="hidden md:table-cell">
                Last issued
              </TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <ClientRow
                key={client.clientId}
                client={client}
                resources={resources}
                onOpen={() => setSelectedId(client.clientId)}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <TenantClientSheet
        slug={slug}
        client={selected}
        resources={resources}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        onChanged={onChanged}
      />
      <TenantClientDialog
        open={creating}
        resources={resources}
        onOpenChange={setCreating}
        onCreate={async (input) => {
          const created = await tenantsApi.createClient(slug, input);
          setCreating(false);
          setCredentials(created);
          await onChanged();
        }}
      />
      <CredentialsDialog
        credentials={credentials}
        onClose={() => setCredentials(null)}
      />
    </PageSection>
  );
}

"use client";

import { formatDateTime, formatRelative } from "@repo/cloud-ui/format";
import type {
  OAuthClientCredentials,
  OAuthClientKind,
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
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

export const KIND_LABELS: Record<OAuthClientKind, string> = {
  web: "Web app",
  native: "Native app",
  service: "Service",
  dynamic: "Registered itself",
};

export function resourceName(
  identifier: string,
  resources: OAuthResourceSummary[],
): string {
  return (
    resources.find((resource) => resource.identifier === identifier)?.name ??
    identifier
  );
}

/** A secret can only be rotated where one exists and the client is live. */
export function canRotate(client: OAuthClientSummary): boolean {
  return (
    client.kind !== "dynamic" && client.kind !== "native" && !client.disabled
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 text-sm last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ClientSheet({
  client,
  resources,
  onOpenChange,
  onRotated,
  onChanged,
}: {
  client: OAuthClientSummary | null;
  resources: OAuthResourceSummary[];
  onOpenChange: (open: boolean) => void;
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
            <dl className="flex flex-col px-4">
              <DetailRow label="Client id">
                <span className="inline-flex max-w-full items-center gap-1">
                  <code className="min-w-0 break-all font-mono text-xs">
                    {client.clientId}
                  </code>
                  <CopyButton value={client.clientId} label="Copy client id" />
                </span>
              </DetailRow>
              <DetailRow label="Resources">
                {client.resources.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {client.resources.map((identifier) => (
                      <li
                        key={identifier}
                        className="flex flex-wrap items-baseline gap-x-2"
                      >
                        <span>{resourceName(identifier, resources)}</span>
                        <span className="font-mono text-xs text-muted-foreground">
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
                  <time
                    dateTime={client.lastIssuedAt}
                    title={formatDateTime(client.lastIssuedAt)}
                  >
                    {formatRelative(client.lastIssuedAt)}
                  </time>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </DetailRow>
              <DetailRow label="Created">
                {client.createdAt ? (
                  <time dateTime={client.createdAt}>
                    {formatDateTime(client.createdAt)}
                  </time>
                ) : (
                  "—"
                )}
              </DetailRow>
            </dl>
            <SheetFooter className="border-t">
              {canRotate(client) ? (
                <ConfirmButton
                  trigger={
                    <Button variant="outline" disabled={busy}>
                      Rotate secret
                    </Button>
                  }
                  title="Rotate the secret?"
                  description={`The current secret for "${client.name ?? client.clientId}" stops working the moment the new one exists. Update the app right after.`}
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
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api.setClientDisabled(client.clientId, false),
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
                  description={`"${client.name ?? client.clientId}" can't get tokens until it is enabled again. ${client.activeGrants} active ${client.activeGrants === 1 ? "grant is" : "grants are"} revoked now.`}
                  actionLabel="Disable"
                  onConfirm={() =>
                    run(() => api.setClientDisabled(client.clientId, true))
                  }
                />
              )}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

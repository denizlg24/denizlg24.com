"use client";

import { errorMessage } from "@repo/cloud-ui/api-error";
import type { ConnectedApp } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { useState } from "react";
import { toast } from "sonner";
import { accountApi } from "@/lib/tenants-api";
import { AppLogo, hostOf, StackedRow, When } from "./account-parts";

/** What each scope lets an app see or do, in a word or two. */
const SCOPE_NOUNS: Record<string, string> = {
  profile: "Name",
  email: "Email",
  offline_access: "Stays signed in",
  superuser: "Full access",
};

function appName(app: ConnectedApp): string {
  return app.tenant?.name ?? app.name ?? "Unnamed app";
}

/** The client's own name, when it says more than the app's. */
function clientLabel(app: ConnectedApp): string | null {
  if (!app.tenant || !app.name || app.name === app.tenant.name) return null;
  return app.name;
}

function accessSummary(scopes: string[]): string {
  const nouns = scopes
    .filter((scope) => scope !== "openid")
    .map((scope) => SCOPE_NOUNS[scope] ?? scope);
  return nouns.length > 0 ? nouns.join(", ") : "Who you are";
}

function LastUsed({ app }: { app: ConnectedApp }) {
  return app.lastIssuedAt ? (
    <When value={app.lastIssuedAt} />
  ) : (
    <span>Not yet</span>
  );
}

function RemoveAccess({
  app,
  busy,
  onRemove,
}: {
  app: ConnectedApp;
  busy: boolean;
  onRemove: () => Promise<void>;
}) {
  const name = appName(app);
  return (
    <ConfirmButton
      trigger={
        <Button size="sm" variant="ghost" disabled={busy}>
          Remove access
        </Button>
      }
      title={`Remove ${name}'s access?`}
      description={`${name} is signed out of your account straight away and has to ask again before it can use it. Anything it already stored stays with ${name}.`}
      actionLabel="Remove access"
      onConfirm={onRemove}
    />
  );
}

export function ConnectedAppList({
  apps,
  onChanged,
}: {
  apps: ConnectedApp[];
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const remove = async (app: ConnectedApp) => {
    setBusyId(app.clientId);
    try {
      await accountApi.removeConnectedApp(app.clientId);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      try {
        await onChanged();
      } finally {
        setBusyId(null);
      }
    }
  };

  return (
    <>
      <ul className="flex flex-col sm:hidden">
        {apps.map((app) => (
          <StackedRow
            key={app.clientId}
            leading={
              <AppLogo
                name={appName(app)}
                logoUrl={app.tenant?.logoUrl ?? null}
              />
            }
            title={<span className="truncate">{appName(app)}</span>}
            detail={
              <>
                Last used <LastUsed app={app} />
                {app.uri ? (
                  <>
                    {" · "}
                    <span className="font-mono">{hostOf(app.uri)}</span>
                  </>
                ) : null}
              </>
            }
            actions={
              <RemoveAccess
                app={app}
                busy={busyId === app.clientId}
                onRemove={() => remove(app)}
              />
            }
          />
        ))}
      </ul>
      <Table containerClassName="hidden sm:block">
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead className="hidden md:table-cell">Can see</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead className="hidden md:table-cell">Allowed</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {apps.map((app) => {
            const client = clientLabel(app);
            return (
              <TableRow key={app.clientId}>
                <TableCell className="max-w-72">
                  <span className="flex min-w-0 items-center gap-3">
                    <AppLogo
                      name={appName(app)}
                      logoUrl={app.tenant?.logoUrl ?? null}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-accent-strong">
                        {appName(app)}
                      </span>
                      {client || app.uri ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {client}
                          {client && app.uri ? " · " : null}
                          {app.uri ? (
                            <span className="font-mono">{hostOf(app.uri)}</span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden max-w-56 truncate text-xs text-muted-foreground md:table-cell">
                  {accessSummary(app.scopes)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  <LastUsed app={app} />
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                  {app.grantedAt ? <When value={app.grantedAt} /> : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <RemoveAccess
                    app={app}
                    busy={busyId === app.clientId}
                    onRemove={() => remove(app)}
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

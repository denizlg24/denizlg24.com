"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type { TenantSummary } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AccountShell, useAccount } from "@/components/account-gate";
import {
  AppLogo,
  LoadError,
  SectionSkeleton,
  StackedRow,
} from "@/components/account-parts";
import { PageIntro, PageSection, SectionEmpty } from "@/components/shell-frame";
import { TenantCreateSheet } from "@/components/tenant-create-sheet";
import {
  ACCESS_LABELS,
  signupLabel,
  TwoFactorRequired,
} from "@/components/tenant-parts";
import { loadTenantRoute, tenantsApi } from "@/lib/tenants-api";

const loadTenants = () => loadTenantRoute(tenantsApi.list);

function tenantHref(tenant: TenantSummary): string {
  return `/apps/${encodeURIComponent(tenant.slug)}`;
}

function counts(tenant: TenantSummary): string {
  return `${tenant.userCount} ${tenant.userCount === 1 ? "person" : "people"} · ${tenant.clientCount} ${tenant.clientCount === 1 ? "client" : "clients"}`;
}

function TenantTable({ tenants }: { tenants: TenantSummary[] }) {
  const router = useRouter();
  // The owner of the service relates to every app the same way; the column
  // only says something when the list mixes owned and administered apps.
  const showAccess = tenants.some((tenant) => tenant.access !== "superuser");

  return (
    <>
      <ul className="flex flex-col sm:hidden">
        {tenants.map((tenant) => (
          <StackedRow
            key={tenant.id}
            leading={<AppLogo name={tenant.name} logoUrl={tenant.logoUrl} />}
            title={
              <>
                <Link
                  href={tenantHref(tenant)}
                  className="truncate rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {tenant.name}
                </Link>
                {tenant.disabled ? (
                  <Badge variant="outline">Disabled</Badge>
                ) : null}
              </>
            }
            detail={
              <>
                <span className="font-mono">{tenant.slug}</span>
                {" · "}
                {counts(tenant)}
              </>
            }
          />
        ))}
      </ul>
      <Table containerClassName="hidden sm:block">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Slug</TableHead>
            <TableHead>People</TableHead>
            <TableHead>Clients</TableHead>
            <TableHead className="hidden md:table-cell">New accounts</TableHead>
            {showAccess ? <TableHead>Your role</TableHead> : null}
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((tenant) => (
            <TableRow
              key={tenant.id}
              className={cn(
                "cursor-pointer",
                tenant.disabled && "text-muted-foreground",
              )}
              onClick={() => router.push(tenantHref(tenant))}
            >
              <TableCell className="max-w-64">
                <span className="flex min-w-0 items-center gap-3">
                  <AppLogo name={tenant.name} logoUrl={tenant.logoUrl} />
                  <Link
                    href={tenantHref(tenant)}
                    onClick={(event) => event.stopPropagation()}
                    className={cn(
                      "truncate rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      tenant.disabled
                        ? "text-muted-foreground"
                        : "text-accent-strong",
                    )}
                  >
                    {tenant.name}
                  </Link>
                </span>
              </TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                {tenant.slug}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {tenant.userCount}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {tenant.clientCount}
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                {signupLabel(tenant.signup)}
              </TableCell>
              {showAccess ? (
                <TableCell className="text-xs text-muted-foreground">
                  {ACCESS_LABELS[tenant.access]}
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                {tenant.disabled ? (
                  <Badge variant="outline">Disabled</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Active</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function AppsPanel() {
  const account = useAccount();
  const router = useRouter();
  const { data, error, reload } = usePoll(loadTenants, null);
  const [creating, setCreating] = useState(false);
  const canCreate = account.superuser;

  const intro = (
    <PageIntro
      title="Apps"
      description="Products that sign people in with a deniz account."
      actions={
        canCreate && data?.status === "ok" ? (
          <Button onClick={() => setCreating(true)}>New app</Button>
        ) : null
      }
    />
  );

  // The list itself never 404s for a member; one means an API without apps.
  const failure =
    error && !data
      ? error
      : data?.status === "not-found"
        ? "This server doesn't offer apps yet."
        : null;
  if (failure) {
    return (
      <>
        {intro}
        <LoadError message={failure} onRetry={() => void reload()} />
      </>
    );
  }

  return (
    <>
      {intro}
      {data?.status === "mfa-required" ? (
        <TwoFactorRequired />
      ) : (
        <PageSection
          title={canCreate ? "All apps" : "Apps you manage"}
          count={data?.status === "ok" ? data.data.length : undefined}
        >
          {data?.status !== "ok" ? (
            <SectionSkeleton rows={3} />
          ) : data.data.length === 0 ? (
            canCreate ? (
              <SectionEmpty
                action={
                  <Button variant="outline" onClick={() => setCreating(true)}>
                    New app
                  </Button>
                }
              >
                No apps yet. An app is someone's product that lets people sign
                in with their deniz account. Create one, then add its APIs and
                clients and invite the people who build it.
              </SectionEmpty>
            ) : (
              <SectionEmpty>
                You don't manage any apps yet. When someone adds you to an app's
                team, it shows up here.
              </SectionEmpty>
            )
          ) : (
            <TenantTable tenants={data.data} />
          )}
        </PageSection>
      )}
      {canCreate ? (
        <TenantCreateSheet
          open={creating}
          onOpenChange={setCreating}
          onCreated={(tenant) => {
            setCreating(false);
            router.push(tenantHref(tenant));
          }}
        />
      ) : null}
    </>
  );
}

export default function AppsPage() {
  return (
    <AccountShell>
      <AppsPanel />
    </AccountShell>
  );
}

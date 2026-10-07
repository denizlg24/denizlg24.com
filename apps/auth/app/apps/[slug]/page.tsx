"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type { TenantDetail } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, use, useCallback, useState } from "react";
import {
  AccountShell,
  useAccount,
  useRefreshAccount,
} from "@/components/account-gate";
import { AppLogo, hostOf, LoadError } from "@/components/account-parts";
import { PageIntro, PageSkeleton } from "@/components/shell-frame";
import { TenantApis } from "@/components/tenant-apis";
import { TenantClients } from "@/components/tenant-clients";
import { TenantMembers } from "@/components/tenant-members";
import {
  ACCESS_LABELS,
  TenantNotFound,
  TwoFactorRequired,
} from "@/components/tenant-parts";
import { TenantSettings } from "@/components/tenant-settings";
import { TenantUsers } from "@/components/tenant-users";
import { loadTenantRoute, tenantsApi } from "@/lib/tenants-api";

const TABS = ["overview", "apis", "clients", "users", "members"] as const;
type Tab = (typeof TABS)[number];

function tabFrom(value: string): Tab | null {
  return TABS.find((tab) => tab === value) ?? null;
}

/** The open tab lives in the URL hash, so a reload or a shared link keeps it. */
function useHashTab(): [Tab, (value: string) => void] {
  const [tab, setTab] = useState<Tab>(() =>
    typeof window === "undefined"
      ? "overview"
      : (tabFrom(window.location.hash.slice(1)) ?? "overview"),
  );
  const select = useCallback((value: string) => {
    const next = tabFrom(value);
    if (!next) return;
    setTab(next);
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      next === "overview" ? `${pathname}${search}` : `#${next}`,
    );
  }, []);
  return [tab, select];
}

function TabLabel({ label, count }: { label: string; count?: number }) {
  return (
    <>
      {label}
      {count !== undefined ? (
        <span className="font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
    </>
  );
}

function TenantIntro({ detail }: { detail: TenantDetail }) {
  const { tenant } = detail;
  return (
    <PageIntro
      title={
        <span className="flex min-w-0 items-center gap-3">
          <AppLogo name={tenant.name} logoUrl={tenant.logoUrl} size="md" />
          <span className="truncate">{tenant.name}</span>
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs">{tenant.slug}</span>
          <span aria-hidden="true">·</span>
          <span>{ACCESS_LABELS[tenant.access]}</span>
          {tenant.disabled ? <Badge variant="outline">Disabled</Badge> : null}
        </span>
      }
      actions={
        tenant.homepageUrl ? (
          <a
            href={tenant.homepageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm font-mono text-xs text-muted-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {hostOf(tenant.homepageUrl)}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </a>
        ) : null
      }
    />
  );
}

function TenantTabs({
  detail,
  reload,
}: {
  detail: TenantDetail;
  reload: () => Promise<void>;
}) {
  const account = useAccount();
  const refreshAccount = useRefreshAccount();
  const router = useRouter();
  const [tab, setTab] = useHashTab();
  const { tenant } = detail;

  const panels: { value: Tab; label: ReactNode; content: ReactNode }[] = [
    {
      value: "overview",
      label: <TabLabel label="Overview" />,
      content: (
        <TenantSettings
          tenant={tenant}
          onChanged={reload}
          onDeleted={() => router.replace("/apps")}
        />
      ),
    },
    {
      value: "apis",
      label: <TabLabel label="APIs" count={detail.resources.length} />,
      content: (
        <TenantApis
          slug={tenant.slug}
          access={tenant.access}
          resources={detail.resources}
          clients={detail.clients}
          onChanged={reload}
        />
      ),
    },
    {
      value: "clients",
      label: <TabLabel label="Clients" count={detail.clients.length} />,
      content: (
        <TenantClients
          slug={tenant.slug}
          clients={detail.clients}
          resources={detail.resources}
          onChanged={reload}
        />
      ),
    },
    {
      value: "users",
      label: <TabLabel label="Users" count={tenant.userCount} />,
      content: (
        <TenantUsers
          slug={tenant.slug}
          appName={tenant.name}
          clients={detail.clients}
        />
      ),
    },
    {
      value: "members",
      label: <TabLabel label="Members" count={detail.members.length} />,
      content: (
        <TenantMembers
          slug={tenant.slug}
          appName={tenant.name}
          access={tenant.access}
          members={detail.members}
          selfId={account.id}
          onChanged={reload}
          onLeft={async () => {
            await refreshAccount();
            router.replace("/apps");
          }}
        />
      ),
    },
  ];

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-6">
      <div className="border-b">
        <TabsList variant="line" aria-label={`${tenant.name} sections`}>
          {panels.map((panel) => (
            <TabsTrigger key={panel.value} value={panel.value}>
              {panel.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {panels.map((panel) => (
        <TabsContent key={panel.value} value={panel.value}>
          {panel.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}

function TenantPanel({ slug }: { slug: string }) {
  const fetchDetail = useCallback(
    () => loadTenantRoute(() => tenantsApi.detail(slug)),
    [slug],
  );
  const { data, error, reload } = usePoll(fetchDetail, null);

  if (error && !data) {
    return (
      <>
        <PageIntro title="App" />
        <LoadError message={error} onRetry={() => void reload()} />
      </>
    );
  }
  if (!data) return <PageSkeleton />;
  if (data.status === "mfa-required") {
    return (
      <>
        <PageIntro title="Apps" />
        <TwoFactorRequired />
      </>
    );
  }
  if (data.status === "not-found") {
    return (
      <>
        <PageIntro title="App not found" />
        <TenantNotFound />
      </>
    );
  }
  return (
    <>
      <TenantIntro detail={data.data} />
      <TenantTabs detail={data.data} reload={reload} />
    </>
  );
}

export default function TenantPage({ params }: PageProps<"/apps/[slug]">) {
  const { slug } = use(params);
  return (
    <AccountShell>
      <TenantPanel slug={slug} />
    </AccountShell>
  );
}

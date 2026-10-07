"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Badge } from "@repo/ui/badge";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ConnectedAppList } from "@/components/account-connected-apps";
import { AccountShell, useAccount } from "@/components/account-gate";
import { LoadError, SectionSkeleton } from "@/components/account-parts";
import { PageIntro, PageSection, SectionEmpty } from "@/components/shell-frame";
import { accountApi } from "@/lib/tenants-api";

function AccountPanel() {
  const account = useAccount();
  const { data, error, reload } = usePoll(accountApi.connectedApps, null);
  const title = account.name || account.username || account.email;

  return (
    <>
      <PageIntro
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-all">{account.email}</span>
            {account.username && account.username !== title ? (
              <span>· {account.username}</span>
            ) : null}
            {account.emailVerified ? null : (
              <Badge variant="outline">Email not verified</Badge>
            )}
          </span>
        }
      />

      <PageSection
        id="connected-apps"
        title="Connected apps"
        count={data?.length}
      >
        {error && !data ? (
          <LoadError message={error} onRetry={() => void reload()} />
        ) : !data ? (
          <SectionSkeleton rows={2} />
        ) : data.length === 0 ? (
          <SectionEmpty>
            No apps can use your account. When you sign in to an app with your
            deniz account and allow it in, it shows up here, and you can take
            its access back at any time.
          </SectionEmpty>
        ) : (
          <ConnectedAppList apps={data} onChanged={reload} />
        )}
      </PageSection>

      <PageSection title="Sign-in security">
        <Link
          href="/security"
          className="-mx-2 flex items-center gap-4 rounded-md px-2 py-2.5 text-sm outline-none transition-colors hover:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="w-32 shrink-0 text-muted-foreground sm:w-40">
            Two-factor
          </span>
          <span className="min-w-0 flex-1 truncate">
            <span className="text-accent-strong">
              {account.twoFactorEnabled ? "On" : "Off"}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              Passkeys, trusted devices and sessions
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </Link>
      </PageSection>
    </>
  );
}

export default function AccountPage() {
  return (
    <AccountShell>
      <AccountPanel />
    </AccountShell>
  );
}

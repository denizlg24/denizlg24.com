"use client";

import { formatDateTime, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Skeleton } from "@repo/ui/skeleton";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSessionUser } from "@/components/session-gate";
import { Shell } from "@/components/shell";
import { PageIntro, PageSection } from "@/components/shell-frame";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

const APPS = [
  { name: "denizlg24.com", href: "https://denizlg24.com/admin/dashboard" },
  { name: "Forge", href: "https://forge.denizlg24.com" },
  { name: "Cloud", href: "https://cloud.denizlg24.com" },
  { name: "Storage", href: "https://storage.denizlg24.com" },
  { name: "Status", href: "https://status.denizlg24.com/admin" },
] as const;

interface SecuritySummary {
  passkeys: number;
  trustedDevices: number;
  trustedNextExpiresAt: string | null;
  sessions: number;
}

async function loadSummary(): Promise<SecuritySummary> {
  const [passkeys, trusted, sessions] = await Promise.all([
    authClient.passkey.listUserPasskeys(),
    api.trustedDevices(),
    authClient.listSessions(),
  ]);
  if (passkeys.error) {
    throw new Error(passkeys.error.message ?? "Couldn't list passkeys");
  }
  if (sessions.error) {
    throw new Error(sessions.error.message ?? "Couldn't list sessions");
  }
  return {
    passkeys: passkeys.data?.length ?? 0,
    trustedDevices: trusted.count,
    trustedNextExpiresAt: trusted.nextExpiresAt,
    sessions: sessions.data?.length ?? 0,
  };
}

function IdentityRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-baseline gap-4 border-b py-2.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function SecurityRow({
  href,
  label,
  value,
  detail,
}: {
  href: string;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="-mx-2 flex items-center gap-4 rounded-md px-2 py-2.5 text-sm outline-none transition-colors hover:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="w-32 shrink-0 text-muted-foreground sm:w-40">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-accent-strong">{value}</span>
        {detail ? (
          <span className="ml-2 text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

function AccountPanel() {
  const user = useSessionUser();
  const { data, error } = usePoll(loadSummary, null);

  return (
    <>
      <PageIntro
        title="Account"
        description="One identity for everything under denizlg24.com."
      />
      <PageSection title="Identity">
        <dl className="flex flex-col">
          <IdentityRow label="Username">
            <span className="text-accent-strong">{user.username}</span>
          </IdentityRow>
          <IdentityRow label="Email">{user.email ?? "—"}</IdentityRow>
          <IdentityRow label="Role">
            {user.role === "superuser" ? "Owner" : "Member"}
          </IdentityRow>
          <IdentityRow label="Member since">
            <time
              dateTime={user.createdAt}
              title={formatDateTime(user.createdAt)}
            >
              {formatDateTime(user.createdAt)}
            </time>
          </IdentityRow>
        </dl>
      </PageSection>
      <PageSection title="Security">
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col">
          <SecurityRow
            href="/security"
            label="Authenticator app"
            value={user.totpEnabled ? "On" : "Not set up"}
          />
          {data ? (
            <>
              <SecurityRow
                href="/security#passkeys"
                label="Passkeys"
                value={data.passkeys}
                detail={data.passkeys === 0 ? "none added" : null}
              />
              <SecurityRow
                href="/security#trusted-devices"
                label="Trusted devices"
                value={data.trustedDevices}
                detail={
                  data.trustedNextExpiresAt
                    ? `next lapses ${formatRelative(data.trustedNextExpiresAt)}`
                    : null
                }
              />
              <SecurityRow
                href="/security#sessions"
                label="Sessions"
                value={data.sessions}
                detail="signed-in devices"
              />
            </>
          ) : (
            <div className="flex flex-col gap-2 py-2" aria-busy="true">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          )}
        </div>
      </PageSection>
      <PageSection title="Apps">
        <ul className="flex flex-col">
          {APPS.map((app) => (
            <li key={app.href}>
              <a
                href={app.href}
                className="-mx-2 flex items-center gap-4 rounded-md px-2 py-2.5 text-sm outline-none transition-colors hover:bg-surface focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="w-32 shrink-0 text-accent-strong sm:w-40">
                  {app.name}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {new URL(app.href).host}
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </a>
            </li>
          ))}
        </ul>
      </PageSection>
    </>
  );
}

export default function HomePage() {
  return (
    <Shell>
      <AccountPanel />
    </Shell>
  );
}

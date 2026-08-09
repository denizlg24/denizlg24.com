"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { DeployDomain } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { domainTone } from "@/components/deploy/status";
import { api, errorMessage } from "@/lib/api";

/** Long enough to catch a validation, short enough not to hammer Cloudflare. */
const POLL_MS = 15_000;

function VerificationRecords({ domain }: { domain: DeployDomain }) {
  const records = [
    ...(domain.verification?.ownership ?? []),
    ...(domain.verification?.ssl ?? []),
  ];
  if (domain.verification?.error) {
    return (
      <p className="text-xs text-destructive">{domain.verification.error}</p>
    );
  }
  if (records.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
      {records.map((record) => (
        <div
          key={`${record.name}:${record.value}`}
          className="flex flex-col gap-1"
        >
          <span className="text-xs text-muted-foreground">{record.type}</span>
          <div className="flex items-center gap-1">
            <Input readOnly value={record.name} className="font-mono text-xs" />
            <CopyButton value={record.name} label="record name" />
          </div>
          <div className="flex items-center gap-1">
            <Input
              readOnly
              value={record.value}
              className="font-mono text-xs"
            />
            <CopyButton value={record.value} label="record value" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What the domain does, which is the question the panel exists to answer. The
 * DNS status alone never did: five rows reading `active` say five records
 * exist, not which name the app is on.
 */
function RoleBadge({ domain }: { domain: DeployDomain }) {
  switch (domain.role) {
    case "canonical":
      return <Badge>canonical</Badge>;
    case "serves":
      return <Badge variant="secondary">serving</Badge>;
    case "redirects":
      return (
        <Badge variant="outline" className="font-normal">
          → {domain.redirectsTo}
        </Badge>
      );
    case "retired":
      return <Badge variant="secondary">retiring</Badge>;
    default:
      return null;
  }
}

/**
 * The name the platform gave the target. It is not a `deploy_domains` row, so
 * it never appeared in this list — and it is the one hostname that is always
 * live, which made its absence the most confusing thing on the page.
 */
function AutoHostnameRow({ hostname }: { hostname: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
      <StatusDot tone="good" label="active" />
      <a
        href={`https://${hostname}`}
        target="_blank"
        rel="noreferrer noopener"
        className="truncate font-mono text-xs hover:underline"
      >
        {hostname}
      </a>
      <Badge variant="outline">automatic</Badge>
      <Badge variant="secondary">serving</Badge>
    </div>
  );
}

export function DomainsPanel({
  targetId,
  autoHostname,
}: {
  targetId: string;
  autoHostname?: string | null;
}) {
  const fetchDomains = useCallback(
    () => api.deploy.domains(targetId),
    [targetId],
  );
  const { data, error, loading, reload } = usePoll(fetchDomains, POLL_MS);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (label: string, run: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await run();
        toast.success(label);
        await reload();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          value={hostname}
          placeholder="app.example.com"
          className="max-w-sm"
          onChange={(event) => setHostname(event.target.value)}
        />
        <Button
          size="sm"
          disabled={busy || hostname.trim().length === 0}
          onClick={() =>
            void act("Domain added", async () => {
              await api.deploy.addDomain(targetId, {
                hostname: hostname.trim(),
                isPrimary: false,
              });
              setHostname("");
            })
          }
        >
          Add
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {autoHostname && <AutoHostnameRow hostname={autoHostname} />}
        {(data ?? []).map((domain) => (
          <div
            key={domain.id}
            className="flex flex-col gap-2 rounded-lg border p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot
                  tone={domainTone(domain.status)}
                  label={domain.status}
                />
                <a
                  href={domain.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate font-mono text-xs hover:underline"
                >
                  {domain.hostname}
                </a>
                <Badge variant="outline">{domain.mode}</Badge>
                <RoleBadge domain={domain} />
              </span>
              <span className="flex items-center gap-1">
                {domain.status === "verifying" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act("Checked", () =>
                        api.deploy.verifyDomain(domain.id),
                      )
                    }
                  >
                    Check
                  </Button>
                )}
                {domain.status === "active" &&
                  !domain.isPrimary &&
                  domain.retiredAt === null && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act("Canonical set", () =>
                          api.deploy.updateDomain(domain.id, {
                            isPrimary: true,
                          }),
                        )
                      }
                    >
                      Make canonical
                    </Button>
                  )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act("Domain removed", () =>
                      api.deploy.removeDomain(domain.id),
                    )
                  }
                >
                  <Trash2 className="size-3" />
                </Button>
              </span>
            </div>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>checked {formatRelative(domain.lastCheckedAt)}</span>
              {/* A retired row keeps answering until the GC pass finishes the
                    rename, so when it stops is the useful fact, not that it is
                    going. */}
              {domain.retiredAt && (
                <span>stops {formatRelative(domain.retiredAt)}</span>
              )}
            </p>
            {domain.status === "verifying" && (
              <VerificationRecords domain={domain} />
            )}
          </div>
        ))}
        {!autoHostname && (data ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </div>
    </div>
  );
}

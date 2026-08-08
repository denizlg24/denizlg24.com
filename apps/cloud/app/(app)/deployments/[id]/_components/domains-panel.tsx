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

export function DomainsPanel({ targetId }: { targetId: string }) {
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

      {(data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <div className="flex flex-col gap-3">
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
                  {domain.isPrimary && <Badge>primary</Badge>}
                  {/* A retired row still routes for the rename grace period —
                      it is not dead, and showing it as gone would be a lie. */}
                  {domain.retiredAt && (
                    <Badge variant="secondary">retiring</Badge>
                  )}
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
                  {domain.status === "active" && !domain.isPrimary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act("Primary set", () =>
                          api.deploy.updateDomain(domain.id, {
                            isPrimary: true,
                          }),
                        )
                      }
                    >
                      Make primary
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
              <p className="text-xs text-muted-foreground">
                checked {formatRelative(domain.lastCheckedAt)}
              </p>
              {domain.status === "verifying" && (
                <VerificationRecords domain={domain} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

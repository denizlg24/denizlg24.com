"use client";

import { domainTone } from "@repo/cloud-ui/deploy-status";
import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { DeployDomain } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTarget } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";

/** Long enough to catch a validation, short enough not to hammer Cloudflare. */
const POLL_MS = 15_000;
const SERVE_DEPLOYMENT = "__serve_deployment__";

function DnsRecord({
  type,
  name,
  value,
}: {
  type: string;
  name: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex h-9 items-center font-mono text-xs">{type}</div>
      <div className="flex items-center gap-1">
        <Input readOnly value={name} className="font-mono text-xs" />
        <CopyButton value={name} label="record name" />
      </div>
      <div className="flex items-center gap-1">
        <Input readOnly value={value} className="font-mono text-xs" />
        <CopyButton value={value} label="record value" />
      </div>
    </div>
  );
}

/**
 * The records to add at the external provider. A `custom_hostname` sits outside
 * the managed zone, so nothing here can write them — they are the one thing on
 * this page that has to be carried somewhere else by hand.
 */
function VerificationRecords({
  domain,
  cnameTarget,
}: {
  domain: DeployDomain;
  cnameTarget: string | null;
}) {
  const records = [
    ...(domain.verification?.ownership ?? []),
    ...(domain.verification?.ssl ?? []),
  ];

  return (
    <div className="flex flex-col gap-3 border-l-2 pl-3">
      <p className="text-xs font-medium">DNS records</p>
      {cnameTarget ? (
        <DnsRecord type="CNAME" name={domain.hostname} value={cnameTarget} />
      ) : (
        <p className="text-xs text-muted-foreground">
          No managed hostname yet — deploy once.
        </p>
      )}
      {records.map((record) => (
        <DnsRecord
          key={`${record.type}:${record.name}:${record.value}`}
          type={record.type}
          name={record.name}
          value={record.value}
        />
      ))}
      {domain.verification?.error && (
        <p className="text-xs text-destructive">{domain.verification.error}</p>
      )}
    </div>
  );
}

/**
 * What the domain does, which is the question the page exists to answer. The
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

export default function DomainsPage() {
  const { target } = useTarget();
  const targetId = target.id;
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

  const domains = data ?? [];
  const cnameTarget =
    domains.find(
      (domain) => domain.mode === "zone_record" && domain.retiredAt === null,
    )?.hostname ??
    target.primaryHostname ??
    null;

  return (
    <Section title="Domains" count={domains.length}>
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

        <div className="flex flex-col">
          {domains.map((domain) => {
            const redirectTargets = domains.filter(
              (candidate) =>
                candidate.id !== domain.id &&
                candidate.retiredAt === null &&
                candidate.role !== "redirects" &&
                (candidate.status === "active" ||
                  candidate.hostname === domain.redirectsTo),
            );
            return (
              <div
                key={domain.id}
                className="flex flex-col gap-2 border-b py-3 last:border-b-0"
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
                    <Badge variant="outline">
                      {domain.mode === "zone_record"
                        ? "managed DNS"
                        : "external DNS"}
                    </Badge>
                    {domain.origin === "generated" && (
                      <Badge variant="ghost">generated</Badge>
                    )}
                    <RoleBadge domain={domain} />
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    {domain.status === "active" &&
                      domain.retiredAt === null && (
                        <Select
                          value={domain.redirectsTo ?? SERVE_DEPLOYMENT}
                          disabled={busy}
                          onValueChange={(value) =>
                            void act(
                              value === SERVE_DEPLOYMENT
                                ? "Domain now serves the deployment"
                                : `Domain redirects to ${value}`,
                              () =>
                                api.deploy.updateDomain(domain.id, {
                                  redirectTo:
                                    value === SERVE_DEPLOYMENT ? null : value,
                                }),
                            )
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-8 w-[15rem] font-mono text-xs"
                            aria-label={`Routing for ${domain.hostname}`}
                          >
                            <SelectValue placeholder="Select routing" />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value={SERVE_DEPLOYMENT}>
                              Serve deployment
                            </SelectItem>
                            {redirectTargets.map((candidate) => (
                              <SelectItem
                                key={candidate.id}
                                value={candidate.hostname}
                                className="font-mono text-xs"
                              >
                                Redirect to {candidate.hostname}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
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
                        Check DNS
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
                    {/* A generated name is not the owner's to delete — it is
                        retired automatically once a real domain is active, and
                        deleting it by hand leaves a target with no URL at all. */}
                    {domain.origin !== "generated" && (
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
                    )}
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
                {domain.mode === "custom_hostname" && (
                  <VerificationRecords
                    domain={domain}
                    cnameTarget={cnameTarget}
                  />
                )}
              </div>
            );
          })}
          {domains.length === 0 && (
            <p className="text-xs text-muted-foreground">—</p>
          )}
        </div>
      </div>
    </Section>
  );
}

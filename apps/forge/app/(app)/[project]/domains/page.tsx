"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Search } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { DomainRow } from "@/components/domain-row";
import { useTarget } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";

/** Long enough to catch a validation, short enough not to hammer Cloudflare. */
const POLL_MS = 15_000;

export default function DomainsPage() {
  const { target } = useTarget();
  const targetId = target.id;
  const fetchDomains = useCallback(
    () => api.deploy.domains(targetId),
    [targetId],
  );
  const { data, error, loading, reload } = usePoll(fetchDomains, POLL_MS);
  const [query, setQuery] = useState("");
  const [hostname, setHostname] = useState("");
  const [adding, setAdding] = useState(false);
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

  const submitHostname = () => {
    if (hostname.trim().length === 0) return;
    void act("Domain added", async () => {
      await api.deploy.addDomain(targetId, {
        hostname: hostname.trim(),
        isPrimary: false,
      });
      setHostname("");
      setAdding(false);
    });
  };

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-32 w-full" />;

  const domains = data ?? [];
  const cnameTarget =
    domains.find(
      (domain) => domain.mode === "zone_record" && domain.retiredAt === null,
    )?.hostname ??
    target.primaryHostname ??
    null;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? domains.filter((domain) => domain.hostname.toLowerCase().includes(needle))
    : domains;

  return (
    <Section
      title="Domains"
      count={needle ? `${visible.length}/${domains.length}` : domains.length}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="Search any domain"
              className="pl-9 text-xs"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant={adding ? "outline" : "default"}
            size="sm"
            onClick={() => setAdding((current) => !current)}
          >
            {adding ? "Cancel" : "Add domain"}
          </Button>
        </div>

        {adding ? (
          <div className="flex flex-wrap items-center gap-2 border-b pb-4">
            <Input
              autoFocus
              value={hostname}
              placeholder="app.example.com"
              className="max-w-sm font-mono text-xs"
              onChange={(event) => setHostname(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !busy) submitHostname();
              }}
            />
            <Button
              size="sm"
              disabled={busy || hostname.trim().length === 0}
              onClick={submitHostname}
            >
              Add
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col">
          {visible.map((domain) => (
            <DomainRow
              key={domain.id}
              domain={domain}
              busy={busy}
              cnameTarget={cnameTarget}
              siblings={domains.filter(
                (candidate) =>
                  candidate.id !== domain.id &&
                  candidate.retiredAt === null &&
                  candidate.role !== "redirects" &&
                  (candidate.status === "active" ||
                    candidate.hostname === domain.redirectsTo),
              )}
              onRefresh={() =>
                void act("Checked", () => api.deploy.verifyDomain(domain.id))
              }
              onSave={(input) =>
                void act("Domain updated", () =>
                  api.deploy.updateDomain(domain.id, input),
                )
              }
              onCanonical={() =>
                void act("Canonical set", () =>
                  api.deploy.updateDomain(domain.id, { isPrimary: true }),
                )
              }
              onRemove={() =>
                void act("Domain removed", () =>
                  api.deploy.removeDomain(domain.id),
                )
              }
            />
          ))}
          {visible.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

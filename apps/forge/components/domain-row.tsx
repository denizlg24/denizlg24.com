"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { DeployDomain } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { OptionSelect } from "@repo/ui/option-select";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import { cn } from "@repo/ui/utils";
import {
  ArrowUpCircle,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CornerUpRight,
  TriangleAlert,
} from "lucide-react";
import { useId, useState } from "react";

/**
 * A row is one domain, closed. Everything it can do — the records to add at a
 * registrar, the routing it takes — opens underneath it, because the question
 * a list of domains answers is "which of these is broken", and eight expanded
 * record tables answer it worse than eight lines do.
 */

const SERVE = "serve";
const REDIRECT = "redirect";
type Routing = typeof SERVE | typeof REDIRECT;

function StatusIcon({ domain }: { domain: DeployDomain }) {
  if (domain.status === "active") {
    return <CircleCheck className="size-4 shrink-0 text-primary" />;
  }
  if (domain.status === "failed") {
    return <TriangleAlert className="size-4 shrink-0 text-destructive" />;
  }
  return <CircleDashed className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * What the domain does, which the DNS status alone never said: five rows
 * reading `active` say five records exist, not which name the app is on.
 */
function RoleLabel({ domain }: { domain: DeployDomain }) {
  if (domain.role === "redirects") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CornerUpRight className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{domain.redirectsTo}</span>
      </span>
    );
  }
  if (domain.role === "retired") {
    return <span className="text-xs text-muted-foreground">retiring</span>;
  }
  if (domain.role === "pending") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <ArrowUpCircle className="size-3.5 shrink-0" />
      {domain.role === "canonical" ? "canonical" : "serving"}
    </span>
  );
}

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
    <div className="grid items-center gap-2 border-b py-2 last:border-b-0 sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.4fr)]">
      <span className="font-mono text-xs uppercase">{type}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-xs">{name}</span>
        <CopyButton value={name} label="record name" />
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-xs">{value}</span>
        <CopyButton value={value} label="record value" />
      </span>
    </div>
  );
}

/**
 * The records to add at the external provider. A `custom_hostname` sits outside
 * the managed zone, so nothing here can write them — they are the one thing on
 * this page that has to be carried somewhere else by hand.
 */
function DnsPanel({
  domain,
  cnameTarget,
}: {
  domain: DeployDomain;
  cnameTarget: string | null;
}) {
  // A managed name's records are written by us, so the only thing it can owe
  // the reader is the validation error. Rendering the CNAME row for it would be
  // an instruction to point a name at itself.
  const external = domain.mode === "custom_hostname";
  const records = external
    ? [
        ...(domain.verification?.ownership ?? []),
        ...(domain.verification?.ssl ?? []),
      ]
    : [];

  return (
    <div className="mt-3 border-t pt-3">
      {external ? (
        <>
          <div className="grid gap-2 border-b pb-2 text-[11px] uppercase tracking-wider text-muted-foreground sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.4fr)]">
            <span>type</span>
            <span>name</span>
            <span>value</span>
          </div>
          {cnameTarget ? (
            <DnsRecord
              type="CNAME"
              name={domain.hostname}
              value={cnameTarget}
            />
          ) : null}
          {records.map((record) => (
            <DnsRecord
              key={`${record.type}:${record.name}:${record.value}`}
              type={record.type}
              name={record.name}
              value={record.value}
            />
          ))}
          {!cnameTarget && records.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">—</p>
          ) : null}
        </>
      ) : null}
      {domain.verification?.error ? (
        <p className="pt-2 text-xs text-destructive">
          {domain.verification.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The routing editor. A rename is add-swap-remove server-side, so the hostname
 * field mints a new record rather than rewriting this one — which is why it is
 * saved through the same button as the routing and not treated as a rename.
 */
function EditPanel({
  domain,
  siblings,
  busy,
  onCancel,
  onSave,
  onRemove,
  onCanonical,
}: {
  domain: DeployDomain;
  siblings: readonly DeployDomain[];
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { hostname?: string; redirectTo?: string | null }) => void;
  onRemove: () => void;
  onCanonical: () => void;
}) {
  const groupId = useId();
  const [hostname, setHostname] = useState(domain.hostname);
  const [routing, setRouting] = useState<Routing>(
    domain.redirectsTo === null ? SERVE : REDIRECT,
  );
  const [redirectTo, setRedirectTo] = useState<string | null>(
    domain.redirectsTo,
  );

  const renamed = hostname.trim() !== domain.hostname;
  const nextRedirect = routing === SERVE ? null : redirectTo;
  const rerouted = nextRedirect !== domain.redirectsTo;
  const savable =
    hostname.trim().length > 0 &&
    (renamed || rerouted) &&
    (routing === SERVE || redirectTo !== null);

  return (
    <div className="mt-3 flex flex-col gap-4 border-t pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${groupId}-hostname`} className="text-xs">
          Domain
        </Label>
        <Input
          id={`${groupId}-hostname`}
          value={hostname}
          disabled={busy || domain.origin === "generated"}
          className="font-mono text-xs"
          onChange={(event) => setHostname(event.target.value)}
        />
      </div>

      <RadioGroup
        value={routing}
        disabled={busy}
        onValueChange={(value) => setRouting(value as Routing)}
        className="gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <RadioGroupItem value={SERVE} id={`${groupId}-serve`} />
            <Label htmlFor={`${groupId}-serve`} className="text-xs font-normal">
              Serve deployment
            </Label>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <RadioGroupItem value={REDIRECT} id={`${groupId}-redirect`} />
            <Label
              htmlFor={`${groupId}-redirect`}
              className="text-xs font-normal"
            >
              Redirect to
            </Label>
          </span>
          <OptionSelect
            value={redirectTo}
            disabled={busy || routing !== REDIRECT || siblings.length === 0}
            onValueChange={setRedirectTo}
            placeholder={siblings.length === 0 ? "no target" : "select domain"}
            aria-label={`Redirect target for ${domain.hostname}`}
            className="w-[18rem] font-mono"
            options={siblings.map((candidate) => ({
              value: candidate.hostname,
              label: candidate.hostname,
            }))}
          />
        </div>
      </RadioGroup>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* A generated name is not the owner's to delete — it is retired
            automatically once a real domain is active, and deleting it by hand
            leaves a target with no URL at all. */}
        {domain.origin === "generated" ? (
          <span />
        ) : (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={onRemove}
          >
            Remove
          </Button>
        )}
        <span className="flex items-center gap-2">
          {domain.status === "active" &&
          !domain.isPrimary &&
          domain.retiredAt === null &&
          domain.role !== "redirects" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onCanonical}
            >
              Make canonical
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !savable}
            onClick={() =>
              onSave({
                ...(renamed ? { hostname: hostname.trim() } : {}),
                ...(rerouted ? { redirectTo: nextRedirect } : {}),
              })
            }
          >
            Save
          </Button>
        </span>
      </div>
    </div>
  );
}

export function DomainRow({
  domain,
  siblings,
  cnameTarget,
  busy,
  onRefresh,
  onSave,
  onRemove,
  onCanonical,
}: {
  domain: DeployDomain;
  /** Domains this one may redirect to. */
  siblings: readonly DeployDomain[];
  cnameTarget: string | null;
  busy: boolean;
  onRefresh: () => void;
  onSave: (input: { hostname?: string; redirectTo?: string | null }) => void;
  onRemove: () => void;
  onCanonical: () => void;
}) {
  const [panel, setPanel] = useState<"dns" | "edit" | null>(null);
  const configured = domain.status === "active";
  // A record in our own zone is written by us, so there is nothing for anyone to
  // carry to a registrar and no records worth showing — unless the validation
  // came back with something to say, which is the one case where a managed name
  // still owes an explanation.
  const hasDnsPanel =
    domain.mode === "custom_hostname" || Boolean(domain.verification?.error);

  return (
    <div className="border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5">
            <StatusIcon domain={domain} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <a
              href={domain.url}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate font-mono text-sm hover:underline"
            >
              {domain.hostname}
            </a>
            <div className="flex flex-wrap items-center gap-2">
              {configured ? (
                <span className="text-xs text-muted-foreground">
                  valid configuration
                </span>
              ) : (
                <Badge variant="destructive" className="font-normal">
                  needs configuration
                </Badge>
              )}
              {domain.origin === "generated" ? (
                <Badge variant="ghost" className="text-muted-foreground">
                  generated
                </Badge>
              ) : null}
              {hasDnsPanel ? (
                <button
                  type="button"
                  aria-expanded={panel === "dns"}
                  onClick={() =>
                    setPanel((current) => (current === "dns" ? null : "dns"))
                  }
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {panel === "dns" ? "hide" : "view"} DNS configuration
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      panel === "dns" && "rotate-180",
                    )}
                  />
                </button>
              ) : null}
              <span className="text-xs text-muted-foreground">
                checked {formatRelative(domain.lastCheckedAt)}
              </span>
              {/* A retired row keeps answering until the GC pass finishes the
                  rename, so when it stops is the useful fact, not that it is
                  going. */}
              {domain.retiredAt ? (
                <span className="text-xs text-muted-foreground">
                  stops {formatRelative(domain.retiredAt)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <RoleLabel domain={domain} />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onRefresh}
          >
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || domain.retiredAt !== null}
            aria-expanded={panel === "edit"}
            onClick={() =>
              setPanel((current) => (current === "edit" ? null : "edit"))
            }
          >
            Edit
          </Button>
        </div>
      </div>

      {panel === "dns" ? (
        <DnsPanel domain={domain} cnameTarget={cnameTarget} />
      ) : null}
      {panel === "edit" ? (
        <EditPanel
          domain={domain}
          siblings={siblings}
          busy={busy}
          onCancel={() => setPanel(null)}
          onSave={(input) => {
            setPanel(null);
            onSave(input);
          }}
          onRemove={onRemove}
          onCanonical={onCanonical}
        />
      ) : null}
    </div>
  );
}

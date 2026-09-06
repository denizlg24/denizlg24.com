import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { NativeSelect } from "@repo/ui/native-select";
import { Textarea } from "@repo/ui/textarea";
import { Activity, HeartPulse, RefreshCw, Trash2 } from "lucide-react";
import { adminAction } from "@/app/admin/actions";
import type {
  DiscoveredSource,
  SourceBinding,
  StatusConfig,
} from "@/lib/config";
import { resolveBinding } from "@/lib/config";
import type { Service } from "@/lib/model";
import { Disclosure, Field, Fields } from "./admin-forms";
import { SectionHeading } from "./shell";
import { Time } from "./time";

function bindingSummary(binding: SourceBinding, services: Service[]) {
  if (binding.kind === "ignore")
    return <Badge variant="outline">Not shown</Badge>;
  if (binding.kind === "own")
    return <Badge variant="secondary">Own tile · {binding.name}</Badge>;
  const service = services.find((item) => item.id === binding.serviceId);
  return (
    <Badge variant="secondary">
      Feeds {service?.name ?? binding.serviceId}
    </Badge>
  );
}
/**
 * Discovery is not adoption. Everything Better Stack reports shows up here, and
 * nothing reaches the public page until it is bound — which is what stops a
 * monitor pointed at somebody else's domain from becoming a service tile.
 */
export function SourcesAdmin({
  sources,
  config,
  services,
  groups,
}: {
  sources: DiscoveredSource[];
  config: StatusConfig;
  services: Service[];
  groups: string[];
}) {
  const bound = sources.filter(
    (source) => resolveBinding(config, source).kind !== "ignore",
  ).length;
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {bound} of {sources.length} Better Stack source
          {sources.length === 1 ? "" : "s"} in use
        </p>
        <form action={adminAction}>
          <Fields operation="sources-refresh" />
          <Button type="submit" size="sm" variant="outline">
            <RefreshCw aria-hidden />
            Detect sources
          </Button>
        </form>
      </div>
      {(["monitor", "heartbeat"] as const).map((kind) => {
        const items = sources.filter((source) => source.kind === kind);
        if (!items.length) return null;
        const Icon = kind === "monitor" ? Activity : HeartPulse;
        return (
          <section className="mb-8" key={kind}>
            <SectionHeading
              title={kind === "monitor" ? "Monitors" : "Heartbeats"}
              note={`${items.length}`}
            />
            {items.map((source) => {
              const binding = resolveBinding(config, source);
              const explicit = config.bindings[source._id] !== undefined;
              return (
                <Disclosure
                  key={source._id}
                  summary={
                    <>
                      <Icon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="truncate font-medium">
                        {source.name}
                      </span>
                      {bindingSummary(binding, services)}
                      {source.missingSince ? (
                        <Badge variant="destructive">Gone upstream</Badge>
                      ) : null}
                      {!explicit ? (
                        <span className="text-xs text-muted-foreground">
                          default
                        </span>
                      ) : null}
                    </>
                  }
                  note={source.upstreamStatus ?? "—"}
                >
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                    {[
                      ["Source id", source._id],
                      ["Type", source.monitorType ?? "—"],
                      ["URL", source.url ?? "—"],
                    ].map(([term, value]) => (
                      <div className="min-w-0" key={term}>
                        <dt className="text-muted-foreground uppercase">
                          {term}
                        </dt>
                        <dd className="truncate font-mono">{value}</dd>
                      </div>
                    ))}
                    <div className="min-w-0">
                      <dt className="text-muted-foreground uppercase">
                        Last checked
                      </dt>
                      <dd className="truncate">
                        <Time value={source.lastCheckedAt} />
                      </dd>
                    </div>
                  </dl>
                  <form action={adminAction} className="max-w-xl space-y-4">
                    <Fields operation="config-binding" id={source._id} />
                    <Field
                      label="What this source does"
                      hint="Ignored sources keep collecting in Better Stack; they just do not appear here."
                    >
                      <NativeSelect
                        name="kind"
                        defaultValue={binding.kind}
                        className="w-full"
                      >
                        <option value="ignore">Ignore</option>
                        <option value="service">
                          Report into an existing service
                        </option>
                        <option value="own">Give it its own tile</option>
                      </NativeSelect>
                    </Field>
                    <Field label="Existing service (when reporting into one)">
                      <NativeSelect
                        name="serviceId"
                        defaultValue={
                          binding.kind === "service" ? binding.serviceId : ""
                        }
                        className="w-full"
                      >
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Tile name (own tile)">
                        <Input
                          name="name"
                          defaultValue={
                            binding.kind === "own" ? binding.name : source.name
                          }
                          maxLength={80}
                        />
                      </Field>
                      <Field label="Group (own tile)">
                        <NativeSelect
                          name="group"
                          defaultValue={
                            binding.kind === "own"
                              ? binding.group
                              : "Other services"
                          }
                          className="w-full"
                        >
                          {groups.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                    </div>
                    <Field label="Description (own tile)">
                      <Textarea
                        name="description"
                        rows={2}
                        maxLength={400}
                        defaultValue={
                          binding.kind === "own"
                            ? binding.description
                            : source.kind === "monitor"
                              ? "External monitoring by Better Stack."
                              : "Scheduled heartbeat monitored by Better Stack."
                        }
                      />
                    </Field>
                    <Button type="submit" size="sm">
                      Save binding
                    </Button>
                  </form>
                  <form action={adminAction}>
                    <Fields operation="config-source-forget" id={source._id} />
                    <Button type="submit" size="sm" variant="ghost">
                      <Trash2 aria-hidden />
                      Forget this source
                    </Button>
                  </form>
                </Disclosure>
              );
            })}
          </section>
        );
      })}
      {!sources.length ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nothing discovered yet — run a collection or press Detect sources.
        </p>
      ) : null}
    </section>
  );
}

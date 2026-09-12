import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/tooltip";
import { cn } from "@repo/ui/utils";
import { Info } from "lucide-react";
import type { PublicData } from "@/lib/data";
import { availability, dailyHealth, healthLabels } from "@/lib/health";
import { Dot, headlines, healthBanner, healthText } from "./health";
import { IncidentTimeline } from "./incident";
import { SectionHeading } from "./shell";
import { UptimeBar } from "./uptime-bar";

export { Dot } from "./health";

export function Overview({ data }: { data: PublicData }) {
  // "All services are online" would be a lie while some are not reporting, but
  // so would "No recent data" while the rest demonstrably are.
  const silent = data.services.filter(
    (service) => service.status === "unknown",
  ).length;
  const headline =
    data.status === "operational" && silent
      ? "All reporting services are online"
      : headlines[data.status];
  return (
    <h1
      className={cn(
        "mb-8 rounded-md px-5 py-5 text-lg font-semibold tracking-tight sm:text-xl",
        healthBanner[data.status],
      )}
    >
      {headline}
    </h1>
  );
}
export function ServiceList({ data }: { data: PublicData }) {
  const today = Date.parse(`${data.generatedAt.slice(0, 10)}T00:00:00Z`);
  const window = Array.from({ length: 90 }, (_, index) =>
    new Date(today - (89 - index) * 86400_000).toISOString().slice(0, 10),
  );
  const byService = new Map(
    data.services.map((service) => [
      service.id,
      new Map(
        data.daily
          .filter((day) => day.serviceId === service.id)
          .map((day) => [day.day, day]),
      ),
    ]),
  );
  return (
    <section>
      {data.groups.map((group) => {
        const services = data.services.filter(
          (service) => service.group === group,
        );
        if (!services.length) return null;
        return (
          <section className="mb-10" key={group}>
            <SectionHeading title={group} />
            <div className="divide-y">
              {services.map((service) => {
                const indexed = byService.get(service.id) ?? new Map();
                const measured = availability(Array.from(indexed.values()));
                const days = window.map((day) => {
                  const count = indexed.get(day);
                  return {
                    day,
                    status: dailyHealth(count),
                    measured: count
                      ? count.operational + count.degraded + count.down
                      : 0,
                    down: count?.down ?? 0,
                  };
                });
                return (
                  <article className="py-4" key={service.id} id={service.id}>
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <Dot status={service.status} />
                        <span className="truncate">{service.name}</span>
                        <Tooltip>
                          <TooltipTrigger
                            aria-label={`About ${service.name}`}
                            className="text-muted-foreground/60 hover:text-foreground shrink-0 transition-colors"
                          >
                            <Info aria-hidden className="size-3.5" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-64">
                            {service.description}
                          </TooltipContent>
                        </Tooltip>
                      </h3>
                      <Tooltip>
                        <TooltipTrigger
                          className={cn(
                            "shrink-0 text-xs tabular-nums",
                            service.status === "operational"
                              ? "text-muted-foreground"
                              : healthText[service.status],
                          )}
                        >
                          {measured.percent === null
                            ? healthLabels[service.status]
                            : `${measured.percent.toFixed(3)}%`}
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {healthLabels[service.status]} ·{" "}
                          {measured.measured.toLocaleString()} measured minutes
                          over 90 days
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <UptimeBar days={days} label={service.name} />
                    <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                      <span>90 days ago</span>
                      <span>Today</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </section>
  );
}
export function ActiveIncidents({ data }: { data: PublicData }) {
  const active = data.incidents.filter((incident) => !incident.resolvedAt);
  if (!active.length) return null;
  return (
    <aside aria-label="Active incidents" className="mb-10 divide-y">
      {active.map((incident) => (
        <IncidentTimeline key={incident.id} incident={incident} compact />
      ))}
    </aside>
  );
}

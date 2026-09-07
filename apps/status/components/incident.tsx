import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { PublicData } from "@/lib/data";
import { Dot, healthText } from "./health";
import { Time } from "./time";

export const incidentStateLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Cause confirmed",
  monitoring: "Monitoring recovery",
  resolved: "Resolved",
};

export function IncidentTimeline({
  incident,
  compact = false,
}: {
  incident: PublicData["incidents"][number];
  compact?: boolean;
}) {
  const resolved = !!incident.resolvedAt;
  const state = resolved
    ? "resolved"
    : (incident.updates.at(-1)?.state ?? "investigating");
  const updates = compact ? incident.updates.slice(-1) : incident.updates;
  return (
    <article id={compact ? undefined : incident.id} className="py-6">
      <div className="mb-2 flex items-center gap-2.5">
        <Dot status={resolved ? "operational" : "down"} />
        <span
          className={`text-[11px] font-medium tracking-wide uppercase ${resolved ? "text-muted-foreground" : healthText.down}`}
        >
          {incidentStateLabels[state] ?? state}
        </span>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground tabular-nums">
          <Time value={incident.startedAt} short />
        </span>
      </div>
      <h2 className="text-base font-medium">
        {compact ? (
          <Link
            prefetch={false}
            href={`/incidents#${incident.id}`}
            className="group flex items-center justify-between gap-3 hover:underline underline-offset-4"
          >
            {incident.title}
            <ArrowUpRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </Link>
        ) : (
          incident.title
        )}
      </h2>
      {!updates.length ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {incident.explanation}
        </p>
      ) : (
        <ol className="mt-3 space-y-3 border-l pl-4">
          {updates.toReversed().map((update) => (
            <li key={update.id} className="relative">
              <span className="bg-border absolute top-1.5 -left-[21px] size-2 rounded-full" />
              <div className="flex items-baseline gap-2">
                <strong className="text-xs font-medium">
                  {incidentStateLabels[update.state] ?? update.state}
                </strong>
                <span className="text-xs text-muted-foreground tabular-nums">
                  <Time value={update.at} />
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {update.text}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-muted-foreground tabular-nums">
        Started <Time value={incident.startedAt} />
        {incident.resolvedAt ? (
          <>
            {" "}
            · Resolved <Time value={incident.resolvedAt} />
          </>
        ) : null}
      </p>
    </article>
  );
}

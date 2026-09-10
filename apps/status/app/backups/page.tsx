import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/tooltip";
import { cn } from "@repo/ui/utils";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Dot, healthText } from "@/components/health";
import { Live } from "@/components/live";
import { Loading, PageNav, SectionHeading } from "@/components/shell";
import { Time } from "@/components/time";
import { formatDuration, publicData } from "@/lib/data";
import { healthLabels } from "@/lib/health";
import type { Health } from "@/lib/model";
export const metadata: Metadata = {
  title: "Backups",
  description: "Backup runs, verified snapshots, and offsite copies.",
  alternates: { canonical: "/backups" },
};
function stateLabel(health: Health, status: string, enabled: boolean) {
  if (health === "unknown") return enabled ? "No data" : "Paused";
  if (health === "degraded")
    return status === "running" ? "Running too long" : "Overdue";
  if (status === "running") return "Running now";
  if (status === "pending") return "Queued";
  if (status === "completed") return "Completed";
  return healthLabels[health];
}
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {term}
      </dt>
      <dd className="mt-0.5 truncate text-sm tabular-nums">{children}</dd>
    </div>
  );
}
async function Content() {
  await connection();
  const data = await publicData();
  return (
    <Live at={data.at} generatedAt={data.generatedAt}>
      {(["cloud", "dr"] as const).map((provider) => {
        const backups = data.backups.filter(
          (backup) => backup.provider === provider,
        );
        return (
          <section className="mb-10" key={provider}>
            <SectionHeading
              title={
                provider === "cloud" ? "Scheduled backups" : "Disaster recovery"
              }
              note={
                provider === "cloud"
                  ? "Databases & files"
                  : "Local snapshots & offsite copies"
              }
            />
            {!backups.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No data
              </p>
            ) : (
              <div className="divide-y">
                {backups.map((backup) => (
                  <article className="py-4" key={backup.id}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <Dot status={backup.health} />
                        <span className="truncate">{backup.name}</span>
                      </h3>
                      <Tooltip>
                        <TooltipTrigger
                          className={cn(
                            "shrink-0 text-xs",
                            backup.health === "operational"
                              ? "text-muted-foreground"
                              : healthText[backup.health],
                          )}
                        >
                          {stateLabel(
                            backup.health,
                            backup.status,
                            backup.enabled,
                          )}
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Reported <Time value={backup.reportedAt || null} />
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                      <Fact term="Last successful">
                        <Time value={backup.lastSuccessAt} />
                      </Fact>
                      <Fact
                        term={
                          backup.status === "running" ? "Started" : "Last run"
                        }
                      >
                        <Time value={backup.startedAt} />
                      </Fact>
                      <Fact
                        term={
                          backup.status === "running"
                            ? "Elapsed"
                            : "Total run time"
                        }
                      >
                        {formatDuration(backup.durationMs)}
                      </Fact>
                      <Fact term="Next scheduled">
                        {!backup.enabled ? (
                          "Paused"
                        ) : backup.status === "running" && !backup.nextRunAt ? (
                          "Timer active · running now"
                        ) : (
                          <Time value={backup.nextRunAt} />
                        )}
                      </Fact>
                    </dl>
                    {backup.runSummary ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {backup.runSummary}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </Live>
  );
}
export default function Page() {
  return (
    <>
      <PageNav active="/backups" />
      <Suspense fallback={<Loading />}>
        <Content />
      </Suspense>
    </>
  );
}

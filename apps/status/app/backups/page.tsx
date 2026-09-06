import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Live } from "@/components/live";
import { Loading, PageNav } from "@/components/shell";
import { Dot } from "@/components/status";
import { Time } from "@/components/time";
import { formatDuration, publicData } from "@/lib/data";
import { healthLabels } from "@/lib/health";
export const metadata: Metadata = {
  title: "Backups",
  description: "Backup runs, verified snapshots, and offsite copies.",
  alternates: { canonical: "/backups" },
};
async function Content() {
  await connection();
  const data = await publicData();
  return (
    <Live at={data.at} generatedAt={data.generatedAt}>
      {(["cloud", "dr"] as const).map((provider) => (
        <section className="backup-section" key={provider}>
          <div className="section-heading">
            <h2>
              {provider === "cloud" ? "Scheduled backups" : "Offsite copies"}
            </h2>
            <span className="section-note">
              {provider === "cloud"
                ? "Databases & files"
                : "Pi · Forge · offsite"}
            </span>
          </div>
          {!data.backups.some((backup) => backup.provider === provider) ? (
            <p className="empty-state">No data</p>
          ) : (
            data.backups
              .filter((backup) => backup.provider === provider)
              .map((backup) => (
                <article className="backup-row" key={backup.id}>
                  <div className="backup-name">
                    <h3>
                      <Dot status={backup.health} />
                      {backup.name}
                    </h3>
                    <span className={`health-label ${backup.health}`}>
                      {backup.health === "unknown"
                        ? "No data"
                        : backup.status === "running"
                          ? "Running now"
                          : backup.status === "pending"
                            ? "Queued"
                            : backup.health === "degraded"
                              ? "Overdue"
                              : backup.status === "completed"
                                ? "Completed"
                                : healthLabels[backup.health]}
                    </span>
                  </div>
                  <dl className="backup-facts">
                    <div>
                      <dt>Last successful</dt>
                      <dd>
                        <Time value={backup.lastSuccessAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>
                        {backup.status === "running" ? "Started" : "Last run"}
                      </dt>
                      <dd>
                        <Time value={backup.startedAt} />
                      </dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatDuration(backup.durationMs)}</dd>
                    </div>
                    <div>
                      <dt>Next scheduled</dt>
                      <dd>
                        {!backup.enabled ? (
                          "Paused"
                        ) : (
                          <Time value={backup.nextRunAt} />
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))
          )}
        </section>
      ))}
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

import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Dot, HealthIcon, healthText } from "@/components/health";
import { Live } from "@/components/live";
import { Loading, PageNav, SectionHeading } from "@/components/shell";
import { Time } from "@/components/time";
import { publicData } from "@/lib/data";
export const metadata: Metadata = {
  title: "Incidents",
  description: "Incident history for the last 90 days.",
  alternates: { canonical: "/incidents" },
};
const stateLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Cause confirmed",
  monitoring: "Monitoring recovery",
  resolved: "Resolved",
};
async function Content() {
  await connection();
  const data = await publicData();
  return (
    <Live at={data.at} generatedAt={data.generatedAt}>
      <SectionHeading title="Previous incidents" note="Last 90 days" />
      {data.incidents.length ? (
        <div className="divide-y">
          {data.incidents.map((incident) => {
            const resolved = !!incident.resolvedAt;
            return (
              <article id={incident.id} key={incident.id} className="py-6">
                <div className="mb-2 flex items-center gap-2.5">
                  <Dot status={resolved ? "operational" : "down"} />
                  <span
                    className={`text-[11px] font-medium tracking-wide uppercase ${
                      resolved ? "text-muted-foreground" : healthText.down
                    }`}
                  >
                    {resolved ? "Resolved" : "Investigating"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <Time value={incident.startedAt} short />
                  </span>
                </div>
                <h2 className="text-base font-medium">{incident.title}</h2>
                {!incident.updates.length ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {incident.explanation}
                  </p>
                ) : (
                  <ol className="mt-3 space-y-3 border-l pl-4">
                    {incident.updates.toReversed().map((update) => (
                      <li key={update.id} className="relative">
                        <span className="bg-border absolute top-1.5 -left-[21px] size-2 rounded-full" />
                        <div className="flex items-baseline gap-2">
                          <strong className="text-xs font-medium">
                            {stateLabels[update.state] ?? update.state}
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
                      {" · "}Resolved <Time value={incident.resolvedAt} />
                    </>
                  ) : null}
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <HealthIcon
            status={data.available ? "operational" : "unknown"}
            className="size-6"
          />
          <p className="text-sm text-muted-foreground">
            {data.available ? "No incidents" : "No data"}
          </p>
        </div>
      )}
    </Live>
  );
}
export default function Page() {
  return (
    <>
      <PageNav active="/incidents" />
      <Suspense fallback={<Loading />}>
        <Content />
      </Suspense>
    </>
  );
}

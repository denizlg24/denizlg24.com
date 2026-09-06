import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Live } from "@/components/live";
import { Loading, PageNav } from "@/components/shell";
import { Dot } from "@/components/status";
import { Time } from "@/components/time";
import { publicData } from "@/lib/data";
export const metadata: Metadata = {
  title: "Incidents",
  description: "Incident history for the last 90 days.",
  alternates: { canonical: "/incidents" },
};
async function Content() {
  await connection();
  const data = await publicData();
  return (
    <Live at={data.at} generatedAt={data.generatedAt}>
      <div className="section-heading">
        <h2>Previous incidents</h2>
        <span className="section-note">Last 90 days</span>
      </div>
      {data.incidents.length ? (
        data.incidents.map((incident) => (
          <article id={incident.id} key={incident.id} className="incident-row">
            <div className="incident-date">
              <Time value={incident.startedAt} short />
              <span
                className={`health-label ${incident.resolvedAt ? "operational" : "down"}`}
              >
                <Dot status={incident.resolvedAt ? "operational" : "down"} />
                {incident.resolvedAt ? "Resolved" : "Investigating"}
              </span>
            </div>
            <div className="incident-body">
              <h2>{incident.title}</h2>
              {!incident.updates.length ? (
                <p>{incident.explanation}</p>
              ) : (
                <ol className="timeline">
                  {incident.updates.toReversed().map((update) => (
                    <li key={update.id}>
                      <div>
                        <strong>{update.state}</strong>
                        <Time value={update.at} />
                      </div>
                      <p>{update.text}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="incident-meta">
                Started <Time value={incident.startedAt} />
                {incident.resolvedAt ? (
                  <>
                    {" · "}Resolved <Time value={incident.resolvedAt} />
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))
      ) : (
        <div className="empty-state">
          <Dot status={data.available ? "operational" : "unknown"} />
          <h3>{data.available ? "No incidents" : "No data"}</h3>
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

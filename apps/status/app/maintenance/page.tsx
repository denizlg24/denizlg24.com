import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Live } from "@/components/live";
import { Loading, PageNav } from "@/components/shell";
import { Time } from "@/components/time";
import { publicData } from "@/lib/data";
export const metadata: Metadata = {
  title: "Maintenance",
  description: "Planned maintenance windows.",
  alternates: { canonical: "/maintenance" },
};
async function Content() {
  await connection();
  const data = await publicData();
  const now = Date.parse(data.generatedAt);
  return (
    <Live at={data.at} generatedAt={data.generatedAt}>
      {[false, true].map((past) => (
        <section className="backup-section" key={String(past)}>
          <div className="section-heading">
            <h2>{past ? "Completed" : "Scheduled"}</h2>
          </div>
          {data.maintenance
            .filter((window) => Date.parse(window.endsAt) <= now === past)
            .map((window) => (
              <article className="maintenance-row" key={window.id}>
                <div className="section-note">
                  {Date.parse(window.endsAt) <= now
                    ? "Ended"
                    : Date.parse(window.startsAt) <= now
                      ? "In progress"
                      : "Scheduled"}
                </div>
                <h3>{window.title}</h3>
                <p>{window.description}</p>
                <p className="maintenance-services">
                  {window.serviceIds
                    .map(
                      (id) =>
                        data.services.find((service) => service.id === id)
                          ?.name ?? id,
                    )
                    .join(" · ")}
                </p>
                <span className="maintenance-window">
                  <Time value={window.startsAt} /> —{" "}
                  <Time value={window.endsAt} />
                </span>
              </article>
            ))}
          {!data.maintenance.some(
            (window) => Date.parse(window.endsAt) <= now === past,
          ) ? (
            <p className="empty-state">
              {past ? "None recorded" : "None scheduled"}
            </p>
          ) : null}
        </section>
      ))}
    </Live>
  );
}
export default function Page() {
  return (
    <>
      <PageNav active="/maintenance" />
      <Suspense fallback={<Loading />}>
        <Content />
      </Suspense>
    </>
  );
}

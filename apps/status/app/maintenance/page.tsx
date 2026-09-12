import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { Live } from "@/components/live";
import { Loading, PageNav, SectionHeading } from "@/components/shell";
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
      {[false, true].map((past) => {
        const windows = data.maintenance.filter(
          (window) => Date.parse(window.endsAt) <= now === past,
        );
        return (
          <section className="mb-10" key={String(past)}>
            <SectionHeading title={past ? "Completed" : "Scheduled"} />
            {!windows.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {past ? "None recorded" : "None scheduled"}
              </p>
            ) : (
              <div className="divide-y">
                {windows.map((window) => {
                  const ended = Date.parse(window.endsAt) <= now;
                  const running = !ended && Date.parse(window.startsAt) <= now;
                  return (
                    <article className="py-4" key={window.id}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className={`text-[11px] font-medium tracking-wide uppercase ${
                            running
                              ? "text-status-info"
                              : "text-muted-foreground"
                          }`}
                        >
                          {ended
                            ? "Ended"
                            : running
                              ? "In progress"
                              : "Scheduled"}
                        </span>
                        <span className="h-px flex-1 bg-border" />
                        <span className="text-xs text-muted-foreground tabular-nums">
                          <Time value={window.startsAt} /> —{" "}
                          <Time value={window.endsAt} />
                        </span>
                      </div>
                      <h3 className="text-sm font-medium">{window.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {window.description}
                      </p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {window.serviceIds
                          .map(
                            (id) =>
                              data.services.find((service) => service.id === id)
                                ?.name ?? id,
                          )
                          .join(" · ")}
                      </p>
                    </article>
                  );
                })}
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
      <PageNav active="/maintenance" />
      <Suspense fallback={<Loading />}>
        <Content />
      </Suspense>
    </>
  );
}

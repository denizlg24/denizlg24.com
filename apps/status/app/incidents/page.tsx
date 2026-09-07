import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { HealthIcon } from "@/components/health";
import { IncidentTimeline } from "@/components/incident";
import { Live } from "@/components/live";
import { Loading, PageNav, SectionHeading } from "@/components/shell";
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
      <SectionHeading title="Previous incidents" note="Last 90 days" />
      {data.incidents.length ? (
        <div className="divide-y">
          {data.incidents.map((incident) => (
            <IncidentTimeline key={incident.id} incident={incident} />
          ))}
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

import { connection } from "next/server";
import { Suspense } from "react";
import { Live } from "@/components/live";
import { Loading, PageNav } from "@/components/shell";
import { ActiveIncidents, Overview, ServiceList } from "@/components/status";
import { publicData } from "@/lib/data";

async function StatusContent() {
  await connection();
  const data = await publicData();
  return (
    <Live at={data.at} generatedAt={data.generatedAt}>
      <Overview data={data} />
      <ActiveIncidents data={data} />
      <ServiceList data={data} />
    </Live>
  );
}
export default function Page() {
  return (
    <>
      <PageNav active="/" />
      <Suspense fallback={<Loading />}>
        <StatusContent />
      </Suspense>
    </>
  );
}

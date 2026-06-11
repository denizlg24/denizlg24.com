import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { DashboardOverview } from "./_components/dashboard-overview";

export default async function Page() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  return (
    <div className="w-full mx-auto">
      <DashboardOverview />
    </div>
  );
}

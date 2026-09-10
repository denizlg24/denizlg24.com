import { requireAdminPage } from "@/lib/require-admin";
import { DashboardOverview } from "./_components/dashboard-overview";
import { DASHBOARD_APP_SCOPE } from "./pwa-config";

export default async function Page() {
  await requireAdminPage(DASHBOARD_APP_SCOPE);

  return (
    <div className="w-full mx-auto">
      <DashboardOverview />
    </div>
  );
}

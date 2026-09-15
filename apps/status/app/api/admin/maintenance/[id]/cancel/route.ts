import { audited, cancelMaintenance, maintenanceView } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const POST = adminRoute<{ id: string }>(
  async ({ actor, params }) => {
    const window = await audited(actor, "maintenance-cancel", params.id, () =>
      cancelMaintenance(actor, params.id),
    );
    return { maintenance: maintenanceView(window, Date.now()) };
  },
  { write: true },
);

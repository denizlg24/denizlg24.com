import { statusMaintenanceInputSchema } from "@repo/schemas/status";
import { audited, maintenanceView, saveMaintenance } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const PATCH = adminRoute<{ id: string }>(
  async ({ actor, params, body }) => {
    const input = statusMaintenanceInputSchema.parse(await body());
    const window = await audited(actor, "maintenance-save", params.id, () =>
      saveMaintenance(actor, params.id, input),
    );
    return { maintenance: maintenanceView(window, Date.now()) };
  },
  { write: true },
);

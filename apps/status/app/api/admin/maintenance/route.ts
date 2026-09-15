import { statusMaintenanceInputSchema } from "@repo/schemas/status";
import {
  audited,
  listMaintenance,
  maintenanceView,
  saveMaintenance,
} from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const GET = adminRoute(() => listMaintenance());

export const POST = adminRoute(
  async ({ actor, body }) => {
    const input = statusMaintenanceInputSchema.parse(await body());
    const window = await audited(actor, "maintenance-save", input.title, () =>
      saveMaintenance(actor, null, input),
    );
    return { maintenance: maintenanceView(window, Date.now()) };
  },
  { write: true, status: 201 },
);

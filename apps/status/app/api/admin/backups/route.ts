import { backupsOverview } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const GET = adminRoute(() => backupsOverview());

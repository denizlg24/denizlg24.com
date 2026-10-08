import type { MacrosModerationOverview } from "@repo/schemas/macros";
import { NextResponse } from "next/server";

import { adminRoute } from "@/lib/api/admin-route";
import { getOverview } from "@/lib/moderation/admin";

export const dynamic = "force-dynamic";

export function GET() {
  return adminRoute(async () =>
    NextResponse.json((await getOverview()) satisfies MacrosModerationOverview),
  );
}

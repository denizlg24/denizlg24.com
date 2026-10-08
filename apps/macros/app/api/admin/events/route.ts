import type { MacrosModerationEventsResponse } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { z } from "zod";

import { adminRoute, invalid } from "@/lib/api/admin-route";
import { listEvents } from "@/lib/moderation/admin";

const querySchema = z.object({
  subject: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function GET(request: Request) {
  return adminRoute(async () => {
    const params = new URL(request.url).searchParams;
    const query = querySchema.safeParse({
      subject: params.get("subject") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!query.success) return invalid(query.error.issues);
    return NextResponse.json({
      events: await listEvents({
        subjectId: query.data.subject,
        limit: query.data.limit,
      }),
    } satisfies MacrosModerationEventsResponse);
  });
}

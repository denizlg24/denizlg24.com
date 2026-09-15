import { statusSamplesQuerySchema } from "@repo/schemas/status";
import { serviceSamples } from "@/lib/admin-ops";
import { adminRoute } from "@/lib/admin-route";

export const GET = adminRoute<{ id: string }>(({ params, query }) =>
  serviceSamples(
    params.id,
    statusSamplesQuerySchema.parse(Object.fromEntries(query.entries())).minutes,
  ),
);

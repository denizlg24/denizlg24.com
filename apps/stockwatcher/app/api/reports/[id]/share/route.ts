import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import { links } from "@/lib/reports/service";
import { reportIdSchema, setSharing } from "@/lib/reports/store";

async function change(
  request: Request,
  ctx: RouteContext<"/api/reports/[id]/share">,
  share: boolean,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to share reports." }, 401);
  const id = reportIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid report id." }, 400);
  const summary = await setSharing(user.id, id.data, share);
  if (!summary) return json({ error: "Report not found." }, 404);
  const published = links(summary, appOrigin(request));
  return json({ ...published, token: summary.shareToken });
}

export const POST = (
  request: Request,
  ctx: RouteContext<"/api/reports/[id]/share">,
) => change(request, ctx, true);

export const DELETE = (
  request: Request,
  ctx: RouteContext<"/api/reports/[id]/share">,
) => change(request, ctx, false);

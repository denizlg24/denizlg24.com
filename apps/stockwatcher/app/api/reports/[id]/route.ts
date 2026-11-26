import { z } from "zod";
import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import { BodyError, issue, message, readBody } from "@/lib/reports/http";
import { resolveDeck, resolveReport } from "@/lib/reports/resolve";
import { links } from "@/lib/reports/service";
import {
  deleteReport,
  getReport,
  reportIdSchema,
  updateReport,
} from "@/lib/reports/store";
import {
  type Deck,
  deckInputSchema,
  type Report,
  reportInputSchema,
} from "@/lib/reports/types";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    doc: z.unknown().optional(),
  })
  .refine((body) => body.title !== undefined || body.doc !== undefined, {
    message: "Send a title or a doc",
  });

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/reports/[id]">,
) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view reports." }, 401);
  const id = reportIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid report id." }, 400);
  const found = await getReport(user.id, id.data);
  if (!found) return json({ error: "Report not found." }, 404);
  return json({ ...found, ...links(found, appOrigin(request)) });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/reports/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit reports." }, 401);
  const id = reportIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid report id." }, 400);
  let body: unknown;
  try {
    body = await readBody(request);
  } catch (error) {
    return error instanceof BodyError
      ? json({ error: error.message }, error.status)
      : json({ error: "Invalid request body." }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return json({ error: issue(parsed.error) }, 400);
  const current = await getReport(user.id, id.data);
  if (!current) return json({ error: "Report not found." }, 404);
  try {
    let doc: Report | Deck | undefined;
    if (parsed.data.doc !== undefined) {
      if (current.kind === "deck") {
        const input = deckInputSchema.safeParse(parsed.data.doc);
        if (!input.success) return json({ error: issue(input.error) }, 400);
        doc = await resolveDeck(input.data);
      } else {
        const input = reportInputSchema.safeParse(parsed.data.doc);
        if (!input.success) return json({ error: issue(input.error) }, 400);
        doc = await resolveReport(input.data);
      }
    }
    const updated = await updateReport(user.id, id.data, {
      title: parsed.data.title,
      doc,
    });
    if (!updated) return json({ error: "Report not found." }, 404);
    return json({ ...updated, ...links(updated, appOrigin(request)) });
  } catch (error) {
    return json(
      { error: message(error, "The report could not be saved.") },
      422,
    );
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/reports/[id]">,
) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to edit reports." }, 401);
  const id = reportIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json({ error: "Invalid report id." }, 400);
  return (await deleteReport(user.id, id.data))
    ? json({ ok: true })
    : json({ error: "Report not found." }, 404);
}

import { knowledgeSourceKeySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAllSourceKeys } from "@/lib/knowledge/catalog";
import { enqueueKnowledgeReindex } from "@/lib/knowledge/reindex";
import { requireAdmin } from "@/lib/require-admin";

const bodySchema = z
  .object({
    sourceKeys: z.array(knowledgeSourceKeySchema).max(5_000).optional(),
    all: z.boolean().optional(),
  })
  .refine((body) => body.all || (body.sourceKeys?.length ?? 0) > 0, {
    message: "Provide sourceKeys or all",
  });

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reindex input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const keys = parsed.data.all
      ? await listAllSourceKeys()
      : (parsed.data.sourceKeys ?? []);
    await enqueueKnowledgeReindex(keys);
    return NextResponse.json({ queued: new Set(keys).size }, { status: 200 });
  } catch (error) {
    console.error("Failed to queue knowledge reindex:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

import { macrosHealthImportBodySchema } from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { importHealthData } from "@/lib/body/service";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  if (!token)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = macrosHealthImportBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid import", issues: parsed.error.issues },
      { status: 400 },
    );
  const result = await importHealthData(token, parsed.data);
  return result
    ? NextResponse.json(result)
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

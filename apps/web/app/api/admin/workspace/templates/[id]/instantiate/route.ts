import { templateInstantiateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace, workspaceClock } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const input = await readBody(request, templateInstantiateSchema);
    return NextResponse.json(
      {
        page: await service.instantiateTemplate(
          id,
          input,
          caller,
          await workspaceClock(),
        ),
      },
      { status: 201 },
    );
  });
}

import {
  type SurfaceAssetAdd,
  surfaceAssetAddSchema,
  surfaceAssetNameSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { WorkspaceError } from "@/lib/workspace/service";
import { addSurfaceAsset } from "@/lib/workspace/surfaces";

export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

async function readMultipart(request: NextRequest): Promise<SurfaceAssetAdd> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const name = surfaceAssetNameSchema.safeParse(form?.get("name"));
  if (!(file instanceof File) || !name.success) {
    throw new WorkspaceError(
      400,
      "INVALID_INPUT",
      "Expected a `file` and a valid `name`",
    );
  }
  return {
    name: name.data,
    contentType: file.type || "application/octet-stream",
    dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
  };
}

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const multipart = (request.headers.get("content-type") ?? "").startsWith(
      "multipart/form-data",
    );
    const input = multipart
      ? await readMultipart(request)
      : await readBody(request, surfaceAssetAddSchema);
    return NextResponse.json(await addSurfaceAsset(id, input));
  });
}

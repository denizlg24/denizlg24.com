import { currentUser, json, sameOrigin } from "@/lib/auth";
import { ExtractError } from "@/lib/documents/extract";
import { ingestUpload } from "@/lib/documents/ingest";
import { DocumentError, listDocuments } from "@/lib/documents/store";
import { documentLimits } from "@/lib/documents/types";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view documents." }, 401);
  return json({
    documents: user.demo ? [] : await listDocuments(user.id),
    demo: user.demo,
    limits: {
      uploadBytes: documentLimits.uploadBytes,
      perUser: documentLimits.perUser,
    },
  });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to upload documents." }, 401);
  if (user.demo)
    return json({ error: "Documents are not available in the demo." }, 403);
  const header = request.headers.get("content-length");
  const declared = header === null || header.trim() === "" ? NaN : Number(header);
  if (!Number.isInteger(declared) || declared < 0)
    return json({ error: "Uploads must declare their size." }, 411);
  if (declared > documentLimits.uploadBytes + 1_000_000)
    return json({ error: "The file is larger than 25 MB." }, 413);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Invalid upload." }, 400);
  }
  try {
    return json(await ingestUpload(user.id, form), 201);
  } catch (error) {
    if (error instanceof ExtractError) return json({ error: error.message }, 422);
    if (error instanceof DocumentError)
      return json({ error: error.message }, error.status);
    console.error("Document upload failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ error: "The document could not be processed." }, 500);
  }
}

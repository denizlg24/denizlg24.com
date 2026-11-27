import { enquirySchema, notifyEnquiry, saveEnquiry } from "@/lib/enquiries";

const recent = new Map<string, number[]>();

function allow(key: string) {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60 * 60_000);
  if (hits.length >= 5) return false;
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5_000) recent.clear();
  return true;
}

const clientKey = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  "unknown";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send the form as JSON." }, { status: 400 });
  }
  if (
    body &&
    typeof body === "object" &&
    "website" in body &&
    typeof body.website === "string" &&
    body.website.trim()
  )
    return Response.json({ ok: true });

  const parsed = enquirySchema.safeParse(body);
  if (!parsed.success)
    return Response.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Check the form and try again.",
        field: parsed.error.issues[0]?.path[0],
      },
      { status: 422 },
    );
  if (!allow(clientKey(request)))
    return Response.json(
      { error: "Too many enquiries from here. Try again in an hour." },
      { status: 429 },
    );

  const enquiry = await saveEnquiry(parsed.data);
  await notifyEnquiry(enquiry);
  return Response.json({ ok: true });
}

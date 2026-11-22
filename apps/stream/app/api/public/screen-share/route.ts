import { z } from "zod";
import {
  closeScreenShare,
  publishScreenSignal,
  readScreenShare,
  screenShareIce,
} from "@/lib/screen-share";

const signal = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(48_000),
});

function keyFrom(request: Request) {
  return /^Cast ([\w-]{43})$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
}

const missing = () => new Response(null, { status: 404 });

export async function GET(request: Request) {
  const key = keyFrom(request);
  const share = key && (await readScreenShare(key));
  if (!share) return missing();
  const ice = new URL(request.url).searchParams.has("ice")
    ? screenShareIce()
    : {};
  return Response.json(
    { ...share, ...ice },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const key = keyFrom(request);
  if (!key) return missing();
  // Bound the read even when the caller sends a chunked body.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 64_000) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = signal.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { type, sdp } = parsed.data;
  return (await publishScreenSignal(key, type, sdp))
    ? new Response(null, { status: 204 })
    : missing();
}

export async function DELETE(request: Request) {
  const key = keyFrom(request);
  if (!key) return missing();
  await closeScreenShare(key);
  return new Response(null, { status: 204 });
}

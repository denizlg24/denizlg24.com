import "server-only";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { AccessError, type Actor, requireActor } from "./auth";

const MAX_BODY_BYTES = 128 * 1024;
const noStore = { "Cache-Control": "no-store" };

export type RouteContext<P extends Record<string, string>> = {
  params: Promise<P>;
};

/**
 * The admin API's one handler shape: authenticate, run, serialise. An
 * `AccessError` is the status it names, a schema failure is 400 with the
 * first issue, anything else is 500 without its message — the audit row has
 * it. Writes invalidate the public page like the server actions do.
 */
export function adminRoute<
  P extends Record<string, string> = Record<never, string>,
>(
  handler: (input: {
    request: Request;
    actor: Actor;
    params: P;
    body: () => Promise<unknown>;
    query: URLSearchParams;
  }) => Promise<unknown>,
  options: { write?: boolean; status?: number } = {},
) {
  return async (request: Request, context: RouteContext<P>) => {
    try {
      const actor = await requireActor(request);
      const params = await context.params;
      const body = async () => {
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
          throw new AccessError(413, "Body too large.");
        const text = await request.text();
        if (!text) return {};
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new AccessError(400, "Body must be JSON.");
        }
      };
      const result = await handler({
        request,
        actor,
        params,
        body,
        query: new URL(request.url).searchParams,
      });
      if (options.write) revalidateTag("status-public", { expire: 0 });
      return Response.json(result, {
        status: options.status ?? 200,
        headers: noStore,
      });
    } catch (error) {
      if (error instanceof AccessError)
        return Response.json(
          { error: error.message },
          { status: error.status, headers: noStore },
        );
      if (error instanceof z.ZodError)
        return Response.json(
          {
            error: error.issues[0]?.message ?? "Invalid input",
            issues: error.issues,
          },
          { status: 400, headers: noStore },
        );
      if (error instanceof Error && error.message.startsWith("Better Stack"))
        return Response.json(
          { error: error.message },
          { status: 502, headers: noStore },
        );
      console.error(
        "Status admin API failed",
        error instanceof Error ? error.name : "unknown",
      );
      return Response.json(
        { error: "The operation failed; check the audit log." },
        { status: 500, headers: noStore },
      );
    }
  };
}

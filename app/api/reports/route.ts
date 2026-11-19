import { appOrigin, currentUser, json, sameOrigin } from "@/lib/auth";
import {
  BodyError,
  createSchema,
  issue,
  message,
  readBody,
} from "@/lib/reports/http";
import { publish } from "@/lib/reports/service";
import { listReports } from "@/lib/reports/store";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view reports." }, 401);
  return json(await listReports(user.id));
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to create reports." }, 401);
  let body: unknown;
  try {
    body = await readBody(request);
  } catch (error) {
    return error instanceof BodyError
      ? json({ error: error.message }, error.status)
      : json({ error: "Invalid request body." }, 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return json({ error: issue(parsed.error) }, 400);
  try {
    return json(await publish(user.id, appOrigin(request), parsed.data), 201);
  } catch (error) {
    return json(
      { error: message(error, "The document could not be created.") },
      422,
    );
  }
}

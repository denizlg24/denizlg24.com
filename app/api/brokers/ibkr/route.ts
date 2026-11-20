import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace, saveWorkspace } from "@/lib/db";
import {
  deleteLink,
  publicLink,
  readLink,
  writeLink,
} from "@/lib/brokers/link";
import { syncUser } from "@/lib/brokers/sync";

const connect = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{10,40}$/, "The Flex token is the long number IBKR generated."),
  queryId: z
    .string()
    .trim()
    .regex(/^\d{3,12}$/, "The Query ID is the number shown next to the query."),
});

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const link = await readLink(user.id);
  return json({ link: link ? publicLink(link) : null });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  let input: unknown = {};
  try {
    const body = await request.text();
    if (body) input = JSON.parse(body);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  if (input && typeof input === "object" && "token" in input) {
    const parsed = connect.safeParse(input);
    if (!parsed.success)
      return json(
        { error: parsed.error.issues[0]?.message ?? "Invalid credentials." },
        400,
      );
    const previous = await readLink(user.id);
    try {
      await writeLink(user.id, parsed.data.token, parsed.data.queryId);
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : "Unable to connect.",
        },
        500,
      );
    }
    const result = await syncUser(user.id);
    if (!result.ok && !previous) await deleteLink(user.id);
    const link = await readLink(user.id);
    return json(
      { result, link: link ? publicLink(link) : null },
      result.ok ? 200 : 422,
    );
  }
  if (!(await readLink(user.id)))
    return json({ error: "Interactive Brokers is not connected." }, 404);
  const result = await syncUser(user.id);
  const link = await readLink(user.id);
  return json(
    { result, link: link ? publicLink(link) : null },
    result.ok ? 200 : 422,
  );
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  await deleteLink(user.id);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readWorkspace(user.id);
    if (!current.data.books.some((book) => book.broker)) break;
    const books = current.data.books.map((book) => ({
      id: book.id,
      name: book.name,
    }));
    if (
      await saveWorkspace(user.id, current.revision, {
        ...current.data,
        books,
      })
    )
      break;
  }
  return json({ link: null });
}

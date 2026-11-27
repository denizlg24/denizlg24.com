import { currentUser, json } from "@/lib/auth";
import { searchThreads } from "@/lib/thread-library";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to search conversations." }, 401);
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 200) ?? "";
  return json(await searchThreads(user.id, query));
}

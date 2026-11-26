import { currentUser, json } from "@/lib/auth";
import { listThreads } from "@/lib/memory";

export async function GET() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to view conversations." }, 401);
  return json(await listThreads(user.id));
}

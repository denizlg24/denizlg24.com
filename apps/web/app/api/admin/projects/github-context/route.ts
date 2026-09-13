import { githubRepositoryContextRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getGitHubRepositoryContext } from "@/lib/github-repository-context";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const search = request.nextUrl.searchParams;
  const maxFiles = search.get("maxFiles");
  const parsed = githubRepositoryContextRequestSchema.safeParse({
    repository: search.get("repository") ?? search.get("repo") ?? undefined,
    branch: search.get("branch") ?? undefined,
    includePaths: search.getAll("includePaths").length
      ? search.getAll("includePaths")
      : undefined,
    maxFiles: maxFiles === null ? undefined : Number(maxFiles),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid repository request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await getGitHubRepositoryContext(parsed.data));
  } catch (error) {
    console.error("Failed to inspect GitHub repository:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to inspect GitHub repository",
      },
      { status: 502 },
    );
  }
}

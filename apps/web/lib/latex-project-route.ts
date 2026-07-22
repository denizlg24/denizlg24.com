import { NextResponse } from "next/server";
import {
  LatexProjectNotFoundError,
  LatexProjectRevisionConflictError,
} from "@/lib/latex-projects";

export function latexProjectErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof LatexProjectNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof LatexProjectRevisionConflictError) {
    return NextResponse.json(
      { error: error.message, project: error.current },
      { status: 409 },
    );
  }
  return null;
}

export function safeDownloadName(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

"use client";

import {
  type AgentUIMessage,
  type KnowledgeSourceKind,
  parseKnowledgeSourceKey,
  type StudyCitation,
} from "@repo/schemas";
import { FileText, Layers, Mic, NotebookPen } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { AdminContextValue } from "../provider";
import { getDocument } from "./study-api";

export const STUDY_ICON = <Layers />;

export const SOURCE_KIND_ICON: Record<KnowledgeSourceKind, ReactNode> = {
  note: <NotebookPen />,
  document: <FileText />,
  "voice-note": <Mic />,
};

export const SOURCE_KIND_LABEL: Record<KnowledgeSourceKind, string> = {
  note: "Note",
  document: "PDF",
  "voice-note": "Voice note",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(
  iso: string | undefined,
  now = Date.now(),
): string {
  if (!iso) return "—";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "—";
  const diff = now - at;
  const ahead = diff < 0;
  const abs = Math.abs(diff);
  const label =
    abs < MINUTE
      ? "now"
      : abs < HOUR
        ? `${Math.round(abs / MINUTE)}m`
        : abs < DAY
          ? `${Math.round(abs / HOUR)}h`
          : abs < 30 * DAY
            ? `${Math.round(abs / DAY)}d`
            : abs < 365 * DAY
              ? `${Math.round(abs / (30 * DAY))}mo`
              : `${(abs / (365 * DAY)).toFixed(1)}y`;
  if (label === "now") return label;
  return ahead ? `in ${label}` : `${label} ago`;
}

export function percent(score: number | undefined): string {
  return score === undefined ? "—" : `${Math.round(score * 100)}%`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function pageLabel(page: { start: number; end: number } | undefined) {
  if (!page) return null;
  return page.start === page.end
    ? `p. ${page.start}`
    : `pp. ${page.start}–${page.end}`;
}

/** The message's `data-citations` part, ordered by marker number. */
export function messageCitations(message: AgentUIMessage): StudyCitation[] {
  let found: StudyCitation[] = [];
  for (const part of message.parts) {
    if (part.type === "data-citations") found = part.data;
  }
  return [...found].sort((left, right) => left.n - right.n);
}

/** Opens a cited source, or a source row, wherever this host shows it. */
export async function openStudySource(
  admin: Pick<AdminContextValue, "client" | "platform" | "routes">,
  source: { sourceKey: string; page?: { start: number; end: number } },
): Promise<void> {
  const parsed = parseKnowledgeSourceKey(source.sourceKey);
  if (!parsed) return;
  const modules = admin.routes.workspace.modules;
  if (parsed.kind === "note") {
    if (!modules.notes) return;
    await admin.platform.navigate(
      `${modules.notes}?note=${encodeURIComponent(parsed.id)}`,
    );
    return;
  }
  if (parsed.kind === "voice-note") {
    const href = modules["voice-notes"];
    if (href) await admin.platform.navigate(href);
    return;
  }
  try {
    const document = await getDocument(admin.client, parsed.id);
    const anchor = source.page ? `#page=${source.page.start}` : "";
    await admin.platform.openExternal(`${document.fileUrl}${anchor}`);
  } catch (error) {
    toast.error(errorMessage(error, "Failed to open document"));
  }
}

/** `?tab=x` on top of a route that may already carry a query. */
export function withParam(path: string, key: string, value: string): string {
  const [base, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

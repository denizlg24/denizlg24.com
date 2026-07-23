"use client";

import type { LatexProject } from "@repo/latex-editor";
import { LatexDiffView } from "@repo/latex-editor/diff-view";
import type { LatexAgentEditProposal } from "@repo/schemas";
import { fingerprintLatexSource } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  History,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";

export interface LatexAgentReviewState {
  proposals: LatexAgentEditProposal[];
  apply: (proposal: LatexAgentEditProposal) => void;
  reject: (proposal: LatexAgentEditProposal) => void;
  applyAll: () => void;
  rejectAll: () => void;
}

export interface LatexHistoryDiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  before: string;
  after: string;
}

export interface LatexHistoryPreview {
  snapshotId: string;
  label: string;
  sublabel: string;
  files: LatexHistoryDiffFile[];
  restore: () => void;
  restoring: boolean;
  close: () => void;
}

function utf8Content(project: LatexProject, path: string): string | null {
  const entry = project.entries.find(
    (candidate) => candidate.kind === "file" && candidate.path === path,
  );
  return entry?.kind === "file" && entry.encoding === "utf8"
    ? entry.content
    : null;
}

function proposalDiff(
  proposal: LatexAgentEditProposal,
  project: LatexProject,
): { original: string; modified: string; stale: boolean } {
  if (proposal.kind === "create") {
    return { original: "", modified: proposal.content, stale: false };
  }
  if (proposal.kind === "rename") {
    return { original: "", modified: "", stale: false };
  }
  const content = utf8Content(project, proposal.filePath);
  if (proposal.kind === "delete") {
    return {
      original: content ?? proposal.beforePreview,
      modified: "",
      stale:
        content === null ||
        fingerprintLatexSource(content) !== proposal.expectedFingerprint,
    };
  }
  const sliceMatches =
    content !== null &&
    proposal.to <= content.length &&
    fingerprintLatexSource(content.slice(proposal.from, proposal.to)) ===
      proposal.expectedFingerprint;
  if (content !== null && sliceMatches) {
    return {
      original: content,
      modified: `${content.slice(0, proposal.from)}${proposal.replacement}${content.slice(proposal.to)}`,
      stale: false,
    };
  }
  return {
    original: proposal.beforePreview,
    modified: proposal.replacement,
    stale: true,
  };
}

export function AgentReviewOverlay({
  review,
  index,
  onIndexChange,
  project,
}: {
  review: LatexAgentReviewState;
  index: number;
  onIndexChange: (index: number) => void;
  project: LatexProject;
}) {
  const clamped = Math.min(index, review.proposals.length - 1);
  const proposal = review.proposals[clamped];
  if (!proposal) return null;
  const total = review.proposals.length;
  const diff = proposalDiff(proposal, project);
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-primary/5 px-3">
        <FilePenLine className="size-4 shrink-0 text-primary" />
        <span className="text-xs font-medium">
          {total > 1 ? `Change ${clamped + 1} of ${total}` : "Proposed change"}
        </span>
        {total > 1 ? (
          <span className="flex items-center">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous change"
              disabled={clamped === 0}
              onClick={() => onIndexChange(clamped - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next change"
              disabled={clamped >= total - 1}
              onClick={() => onIndexChange(clamped + 1)}
            >
              <ChevronRight />
            </Button>
          </span>
        ) : null}
        {diff.stale ? (
          <span className="flex items-center gap-1 text-[11px] text-destructive">
            <TriangleAlert className="size-3.5" /> file changed since proposed
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {total > 1 ? (
            <>
              <Button size="xs" variant="ghost" onClick={review.rejectAll}>
                Reject all
              </Button>
              <Button size="xs" variant="outline" onClick={review.applyAll}>
                Apply all
              </Button>
            </>
          ) : null}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => review.reject(proposal)}
          >
            <X /> Reject
          </Button>
          <Button size="xs" onClick={() => review.apply(proposal)}>
            <Check /> Apply
          </Button>
        </span>
      </div>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{proposal.filePath}</span>
        {proposal.kind === "rename" ? (
          <>
            <ArrowRight className="size-3.5" />
            <span className="font-mono text-foreground">
              {proposal.targetPath}
            </span>
          </>
        ) : null}
        <Badge variant="outline" className="text-[10px] capitalize">
          {proposal.kind}
        </Badge>
        <span className="min-w-0 truncate" title={proposal.explanation}>
          {proposal.explanation}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {proposal.kind === "rename" ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            rename only — no content changes
          </div>
        ) : (
          <LatexDiffView
            original={diff.original}
            modified={diff.modified}
            filePath={proposal.filePath}
          />
        )}
      </div>
    </>
  );
}

const HISTORY_STATUS_STYLES: Record<LatexHistoryDiffFile["status"], string> = {
  added: "text-primary",
  modified: "text-amber-600",
  deleted: "text-destructive",
};

export function HistoryDiffOverlay({
  preview,
  activePath,
  onSelectPath,
  onClose,
}: {
  preview: LatexHistoryPreview;
  activePath: string | null;
  onSelectPath: (path: string) => void;
  onClose: () => void;
}) {
  const file =
    preview.files.find((candidate) => candidate.path === activePath) ??
    preview.files[0];
  return (
    <>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/40 px-3">
        <History className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{preview.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {preview.sublabel}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={preview.restoring}
            onClick={preview.restore}
          >
            <RotateCcw /> Restore
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Close history diff"
            onClick={onClose}
          >
            <X />
          </Button>
        </span>
      </div>
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {preview.files.map((candidate) => (
          <button
            key={candidate.path}
            type="button"
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded px-2 font-mono text-[11px]",
              candidate.path === file?.path
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
            onClick={() => onSelectPath(candidate.path)}
          >
            <span
              className={cn(
                "font-semibold",
                HISTORY_STATUS_STYLES[candidate.status],
              )}
            >
              {candidate.status === "added"
                ? "+"
                : candidate.status === "deleted"
                  ? "−"
                  : "~"}
            </span>
            {candidate.path}
          </button>
        ))}
        {preview.files.length === 0 ? (
          <span className="px-1 text-[11px] text-muted-foreground">
            no source changes in this version
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {file ? (
          <LatexDiffView
            original={file.before}
            modified={file.after}
            filePath={file.path}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            —
          </div>
        )}
      </div>
    </>
  );
}

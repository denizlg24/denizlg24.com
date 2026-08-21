"use client";

import type { ICourseReadingSummary, IPaper } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { FileUp, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { PapersResponse } from "../papers/papers-page";
import {
  dueLabel,
  isOverdue,
  percentRead,
  READING_STATUS_LABEL,
} from "../papers/reading";
import { useAdmin } from "../provider";

export function CourseReadingsPanel({
  courseId,
  readings,
  onRefresh,
}: {
  courseId: string;
  readings: ICourseReadingSummary[];
  onRefresh: () => Promise<void>;
}) {
  const { client, platform } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachable, setAttachable] = useState<IPaper[]>([]);
  const [busy, setBusy] = useState(false);

  // Refetched on every open: unlinking a reading here, or adding one anywhere
  // else, changes what is attachable, and a cached list never shows either.
  const loadAttachable = async () => {
    try {
      const result = await client.get<PapersResponse>("papers");
      setAttachable(
        result.papers.filter((paper) => !paper.courseIds.includes(courseId)),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Load failed");
    }
  };

  const attach = async (paperId: string) => {
    const paper = attachable.find((candidate) => candidate._id === paperId);
    if (!paper) return;
    setBusy(true);
    try {
      await client.patch(`papers/${paperId}`, {
        courseIds: [...paper.courseIds, courseId],
      });
      setAttachable((current) =>
        current.filter((candidate) => candidate._id !== paperId),
      );
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Link failed");
    } finally {
      setBusy(false);
    }
  };

  const detach = async (readingId: string) => {
    setBusy(true);
    try {
      await client.del(`papers/${readingId}/courses/${courseId}`);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unlink failed");
    } finally {
      setBusy(false);
    }
  };

  const uploadReading = async (file: File) => {
    setBusy(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const uploaded = await client.upload<{ pdf: IPaper["pdf"] }>(
        "papers/upload",
        data,
      );
      await client.post("papers", {
        title: file.name.replace(/\.pdf$/i, ""),
        type: "other",
        pdf: uploaded.pdf,
        citable: false,
        courseIds: [courseId],
      });
      await onRefresh();
      toast.success("Reading added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select
          value=""
          onOpenChange={(open) => open && void loadAttachable()}
          onValueChange={(paperId) => void attach(paperId)}
        >
          <SelectTrigger size="sm" className="flex-1">
            <SelectValue placeholder="Link reading" />
          </SelectTrigger>
          <SelectContent>
            {attachable.map((paper) => (
              <SelectItem key={paper._id} value={paper._id}>
                {paper.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadReading(file);
            event.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileUp className="size-3.5" />
          )}
          Upload
        </Button>
      </div>

      {readings.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">—</p>
      ) : (
        <div>
          {readings.map((reading) => {
            const percent = percentRead(
              reading.currentPage,
              reading.totalPages,
              reading.readingStatus,
            );
            const due = dueLabel(reading.dueAt);
            const overdue = isOverdue(reading);
            return (
              <div
                key={reading._id}
                className="group border-b border-border/60 py-2 last:border-b-0"
              >
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
                    onClick={() =>
                      platform.navigate(
                        `/papers?paper=${encodeURIComponent(reading._id)}`,
                      )
                    }
                  >
                    {reading.title}
                  </button>
                  <Badge
                    variant={
                      reading.readingStatus === "reading"
                        ? "default"
                        : "secondary"
                    }
                    className="shrink-0 text-[9px]"
                  >
                    {READING_STATUS_LABEL[reading.readingStatus]}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0 opacity-0 group-hover:opacity-100"
                    disabled={busy}
                    onClick={() => void detach(reading._id)}
                    aria-label={`Unlink ${reading.title}`}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
                <div className="mt-1 flex items-center gap-3 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {reading.authorLine && (
                    <span className="min-w-0 truncate">
                      {reading.authorLine}
                    </span>
                  )}
                  <span className="flex-1" />
                  {percent !== undefined && (
                    <span>
                      p. {reading.currentPage ?? "—"} /{" "}
                      {reading.totalPages ?? "—"} · {percent}%
                    </span>
                  )}
                  {due && (
                    <span className={overdue ? "text-destructive" : ""}>
                      {due}
                    </span>
                  )}
                </div>
                {percent !== undefined && (
                  <div className="mt-1.5 h-px bg-border">
                    <div
                      className="h-px bg-foreground/60"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

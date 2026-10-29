"use client";

import type { ICourseReadingSummary, IPaper } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { List, ListRow } from "@repo/ui/list";
import { Meter } from "@repo/ui/meter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { BookOpen, FileUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
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
  const { client, routes } = useAdmin();
  const router = useRouter();
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          value=""
          onOpenChange={(open) => open && void loadAttachable()}
          onValueChange={(paperId) => void attach(paperId)}
          disabled={busy}
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
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? <Spinner className="size-3.5" /> : <FileUp />}
          Upload
        </Button>
      </div>

      {readings.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No readings</p>
      ) : (
        <List>
          {readings.map((reading) => {
            const percent = percentRead(
              reading.currentPage,
              reading.totalPages,
              reading.readingStatus,
            );
            const due = dueLabel(reading.dueAt);
            const overdue = isOverdue(reading);
            return (
              <div key={reading._id} className="flex flex-col">
                <ListRow
                  leading={<BookOpen />}
                  title={reading.title}
                  description={reading.authorLine || undefined}
                  onClick={() =>
                    router.push(
                      `${routes.papers.root}?paper=${encodeURIComponent(reading._id)}`,
                    )
                  }
                  meta={
                    <>
                      {percent !== undefined && (
                        <span>
                          p. {reading.currentPage ?? "—"}/
                          {reading.totalPages ?? "—"} · {percent}%
                        </span>
                      )}
                      {due && (
                        <span className={cn(overdue && "text-status-critical")}>
                          {due}
                        </span>
                      )}
                      <Badge
                        variant={
                          reading.readingStatus === "reading"
                            ? "info"
                            : "secondary"
                        }
                      >
                        {READING_STATUS_LABEL[reading.readingStatus]}
                      </Badge>
                    </>
                  }
                  trailing={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void detach(reading._id);
                      }}
                      aria-label={`Unlink ${reading.title}`}
                    >
                      <X />
                    </Button>
                  }
                />
                {percent !== undefined && (
                  <Meter value={percent / 100} className="mb-1 ml-8 w-auto" />
                )}
              </div>
            );
          })}
        </List>
      )}
    </div>
  );
}

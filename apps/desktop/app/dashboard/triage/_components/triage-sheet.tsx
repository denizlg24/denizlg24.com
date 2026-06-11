"use client";

import {
  Archive,
  Calendar,
  Check,
  ChevronDown,
  Loader2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { denizApi } from "@/lib/api-wrapper";
import type { IEmailTriage } from "@/lib/data-types";
import { CategoryBadge } from "./category-badge";

interface DetailResponse {
  triage: IEmailTriage;
  email: {
    _id: string;
    accountId: string;
    subject: string;
    from: { name?: string; address: string }[];
    date: string;
    threadId?: string;
    body: { text: string; html: string } | null;
  };
}

function formatUserStatus(status: IEmailTriage["userStatus"]): string {
  if (status === "pending") return "Pending";
  if (status === "reviewed") return "Reviewed";
  return "Archived";
}

export function TriageSheet({
  triageId,
  open,
  onOpenChange,
  api,
  onSuggestionUpdated,
}: {
  triageId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: denizApi;
  onSuggestionUpdated: () => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (!triageId || !open) {
      setDetail(null);
      return;
    }
    setLoading(true);
    api
      .GET<DetailResponse>({ endpoint: `triage/${triageId}` })
      .then((res) => {
        if (!("code" in res)) setDetail(res);
        else toast.error("Failed to load triage");
      })
      .finally(() => setLoading(false));
  }, [triageId, open, api]);

  if (!open) return null;

  const handleSuggestion = async (
    suggestionId: string,
    type: "task" | "event",
    action: "accept" | "dismiss",
  ) => {
    if (!triageId) return;
    setPendingIds((prev) => new Set(prev).add(suggestionId));

    const res = await api.PATCH<{ ok: boolean; error?: string }>({
      endpoint: `triage/${triageId}/suggestions/${suggestionId}`,
      body: { type, action },
    });

    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(suggestionId);
      return next;
    });

    if ("code" in res || res.ok === false) {
      toast.error(
        "error" in res && typeof res.error === "string"
          ? res.error
          : "message" in res
            ? res.message
            : "Failed",
      );
      return;
    }

    toast.success(action === "accept" ? "Accepted" : "Dismissed");
    await onSuggestionUpdated();
    // refresh local detail
    const refreshed = await api.GET<DetailResponse>({
      endpoint: `triage/${triageId}`,
    });
    if (!("code" in refreshed)) setDetail(refreshed);
  };

  const handleStatusChange = async (nextStatus: IEmailTriage["userStatus"]) => {
    if (!triageId) return;

    setUpdatingStatus(true);
    const res = await api.PATCH<{ ok: boolean; error?: string }>({
      endpoint: `triage/${triageId}`,
      body: { userStatus: nextStatus },
    });
    setUpdatingStatus(false);

    if ("code" in res || res.ok === false) {
      toast.error(
        "error" in res && typeof res.error === "string"
          ? res.error
          : "message" in res
            ? res.message
            : "Failed",
      );
      return;
    }

    toast.success(nextStatus === "archived" ? "Moved to archive" : "Restored");
    await onSuggestionUpdated();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm font-semibold">
            {detail?.email.subject ?? "Loading..."}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {detail?.email.from
              .map((f) => (f.name ? `${f.name} <${f.address}>` : f.address))
              .join(", ")}
          </SheetDescription>
        </SheetHeader>

        {loading && !detail && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {detail && (
          <div className="flex flex-col gap-4 px-4 pb-8">
            <div className="flex items-center gap-2">
              <CategoryBadge category={detail.triage.category} />
              {detail.triage.userStatus !== "pending" && (
                <Badge variant="secondary" className="text-xs">
                  {formatUserStatus(detail.triage.userStatus)}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs tabular-nums">
                {(detail.triage.confidence * 100).toFixed(0)}%
              </Badge>
              <Progress
                value={detail.triage.confidence * 100}
                className="h-1 flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={updatingStatus}
                onClick={() =>
                  handleStatusChange(
                    detail.triage.userStatus === "archived"
                      ? "pending"
                      : "archived",
                  )
                }
              >
                {updatingStatus ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : detail.triage.userStatus === "archived" ? (
                  <Undo2 className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                {detail.triage.userStatus === "archived"
                  ? "Restore"
                  : "Archive"}
              </Button>
            </div>

            {detail.triage.summary && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {detail.triage.summary}
              </p>
            )}

            <Collapsible open={bodyOpen} onOpenChange={setBodyOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between h-8 text-xs"
                >
                  Email body
                  <ChevronDown
                    className={`size-3.5 transition-transform ${
                      bodyOpen ? "rotate-180" : ""
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="text-xs whitespace-pre-wrap font-sans mt-2 p-3 bg-muted/50 rounded-md max-h-72 overflow-y-auto">
                  {detail.email.body?.text ??
                    detail.email.body?.html?.replace(/<[^>]+>/g, " ") ??
                    "(no body)"}
                </pre>
              </CollapsibleContent>
            </Collapsible>

            {detail.triage.suggestedTasks.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Suggested Tasks
                </p>
                {detail.triage.suggestedTasks.map((t) => (
                  <SuggestionCard
                    key={t._id}
                    title={t.title}
                    description={t.description}
                    meta={
                      <>
                        <Badge variant="outline" className="text-[10px]">
                          {t.priority}
                        </Badge>
                        {t.kanbanBoardTitle && t.kanbanColumnTitle && (
                          <span className="text-[10px] text-muted-foreground">
                            {t.kanbanBoardTitle} / {t.kanbanColumnTitle}
                          </span>
                        )}
                        {t.dueDate && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            due {new Date(t.dueDate).toLocaleDateString()}
                          </span>
                        )}
                      </>
                    }
                    status={t.status}
                    pending={pendingIds.has(t._id)}
                    onAccept={() => handleSuggestion(t._id, "task", "accept")}
                    onDismiss={() => handleSuggestion(t._id, "task", "dismiss")}
                  />
                ))}
              </div>
            )}

            {detail.triage.suggestedEvents.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Suggested Events
                </p>
                {detail.triage.suggestedEvents.map((e) => (
                  <SuggestionCard
                    key={e._id}
                    title={e.title}
                    description={e.place}
                    meta={
                      <span className="text-[10px] text-muted-foreground tabular-nums inline-flex items-center gap-1">
                        <Calendar className="size-3" />
                        {new Date(e.date).toLocaleString()}
                      </span>
                    }
                    status={e.status}
                    pending={pendingIds.has(e._id)}
                    onAccept={() => handleSuggestion(e._id, "event", "accept")}
                    onDismiss={() =>
                      handleSuggestion(e._id, "event", "dismiss")
                    }
                  />
                ))}
              </div>
            )}

            {detail.triage.suggestedTasks.length === 0 &&
              detail.triage.suggestedEvents.length === 0 && (
                <>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    No suggestions for this email.
                  </p>
                </>
              )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SuggestionCard({
  title,
  description,
  meta,
  status,
  pending,
  onAccept,
  onDismiss,
}: {
  title: string;
  description?: string;
  meta: React.ReactNode;
  status: "pending" | "accepted" | "dismissed";
  pending: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="border rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate">{title}</p>
          {description && (
            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
              {description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">{meta}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {status === "pending" ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={pending}
                onClick={onAccept}
              >
                {pending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5 text-green-600" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={pending}
                onClick={onDismiss}
              >
                <X className="size-3.5 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <Badge
              variant={status === "accepted" ? "default" : "outline"}
              className="text-[10px]"
            >
              {status}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

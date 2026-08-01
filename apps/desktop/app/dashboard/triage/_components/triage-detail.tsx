"use client";

import { EmailIframe } from "@repo/admin/inbox/email-iframe";
import {
  CATEGORY_ACCENT,
  CATEGORY_LABELS,
  TRIAGE_CATEGORIES,
} from "@repo/admin/triage/category-meta";
import { Button } from "@repo/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  Check,
  Loader2,
  Paperclip,
  RotateCw,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import {
  type TriageCategory,
  type TriageDetailResponse,
  triageDetailResponseSchema,
} from "@/lib/data-types";
import { TriageSuggestions } from "./triage-suggestions";

function isTriageCategory(value: string): value is TriageCategory {
  return TRIAGE_CATEGORIES.some((category) => category === value);
}

export function TriageDetail({
  api,
  triageId,
  onBack,
  onChanged,
}: {
  api: denizApi;
  triageId: string;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<TriageDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setLoadFailed(false);
    (async () => {
      const res = await api.GET<TriageDetailResponse>({
        endpoint: `triage/${triageId}`,
        schema: triageDetailResponseSchema,
      });
      if (cancelled) return;
      if ("code" in res) {
        toast.error("Failed to load triage");
        setLoadFailed(true);
      } else {
        setDetail(res);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, triageId, reloadToken]);

  const decide = useCallback(
    async (
      suggestionId: string,
      type: "task" | "event",
      action: "accept" | "dismiss",
    ) => {
      setPendingIds((prev) => new Set(prev).add(suggestionId));

      const res = await api.PATCH<{
        ok: boolean;
        error?: string;
        placedIn?: string;
      }>({
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

      // `placedIn` is only set when the suggestion carried no board and one was
      // picked for it, so the owner sees where an unrouted task actually landed.
      toast.success(
        action === "dismiss"
          ? "Dismissed"
          : res.placedIn
            ? `Accepted → ${res.placedIn}`
            : "Accepted",
      );
      await onChanged();
      const refreshed = await api.GET<TriageDetailResponse>({
        endpoint: `triage/${triageId}`,
      });
      if (!("code" in refreshed)) setDetail(refreshed);
    },
    [api, triageId, onChanged],
  );

  const changeStatus = async (
    nextStatus: TriageDetailResponse["triage"]["userStatus"],
  ) => {
    setUpdatingStatus(true);
    const res = await api.PATCH<{ ok: boolean; error?: string }>({
      endpoint: `triage/${triageId}`,
      body: { userStatus: nextStatus },
    });
    setUpdatingStatus(false);

    if ("code" in res || res.ok === false) {
      toast.error(
        "error" in res && typeof res.error === "string" ? res.error : "Failed",
      );
      return;
    }

    toast.success(nextStatus === "archived" ? "Archived" : "Restored");
    await onChanged();
    onBack();
  };

  /**
   * Reclassify in place. The row stays open so the correction can be checked
   * against the email that is already on screen.
   */
  const changeCategory = async (next: TriageCategory) => {
    const previous = detail;
    if (!previous || next === previous.triage.category) return;

    setSavingCategory(true);
    setDetail({
      ...previous,
      triage: {
        ...previous.triage,
        category: next,
        llmCategory: previous.triage.llmCategory ?? previous.triage.category,
        reviewRequired: false,
      },
    });

    const res = await api.PATCH<{ ok: boolean; error?: string }>({
      endpoint: `triage/${triageId}`,
      body: { category: next },
    });
    setSavingCategory(false);

    if ("code" in res || res.ok === false) {
      setDetail(previous);
      toast.error(
        "error" in res && typeof res.error === "string"
          ? res.error
          : "Failed to change category",
      );
      return;
    }

    toast.success(`Moved to ${CATEGORY_LABELS[next]}`);
    await onChanged();
    const refreshed = await api.GET<TriageDetailResponse>({
      endpoint: `triage/${triageId}`,
    });
    if (!("code" in refreshed)) setDetail(refreshed);
  };

  const confirmClassification = async () => {
    if (!detail) return;
    setUpdatingStatus(true);
    const res = await api.PATCH<{ ok: boolean; error?: string }>({
      endpoint: `triage/${triageId}`,
      body: { category: detail.triage.category, userStatus: "reviewed" },
    });
    setUpdatingStatus(false);

    if ("code" in res || res.ok === false) {
      toast.error(
        "error" in res && typeof res.error === "string"
          ? res.error
          : "Failed to save classification review",
      );
      return;
    }

    toast.success("Classification reviewed");
    await onChanged();
    onBack();
  };

  const archived = detail?.triage.userStatus === "archived";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 size-8"
          aria-label="Back to triage list"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>

        {detail && (
          <>
            <Select
              value={detail.triage.category}
              disabled={savingCategory}
              onValueChange={(value) => {
                if (isTriageCategory(value)) void changeCategory(value);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Category"
                className={cn(
                  "h-7 w-auto gap-1.5 border-none px-1.5 text-[10px] font-medium uppercase tracking-[0.12em] shadow-none",
                  CATEGORY_ACCENT[detail.triage.category],
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRIAGE_CATEGORIES.map((category) => (
                  <SelectItem
                    key={category}
                    value={category}
                    className="text-xs"
                  >
                    {CATEGORY_LABELS[category]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {savingCategory && (
              <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
            )}

            {detail.triage.llmCategory ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                was {CATEGORY_LABELS[detail.triage.llmCategory]}
              </span>
            ) : (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {(detail.triage.confidence * 100).toFixed(0)}%
              </span>
            )}

            {detail.triage.attachmentTextUsed && (
              <Paperclip
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Attachment text used"
              />
            )}
          </>
        )}

        <div className="flex-1" />

        {detail && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={updatingStatus}
            onClick={() => changeStatus(archived ? "pending" : "archived")}
          >
            {updatingStatus ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : archived ? (
              <Undo2 className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
            {archived ? "Restore" : "Archive"}
          </Button>
        )}
      </div>

      {loadFailed ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
          <span className="text-sm text-muted-foreground">
            Couldn't load this triage.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setReloadToken((token) => token + 1)}
          >
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      ) : loading || !detail ? (
        <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-5 sm:px-8">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detail.triage.reviewRequired && (
            <section className="flex flex-wrap items-center gap-2 border-b border-l-2 border-l-status-warning bg-status-warning/5 px-4 py-2.5 sm:px-8">
              <span className="min-w-0 flex-1 text-xs font-medium">
                Confirm the category
              </span>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={updatingStatus}
                onClick={confirmClassification}
              >
                {updatingStatus ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Confirm
              </Button>
            </section>
          )}

          <TriageSuggestions
            triage={detail.triage}
            pendingIds={pendingIds}
            onDecide={(id, type, action) => void decide(id, type, action)}
          />

          <div className="px-4 py-5 sm:px-8 sm:py-6">
            <h1 className="text-lg font-semibold leading-snug sm:text-xl">
              {detail.email.subject || "(No Subject)"}
            </h1>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-medium">
                {detail.email.from[0]?.name ??
                  detail.email.from[0]?.address ??
                  "Unknown"}
              </span>
              {detail.email.from[0]?.name && (
                <span className="text-xs text-muted-foreground">
                  &lt;{detail.email.from[0].address}&gt;
                </span>
              )}
              <span className="text-muted-foreground/40">·</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {format(new Date(detail.email.date), "EEE, MMM d yyyy 'at' p")}
              </span>
            </div>

            {detail.triage.summary && (
              <p className="mt-4 border-l-2 pl-3 text-xs leading-relaxed text-muted-foreground">
                {detail.triage.summary}
              </p>
            )}

            <hr className="my-5" />

            {detail.email.body?.html ? (
              <EmailIframe html={detail.email.body.html} />
            ) : detail.email.body?.text ? (
              <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                {detail.email.body.text}
              </pre>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">
                —
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

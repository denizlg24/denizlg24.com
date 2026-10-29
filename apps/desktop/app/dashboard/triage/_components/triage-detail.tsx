"use client";

import { EmailBody } from "@repo/admin/inbox/email-detail";
import {
  CATEGORY_ACCENT,
  CATEGORY_LABELS,
  TRIAGE_CATEGORIES,
} from "@repo/admin/triage/category-meta";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { format } from "date-fns";
import {
  Archive,
  ArrowLeft,
  Check,
  MailWarning,
  Paperclip,
  RotateCw,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import {
  type IEmailTriage,
  type TriageAcceptanceResponse,
  type TriageCategory,
  type TriageDetailResponse,
  type TriageSuggestionType,
  triageDetailResponseSchema,
} from "@/lib/data-types";
import { isTriageCategory, triageSender } from "./triage-row";
import { TriageSuggestions } from "./triage-suggestions";

export function TriageDetail({
  api,
  item,
  detailCache,
  onBack,
  onChanged,
}: {
  api: denizApi;
  item: IEmailTriage;
  detailCache: React.RefObject<Map<string, TriageDetailResponse>>;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const triageId = item._id;
  const [detail, setDetail] = useState<TriageDetailResponse | null>(
    () => detailCache.current.get(triageId) ?? null,
  );
  const [loading, setLoading] = useState(
    () => !detailCache.current.has(triageId),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = detailCache.current.get(triageId);
    if (cached) {
      setDetail(cached);
      setLoading(false);
      setLoadFailed(false);
      return;
    }
    setLoading(true);
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
        if (res.triage.derivationStatus === "pending") {
          detailCache.current.delete(triageId);
        } else {
          detailCache.current.set(triageId, res);
        }
        setDetail(res);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, detailCache, triageId, reloadToken]);

  useEffect(() => {
    if (detail?.triage.derivationStatus !== "pending") return;
    let cancelled = false;

    void (async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        if (cancelled) return;
        const res = await api.GET<TriageDetailResponse>({
          endpoint: `triage/${triageId}`,
          schema: triageDetailResponseSchema,
        });
        if (cancelled || "code" in res) continue;
        setDetail(res);
        if (res.triage.derivationStatus !== "pending") {
          detailCache.current.set(triageId, res);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, detail?.triage.derivationStatus, detailCache, triageId]);

  const decide = useCallback(
    async (
      suggestionId: string,
      type: TriageSuggestionType,
      action: "accept" | "dismiss",
    ) => {
      setPendingIds((prev) => new Set(prev).add(suggestionId));

      const res = await api.PATCH<TriageAcceptanceResponse>({
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
          : res.ok && res.placedIn
            ? `Accepted → ${res.placedIn}`
            : "Accepted",
      );
      await onChanged();
      const refreshed = await api.GET<TriageDetailResponse>({
        endpoint: `triage/${triageId}`,
      });
      if (!("code" in refreshed)) {
        detailCache.current.set(triageId, refreshed);
        setDetail(refreshed);
      }
    },
    [api, detailCache, triageId, onChanged],
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
        derivationStatus:
          next === "action-needed" || next === "scheduled"
            ? "pending"
            : previous.triage.derivationStatus,
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
    detailCache.current.delete(triageId);
    await onChanged();
    setReloadToken((token) => token + 1);
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

  const displayTriage = detail?.triage ?? item;
  const displayEmail = detail?.email ?? item.email;
  const archived = displayTriage.userStatus === "archived";
  const sender = displayEmail?.from[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="Back"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>

        <Select
          value={displayTriage.category}
          disabled={savingCategory}
          onValueChange={(value) => {
            if (isTriageCategory(value)) void changeCategory(value);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label="Category"
            className={cn(
              "h-7 w-auto gap-1.5 border-none bg-transparent px-1.5 text-xs font-medium shadow-none",
              CATEGORY_ACCENT[displayTriage.category],
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRIAGE_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category} className="text-xs">
                {CATEGORY_LABELS[category]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {savingCategory ? (
          <Spinner className="size-3 text-muted-foreground" />
        ) : null}

        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {displayTriage.llmCategory
            ? `was ${CATEGORY_LABELS[displayTriage.llmCategory]}`
            : `${Math.round(displayTriage.confidence * 100)}%`}
        </span>

        {displayTriage.attachmentTextUsed ? (
          <Paperclip
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label="Attachment text used"
          />
        ) : null}

        <div className="flex-1" />

        {displayTriage.reviewRequired ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={updatingStatus}
            onClick={confirmClassification}
          >
            {updatingStatus ? <Spinner className="size-3.5" /> : <Check />}
            Confirm
          </Button>
        ) : null}

        {detail ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={updatingStatus}
            onClick={() => changeStatus(archived ? "pending" : "archived")}
          >
            {archived ? <Undo2 /> : <Archive />}
            {archived ? "Restore" : "Archive"}
          </Button>
        ) : null}
      </div>

      {loadFailed ? (
        <EmptyState
          icon={<MailWarning />}
          label="Failed to load"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((token) => token + 1)}
            >
              <RotateCw />
              Retry
            </Button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-5 py-6 sm:px-8">
            <PageTitle
              title={displayEmail?.subject || "(No subject)"}
              meta={
                <>
                  {displayTriage.reviewRequired ? (
                    <Badge variant="warning">Review</Badge>
                  ) : null}
                  {archived ? (
                    <Badge variant="secondary">Archived</Badge>
                  ) : null}
                  {displayEmail ? (
                    <span className="tabular-nums">
                      {format(
                        new Date(displayEmail.date),
                        "EEE, MMM d, yyyy 'at' HH:mm",
                      )}
                    </span>
                  ) : null}
                </>
              }
            />

            <Properties>
              <Property label="From">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate">
                    {triageSender({ email: displayEmail })}
                  </span>
                  {sender?.name ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {sender.address}
                    </span>
                  ) : null}
                </span>
              </Property>
              {displayTriage.summary ? (
                <Property label="Summary" className="items-start py-1.5">
                  <span className="text-sm leading-relaxed">
                    {displayTriage.summary}
                  </span>
                </Property>
              ) : null}
            </Properties>

            {detail ? (
              <TriageSuggestions
                triage={detail.triage}
                pendingIds={pendingIds}
                onDecide={(id, type, action) => void decide(id, type, action)}
              />
            ) : null}

            {displayTriage.derivationStatus === "pending" ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                Extracting
              </p>
            ) : null}

            <EmailBody
              loading={loading && !detail}
              html={detail?.email.body?.html}
              text={detail?.email.body?.text}
            />
          </div>
        </div>
      )}
    </div>
  );
}

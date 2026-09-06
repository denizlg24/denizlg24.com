"use client";

import type { ITimelineItem } from "@repo/schemas";
import { Milestone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { TimelineForm } from "./timeline-form";

const ICON = <Milestone className="size-4 text-muted-foreground" />;

export function TimelineEditorPage({
  mode,
  itemId,
}: {
  mode: "create" | "edit";
  itemId?: string;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.timeline.root;

  const [item, setItem] = useState<ITimelineItem | null>(null);
  const [loading, setLoading] = useState(mode === "edit");

  const load = useCallback(async () => {
    if (mode !== "edit" || !itemId) return;
    setLoading(true);
    try {
      const result = await client.get<{ item: ITimelineItem }>(
        `timeline/${itemId}`,
      );
      setItem(result.item);
    } catch {
      toast.error("Failed to load entry");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [client, itemId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = mode === "edit" ? "Edit Entry" : "New Entry";
  const shell = { icon: ICON, backTo, backLabel: "Timeline" } as const;

  if (loading) return <DetailPageSkeleton {...shell} title={title} rows={2} />;

  if (mode === "edit" && !item) {
    return (
      <DetailNotFound
        {...shell}
        title="Entry not found"
        message="This entry could not be loaded."
      />
    );
  }

  return (
    <DetailPageShell {...shell} title={mode === "edit" ? item?.title : title}>
      <TimelineForm
        mode={mode}
        item={item ?? undefined}
        onSuccess={() => router.push(backTo)}
        onCancel={() => router.push(backTo)}
      />
    </DetailPageShell>
  );
}

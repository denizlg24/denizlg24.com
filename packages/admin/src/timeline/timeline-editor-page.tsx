"use client";

import type { ITimelineItem } from "@repo/schemas";
import { Milestone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DocumentEditorSkeleton,
  DocumentNotFound,
} from "../projects/document-editor";
import { useAdmin } from "../provider";
import { TimelineForm } from "./timeline-form";

const ICON = <Milestone />;

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

  const shell = { icon: ICON, backTo, backLabel: "Timeline" } as const;

  if (loading) {
    return <DocumentEditorSkeleton {...shell} title="Entry" properties={5} />;
  }

  if (mode === "edit" && !item) {
    return <DocumentNotFound {...shell} label="Entry not found" />;
  }

  return (
    <TimelineForm
      key={item?._id ?? "new"}
      mode={mode}
      item={item ?? undefined}
      {...shell}
      onSuccess={() => router.push(backTo)}
      onDeleted={() => router.push(backTo)}
    />
  );
}

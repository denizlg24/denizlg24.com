"use client";

import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { useOptimistic, useTransition } from "react";

import { toggleSaved } from "@/app/actions";

export function SaveButton({
  titleId,
  saved,
  size = "md",
  labels = { off: "Save", on: "Saved" },
}: {
  titleId: string;
  saved: boolean;
  size?: "md" | "lg";
  labels?: { off: string; on: string };
}) {
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      setOptimistic(!optimistic);
      await toggleSaved(titleId, !optimistic);
    });
  const Icon = optimistic ? BookmarkCheck : BookmarkPlus;
  return (
    <button
      type="button"
      data-nav
      aria-pressed={optimistic}
      onClick={toggle}
      className={`flex items-center gap-2.5 rounded-full border border-hairline bg-ink/40 text-paper backdrop-blur-sm transition-colors hover:border-paper/40 ${size === "lg" ? "px-7 py-4 text-lg" : "px-5 py-3"}`}
    >
      <Icon
        className={`${size === "lg" ? "size-6" : "size-5"} ${optimistic ? "text-amber" : ""}`}
        strokeWidth={1.75}
      />
      {optimistic ? labels.on : labels.off}
    </button>
  );
}

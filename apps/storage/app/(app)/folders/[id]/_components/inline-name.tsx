"use client";

import { cn } from "@repo/ui/utils";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { normalizeFileNamePreview, normalizeNamePreview } from "@/lib/format";

/**
 * Rename and create-folder both happen in place rather than in a dialog. The
 * hint shows the name the API will actually store, since it snake-cases
 * everything on the way in.
 */
export function InlineName({
  initial,
  kind,
  placeholder,
  onCommit,
  onCancel,
  className,
}: {
  initial: string;
  kind: "file" | "folder";
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = kind === "file" ? initial.lastIndexOf(".") : -1;
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, kind]);

  const normalize =
    kind === "file" ? normalizeFileNamePreview : normalizeNamePreview;
  const preview = normalize(value.trim());
  const valid = preview.length > 0;
  const changed = preview !== initial;

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    if (!valid || !changed) {
      onCancel();
      return;
    }
    onCommit(value.trim());
  };

  const cancel = () => {
    if (committed.current) return;
    committed.current = true;
    onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        aria-label={kind === "file" ? "File name" : "Folder name"}
        className="w-full min-w-0 rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
      {valid && preview !== value.trim() && (
        <span className="truncate text-[11px] text-muted-foreground">
          Saved as {preview}
        </span>
      )}
    </span>
  );
}

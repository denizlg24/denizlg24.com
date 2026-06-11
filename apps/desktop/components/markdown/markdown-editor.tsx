"use client";

import {
  ChevronLeftCircle,
  ChevronRightCircle,
  ClipboardX,
  Edit2,
  Eye,
  Loader2,
  Save,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTextareaEditor } from "@/hooks/use-textarea-editor";

interface Props {
  value: string;
  initialValue: string;
  onChange: (next: string) => void;
  onSave: () => void | Promise<void>;
  saving?: boolean;
  placeholder?: string;
  className?: string;
}

export const MarkdownEditor = ({
  value,
  initialValue,
  onChange,
  onSave,
  saving = false,
  placeholder,
  className,
}: Props) => {
  const [preview, setPreview] = useState(true);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const setContent = useCallback(
    (next: string | ((prev: string) => string)) => {
      if (typeof next === "function") onChange(next(value));
      else onChange(next);
    },
    [onChange, value],
  );

  const { onKeyDown, clearMultiSelections } = useTextareaEditor(
    textareaRef,
    value,
    setContent,
  );

  const dirty = value !== initialValue;

  return (
    <div
      className={`relative flex min-h-0 w-full flex-1 flex-col ${className ?? ""}`}
    >
      {toolbarOpen ? (
        <div className="absolute right-2 top-2 z-90 flex flex-col items-center gap-1 rounded-full border bg-surface px-1 py-2 shadow">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setPreview((p) => !p)}
            title={preview ? "Edit" : "Preview"}
          >
            {preview ? <Edit2 /> : <Eye />}
          </Button>
          <Button
            onClick={onSave}
            size="icon-sm"
            disabled={!dirty || saving}
            title="Save"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
          </Button>
          <Button
            onClick={() => onChange(initialValue)}
            disabled={!dirty || saving}
            variant="secondary"
            size="icon-sm"
            title="Discard changes"
          >
            <ClipboardX />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            onClick={() => setToolbarOpen(false)}
            title="Hide toolbar"
          >
            <ChevronRightCircle />
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="icon-sm"
          className="absolute right-2 top-2 z-90 rounded-full"
          onClick={() => setToolbarOpen(true)}
          title="Show toolbar"
        >
          <ChevronLeftCircle />
        </Button>
      )}

      {!preview && (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onMouseDown={clearMultiSelections}
          placeholder={placeholder}
          className="relative z-1 min-h-0 flex-1 resize-none! rounded-none border-none! bg-transparent! font-mono text-sm shadow-none! outline-none! ring-0! overflow-y-auto selection:bg-blue-400/30 selection:text-foreground"
        />
      )}

      {preview && (
        <div className="mx-auto min-h-0 w-full max-w-full! flex-1 overflow-y-auto bg-background px-3 py-2">
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {placeholder ?? "No content yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

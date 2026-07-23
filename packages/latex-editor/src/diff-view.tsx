"use client";

import { unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cn } from "@repo/ui/utils";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";
import { latexSupport } from "./latex-language";
import { appEditorTheme } from "./theme";

function useIsDarkTheme() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

const diffTheme = EditorView.baseTheme({
  "& .cm-changedLine": {
    backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
  },
  "& .cm-changedText": {
    background:
      "color-mix(in oklab, var(--primary) 26%, transparent) !important",
  },
  "& .cm-deletedChunk": {
    backgroundColor: "color-mix(in oklab, var(--destructive) 10%, transparent)",
  },
  "& .cm-deletedChunk .cm-deletedText": {
    background:
      "color-mix(in oklab, var(--destructive) 24%, transparent) !important",
    textDecoration: "line-through",
    textDecorationColor:
      "color-mix(in oklab, var(--destructive) 60%, transparent)",
  },
  "& .cm-collapsedLines": {
    color: "var(--muted-foreground)",
    background: "var(--muted)",
    padding: "2px 8px",
    fontSize: "11px",
  },
});

export interface LatexDiffViewProps {
  /** Content before the change. */
  original: string;
  /** Content after the change; rendered as the document. */
  modified: string;
  /** Path used to pick syntax highlighting. */
  filePath?: string | null;
  /** Collapse long unchanged regions (on by default). */
  collapseUnchanged?: boolean;
  className?: string;
}

export function LatexDiffView({
  original,
  modified,
  filePath,
  collapseUnchanged = true,
  className,
}: LatexDiffViewProps) {
  const isDark = useIsDarkTheme();
  const extensions = useMemo(
    () => [
      ...appEditorTheme(isDark),
      diffTheme,
      ...(filePath?.match(/\.(tex|cls|sty)$/i)
        ? [
            latexSupport({
              fileName: filePath,
              isMainFile: false,
              isMultiFile: false,
            }),
          ]
        : []),
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      unifiedMergeView({
        original,
        mergeControls: false,
        ...(collapseUnchanged
          ? { collapseUnchanged: { margin: 3, minSize: 6 } }
          : {}),
      }),
    ],
    [collapseUnchanged, filePath, isDark, original],
  );
  return (
    <CodeMirror
      // Remount when either side changes so unifiedMergeView re-anchors.
      key={`${filePath ?? ""}:${original.length}:${modified.length}`}
      value={modified}
      height="100%"
      className={cn(
        "h-full [&_.cm-editor]:h-full [&_.cm-scroller]:font-mono",
        className,
      )}
      theme="none"
      extensions={extensions}
      editable={false}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
    />
  );
}

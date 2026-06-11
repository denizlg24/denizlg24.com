import type React from "react";
import { useCallback, useRef, useState } from "react";

const INDENT = "  ";

const CLOSING_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "`": "`",
  '"': '"',
  "'": "'",
};

const _ASYMMETRIC_CLOSINGS = new Set([")", "]", "}"]);

const LIST_MARKER_RE = /^(\s*)([-*+])\s/;
const ORDERED_LIST_RE = /^(\s*)(\d+)\.\s/;

export interface MultiSelection {
  start: number;
  end: number;
}

function getLineInfo(text: string, cursorPos: number) {
  const lineStart = text.lastIndexOf("\n", cursorPos - 1) + 1;
  let lineEnd = text.indexOf("\n", cursorPos);
  if (lineEnd === -1) lineEnd = text.length;
  const lineText = text.slice(lineStart, lineEnd);
  const indent = lineText.match(/^(\s*)/)?.[1] ?? "";
  return { lineStart, lineEnd, lineText, indent };
}

function getSelectedLineRange(text: string, selStart: number, selEnd: number) {
  const blockStart = text.lastIndexOf("\n", selStart - 1) + 1;
  let blockEnd = text.indexOf("\n", selEnd);
  if (blockEnd === -1) blockEnd = text.length;
  return { blockStart, blockEnd };
}

function applyEdit(
  textarea: HTMLTextAreaElement,
  newValue: string,
  cursorStart: number,
  cursorEnd?: number,
) {
  textarea.value = newValue;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.setSelectionRange(cursorStart, cursorEnd ?? cursorStart);
}

function scrollCursorIntoView(
  textarea: HTMLTextAreaElement,
  cursorPos: number,
) {
  if (cursorPos >= textarea.value.length) {
    textarea.scrollTop = textarea.scrollHeight;
    return;
  }

  const lineHeight = parseInt(getComputedStyle(textarea).lineHeight, 10) || 20;
  const viewportPadding = lineHeight * 2;
  const lineNumber = textarea.value.slice(0, cursorPos).split("\n").length - 1;
  const cursorTop = lineNumber * lineHeight;
  const cursorBottom = cursorTop + lineHeight;
  const visibleTop = textarea.scrollTop + viewportPadding;
  const visibleBottom =
    textarea.scrollTop + textarea.clientHeight - viewportPadding;

  if (cursorTop < visibleTop) {
    textarea.scrollTop = Math.max(0, cursorTop - viewportPadding);
  } else if (cursorBottom > visibleBottom) {
    textarea.scrollTop = Math.max(
      0,
      cursorBottom - textarea.clientHeight + viewportPadding,
    );
  }
}

function findAllOccurrences(text: string, word: string): MultiSelection[] {
  const results: MultiSelection[] = [];
  let pos = 0;
  while (pos <= text.length - word.length) {
    const idx = text.indexOf(word, pos);
    if (idx === -1) break;
    results.push({ start: idx, end: idx + word.length });
    pos = idx + 1;
  }
  return results;
}

function applyMultiEdit(
  text: string,
  selections: MultiSelection[],
  insertText: string,
): { newText: string; newSelections: MultiSelection[] } {
  const sorted = [...selections].sort((a, b) => a.start - b.start);
  let result = text;
  let offset = 0;
  const newSelections: MultiSelection[] = [];

  for (const sel of sorted) {
    const adjStart = sel.start + offset;
    const adjEnd = sel.end + offset;
    const oldLen = adjEnd - adjStart;
    result = result.slice(0, adjStart) + insertText + result.slice(adjEnd);
    const newPos = adjStart + insertText.length;
    newSelections.push({ start: newPos, end: newPos });
    offset += insertText.length - oldLen;
  }

  return { newText: result, newSelections };
}

function moveVertical(text: string, pos: number, direction: -1 | 1): number {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const col = pos - lineStart;
  if (direction === -1) {
    if (lineStart === 0) return pos;
    const prevLineStart = text.lastIndexOf("\n", lineStart - 2) + 1;
    const prevLineLen = lineStart - 1 - prevLineStart;
    return prevLineStart + Math.min(col, prevLineLen);
  }
  const lineEnd = text.indexOf("\n", pos);
  if (lineEnd === -1) return pos;
  const nextLineStart = lineEnd + 1;
  let nextLineEnd = text.indexOf("\n", nextLineStart);
  if (nextLineEnd === -1) nextLineEnd = text.length;
  return nextLineStart + Math.min(col, nextLineEnd - nextLineStart);
}

function moveWordLeft(text: string, pos: number): number {
  if (pos <= 0) return 0;
  let p = pos - 1;
  while (p > 0 && !/[a-zA-Z0-9_]/.test(text[p])) p--;
  while (p > 0 && /[a-zA-Z0-9_]/.test(text[p - 1])) p--;
  return p;
}

function moveWordRight(text: string, pos: number): number {
  if (pos >= text.length) return text.length;
  let p = pos;
  while (p < text.length && /[a-zA-Z0-9_]/.test(text[p])) p++;
  while (p < text.length && !/[a-zA-Z0-9_]/.test(text[p])) p++;
  return p;
}

function deduplicateSelections(selections: MultiSelection[]): MultiSelection[] {
  const seen = new Set<string>();
  return selections.filter((s) => {
    const key = `${s.start}:${s.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useTextareaEditor(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  _content: string,
  setContent: (value: string) => void,
): {
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
  multiSelections: MultiSelection[];
  clearMultiSelections: () => void;
} {
  const [multiSelections, setMultiSelections] = useState<MultiSelection[]>([]);
  const multiSelectWordRef = useRef("");

  const clearMultiSelections = useCallback(() => {
    setMultiSelections([]);
    multiSelectWordRef.current = "";
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart: selStart, selectionEnd: selEnd } = textarea;
      const text = textarea.value;
      const hasSelection = selStart !== selEnd;

      if (multiSelections.length > 0) {
        if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const word = multiSelectWordRef.current;
          if (!word) return;
          const allOccurrences = findAllOccurrences(text, word);
          const selectedStarts = new Set(multiSelections.map((s) => s.start));
          if (allOccurrences.every((occ) => selectedStarts.has(occ.start)))
            return;
          const lastAdded = multiSelections[multiSelections.length - 1];
          let nextOcc = allOccurrences.find(
            (occ) =>
              occ.start > lastAdded.start && !selectedStarts.has(occ.start),
          );
          if (!nextOcc) {
            nextOcc = allOccurrences.find(
              (occ) => !selectedStarts.has(occ.start),
            );
          }
          if (nextOcc) {
            const added = nextOcc;
            setMultiSelections((prev) => [...prev, added]);
            requestAnimationFrame(() => {
              const lineHeight =
                parseInt(getComputedStyle(textarea).lineHeight, 10) || 20;
              const textBefore = text.slice(0, added.start);
              const lineNumber = textBefore.split("\n").length;
              textarea.scrollTop = Math.max(0, (lineNumber - 3) * lineHeight);
            });
          }
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          setMultiSelections([]);
          multiSelectWordRef.current = "";
          return;
        }

        if (multiSelections.length >= 2) {
          if (
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight" ||
            e.key === "ArrowUp" ||
            e.key === "ArrowDown"
          ) {
            e.preventDefault();
            const isCtrl = e.ctrlKey || e.metaKey;
            let moved: MultiSelection[];

            if (e.key === "ArrowLeft") {
              moved = multiSelections.map((sel) => {
                if (sel.start !== sel.end)
                  return { start: sel.start, end: sel.start };
                const np = isCtrl
                  ? moveWordLeft(text, sel.start)
                  : Math.max(0, sel.start - 1);
                return { start: np, end: np };
              });
            } else if (e.key === "ArrowRight") {
              moved = multiSelections.map((sel) => {
                if (sel.start !== sel.end)
                  return { start: sel.end, end: sel.end };
                const np = isCtrl
                  ? moveWordRight(text, sel.start)
                  : Math.min(text.length, sel.start + 1);
                return { start: np, end: np };
              });
            } else if (e.key === "ArrowUp") {
              moved = multiSelections.map((sel) => {
                const p = sel.start === sel.end ? sel.start : sel.start;
                const np = moveVertical(text, p, -1);
                return { start: np, end: np };
              });
            } else {
              moved = multiSelections.map((sel) => {
                const p = sel.start === sel.end ? sel.start : sel.end;
                const np = moveVertical(text, p, 1);
                return { start: np, end: np };
              });
            }

            multiSelectWordRef.current = "";
            const deduped = deduplicateSelections(moved);
            if (deduped.length < 2) {
              setMultiSelections([]);
              if (deduped.length === 1) {
                requestAnimationFrame(() =>
                  textarea.setSelectionRange(deduped[0].start, deduped[0].end),
                );
              }
            } else {
              setMultiSelections(deduped);
              requestAnimationFrame(() => {
                const last = deduped[deduped.length - 1];
                textarea.setSelectionRange(last.start, last.end);
              });
            }
            return;
          }

          if (
            (e.key === "Home" || e.key === "End") &&
            !e.ctrlKey &&
            !e.metaKey
          ) {
            e.preventDefault();
            const moved = multiSelections.map((sel) => {
              const p =
                sel.start === sel.end
                  ? sel.start
                  : e.key === "Home"
                    ? sel.start
                    : sel.end;
              const lineStart = text.lastIndexOf("\n", p - 1) + 1;
              if (e.key === "Home") {
                return { start: lineStart, end: lineStart };
              }
              let lineEnd = text.indexOf("\n", p);
              if (lineEnd === -1) lineEnd = text.length;
              return { start: lineEnd, end: lineEnd };
            });

            multiSelectWordRef.current = "";
            const deduped = deduplicateSelections(moved);
            if (deduped.length < 2) {
              setMultiSelections([]);
              if (deduped.length === 1) {
                requestAnimationFrame(() =>
                  textarea.setSelectionRange(deduped[0].start, deduped[0].end),
                );
              }
            } else {
              setMultiSelections(deduped);
              requestAnimationFrame(() => {
                const last = deduped[deduped.length - 1];
                textarea.setSelectionRange(last.start, last.end);
              });
            }
            return;
          }

          if ((e.ctrlKey || e.metaKey) && e.key !== "d") {
            setMultiSelections([]);
            multiSelectWordRef.current = "";
            return;
          }

          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            const { newText, newSelections } = applyMultiEdit(
              text,
              multiSelections,
              e.key,
            );
            setContent(newText);
            setMultiSelections(newSelections);
            requestAnimationFrame(() => {
              const last = newSelections[newSelections.length - 1];
              applyEdit(textarea, newText, last.start, last.end);
            });
            return;
          }

          if (e.key === "Backspace") {
            e.preventDefault();
            const sorted = [...multiSelections].sort(
              (a, b) => a.start - b.start,
            );
            const allCursors = sorted.every((s) => s.start === s.end);

            if (allCursors) {
              const expanded = sorted
                .filter((s) => s.start > 0)
                .map((s) => ({ start: s.start - 1, end: s.end }));
              if (expanded.length === 0) return;
              const { newText, newSelections } = applyMultiEdit(
                text,
                expanded,
                "",
              );
              setContent(newText);
              setMultiSelections(newSelections);
              requestAnimationFrame(() => {
                const last = newSelections[newSelections.length - 1];
                applyEdit(textarea, newText, last.start, last.end);
              });
            } else {
              const { newText, newSelections } = applyMultiEdit(
                text,
                sorted,
                "",
              );
              setContent(newText);
              setMultiSelections(newSelections);
              requestAnimationFrame(() => {
                const last = newSelections[newSelections.length - 1];
                applyEdit(textarea, newText, last.start, last.end);
              });
            }
            return;
          }

          if (e.key === "Delete") {
            e.preventDefault();
            const sorted = [...multiSelections].sort(
              (a, b) => a.start - b.start,
            );
            const allCursors = sorted.every((s) => s.start === s.end);

            if (allCursors) {
              const expanded = sorted
                .filter((s) => s.end < text.length)
                .map((s) => ({ start: s.start, end: s.end + 1 }));
              if (expanded.length === 0) return;
              const { newText, newSelections } = applyMultiEdit(
                text,
                expanded,
                "",
              );
              setContent(newText);
              setMultiSelections(newSelections);
              requestAnimationFrame(() => {
                const last = newSelections[newSelections.length - 1];
                applyEdit(textarea, newText, last.start, last.end);
              });
            } else {
              const { newText, newSelections } = applyMultiEdit(
                text,
                sorted,
                "",
              );
              setContent(newText);
              setMultiSelections(newSelections);
              requestAnimationFrame(() => {
                const last = newSelections[newSelections.length - 1];
                applyEdit(textarea, newText, last.start, last.end);
              });
            }
            return;
          }

          if (e.key === "Enter") {
            e.preventDefault();
            const { newText, newSelections } = applyMultiEdit(
              text,
              multiSelections,
              "\n",
            );
            setContent(newText);
            setMultiSelections(newSelections);
            requestAnimationFrame(() => {
              const last = newSelections[newSelections.length - 1];
              applyEdit(textarea, newText, last.start, last.end);
            });
            return;
          }

          if (e.key === "Tab") {
            e.preventDefault();
            const { newText, newSelections } = applyMultiEdit(
              text,
              multiSelections,
              INDENT,
            );
            setContent(newText);
            setMultiSelections(newSelections);
            requestAnimationFrame(() => {
              const last = newSelections[newSelections.length - 1];
              applyEdit(textarea, newText, last.start, last.end);
            });
            return;
          }

          return;
        }

        setMultiSelections([]);
        multiSelectWordRef.current = "";
      }

      if (e.key === "b" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        if (hasSelection) {
          const selected = text.slice(selStart, selEnd);
          const newText = `${text.slice(0, selStart)}**${selected}**${text.slice(selEnd)}`;
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 2, selEnd + 2),
          );
        } else {
          const newText = `${text.slice(0, selStart)}****${text.slice(selEnd)}`;
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 2),
          );
        }
        return;
      }

      if (e.key === "i" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        if (hasSelection) {
          const selected = text.slice(selStart, selEnd);
          const newText = `${text.slice(0, selStart)}*${selected}*${text.slice(selEnd)}`;
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 1, selEnd + 1),
          );
        } else {
          const newText = `${text.slice(0, selStart)}**${text.slice(selEnd)}`;
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 1),
          );
        }
        return;
      }

      if (e.key === "K" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        if (hasSelection) {
          const selected = text.slice(selStart, selEnd);
          const newText = `${text.slice(0, selStart)}\`${selected}\`${text.slice(selEnd)}`;
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 1, selEnd + 1),
          );
        } else {
          const newText = `${text.slice(0, selStart)}\`\`${text.slice(selEnd)}`;
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 1),
          );
        }
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();

        if (hasSelection) {
          const { blockStart, blockEnd } = getSelectedLineRange(
            text,
            selStart,
            selEnd,
          );
          const block = text.slice(blockStart, blockEnd);
          const lines = block.split("\n");

          let newLines: string[];
          let deltaFirst = 0;
          let deltaTotal = 0;

          if (e.shiftKey) {
            newLines = lines.map((line, i) => {
              if (line.startsWith(INDENT)) {
                const removed = INDENT.length;
                if (i === 0) deltaFirst = -removed;
                deltaTotal -= removed;
                return line.slice(removed);
              }
              if (line.startsWith(" ")) {
                if (i === 0) deltaFirst = -1;
                deltaTotal -= 1;
                return line.slice(1);
              }
              return line;
            });
          } else {
            newLines = lines.map((line) => INDENT + line);
            deltaFirst = INDENT.length;
            deltaTotal = lines.length * INDENT.length;
          }

          const newBlock = newLines.join("\n");
          const newText =
            text.slice(0, blockStart) + newBlock + text.slice(blockEnd);
          setContent(newText);
          const newSelStart = Math.max(blockStart, selStart + deltaFirst);
          const newSelEnd = selEnd + deltaTotal;
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, newSelStart, newSelEnd),
          );
        } else {
          const { lineStart, lineEnd, lineText } = getLineInfo(text, selStart);
          const isListLine =
            LIST_MARKER_RE.test(lineText) || ORDERED_LIST_RE.test(lineText);

          if (isListLine) {
            if (e.shiftKey) {
              if (lineText.startsWith(INDENT)) {
                const newLine = lineText.slice(INDENT.length);
                const newText =
                  text.slice(0, lineStart) + newLine + text.slice(lineEnd);
                setContent(newText);
                requestAnimationFrame(() =>
                  applyEdit(textarea, newText, selStart - INDENT.length),
                );
              } else if (lineText.startsWith(" ")) {
                const newLine = lineText.slice(1);
                const newText =
                  text.slice(0, lineStart) + newLine + text.slice(lineEnd);
                setContent(newText);
                requestAnimationFrame(() =>
                  applyEdit(textarea, newText, selStart - 1),
                );
              }
            } else {
              const newLine = INDENT + lineText;
              const newText =
                text.slice(0, lineStart) + newLine + text.slice(lineEnd);
              setContent(newText);
              requestAnimationFrame(() =>
                applyEdit(textarea, newText, selStart + INDENT.length),
              );
            }
          } else {
            if (e.shiftKey) {
              if (lineText.startsWith(INDENT)) {
                const newLine = lineText.slice(INDENT.length);
                const newText =
                  text.slice(0, lineStart) + newLine + text.slice(lineEnd);
                setContent(newText);
                requestAnimationFrame(() =>
                  applyEdit(
                    textarea,
                    newText,
                    Math.max(lineStart, selStart - INDENT.length),
                  ),
                );
              }
            } else {
              const newText =
                text.slice(0, selStart) + INDENT + text.slice(selEnd);
              setContent(newText);
              requestAnimationFrame(() =>
                applyEdit(textarea, newText, selStart + INDENT.length),
              );
            }
          }
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const { lineText, indent } = getLineInfo(text, selStart);

        const unorderedMatch = lineText.match(LIST_MARKER_RE);
        if (unorderedMatch) {
          const [fullMatch, , marker] = unorderedMatch;
          const afterMarker = lineText.slice(fullMatch.length);

          if (afterMarker.trim() === "") {
            e.preventDefault();
            const { lineStart, lineEnd } = getLineInfo(text, selStart);
            const newText = text.slice(0, lineStart) + text.slice(lineEnd);
            const trimmedNewText = newText.startsWith("\n", lineStart)
              ? newText.slice(0, lineStart) + newText.slice(lineStart + 1)
              : newText;
            setContent(trimmedNewText);
            requestAnimationFrame(() =>
              applyEdit(textarea, trimmedNewText, lineStart),
            );
            return;
          }

          e.preventDefault();
          const continuation = `\n${indent}${marker} `;
          const newText =
            text.slice(0, selStart) + continuation + text.slice(selEnd);
          const nextCursor = selStart + continuation.length;
          setContent(newText);
          requestAnimationFrame(() => {
            applyEdit(textarea, newText, nextCursor);
            scrollCursorIntoView(textarea, nextCursor);
          });
          return;
        }

        const orderedMatch = lineText.match(ORDERED_LIST_RE);
        if (orderedMatch) {
          const [fullMatch, , numStr] = orderedMatch;
          const afterMarker = lineText.slice(fullMatch.length);

          if (afterMarker.trim() === "") {
            e.preventDefault();
            const { lineStart, lineEnd } = getLineInfo(text, selStart);
            const newText = text.slice(0, lineStart) + text.slice(lineEnd);
            const trimmedNewText = newText.startsWith("\n", lineStart)
              ? newText.slice(0, lineStart) + newText.slice(lineStart + 1)
              : newText;
            setContent(trimmedNewText);
            requestAnimationFrame(() =>
              applyEdit(textarea, trimmedNewText, lineStart),
            );
            return;
          }

          e.preventDefault();
          const nextNum = parseInt(numStr, 10) + 1;
          const continuation = `\n${indent}${nextNum}. `;
          const newText =
            text.slice(0, selStart) + continuation + text.slice(selEnd);
          const nextCursor = selStart + continuation.length;
          setContent(newText);
          requestAnimationFrame(() => {
            applyEdit(textarea, newText, nextCursor);
            scrollCursorIntoView(textarea, nextCursor);
          });
          return;
        }
      }

      if (e.key === "d" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        let wordStart: number;
        let wordEnd: number;

        if (hasSelection) {
          wordStart = selStart;
          wordEnd = selEnd;
        } else {
          const wordBoundary = /[a-zA-Z0-9_]/;
          let start = selStart;
          let end = selStart;
          while (start > 0 && wordBoundary.test(text[start - 1])) start--;
          while (end < text.length && wordBoundary.test(text[end])) end++;
          if (start >= end) return;
          wordStart = start;
          wordEnd = end;
        }

        multiSelectWordRef.current = text.slice(wordStart, wordEnd);
        setMultiSelections([{ start: wordStart, end: wordEnd }]);
        applyEdit(textarea, text, wordStart, wordEnd);
        return;
      }

      if (e.key in CLOSING_PAIRS && !e.ctrlKey && !e.metaKey) {
        const closing = CLOSING_PAIRS[e.key];
        const isSymmetric = e.key === closing;

        if (!hasSelection && isSymmetric) {
          const charBefore = selStart > 0 ? text[selStart - 1] : "";
          const charAfter = text[selStart];

          if (e.key !== "`" && /\w/.test(charBefore)) {
            return;
          }

          if (charAfter === closing) {
            e.preventDefault();
            requestAnimationFrame(() =>
              textarea.setSelectionRange(selStart + 1, selStart + 1),
            );
            return;
          }
        }

        e.preventDefault();

        if (hasSelection) {
          const selected = text.slice(selStart, selEnd);
          const newText =
            text.slice(0, selStart) +
            e.key +
            selected +
            closing +
            text.slice(selEnd);
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 1, selEnd + 1),
          );
        } else {
          const newText =
            text.slice(0, selStart) + e.key + closing + text.slice(selEnd);
          setContent(newText);
          requestAnimationFrame(() =>
            applyEdit(textarea, newText, selStart + 1),
          );
        }
        return;
      }
    },
    [setContent, textareaRef, multiSelections],
  );

  return { onKeyDown, multiSelections, clearMultiSelections };
}

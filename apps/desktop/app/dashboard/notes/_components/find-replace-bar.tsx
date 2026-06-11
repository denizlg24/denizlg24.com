"use client";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Regex,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FindReplaceBarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  setContent: (value: string) => void;
  showReplace: boolean;
  onClose: () => void;
  initialQuery?: string;
  onMatchesChange?: (matches: MatchResult[], currentIndex: number) => void;
}

export interface MatchResult {
  start: number;
  end: number;
}

function computeMatches(
  content: string,
  query: string,
  useRegex: boolean,
  caseSensitive: boolean,
): MatchResult[] {
  if (!query) return [];

  const matches: MatchResult[] = [];

  if (useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, caseSensitive ? "g" : "gi");
    } catch {
      return [];
    }
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
  } else {
    const searchIn = caseSensitive ? content : content.toLowerCase();
    const searchFor = caseSensitive ? query : query.toLowerCase();
    let pos = 0;
    while (pos <= searchIn.length - searchFor.length) {
      const idx = searchIn.indexOf(searchFor, pos);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + searchFor.length });
      pos = idx + 1;
    }
  }

  return matches;
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

export function FindReplaceBar({
  textareaRef,
  content,
  setContent,
  showReplace,
  onClose,
  initialQuery,
  onMatchesChange,
}: FindReplaceBarProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [replacement, setReplacement] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const findInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, []);

  const matches = useMemo(
    () => computeMatches(content, query, useRegex, caseSensitive),
    [content, query, useRegex, caseSensitive],
  );

  useEffect(() => {
    if (matches.length === 0) {
      setCurrentIndex(0);
      return;
    }
    if (currentIndex >= matches.length) {
      setCurrentIndex(0);
    }
  }, [matches.length, currentIndex]);

  useEffect(() => {
    const clampedIndex =
      matches.length > 0 ? Math.min(currentIndex, matches.length - 1) : 0;
    onMatchesChange?.(matches, clampedIndex);
  }, [matches, currentIndex, onMatchesChange]);

  const selectMatch = useCallback(
    (index: number) => {
      const textarea = textareaRef.current;
      if (!textarea || matches.length === 0) return;
      const match = matches[index];
      textarea.focus();
      textarea.setSelectionRange(match.start, match.end);
      textarea.blur();
      findInputRef.current?.focus();

      const lineHeight =
        parseInt(getComputedStyle(textarea).lineHeight, 10) || 20;
      const textBefore = content.slice(0, match.start);
      const lineNumber = textBefore.split("\n").length;
      const scrollTarget = (lineNumber - 3) * lineHeight;
      textarea.scrollTop = Math.max(0, scrollTarget);
    },
    [textareaRef, matches, content],
  );

  useEffect(() => {
    if (matches.length > 0) {
      selectMatch(currentIndex);
    }
  }, [currentIndex, matches, selectMatch]);

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = (currentIndex + 1) % matches.length;
    setCurrentIndex(next);
  }, [matches.length, currentIndex]);

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prev);
  }, [matches.length, currentIndex]);

  const handleReplace = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || matches.length === 0) return;

    const match = matches[currentIndex];
    let replaceWith = replacement;

    if (useRegex) {
      try {
        const re = new RegExp(query, caseSensitive ? "" : "i");
        const matched = content.slice(match.start, match.end);
        replaceWith = matched.replace(re, replacement);
      } catch {}
    }

    const newContent =
      content.slice(0, match.start) + replaceWith + content.slice(match.end);
    setContent(newContent);
    requestAnimationFrame(() => {
      applyEdit(
        textarea,
        newContent,
        match.start,
        match.start + replaceWith.length,
      );
      findInputRef.current?.focus();
    });
  }, [
    textareaRef,
    matches,
    currentIndex,
    content,
    setContent,
    replacement,
    query,
    useRegex,
    caseSensitive,
  ]);

  const handleReplaceAll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || matches.length === 0) return;

    let newContent: string;
    if (useRegex) {
      try {
        const re = new RegExp(query, caseSensitive ? "g" : "gi");
        newContent = content.replace(re, replacement);
      } catch {
        return;
      }
    } else {
      let result = "";
      let lastEnd = 0;
      for (const match of matches) {
        result += content.slice(lastEnd, match.start) + replacement;
        lastEnd = match.end;
      }
      result += content.slice(lastEnd);
      newContent = result;
    }

    setContent(newContent);
    setCurrentIndex(0);
    requestAnimationFrame(() => {
      applyEdit(textarea, newContent, 0, 0);
      findInputRef.current?.focus();
    });
  }, [
    textareaRef,
    matches,
    content,
    setContent,
    replacement,
    query,
    useRegex,
    caseSensitive,
  ]);

  const handleFindKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      textareaRef.current?.focus();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrev();
      } else {
        goToNext();
      }
    }
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      textareaRef.current?.focus();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleReplace();
    }
  };

  const invalidRegex =
    useRegex &&
    query.length > 0 &&
    (() => {
      try {
        new RegExp(query);
        return false;
      } catch {
        return true;
      }
    })();

  return (
    <TooltipProvider>
      <div className="border-t bg-surface px-3 py-2 flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Input
              ref={findInputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCurrentIndex(0);
              }}
              onKeyDown={handleFindKeyDown}
              placeholder="Find"
              className={cn(
                "h-7 text-xs pr-16 font-mono",
                invalidRegex && "border-destructive ring-destructive/20",
              )}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground select-none tabular-nums">
              {query
                ? matches.length > 0
                  ? `${currentIndex + 1} of ${matches.length}`
                  : "No results"
                : ""}
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={caseSensitive ? "default" : "ghost"}
                size="icon-xs"
                onClick={() => setCaseSensitive((v) => !v)}
              >
                <CaseSensitive />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Match Case</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={useRegex ? "default" : "ghost"}
                size="icon-xs"
                onClick={() => setUseRegex((v) => !v)}
              >
                <Regex />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Use Regex</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={goToPrev}
                disabled={matches.length === 0}
              >
                <ArrowUp />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Previous (Shift+Enter)
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={goToNext}
                disabled={matches.length === 0}
              >
                <ArrowDown />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Next (Enter)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" onClick={onClose}>
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Close (Esc)</TooltipContent>
          </Tooltip>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1.5">
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={handleReplaceKeyDown}
              placeholder="Replace"
              className="h-7 text-xs flex-1 font-mono"
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleReplace}
                  disabled={matches.length === 0}
                >
                  <Replace />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Replace (Enter in replace field)
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleReplaceAll}
                  disabled={matches.length === 0}
                >
                  <ReplaceAll />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Replace All</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

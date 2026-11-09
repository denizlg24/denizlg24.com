"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;

function searchUrl(value: string): string {
  const q = value.trim();
  return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
}

/**
 * Searches as you type. The first keystroke away from `/search` pushes a
 * history entry; every one after replaces it, so Back leaves search in one
 * step. `expanding` is the nav's icon that opens into a field.
 */
export function SearchField({
  expanding = false,
  className = "",
}: {
  expanding?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const onSearch = pathname === "/search";
  const urlQuery = onSearch ? (params.get("q") ?? "") : "";
  const [value, setValue] = useState(urlQuery);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pushed = useRef(false);

  useEffect(() => {
    if (!onSearch) {
      setValue("");
      pushed.current = false;
    }
  }, [onSearch]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (expanding && focused && document.activeElement !== input.current) {
      input.current?.focus();
    }
  }, [expanding, focused]);

  const go = (next: string) => {
    if (onSearch || pushed.current) {
      router.replace(searchUrl(next), { scroll: false });
    } else {
      pushed.current = true;
      router.push(searchUrl(next));
    }
  };

  const change = (next: string) => {
    setValue(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go(next), DEBOUNCE_MS);
  };

  const clear = () => {
    window.clearTimeout(timer.current);
    setValue("");
    if (onSearch) router.replace("/search", { scroll: false });
    input.current?.focus();
  };

  const open = !expanding || focused || value.length > 0 || onSearch;

  if (!open) {
    return (
      <button
        type="button"
        data-nav
        aria-label="Search"
        onClick={() => setFocused(true)}
        className={`grid size-10 shrink-0 place-items-center rounded-full text-paper transition-colors hover:text-paper/75 ${className}`}
      >
        <Search className="size-[1.35rem]" strokeWidth={2} />
      </button>
    );
  }

  return (
    <form
      role="search"
      action="/search"
      onSubmit={(event) => {
        event.preventDefault();
        window.clearTimeout(timer.current);
        go(value);
      }}
      className={`flex h-10 min-w-0 items-center gap-2 border border-paper/70 bg-ink/85 px-2.5 ${expanding ? "w-[clamp(12rem,22vw,17rem)]" : "w-full"} ${className}`}
    >
      <Search
        className="size-5 shrink-0 text-paper"
        strokeWidth={2}
        aria-hidden
      />
      <label className="min-w-0 flex-1">
        <span className="sr-only">Titles, people, genres</span>
        <input
          ref={input}
          name="q"
          value={value}
          onChange={(event) => change(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.blur();
              if (!value) setFocused(false);
            }
          }}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          data-nav
          placeholder="Titles, people, genres"
          className="w-full min-w-0 bg-transparent text-[0.95rem] text-paper outline-none placeholder:text-paper/45"
        />
      </label>
      {value ? (
        <button
          type="button"
          data-nav
          aria-label="Clear search"
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
          className="grid size-7 shrink-0 place-items-center rounded-full text-paper/70 hover:text-paper"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </form>
  );
}

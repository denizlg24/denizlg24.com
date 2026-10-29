"use client";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandPrimitive,
  CommandShortcut,
} from "@repo/ui/command";
import { FilePlus, PanelLeft, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { PageIcon, RefIcon } from "@/components/workspace/page-icon";
import { OPEN_COMMAND_PALETTE } from "@/components/workspace/sidebar";
import { MODULE_SECTIONS, MODULES } from "@/lib/workspace/modules";
import { pageHref, pageTitle, resolveRef } from "@/lib/workspace/refs";
import { pageAncestors, useWorkspaceStore } from "@/stores/workspace";

function fuzzyScore(value: string, search: string): number {
  const v = value.toLowerCase();
  const s = search.toLowerCase().trim();

  if (!s) return 1;
  if (v === s) return 1;
  if (v.startsWith(s)) return 0.95;

  const vWords = v.split(/[\s\-_]+/);

  for (let i = 0; i < vWords.length; i++) {
    if (vWords[i] === s) return 0.93;
  }

  for (let i = 0; i < vWords.length; i++) {
    if (vWords[i].startsWith(s)) return 0.9 - i * 0.01;
  }

  const sWords = s.split(/\s+/);
  if (sWords.length > 1) {
    const used = new Set<number>();
    let total = 0;

    for (const sw of sWords) {
      let best = 0;
      let bestIdx = -1;
      for (let i = 0; i < vWords.length; i++) {
        if (used.has(i)) continue;
        let sc = 0;
        if (vWords[i] === sw) sc = 1;
        else if (vWords[i].startsWith(sw)) sc = 0.9;
        else if (vWords[i].includes(sw)) sc = 0.7;
        if (sc > best) {
          best = sc;
          bestIdx = i;
        }
      }
      if (best === 0) return 0;
      used.add(bestIdx);
      total += best;
    }

    return 0.5 + (total / sWords.length) * 0.15;
  }

  const initials = vWords.map((w) => w[0] ?? "").join("");
  if (initials.startsWith(s)) return 0.55;
  if (initials.includes(s)) return 0.5;

  for (let i = 0; i < vWords.length; i++) {
    const idx = vWords[i].indexOf(s);
    if (idx !== -1) {
      const positionPenalty = idx * 0.02;
      const wordPenalty = i * 0.01;
      return 0.45 - positionPenalty - wordPenalty;
    }
  }

  if (v.includes(s)) {
    const idx = v.indexOf(s);
    return 0.3 - idx * 0.005;
  }

  for (const w of vWords) {
    let wi = 0;
    let matched = 0;
    let firstIdx = -1;
    let lastIdx = -1;

    for (let si = 0; si < s.length; si++) {
      let found = false;
      while (wi < w.length) {
        if (w[wi] === s[si]) {
          if (firstIdx === -1) firstIdx = wi;
          matched++;
          lastIdx = wi;
          wi++;
          found = true;
          break;
        }
        wi++;
      }
      if (!found) break;
    }

    if (matched === s.length) {
      const span = lastIdx - firstIdx + 1;
      if (span > s.length * 3) continue;
      const density = matched / span;
      return 0.05 + density * 0.15;
    }
  }

  return 0;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay]);

  return debounced;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 120);
  const router = useRouter();
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const recents = useWorkspaceStore((s) => s.workspace.recents);
  const createPage = useWorkspaceStore((s) => s.createPage);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "p" || e.key === "k") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const openPalette = () => setOpen(true);
    window.addEventListener("keydown", down);
    window.addEventListener(OPEN_COMMAND_PALETTE, openPalette);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_COMMAND_PALETTE, openPalette);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) setSearch("");
  };

  const searching = debouncedSearch.trim().length > 0;
  const livePages = Object.values(pages)
    .filter((p) => !p.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const recentRows = recents
    .map((ref) => resolveRef(ref, pages))
    .filter((r) => r !== null)
    .slice(0, 6);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed top-[16%] left-1/2 z-[110] w-full max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl shadow-black/15 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            Search
          </DialogPrimitive.Title>
          <Command
            className="bg-transparent"
            filter={(value, term, keywords) =>
              fuzzyScore([value, ...(keywords ?? [])].join(" "), term)
            }
          >
            <div className="flex items-center gap-3 border-b px-4">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <CommandPrimitive.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search pages and modules"
                className="flex h-12 w-full bg-transparent text-[15px] text-accent-strong outline-none placeholder:text-muted-foreground"
              />
            </div>
            <CommandList className="max-h-[min(60vh,28rem)] p-1.5">
              <CommandEmpty>No results</CommandEmpty>
              {!searching && recentRows.length > 0 ? (
                <CommandGroup heading="Recent">
                  {recentRows.map((r) => (
                    <CommandItem
                      key={`recent-${r.ref}`}
                      value={`recent ${r.ref}`}
                      keywords={[r.label]}
                      onSelect={() => go(r.href)}
                    >
                      <RefIcon resolved={r} className="text-muted-foreground" />
                      <span className="truncate">{r.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
              <CommandGroup heading="Pages">
                {livePages.map((page) => {
                  const path = pageAncestors(pages, page.id)
                    .map(pageTitle)
                    .join(" / ");
                  return (
                    <CommandItem
                      key={page.id}
                      value={`page ${page.id}`}
                      keywords={[pageTitle(page), path]}
                      onSelect={() => go(pageHref(page.id))}
                    >
                      <PageIcon
                        icon={page.icon}
                        className="text-muted-foreground"
                      />
                      <span className="truncate">{pageTitle(page)}</span>
                      {path ? (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {path}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {MODULE_SECTIONS.map((section) => (
                <CommandGroup key={section.id} heading={section.label}>
                  {MODULES.filter((m) => m.section === section.id).map(
                    (module) => {
                      const Icon = module.icon;
                      return (
                        <CommandItem
                          key={module.id}
                          value={`module ${module.id}`}
                          keywords={[module.label, ...(module.keywords ?? [])]}
                          onSelect={() => go(module.href)}
                        >
                          <Icon className="text-muted-foreground" />
                          <span>{module.label}</span>
                        </CommandItem>
                      );
                    },
                  )}
                </CommandGroup>
              ))}
              <CommandGroup heading="Actions">
                <CommandItem
                  value="action new-page"
                  keywords={["New page", "create"]}
                  onSelect={() => go(pageHref(createPage(null)))}
                >
                  <FilePlus className="text-muted-foreground" />
                  New page
                </CommandItem>
                <CommandItem
                  value="action toggle-sidebar"
                  keywords={["Toggle sidebar"]}
                  onSelect={() => {
                    toggleSidebar();
                    setOpen(false);
                  }}
                >
                  <PanelLeft className="text-muted-foreground" />
                  Toggle sidebar
                  <CommandShortcut>⌘\</CommandShortcut>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

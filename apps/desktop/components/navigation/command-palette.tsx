"use client";

import { Command as CommandPrimitive } from "cmdk";
import { HomeIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import {
  DASHBOARD_PREFIX,
  GROUPS,
  type NavGroup,
} from "@/components/navigation/navigation-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

type CommandEntry = {
  label: string;
  parent?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

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

function flattenGroup(group: NavGroup): CommandEntry[] {
  const entries: CommandEntry[] = [];
  for (const item of group.items) {
    if (item.children) {
      for (const child of item.children) {
        entries.push({
          label: child.label,
          parent: item.label,
          href: child.href,
          icon: child.icon,
        });
      }
    } else if (item.href) {
      entries.push({ label: item.label, href: item.href, icon: item.icon });
    }
  }
  return entries;
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
  const debouncedSearch = useDebouncedValue(search, 150);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const handleSelect = (href: string) => {
    setOpen(false);
    router.push(DASHBOARD_PREFIX + href);
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setSearch("");
      setShowAll(false);
    }
  };

  const [showAll, setShowAll] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!open) {
      setShowAll(false);
      return;
    }

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (search.trim().length > 0) {
      setShowAll(false);
      return;
    }
    idleTimerRef.current = setTimeout(() => setShowAll(true), 2000);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [open, search]);

  const showResults = debouncedSearch.trim().length > 0 || showAll;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed top-[20%] left-1/2 z-50 w-full max-w-xl -translate-x-1/2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            Command Palette
          </DialogPrimitive.Title>
          <Command
            className="overflow-visible bg-transparent"
            filter={showAll ? () => 1 : fuzzyScore}
          >
            <div className="flex items-center gap-3 rounded-full border bg-popover px-5 shadow-lg">
              <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
              <CommandPrimitive.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Search pages..."
                className="flex h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div
              className={`mt-2 rounded-xl border bg-popover shadow-lg overflow-hidden transition-all duration-200 ease-out origin-top ${
                showResults
                  ? "opacity-100 scale-y-100 translate-y-0"
                  : "opacity-0 scale-y-95 -translate-y-1 pointer-events-none max-h-0 border-transparent mt-0"
              }`}
            >
              <CommandList className="max-h-75">
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="General">
                  <CommandItem
                    value="Home"
                    onSelect={() => {
                      setOpen(false);
                      router.push(DASHBOARD_PREFIX);
                    }}
                  >
                    <HomeIcon className="size-4 shrink-0" />
                    <span>Home</span>
                  </CommandItem>
                </CommandGroup>
                {GROUPS.map((group) => {
                  const entries = flattenGroup(group);
                  if (entries.length === 0) return null;
                  return (
                    <CommandGroup
                      key={group.groupLabel}
                      heading={group.groupLabel}
                    >
                      {entries.map((entry) => {
                        const Icon = entry.icon;
                        const uniqueValue = entry.parent
                          ? `${entry.parent} ${entry.label}`
                          : entry.label;
                        return (
                          <CommandItem
                            key={entry.href}
                            value={uniqueValue}
                            onSelect={() => handleSelect(entry.href)}
                            className={entry.parent ? "pl-6" : ""}
                          >
                            <Icon className="size-4 shrink-0" />
                            <span>{entry.label}</span>
                            {entry.parent && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                {entry.parent}
                              </span>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  );
                })}
              </CommandList>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

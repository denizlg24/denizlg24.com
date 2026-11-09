"use client";

import { Check, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { toggleSaved } from "@/app/actions";

interface MyListState {
  saved: ReadonlySet<string>;
  toggle: (titleId: string) => void;
}

const MyListContext = createContext<MyListState>({
  saved: new Set(),
  toggle: () => {},
});

/**
 * What's on the sofa's list, held once for the whole page so every tile,
 * preview card and modal shows the same state and updates together.
 */
export function MyListProvider({
  initial,
  children,
}: {
  initial: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState<ReadonlySet<string>>(
    () => new Set(initial),
  );
  const initialKey = initial.join(",");
  useEffect(() => {
    setSaved(new Set(initialKey ? initialKey.split(",") : []));
  }, [initialKey]);

  const toggle = useCallback(
    (titleId: string) => {
      const next = !saved.has(titleId);
      setSaved((current) => {
        const copy = new Set(current);
        if (next) copy.add(titleId);
        else copy.delete(titleId);
        return copy;
      });
      void toggleSaved(titleId, next).then((result) => {
        if (!result.ok) {
          setSaved((current) => {
            const copy = new Set(current);
            if (next) copy.delete(titleId);
            else copy.add(titleId);
            return copy;
          });
        } else if (pathname === "/my-list") {
          router.refresh();
        }
      });
    },
    [saved, pathname, router],
  );

  const value = useMemo(() => ({ saved, toggle }), [saved, toggle]);
  return <MyListContext value={value}>{children}</MyListContext>;
}

export function useMyList(titleId: string): [boolean, () => void] {
  const { saved, toggle } = use(MyListContext);
  return [saved.has(titleId), () => toggle(titleId)];
}

/** The round "+" / tick button of preview cards and the details modal. */
export function MyListButton({
  titleId,
  size = "md",
}: {
  titleId: string;
  size?: "sm" | "md" | "lg";
}) {
  const [on, toggle] = useMyList(titleId);
  const Icon = on ? Check : Plus;
  const box = { sm: "size-8", md: "size-10", lg: "size-11 md:size-12" }[size];
  return (
    <button
      type="button"
      data-nav
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from My List" : "Add to My List"}
      title={on ? "Remove from My List" : "Add to My List"}
      className={`grid shrink-0 place-items-center rounded-full border-2 border-paper/60 bg-ink/50 text-paper transition-colors hover:border-paper hover:bg-paper/10 ${box}`}
    >
      <Icon className="size-[55%]" strokeWidth={2.25} />
    </button>
  );
}

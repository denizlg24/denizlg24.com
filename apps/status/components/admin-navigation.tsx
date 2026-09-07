"use client";
import { cn } from "@repo/ui/utils";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

export function AdminNavigation({
  view,
  views,
}: {
  view: string;
  views: readonly (readonly [string, string])[];
}) {
  const router = useRouter();
  const [selected, select] = useOptimistic(view);
  const [pending, transition] = useTransition();
  return (
    <nav
      aria-label="Admin navigation"
      aria-busy={pending}
      className="no-scrollbar -mx-1 mb-8 flex items-center gap-1 overflow-x-auto overflow-y-hidden border-b"
    >
      {views.map(([name, label]) => (
        <Link
          key={name}
          prefetch={false}
          href={`/admin?view=${name}`}
          aria-current={selected === name ? "page" : undefined}
          onNavigate={(event) => {
            event.preventDefault();
            transition(() => {
              select(name);
              router.push(`/admin?view=${name}`);
            });
          }}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
            selected === name
              ? "border-accent-strong text-foreground font-medium"
              : "hover:text-foreground border-transparent text-muted-foreground",
          )}
        >
          {label}
          {pending && selected === name ? (
            <LoaderCircle
              aria-label="Loading"
              className="size-3 motion-safe:animate-spin"
            />
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

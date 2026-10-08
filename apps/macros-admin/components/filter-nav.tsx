import { cn } from "@repo/ui/utils";
import Link from "next/link";

export function FilterNav<T extends string>({
  label,
  value,
  options,
  href,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  href: (value: T) => string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("-mb-px flex gap-5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Link
            key={option.value}
            href={href(option.value)}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "-mb-px flex h-9 items-center border-b-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "border-accent-strong font-medium text-accent-strong"
                : "border-transparent text-muted-foreground hover:text-accent-strong",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

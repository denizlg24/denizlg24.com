import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  href: string;
  title: string;
  subtitle: string;
  footer: ReactNode;
  children: ReactNode;
  minHeight?: "sm" | "md";
};

export function MetricTile({
  children,
  footer,
  href,
  minHeight = "sm",
  subtitle,
  title,
}: Props) {
  const min = minHeight === "md" ? "min-h-48" : "min-h-40";
  return (
    <Link
      href={href}
      className={`flex flex-col justify-between rounded-2xl bg-card p-4 ${min}`}
    >
      <div>
        <p className="text-lg font-medium leading-tight">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
      <div className="flex items-center justify-between border-t border-border/70 pt-3">
        <div className="text-base font-medium tabular-nums">{footer}</div>
        <ChevronRight className="size-5 text-muted-foreground" />
      </div>
    </Link>
  );
}

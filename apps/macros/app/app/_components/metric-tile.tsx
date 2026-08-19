import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

type Props = {
  href: string
  title: string
  subtitle: string
  footer: ReactNode
  children: ReactNode
  minHeight?: "sm" | "md"
}

export function MetricTile({
  children,
  footer,
  href,
  minHeight = "sm",
  subtitle,
  title,
}: Props) {
  const min = minHeight === "md" ? "min-h-44" : "min-h-36"
  return (
    <Link
      href={href}
      className={`flex flex-col justify-between rounded-2xl bg-muted/40 p-3 ${min}`}
    >
      <div>
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {children}
      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <div className="text-sm font-semibold tabular-nums">{footer}</div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </Link>
  )
}

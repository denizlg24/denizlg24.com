import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

type Props = {
  title: string
  backHref?: string
  backLabel?: string
  action?: ReactNode
}

export function PageHeader({
  action,
  backHref = "/app",
  backLabel = "Back",
  title,
}: Props) {
  return (
    <header className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 pt-5 pb-3">
      <Button asChild type="button" variant="ghost" size="icon">
        <Link href={backHref} aria-label={backLabel}>
          <ArrowLeft className="size-5" />
        </Link>
      </Button>
      <h1 className="min-w-0 truncate text-center text-xl font-bold">
        {title}
      </h1>
      <div className="flex justify-end">
        {action ?? <span className="size-9" aria-hidden="true" />}
      </div>
    </header>
  )
}

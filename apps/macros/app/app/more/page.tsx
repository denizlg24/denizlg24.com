import { ChevronRight, ListChecks, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { pageMetadata } from "@/app/metadata"

export const metadata = pageMetadata(
  "More",
  "Open additional nutrition views and food log settings."
)

export default function Page() {
  return (
    <div className="min-h-dvh pb-32">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-3xl font-black tracking-tight">More</h1>
      </div>

      <div className="px-4">
        <div className="rounded-xl bg-muted/40 divide-y divide-border/40">
          <Link
            href="/app/food-log/nutrition"
            className="flex items-center gap-3 px-4 py-4"
          >
            <ListChecks className="size-5" />
            <span className="flex-1 text-sm font-medium">
              Nutrition Overview
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <button
            type="button"
            disabled
            className="w-full flex items-center gap-3 px-4 py-4 text-left disabled:opacity-60"
          >
            <SlidersHorizontal className="size-5" />
            <span className="flex-1 text-sm font-medium">
              Customize Food Log
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  )
}

import {
  Activity,
  BarChart3,
  ChevronRight,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "More",
  "Open additional nutrition views and food log settings.",
);

export default function Page() {
  return (
    <div className="min-h-dvh pb-32">
      <div className="macros-page-top px-5 pb-6">
        <h1 className="text-3xl font-black tracking-tight">More</h1>
      </div>

      <div className="px-5">
        <h2 className="mb-4 text-xl font-bold">General</h2>
        <div className="divide-y divide-border/70 rounded-2xl bg-card">
          <Link
            href="/app/food-log/nutrition"
            className="flex min-h-18 items-center gap-4 px-5 py-4"
          >
            <ListChecks className="size-5" />
            <span className="flex-1 text-base font-medium">
              Nutrition Overview
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            href="/app/body"
            className="flex min-h-18 items-center gap-4 px-5 py-4"
          >
            <Activity className="size-5" />
            <span className="flex-1 text-base font-medium">Body & habits</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <Link
            href="/app/statistics"
            className="flex min-h-18 items-center gap-4 px-5 py-4"
          >
            <BarChart3 className="size-5" />
            <span className="flex-1 text-base font-medium">
              Statistics & export
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
          <button
            type="button"
            disabled
            className="flex min-h-18 w-full items-center gap-4 px-5 py-4 text-left disabled:opacity-60"
          >
            <SlidersHorizontal className="size-5" />
            <span className="flex-1 text-base font-medium">
              Customize Food Log
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Button } from "@repo/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { TargetGrid } from "@/components/deploy/target-grid";

export default function DeploymentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-base font-semibold leading-tight">deployments</h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/deployments/new">
            <Plus className="size-3" />
            New target
          </Link>
        </Button>
      </div>
      <TargetGrid />
    </div>
  );
}

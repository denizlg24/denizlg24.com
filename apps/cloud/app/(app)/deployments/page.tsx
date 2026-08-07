"use client";

import { TargetGrid } from "@/components/deploy/target-grid";

export default function DeploymentsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-base font-semibold leading-tight">deployments</h1>
      <TargetGrid />
    </div>
  );
}

"use client";

import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Plus } from "lucide-react";
import Link from "next/link";
import { TargetGrid } from "@/components/deploy/target-grid";

/**
 * Creating a target is a page, not a dialog: the repository is only the half of
 * it that cannot be defaulted, and the build configuration next to it is the
 * part worth reading before the first build rather than after it.
 */
export function DeploySection({ projectId }: { projectId: string }) {
  return (
    <Section
      title="Deployments"
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={`/deployments/new?projectId=${projectId}`}>
            <Plus className="size-3" />
            New target
          </Link>
        </Button>
      }
    >
      <TargetGrid projectId={projectId} />
    </Section>
  );
}

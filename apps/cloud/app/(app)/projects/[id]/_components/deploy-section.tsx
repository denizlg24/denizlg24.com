"use client";

import { TargetGrid } from "@repo/cloud-ui/deploy/target-grid";
import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { Plus } from "lucide-react";
import Link from "next/link";
import {
  newProjectServiceHref,
  projectServiceHref,
} from "@/lib/project-routes";

/**
 * Creating a target is a page, not a dialog: the repository is only the half of
 * it that cannot be defaulted, and the build configuration next to it is the
 * part worth reading before the first build rather than after it.
 */
export function DeploySection({ projectId }: { projectId: string }) {
  return (
    <Section
      title="Services"
      actions={
        <Button asChild size="sm">
          <Link href={newProjectServiceHref(projectId)}>
            <Plus className="size-3" />
            Import repository
          </Link>
        </Button>
      }
    >
      <TargetGrid
        projectId={projectId}
        targetHref={(target) => projectServiceHref(target.projectId, target.id)}
        emptyLabel="No repository connected. Import one to deploy this project."
      />
    </Section>
  );
}

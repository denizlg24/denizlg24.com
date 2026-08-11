"use client";

import { TargetGrid } from "@repo/cloud-ui/deploy/target-grid";
import { Button } from "@repo/ui/button";
import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { ProjectsStrip } from "@/components/projects-strip";
import { projectHref } from "@/components/target-context";

/**
 * Every deployable on the box. A project and its deploy target are one thing
 * here, so a card links straight at `/<slug>` rather than through a project
 * page that would hold a single row.
 */
export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="projects">
        <Button asChild size="sm">
          <Link href="/new">Import</Link>
        </Button>
      </PageHeading>
      <ProjectsStrip />
      <TargetGrid targetHref={(target) => projectHref(target.projectSlug)} />
    </div>
  );
}

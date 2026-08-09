"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { cn } from "@repo/ui/utils";
import { ArrowUpRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { projectServiceHref } from "@/lib/project-routes";
import { TargetContext } from "./_components/target-context";

const SECTIONS = [
  { segment: "", label: "Overview" },
  { segment: "deployments", label: "Deployments" },
  { segment: "environment", label: "Environment" },
  { segment: "domains", label: "Domains" },
  { segment: "settings", label: "Settings" },
] as const;

function sectionHref(
  projectId: string,
  targetId: string,
  segment: string,
): string {
  return projectServiceHref(projectId, targetId, segment);
}

/**
 * Overview is the bare target route, so a `startsWith` test would mark it
 * active on every section. It matches exactly; the others own their subtree,
 * which is what keeps "Deployments" lit while a single deployment is open.
 */
function isActive(pathname: string, href: string, segment: string): boolean {
  return segment === "" ? pathname === href : pathname.startsWith(href);
}

export default function ProjectServiceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const params = useParams<{ serviceId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const targetId = params.serviceId;

  const fetchTarget = useCallback(
    () => api.deploy.target(targetId),
    [targetId],
  );
  const {
    data: target,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(fetchTarget, null);

  if (unreachable) {
    return <Unreachable retrying={loading} onRetry={() => void reload()} />;
  }
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!target) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <TargetContext.Provider value={{ target, reload }}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-3 border-b pb-4">
          <div className="min-w-0 flex-1">
            <p className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Link href="/projects" className="hover:text-foreground">
                Projects
              </Link>
              <span>/</span>
              <Link
                href={`/projects/${target.projectId}`}
                className="truncate hover:text-foreground"
              >
                {target.projectSlug}
              </Link>
            </p>
            <h1 className="text-base font-semibold leading-tight">
              {target.name}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {target.repoOwner}/{target.repoName} · {target.productionBranch}
            </p>
          </div>
          {target.primaryHostname && (
            <Button asChild variant="outline" size="sm">
              <a
                href={`https://${target.primaryHostname}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {target.primaryHostname}
                <ArrowUpRight className="size-3" />
              </a>
            </Button>
          )}
          <Button asChild size="sm">
            <Link
              href={projectServiceHref(target.projectId, target.id, "deploy")}
            >
              Deploy
            </Link>
          </Button>
          <TypedConfirmDialog
            title={`Delete ${target.name}`}
            keyword={target.name}
            actionLabel="Delete"
            onConfirm={async () => {
              try {
                await api.deploy.removeTarget(target.id);
                toast.success("Target deleted");
                router.push(`/projects/${target.projectId}`);
              } catch (err) {
                toast.error(errorMessage(err));
              }
            }}
            trigger={
              <Button variant="ghost" size="sm">
                <Trash2 className="size-3" />
              </Button>
            }
          />
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <nav className="flex gap-1 overflow-x-auto md:w-44 md:shrink-0 md:flex-col md:overflow-visible">
            {SECTIONS.map((section) => {
              const href = sectionHref(
                target.projectId,
                target.id,
                section.segment,
              );
              const active = isActive(pathname, href, section.segment);
              return (
                <Link
                  key={section.segment}
                  href={href}
                  className={cn(
                    "whitespace-nowrap rounded px-2 py-1.5 text-xs transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {section.label}
                </Link>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </TargetContext.Provider>
  );
}

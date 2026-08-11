"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { type ReactNode, useCallback } from "react";
import { projectHref, TargetContext } from "@/components/target-context";
import { api } from "@/lib/api";

const SECTIONS = [
  { segment: "", label: "overview" },
  { segment: "deployments", label: "deployments" },
  { segment: "analytics", label: "analytics" },
  { segment: "logs", label: "logs" },
  { segment: "storage", label: "storage" },
  { segment: "environment", label: "environment" },
  { segment: "domains", label: "domains" },
  { segment: "settings", label: "settings" },
] as const;

/**
 * Overview is the bare project route, so a `startsWith` test would mark it
 * active on every section. It matches exactly; the others own their subtree,
 * which is what keeps "deployments" lit while a single deployment is open.
 */
function isActive(pathname: string, href: string, segment: string): boolean {
  return segment === "" ? pathname === href : pathname.startsWith(href);
}

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ project: string }>();
  const pathname = usePathname();
  const slug = params.project;

  const fetchTarget = useCallback(() => api.deploy.targetBySlug(slug), [slug]);
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
            <h1 className="text-sm font-semibold tracking-tight">
              {target.projectSlug}
            </h1>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {target.repoOwner}/{target.repoName} · {target.productionBranch}
            </p>
          </div>
          {target.primaryHostname ? (
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
          ) : null}
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          <nav className="flex gap-1 overflow-x-auto md:w-40 md:shrink-0 md:flex-col md:overflow-visible">
            {SECTIONS.map((section) => {
              const href = projectHref(target.projectSlug, section.segment);
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

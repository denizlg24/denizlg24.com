"use client";

import { FrameworkIcon } from "@repo/cloud-ui/tech-icon";
import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import {
  ArrowUpRight,
  ChartLine,
  Database,
  Globe,
  KeyRound,
  LayoutGrid,
  Rocket,
  ScrollText,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { type ReactNode, useCallback } from "react";
import { projectHref, TargetContext } from "@/components/target-context";
import { api } from "@/lib/api";

const SECTIONS = [
  { segment: "", label: "overview", icon: LayoutGrid },
  { segment: "deployments", label: "deployments", icon: Rocket },
  { segment: "analytics", label: "analytics", icon: ChartLine },
  { segment: "logs", label: "logs", icon: ScrollText },
  { segment: "resources", label: "resources", icon: Database },
  { segment: "environment", label: "environment", icon: KeyRound },
  { segment: "domains", label: "domains", icon: Globe },
  { segment: "settings", label: "settings", icon: Settings },
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
        <div className="flex flex-wrap items-start gap-3 border-b pb-4">
          {/* Labelled: nothing on this header writes the framework out. */}
          <FrameworkIcon
            framework={target.framework}
            className="mt-0.5 size-5 text-muted-foreground"
            label={target.framework ?? "no preset"}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold tracking-tight">
              {target.projectSlug}
            </h1>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {target.repoOwner}/{target.repoName} · {target.productionBranch}
            </p>
          </div>
          {target.primaryHostname ? (
            <Button asChild variant="outline" size="sm" className="truncate">
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
                    "flex items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-xs transition-colors",
                    active
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {/* <section.icon className="size-3.5 shrink-0" aria-hidden /> */}
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

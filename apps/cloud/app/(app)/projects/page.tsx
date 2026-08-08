"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { api } from "@/lib/api";

export default function ProjectsPage() {
  const fetchProjects = useCallback(
    () => api.projects.list({ limit: 100 }),
    [],
  );
  const { data, error } = usePoll(fetchProjects, null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">
          projects
          {data && (
            <span className="ml-2 font-normal text-muted-foreground">
              {data.pagination.total}
            </span>
          )}
        </h1>
        <Button asChild size="sm" variant="outline">
          <Link href="/projects/new">
            <Plus className="size-3.5" />
            project
          </Link>
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto border-y">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>name</TableHead>
                <TableHead>slug</TableHead>
                <TableHead>description</TableHead>
                <TableHead className="text-right">created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {project.slug}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                    {project.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {formatRelative(project.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-16 text-center text-xs text-muted-foreground"
                  >
                    —
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

"use client";
import { FolderGit2, RefreshCcwIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { ILeanProject } from "@/models/Project";

export const ProjectsSection = ({
  initialProjects,
}: {
  initialProjects: ILeanProject[];
}) => {
  const searchParams = useSearchParams();
  const query = searchParams.get("query") || "";
  const arrayTags = searchParams.getAll("tags") || [];
  const projects = useMemo(() => {
    if (!query && arrayTags.length === 0) return initialProjects;

    const lowerQuery = query.toLowerCase().trim();

    return initialProjects
      .map((project) => {
        if (
          arrayTags.length > 0 &&
          arrayTags.some((tag) => !project.tags.includes(tag))
        ) {
          return null;
        }

        if (!lowerQuery) {
          return { ...project, score: 1 };
        }

        let score = 0;
        const title = project.title?.toLowerCase() || "";
        const subtitle = project.subtitle?.toLowerCase() || "";
        const markdown = project.markdown?.toLowerCase() || "";

        if (title.includes(lowerQuery)) {
          score += 10;
          if (title.startsWith(lowerQuery)) score += 5;
        }

        if (subtitle.includes(lowerQuery)) {
          score += 5;
        }

        if (markdown.includes(lowerQuery)) {
          score += 1;
        }

        if (score === 0) return null;

        return { ...project, score };
      })
      .filter((item): item is ILeanProject & { score: number } => item !== null)
      .sort((a, b) => b.score - a.score);
  }, [initialProjects, query, arrayTags]);

  if (projects.length === 0)
    return (
      <>
        {query || arrayTags.length > 0 ? (
          <p className="col-span-full text-sm text-left ">
            Displaying {projects.length} project(s) matching your filters.
          </p>
        ) : (
          <p className="col-span-full text-sm text-left ">
            Displaying {projects.length} active project(s).
          </p>
        )}
        <Empty className="col-span-full">
          <EmptyHeader className="max-w-lg!">
            <EmptyMedia variant="icon">
              <FolderGit2 />
            </EmptyMedia>
            <EmptyTitle>No projects to display</EmptyTitle>
            <EmptyDescription>
              {query || arrayTags.length > 0
                ? "Whoops. There are no projects matching your filters. Maybe I have to work harder, or maybe you should adjust your filters..."
                : "Whoops. There are no projects to display. Either I broke something or I'm a fraud that has never done anything. You decide..."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <Link href={"/projects"}>
                {query || arrayTags.length > 0 ? (
                  <>
                    <Trash2 /> Clear filters
                  </>
                ) : (
                  <>
                    <RefreshCcwIcon />
                    Refresh
                  </>
                )}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </>
    );

  return (
    <>
      {query || arrayTags.length > 0 ? (
        <p className="col-span-full text-sm text-left">
          Displaying {projects.length} project(s) matching your filters.
        </p>
      ) : (
        <p className="col-span-full text-sm text-left ">
          Displaying {projects.length} active project(s).
        </p>
      )}
      {projects.map((project) => (
        <ProjectCard
          key={project._id.toString()}
          className="max-w-full col-span-1"
          project={{
            ...project,
            links: project.links.map((link) => ({
              _id: link._id.toString(),
              label: link.label,
              icon: link.icon,
              url: link.url,
            })),
          }}
        />
      ))}
    </>
  );
};

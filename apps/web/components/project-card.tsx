"use client";

import Image from "next/image";
import Link from "next/link";
import { cn, iconMap } from "@/lib/utils";
import type { ILeanProject } from "@/models/Project";
import { StyledLink } from "./styled-link";
import { Badge } from "./ui/badge";

export const ProjectCard = ({
  project,
  className,
}: {
  project: ILeanProject;
  className?: string;
}) => {
  return (
    <article
      className={cn("w-full flex flex-col gap-4 max-w-3xs h-full", className)}
    >
      <Link href={`/projects/${project._id}`}>
        <div className="w-full flex flex-col gap-2 group hover:cursor-pointer">
          <Image
            src={project.images[0]}
            alt={project.title}
            width={1920}
            height={1080}
            className="w-full h-auto object-cover rounded-sm drop-shadow-lg aspect-video group-hover:scale-[1.01] group-hover:-translate-y-1 transition-all group-hover:drop-shadow-xl duration-400"
          />
          <h1 className="text-lg font-medium text-left truncate">
            {project.title}
          </h1>
          <h2 className="text-sm text-justify font-light text-muted-foreground line-clamp-4">
            {project.subtitle}
          </h2>

          <div className="flex flex-row items-center justify-start gap-1 flex-wrap w-full">
            {project.tags.map((tag, indx) =>
              indx > 3 ? null : (
                <Badge key={tag} className="text-xs">
                  {tag}
                </Badge>
              ),
            )}
            {project.tags.length > 4 && (
              <Badge className="text-xs">{`+${project.tags.length - 4}`}</Badge>
            )}
          </div>
        </div>
      </Link>
      <div className="flex flex-row items-center justify-start gap-1 flex-wrap w-full mt-auto">
        {project.links.map((link, linkIdx) => {
          const Icon = iconMap[link.icon];
          return (
            <StyledLink
              key={linkIdx}
              type="anchor"
              className="inline-flex items-center gap-1 text-xs"
              href={link.url}
              target="_blank"
            >
              {link.label} <Icon className="w-3 h-3" />
            </StyledLink>
          );
        })}
      </div>
    </article>
  );
};

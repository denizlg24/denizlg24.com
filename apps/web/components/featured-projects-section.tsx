import { getActiveProjects } from "@/lib/projects";
import { ProjectCard } from "./project-card";

export async function FeaturedProjectsSection({
  count,
}: {
  count?: number;
} = {}) {
  const projects = await getActiveProjects();

  return projects
    .filter((project) => project.isFeatured)
    .map((project) => (
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
    ));
}

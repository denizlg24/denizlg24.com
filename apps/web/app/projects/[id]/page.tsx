export const revalidate = 2592000; // Revalidate every 30 days

import Image from "next/image";
import { notFound } from "next/navigation";
import { ImageZoomButton } from "@/components/image-zoom-button";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Separator } from "@/components/ui/separator";
import { getActiveProjects, getProjectById } from "@/lib/projects";
import { iconMap } from "@/lib/utils";

export async function generateStaticParams() {
  const projects = await getActiveProjects();

  return projects.map((project) => ({
    id: project._id.toString(),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) {
    return {
      title: "Project Not Found",
      description: "The requested project does not exist.",
    };
  }
  return {
    title: {
      absolute: `${project.title} | Deniz Lopes Güneş`,
    },
    description: project.subtitle,
    openGraph: {
      title: `${project.title} | Deniz Lopes Güneş`,
      description: project.subtitle,
      url: `https://denizlg24.com/projects/${project._id}`,
      type: "article",
      locale: "en_US",
      siteName: "Deniz Lopes Güneş Portfolio",
    },
    twitter: {
      card: "summary_large_image",
      title: `${project.title} | Deniz Lopes Güneş`,
      description: project.subtitle,
    },
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) {
    notFound();
  }
  return (
    <main className="flex flex-col items-center justify-center animate-in fade-in duration-500">
      <section className="w-full max-w-5xl mx-auto px-4 items-center mt-6">
        <h1 className="sm:text-4xl xs:text-3xl text-2xl font-calistoga text-balance text-center">
          {project.title}
        </h1>
        <div className="mt-6 flex items-center justify-center overflow-hidden rounded-lg drop-shadow-xl w-full h-auto aspect-video">
          <Carousel>
            <CarouselContent>
              {project.images.map((image, index) => (
                <CarouselItem key={index} className="relative">
                  <Image
                    src={image}
                    alt={project.title}
                    width={1920}
                    height={1080}
                    className="object-cover w-full h-auto aspect-video rounded-lg border-2"
                  />
                  <ImageZoomButton src={image} alt={project.title} />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-1" />
            <CarouselNext className="right-1" />
          </Carousel>
        </div>
        <div className="flex flex-row items-center justify-start gap-1 flex-wrap w-full mt-4">
          {project.tags.map((tag) => (
            <Badge key={tag} className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        <Separator className="my-4" />
        <MarkdownRenderer content={project.markdown} />
        <Separator className="my-4" />
        <div className="flex flex-row items-center flex-wrap justify-end gap-2 mt-2">
          {project.links.map((link, linkIdx) => {
            const Icon = iconMap[link.icon];
            return (
              <Button
                className="sm:text-sm text-xs"
                size={"sm"}
                asChild
                key={`${link}-${linkIdx}`}
                variant={"default"}
              >
                <a href={link.url} target="_blank">
                  {link.label} <Icon className="w-3 h-3" />
                </a>
              </Button>
            );
          })}
        </div>
      </section>
    </main>
  );
}

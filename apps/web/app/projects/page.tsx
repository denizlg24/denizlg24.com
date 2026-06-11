export const revalidate = 2592000;

import { ChevronsUpDown, Loader2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveProjects } from "@/lib/projects";
import { FilterWrapper } from "./components/filter-wrapper";
import { ProjectsSection } from "./components/projects-section";

export const metadata: Metadata = {
  title: {
    absolute: "Projects | Deniz Lopes Güneş",
  },
  description:
    "Explore a curated selection of software projects developed by Deniz Lopes Güneş, showcasing expertise in fullstack applications, open-source contributions, and innovative solutions.",
  openGraph: {
    title: "Projects | Deniz Lopes Güneş",
    description:
      "Explore a curated selection of software projects developed by Deniz Lopes Güneş, showcasing expertise in fullstack applications, open-source contributions, and innovative solutions.",
    url: "https://denizlg24.com/projects",
    type: "website",
    locale: "en_US",
    siteName: "Deniz Lopes Güneş Portfolio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Projects | Deniz Lopes Güneş",
    description:
      "Explore a curated selection of software projects developed by Deniz Lopes Güneş, showcasing expertise in fullstack applications, open-source contributions, and innovative solutions.",
  },
};

export default async function Page() {
  const projects = await getActiveProjects();
  return (
    <main className="flex flex-col items-center min-h-screen">
      <section className="w-full max-w-5xl mx-auto px-4 text-center items-center">
        <h1 className="sm:text-5xl text-4xl text-balance font-calistoga text-center">
          projects.
        </h1>
        <Suspense
          fallback={
            <div className="w-full flex xs:flex-row flex-col items-center justify-between mt-16 gap-2">
              <Input
                placeholder="Search projects..."
                className="w-full grow max-w-sm"
              />
              <Button
                variant="outline"
                className="xs:w-[200px] w-full justify-between"
              >
                Filter by topic...
                <ChevronsUpDown className="opacity-50" />
              </Button>
            </div>
          }
        >
          <FilterWrapper />
        </Suspense>
        <div className="grid md:grid-cols-3 xs:grid-cols-2 grid-cols-1 gap-4 mt-4 pt-4 border-t">
          <Suspense
            fallback={
              <div className="w-fit h-[150px] flex items-center justify-center mx-auto col-span-full">
                <Loader2 className="animate-spin" />
              </div>
            }
          >
            <ProjectsSection initialProjects={projects} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

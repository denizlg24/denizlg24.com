export const revalidate = 2592000; // Revalidate every 30 days

import { ChevronsUpDown, Loader2 } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveBlogs } from "@/lib/blog";
import { FilterWrapper } from "../projects/components/filter-wrapper";
import { BlogSection } from "./components/blog-section";

export const metadata: Metadata = {
  title: {
    absolute: "Blog | Deniz Lopes Güneş",
  },
  description:
    "Thoughts, tutorials and essays about software engineering, full-stack development, open source, and career insights by Deniz Lopes Güneş.",
  openGraph: {
    title: "Blog | Deniz Lopes Güneş",
    description:
      "Thoughts, tutorials and essays about software engineering, full-stack development, open source, and career insights by Deniz Lopes Güneş.",
    url: "https://denizlg24.com/blog",
    siteName: "Deniz Lopes Güneş",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog | Deniz Lopes Güneş",
    description:
      "Thoughts, tutorials and essays about software engineering, full-stack development, open source, and career insights by Deniz Lopes Güneş.",
  },
};

export default async function Page() {
  const blogs = await getActiveBlogs();
  return (
    <main className="flex flex-col items-center min-h-screen">
      <section className="w-full max-w-5xl mx-auto px-4 text-center items-center">
        <h1 className="sm:text-5xl text-4xl text-balance font-calistoga text-center">
          blog.
        </h1>
        <Suspense
          fallback={
            <div className="w-full flex xs:flex-row flex-col items-center justify-between mt-16 gap-2">
              <Input
                placeholder="Search for posts..."
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
          <FilterWrapper fetcher="blog" />
        </Suspense>
        <div className="flex flex-col gap-1 mt-4 pt-4 border-t">
          <Suspense
            fallback={
              <div className="w-fit h-[150px] flex items-center justify-center mx-auto">
                <Loader2 className="animate-spin" />
              </div>
            }
          >
            <BlogSection initialBlogs={blogs} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

"use client";

import { Eye, EyeOff, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ILeanBlog } from "@/models/Blog";
import { BlogList } from "./blog-list";

interface BlogManagerProps {
  initialBlogs: ILeanBlog[];
}

export function BlogManager({ initialBlogs }: BlogManagerProps) {
  const [blogs, setBlogs] = useState(initialBlogs);
  const [filteredBlogs, setFilteredBlogs] = useState(initialBlogs);
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");

  const fetchBlogs = async () => {
    try {
      const response = await fetch("/api/admin/blogs");
      if (!response.ok) {
        throw new Error("Failed to fetch blogs");
      }
      const data = await response.json();
      setBlogs(data.blogs || []);
    } catch (error) {
      console.error("Error fetching blogs:", error);
    }
  };

  useEffect(() => {
    let filtered = blogs;

    if (visibilityFilter !== "all") {
      filtered = filtered.filter((blog) =>
        visibilityFilter === "hidden" ? !blog.isActive : blog.isActive,
      );
    }

    setFilteredBlogs(filtered);
  }, [blogs, visibilityFilter]);

  return (
    <>
      <div className="flex sm:flex-row flex-col sm:items-center items-start gap-2 justify-between w-full">
        <div className="">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Blogs Management
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Create and manage your blog posts.
          </p>
        </div>
        <div className="flex gap-2 sm:w-fit w-full">
          <Button asChild>
            <Link href="/admin/dashboard/blogs/new">
              <Plus className="w-4 h-4 mr-2" />
              Create New
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-2 mt-4">
        <div className="flex items-center gap-2 justify-end">
          <Label className="text-sm">Toggle Hidden:</Label>
          <Button
            variant={visibilityFilter === "hidden" ? "default" : "outline"}
            size="icon"
            onClick={() =>
              setVisibilityFilter(
                visibilityFilter === "hidden" ? "all" : "hidden",
              )
            }
            title={
              visibilityFilter === "hidden" ? "Show All" : "Show Hidden Only"
            }
          >
            {visibilityFilter === "hidden" ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Button>
        </div>

        <BlogList blogs={filteredBlogs} onRefresh={fetchBlogs} />
      </div>
    </>
  );
}

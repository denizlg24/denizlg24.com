"use client";

import {
  Clock,
  Eye,
  EyeOff,
  MessageSquare,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { ShareButton } from "@/app/blog/[slug]/components/share-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ILeanBlog } from "@/models/Blog";

interface BlogListProps {
  blogs: ILeanBlog[];
  onRefresh: () => void;
}

export function BlogList({ blogs, onRefresh }: BlogListProps) {
  const handleToggleActive = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/blogs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleActive: true }),
      });

      if (!response.ok) {
        throw new Error("Failed to toggle blog visibility");
      }

      onRefresh();
    } catch (error) {
      console.error("Error toggling blog visibility:", error);
      alert("Failed to toggle blog visibility. Please try again.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this blog post?")) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/blogs/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete blog");
      }

      onRefresh();
    } catch (error) {
      console.error("Error deleting blog:", error);
      alert("Failed to delete blog. Please try again.");
    }
  };

  if (blogs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm sm:text-base text-muted-foreground">
          No blogs found
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {blogs.map((blog) => (
        <Card key={blog._id} className="p-3 sm:p-4">
          <div className="flex flex-col items-start gap-4">
            <div className="flex-1 min-w-0 w-full sm:w-auto">
              <h3 className="font-semibold text-sm sm:text-base md:text-lg truncate">
                {blog.title}
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mb-2">
                {blog.excerpt}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>{blog.timeToRead} min read</span>
                </div>
                {blog.tags?.slice(0, 5).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {blog.tags && blog.tags.length > 5 && (
                  <Badge variant="secondary" className="text-xs">
                    +{blog.tags.length - 5}
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 w-full shrink-0 pt-2 border-t">
              <ShareButton
                url={`https://denizlg24.com/blog/${blog.slug}`}
                title={`${blog.excerpt}\n\nRead the full articles here: `}
              />
              <Button asChild size={"icon"} variant={"ghost"}>
                <Link href={`/admin/dashboard/blogs/${blog._id}/comments`}>
                  <MessageSquare />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleToggleActive(blog._id)}
                title={blog.isActive ? "Hide blog" : "Show blog"}
              >
                {blog.isActive ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <Link href={`/admin/dashboard/blogs/${blog._id}`}>
                  <Pencil className="w-4 h-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(blog._id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

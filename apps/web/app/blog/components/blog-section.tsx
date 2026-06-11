"use client";
import {
  Calendar,
  Clock,
  Eye,
  Notebook,
  RefreshCcwIcon,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { ILeanBlog } from "@/models/Blog";

export const BlogSection = ({
  initialBlogs,
}: {
  initialBlogs: ILeanBlog[];
}) => {
  const searchParams = useSearchParams();
  const query = searchParams.get("query") || "";
  const arrayTags = searchParams.getAll("tags") || [];
  const sort = searchParams.get("sort") || "newest";
  const router = useRouter();

  const [viewsMap, setViewsMap] = useState<Record<string, number>>({});
  const [viewsLoaded, setViewsLoaded] = useState(false);

  useEffect(() => {
    const fetchViews = async () => {
      try {
        const response = await fetch("/api/blog/views");
        if (response.ok) {
          const data = await response.json();
          setViewsMap(data.views || {});
        }
      } catch (error) {
        console.error("Error fetching views:", error);
      } finally {
        setViewsLoaded(true);
      }
    };

    fetchViews();
  }, []);

  const blogs = useMemo(() => {
    let filtered = initialBlogs;

    if (arrayTags.length > 0) {
      filtered = filtered.filter(
        (blog) =>
          blog.tags && arrayTags.every((tag) => blog.tags?.includes(tag)),
      );
    }

    if (query) {
      const lowerQuery = query.toLowerCase().trim();
      filtered = filtered
        .map((blog) => {
          let score = 0;
          const title = blog.title?.toLowerCase() || "";
          const excerpt = blog.excerpt?.toLowerCase() || "";
          const content = blog.content?.toLowerCase() || "";

          if (title.includes(lowerQuery)) {
            score += 50;
            if (title.startsWith(lowerQuery)) score += 25;
          }

          if (excerpt.includes(lowerQuery)) {
            score += 10;
          }

          if (content.includes(lowerQuery)) {
            score += 1;
          }

          if (
            blog.tags?.some((tag) => tag.toLowerCase().includes(lowerQuery))
          ) {
            score += 5;
          }

          if (score === 0) return null;
          return { ...blog, score };
        })
        .filter((item): item is ILeanBlog & { score: number } => item !== null)
        .sort((a, b) => b.score - a.score);
    } else {
      filtered = filtered.map((blog) => ({ ...blog, score: 0 }));
    }

    if (!query) {
      switch (sort) {
        case "oldest":
          filtered = [...filtered].sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          break;
        case "most-popular":
          filtered = [...filtered].sort(
            (a, b) => (viewsMap[b._id] || 0) - (viewsMap[a._id] || 0),
          );
          break;
        default:
          filtered = [...filtered].sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          break;
      }
    }

    return filtered;
  }, [initialBlogs, query, arrayTags, sort, viewsMap]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <>
      <div className="w-full flex flex-row items-center justify-between">
        {query || arrayTags.length > 0 ? (
          <p className="text-sm text-left text-muted-foreground">
            Displaying {blogs.length} post(s) matching your filters.
          </p>
        ) : (
          <p className="text-sm text-left text-muted-foreground">
            Displaying {blogs.length} active post(s).
          </p>
        )}
        <div className="w-fit shrink-0 flex flex-row items-center justify-end gap-2">
          <Label className="text-muted-foreground">Sort:</Label>
          <Select
            value={sort}
            onValueChange={(value) => {
              const newParams = new URLSearchParams(searchParams);
              newParams.set("sort", value);
              const queryString = newParams.toString();
              router.push(`/blog?${queryString}`);
            }}
          >
            <SelectTrigger className="w-fit border-none shadow-none px-0 gap-1 font-medium">
              {sort === "most-popular"
                ? "Most popular"
                : sort === "newest"
                  ? "Newest"
                  : "Oldest"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="most-popular">Most popular</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {blogs.length === 0 ? (
        <Empty>
          <EmptyHeader className="max-w-lg!">
            <EmptyMedia variant="icon">
              <Notebook />
            </EmptyMedia>
            <EmptyTitle>No posts to display</EmptyTitle>
            <EmptyDescription>
              {query || arrayTags.length > 0
                ? "Whoops. There are no posts matching your filters. Maybe I have to start posting more, or maybe you should adjust your filters..."
                : "Whoops. There are no posts to display. Either I broke something or I'm lazy and still haven't written anything. You decide..."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline" size="sm">
              <Link href={"/blog"}>
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
      ) : (
        <div className="flex flex-col divide-y divide-border/40">
          {blogs.map((blog) => (
            <Link
              key={blog._id}
              href={`/blog/${blog.slug}`}
              className="group py-4 flex flex-col gap-2 text-left transition-colors hover:bg-muted/30 -mx-3 px-3 rounded-md"
            >
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-base sm:text-lg transition-colors line-clamp-1">
                  {blog.title}
                </h3>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {blog.excerpt}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDate(blog.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {blog.timeToRead} min read
                </span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" />
                  {viewsLoaded
                    ? (viewsMap[blog._id] || 0).toLocaleString()
                    : "—"}{" "}
                  views
                </span>
                {blog.tags && blog.tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {blog.tags.slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="text-xs px-1.5 py-0"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {blog.tags.length > 3 && (
                      <span className="text-muted-foreground">
                        +{blog.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
};

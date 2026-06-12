"use client";

import { useEffect, useState } from "react";
import type { InstagramPost } from "@/lib/instagram_posts";
import { InstagramGrid } from "./instagram-grid";
import { InstagramGridSkeleton } from "./instagram-grid-skeleton";

export function InstagramGridClient({ count = 6 }: { count?: number }) {
  const [posts, setPosts] = useState<InstagramPost[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPosts() {
      try {
        const response = await fetch("/api/instagram", {
          signal: controller.signal,
        });

        if (!response.ok) {
          setPosts([]);
          return;
        }

        const data = (await response.json()) as InstagramPost[];
        setPosts(
          data.filter((post) => post.media_type !== "VIDEO").slice(0, count),
        );
      } catch {
        if (!controller.signal.aborted) {
          setPosts([]);
        }
      }
    }

    void loadPosts();

    return () => controller.abort();
  }, [count]);

  if (posts === null) {
    return <InstagramGridSkeleton count={count} />;
  }

  return <InstagramGrid posts={posts} />;
}

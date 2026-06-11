"use client";

import Cookies from "js-cookie";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";

const VIEW_COOKIE_PREFIX = "blog_viewed_";
const VIEW_COOKIE_EXPIRY_HOURS = 24;

interface BlogViewCounterProps {
  blogId: string;
}

export function BlogViewCounter({ blogId }: BlogViewCounterProps) {
  const [views, setViews] = useState<number | null>(null);

  useEffect(() => {
    const fetchOrIncrementViews = async () => {
      const cookieName = `${VIEW_COOKIE_PREFIX}${blogId}`;
      const hasViewed = Cookies.get(cookieName);

      try {
        if (hasViewed) {
          const response = await fetch(`/api/blog/views?blogId=${blogId}`, {
            method: "GET",
          });

          if (response.ok) {
            const data = await response.json();
            setViews(data.views);
          }
        } else {
          const response = await fetch("/api/blog/views", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ blogId }),
          });

          if (response.ok) {
            const data = await response.json();
            setViews(data.views);

            Cookies.set(cookieName, "1", {
              expires: VIEW_COOKIE_EXPIRY_HOURS / 24,
              sameSite: "lax",
            });
          }
        }
      } catch (error) {
        console.error("Error fetching view count:", error);
      }
    };

    fetchOrIncrementViews();
  }, [blogId]);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Eye className="w-4 h-4" />
      {views !== null ? views.toLocaleString() : "—"} views
    </span>
  );
}

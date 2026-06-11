"use client";

import CircularGallery from "@/components/CircularGallery";
import type { InstagramPost } from "@/lib/instagram_posts";
import { cn } from "@/lib/utils";

export const InstagramPostsGallery = ({
  className,
  items,
}: {
  className?: string;
  items?: InstagramPost[];
}) => {
  return (
    <div
      className={cn(
        "relative w-full sm:h-[300px] xs:h-[250px] h-[150px] text-foreground",
        className,
      )}
    >
      <CircularGallery
        items={items?.map((post) => ({
          image: post.media_url,
          text: new Date(post.timestamp).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          link: post.permalink,
        }))}
        bend={2}
        textColor="#778873"
        font="bold 48px Inter"
        borderRadius={0.05}
        scrollEase={0.15}
        autoScrollSpeed={0.03}
      />
    </div>
  );
};

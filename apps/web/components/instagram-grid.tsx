"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FaInstagram } from "react-icons/fa6";
import type { InstagramPost } from "@/lib/instagram_posts";
import { cn } from "@/lib/utils";
import { INSTAGRAM_GRID_CLASSES } from "./instagram-grid-layout";

function BentoItem({
  post,
  index,
  className,
}: {
  post: InstagramPost;
  index: number;
  className?: string;
}) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, index * 80);

    return () => clearTimeout(timer);
  }, [index]);

  return (
    <Link
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "relative overflow-hidden sm:rounded-xl xs:rounded-lg rounded group bg-accent",
        "transition-all duration-500 ease-out",
        isVisible
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 translate-y-4 scale-95",
        className,
      )}
    >
      <Image
        src={post.media_url}
        alt="Instagram post"
        fill
        sizes="(max-width: 640px) 50vw, 25vw"
        className="object-cover transition-transform duration-500 group-hover:scale-110"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center">
        <FaInstagram className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 drop-shadow-lg" />
      </div>
    </Link>
  );
}

export function InstagramGrid({ posts }: { posts: InstagramPost[] }) {
  if (posts.length === 0) {
    return null;
  }

  return posts
    .slice(0, INSTAGRAM_GRID_CLASSES.length)
    .map((post, index) => (
      <BentoItem
        key={post.id}
        post={post}
        index={index}
        className={INSTAGRAM_GRID_CLASSES[index]}
      />
    ));
}

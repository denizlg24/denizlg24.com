"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface FadeInImageProps extends ImageProps {
  wrapperClassName?: string;
}

export function FadeInImage({
  className,
  wrapperClassName,
  alt,
  ...props
}: FadeInImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Image
        {...props}
        alt={alt}
        loading="eager"
        onClick={() => {
          // A full navigation: /auth/login is a route handler that redirects
          // off-site to start sign-in, not a page the router can render.
          window.location.assign("/auth/login");
        }}
        className={cn(
          "transition-all duration-500 ease-out",
          isLoaded ? "opacity-100" : "opacity-0 translate-y-12!",
          className,
        )}
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  );
}

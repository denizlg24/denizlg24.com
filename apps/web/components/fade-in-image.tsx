"use client";

import Image, { type ImageProps } from "next/image";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Image
        {...props}
        alt={alt}
        loading="eager"
        onClick={() => {
          router.push("/auth/login");
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

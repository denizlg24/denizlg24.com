"use client";

import { useEffect, useRef, useState } from "react";

const narrow = "(max-width: 640px)";

export function AutoplayVideo({
  name,
  label,
  lazy = false,
  vertical = false,
  className = "landing-media",
}: {
  name: string;
  label: string;
  lazy?: boolean;
  vertical?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [variant, setVariant] = useState<"landscape" | "vertical">(
    vertical ? "vertical" : "landscape",
  );
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (vertical) return;
    const query = window.matchMedia(narrow);
    const update = () => setVariant(query.matches ? "vertical" : "landscape");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [vertical]);

  useEffect(() => {
    const video = ref.current;
    if (!video || fallback) return;
    video.muted = true;
    const start = () => {
      video.play().catch(() => setFallback(true));
    };
    if (!lazy) {
      start();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        video.preload = "auto";
        start();
      },
      { rootMargin: "300px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [variant, lazy, fallback]);

  const base = `/media/${name}-${variant}`;
  const [width, height] = variant === "vertical" ? [720, 1280] : [1280, 720];
  return (
    <figure className={className}>
      {fallback ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${base}.gif`} alt={label} width={width} height={height} />
      ) : (
        <video
          key={variant}
          ref={ref}
          src={`${base}.mp4`}
          poster={`${base}.jpg`}
          width={width}
          height={height}
          aria-label={label}
          muted
          loop
          playsInline
          autoPlay={!lazy}
          preload={lazy ? "none" : "auto"}
          disablePictureInPicture
          disableRemotePlayback
        />
      )}
    </figure>
  );
}

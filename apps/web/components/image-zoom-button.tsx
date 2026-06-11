"use client";

import { Fullscreen } from "lucide-react";
import { useState } from "react";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";

interface ImageZoomButtonProps {
  src: string;
  alt: string;
}

export function ImageZoomButton({ src, alt }: ImageZoomButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        size="icon-sm"
        className="absolute right-2 bottom-2"
        onClick={() => setIsOpen(true)}
      >
        <Fullscreen />
      </Button>
      <ImageLightbox
        src={src}
        alt={alt}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

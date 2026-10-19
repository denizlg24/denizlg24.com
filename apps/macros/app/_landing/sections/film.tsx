"use client";

import { cn } from "@repo/ui/utils";
import { Play } from "lucide-react";
import { useRef, useState } from "react";
import { container, MacroRule } from "@/app/_landing/site";

export function Film() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function play() {
    setStarted(true);
    void video.current?.play();
  }

  return (
    <section aria-labelledby="film-title" className="pb-16 sm:pb-24">
      <div className={container}>
        <h2
          id="film-title"
          className="eyebrow mb-5 flex items-center gap-3 sm:mb-6"
        >
          <MacroRule />
          Macros in 22 seconds
        </h2>
        <div className="reveal relative overflow-hidden rounded-2xl ring-1 ring-border">
          <video
            ref={video}
            className="block aspect-video w-full bg-muted"
            src="/media/macros-film.mp4"
            poster="/media/macros-film-poster.jpg"
            width={1920}
            height={1080}
            controls={started}
            playsInline
            preload="none"
            aria-label="Macros: scan a barcode, log a plate, follow your day hour by hour, and see your weight trend and expenditure"
          >
            <track
              kind="captions"
              src="/media/macros-film.vtt"
              srcLang="en"
              label="English"
            />
          </video>
          <button
            type="button"
            onClick={play}
            hidden={started}
            aria-label="Play the Macros film"
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-foreground/0 transition-colors hover:bg-foreground/5",
              "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-foreground",
            )}
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-foreground text-background shadow-lg sm:size-20">
              <Play
                aria-hidden="true"
                className="ml-1 size-6 fill-current sm:size-7"
              />
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

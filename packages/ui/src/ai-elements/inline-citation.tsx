"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
} from "../carousel";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../hover-card";
import { cn } from "../utils";
import { sourceHostname } from "./sources";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({
  className,
  ...props
}: InlineCitationProps) => (
  <span
    data-slot="inline-citation"
    className={cn("group/citation inline", className)}
    {...props}
  />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({
  className,
  ...props
}: InlineCitationTextProps) => (
  <span
    data-slot="inline-citation-text"
    className={cn(
      "rounded-[2px] transition-colors group-hover/citation:bg-surface",
      className,
    )}
    {...props}
  />
);

export type InlineCitationCardProps = ComponentProps<typeof HoverCard>;

export const InlineCitationCard = ({
  openDelay = 150,
  closeDelay = 100,
  ...props
}: InlineCitationCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
);

export type InlineCitationCardTriggerProps = ComponentProps<"button"> & {
  sources: string[];
};

export const InlineCitationCardTrigger = ({
  sources,
  className,
  children,
  ...props
}: InlineCitationCardTriggerProps) => {
  const [first] = sources;
  const label = sourceHostname(first) ?? first ?? "source";
  const extra = sources.length > 1 ? sources.length - 1 : 0;

  return (
    <HoverCardTrigger asChild>
      <button
        type="button"
        aria-label={`Source: ${label}${extra ? `, ${extra} more` : ""}`}
        className={cn(
          "ml-0.5 inline-flex h-4 max-w-40 items-center gap-0.5 rounded-sm bg-surface px-1 align-[0.1em] text-[10px] leading-none text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <span className="truncate">{label}</span>
            {extra ? <span className="shrink-0">+{extra}</span> : null}
          </>
        )}
      </button>
    </HoverCardTrigger>
  );
};

export type InlineCitationCardBodyProps = ComponentProps<
  typeof HoverCardContent
>;

export const InlineCitationCardBody = ({
  className,
  ...props
}: InlineCitationCardBodyProps) => (
  <HoverCardContent
    className={cn(
      "relative w-72 max-w-[calc(100vw-2rem)] p-0 text-xs",
      className,
    )}
    {...props}
  />
);

const CarouselApiContext = createContext<CarouselApi | undefined>(undefined);

const useCarouselApi = () => useContext(CarouselApiContext);

export type InlineCitationCarouselProps = ComponentProps<typeof Carousel>;

export const InlineCitationCarousel = ({
  className,
  children,
  ...props
}: InlineCitationCarouselProps) => {
  const [api, setApi] = useState<CarouselApi>();

  return (
    <CarouselApiContext.Provider value={api}>
      <Carousel className={cn("w-full", className)} setApi={setApi} {...props}>
        {children}
      </Carousel>
    </CarouselApiContext.Provider>
  );
};

export type InlineCitationCarouselContentProps = ComponentProps<"div">;

export const InlineCitationCarouselContent = (
  props: InlineCitationCarouselContentProps,
) => <CarouselContent {...props} />;

export type InlineCitationCarouselItemProps = ComponentProps<"div">;

export const InlineCitationCarouselItem = ({
  className,
  ...props
}: InlineCitationCarouselItemProps) => (
  <CarouselItem
    className={cn("w-full space-y-1.5 p-3 pl-7", className)}
    {...props}
  />
);

export type InlineCitationCarouselHeaderProps = ComponentProps<"div">;

export const InlineCitationCarouselHeader = ({
  className,
  ...props
}: InlineCitationCarouselHeaderProps) => (
  <div
    className={cn(
      "flex items-center gap-1 border-b border-border px-1.5 py-1",
      className,
    )}
    {...props}
  />
);

export type InlineCitationCarouselIndexProps = ComponentProps<"div">;

export const InlineCitationCarouselIndex = ({
  children,
  className,
  ...props
}: InlineCitationCarouselIndexProps) => {
  const api = useCarouselApi();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  const syncState = useCallback(() => {
    if (!api) {
      return;
    }
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);
  }, [api]);

  useEffect(() => {
    if (!api) {
      return;
    }
    syncState();
    api.on("select", syncState);
    api.on("reInit", syncState);
    return () => {
      api.off("select", syncState);
      api.off("reInit", syncState);
    };
  }, [api, syncState]);

  return (
    <div
      className={cn(
        "ml-auto px-1.5 text-[11px] text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    >
      {children ?? `${current}/${count}`}
    </div>
  );
};

const carouselNavClasses =
  "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40";

export type InlineCitationCarouselPrevProps = ComponentProps<"button">;

export const InlineCitationCarouselPrev = ({
  className,
  ...props
}: InlineCitationCarouselPrevProps) => {
  const api = useCarouselApi();
  const handleClick = useCallback(() => api?.scrollPrev(), [api]);

  return (
    <button
      aria-label="Previous source"
      className={cn(carouselNavClasses, className)}
      onClick={handleClick}
      type="button"
      {...props}
    >
      <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
    </button>
  );
};

export type InlineCitationCarouselNextProps = ComponentProps<"button">;

export const InlineCitationCarouselNext = ({
  className,
  ...props
}: InlineCitationCarouselNextProps) => {
  const api = useCarouselApi();
  const handleClick = useCallback(() => api?.scrollNext(), [api]);

  return (
    <button
      aria-label="Next source"
      className={cn(carouselNavClasses, className)}
      onClick={handleClick}
      type="button"
      {...props}
    >
      <ChevronRightIcon aria-hidden="true" className="size-3.5" />
    </button>
  );
};

export type InlineCitationSourceProps = ComponentProps<"div"> & {
  title?: string;
  url?: string;
  description?: string;
};

export const InlineCitationSource = ({
  title,
  url,
  description,
  className,
  children,
  ...props
}: InlineCitationSourceProps) => (
  <div className={cn("min-w-0 space-y-0.5", className)} {...props}>
    {title ? (
      <h4 className="truncate text-xs font-medium leading-tight text-foreground">
        {title}
      </h4>
    ) : null}
    {url ? (
      <a
        className="block truncate text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        {sourceHostname(url) ?? url}
      </a>
    ) : null}
    {description ? (
      <p className="line-clamp-3 pt-1 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    ) : null}
    {children}
  </div>
);

export type InlineCitationQuoteProps = ComponentProps<"blockquote">;

export const InlineCitationQuote = ({
  className,
  ...props
}: InlineCitationQuoteProps) => (
  <blockquote
    className={cn(
      "border-l border-border pl-2 text-xs leading-relaxed text-muted-foreground",
      className,
    )}
    {...props}
  />
);

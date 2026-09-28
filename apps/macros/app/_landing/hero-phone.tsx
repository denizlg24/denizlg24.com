"use client";

import { cn } from "@repo/ui/utils";
import { Pause, Play } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type IosTab, IosTabBar, withVars } from "@/app/_landing/phone/ios";
import { Phone } from "@/app/_landing/phone/phone";

export interface HeroScreen {
  tab: IosTab;
  label: string;
  description: string;
  content: ReactNode;
}

const SLIDE_SECONDS = 6.5;

export function HeroPhone({ screens }: { screens: HeroScreen[] }) {
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);
  const [visible, setVisible] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const current = screens[active] ?? screens[0];
  if (!current) return null;

  return (
    <div
      ref={ref}
      className="flex flex-col items-center gap-7"
      data-autoplay={autoplay}
      data-visible={visible}
      style={withVars({ "--slide-duration": `${SLIDE_SECONDS}s` })}
    >
      <Phone size="hero" label={current.description}>
        {screens.map((screen, index) => (
          <div
            key={screen.tab}
            className="hero-screen"
            data-active={index === active}
          >
            {screen.content}
          </div>
        ))}
        <IosTabBar active={current.tab} />
      </Phone>

      <div className="flex items-center gap-4">
        <div
          role="group"
          aria-label="Screens shown on the phone"
          className="flex items-center gap-5"
        >
          {screens.map((screen, index) => (
            <button
              key={screen.tab}
              type="button"
              aria-pressed={index === active}
              onClick={() => {
                setActive(index);
                setAutoplay(false);
              }}
              className={cn(
                "group flex w-[4.75rem] flex-col items-start gap-2 rounded-sm py-1 text-left text-[13px] font-medium transition-colors",
                index === active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {screen.label}
              <span className="switch-track block h-0.5 w-full overflow-hidden rounded-full bg-foreground/12">
                <span
                  className="switch-fill block h-full rounded-full bg-foreground"
                  onAnimationEnd={
                    index === active
                      ? () => setActive((index + 1) % screens.length)
                      : undefined
                  }
                />
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAutoplay((value) => !value)}
          aria-label={autoplay ? "Pause screen tour" : "Play screen tour"}
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/6 hover:text-foreground motion-reduce:hidden"
        >
          {autoplay ? (
            <Pause size={14} strokeWidth={2.4} fill="currentColor" />
          ) : (
            <Play size={14} strokeWidth={2.4} fill="currentColor" />
          )}
        </button>
      </div>
    </div>
  );
}

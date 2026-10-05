import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";
import type { SectionLink } from "@/app/_landing/sections/feature-row";
import { container, MacroRule } from "@/app/_landing/site";

/** The opening of every page below the overview. */
export function PageIntro({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title">
      <div className={cn(container, "pt-14 pb-8 sm:pt-20 sm:pb-10 lg:pt-24")}>
        <p className="eyebrow flex items-center gap-3">
          <MacroRule />
          {eyebrow}
        </p>
        <h1
          id="page-title"
          className="mt-6 max-w-4xl text-[clamp(2.5rem,8.6vw,5.25rem)] leading-[0.98] font-semibold tracking-[-0.05em] text-balance"
        >
          {title}
        </h1>
        <div className="mt-7 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty sm:text-xl sm:leading-relaxed">
          {lead}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Numbered jump links that match the section labels further down. */
export function OnThisPage({ items }: { items: ReadonlyArray<SectionLink> }) {
  return (
    <nav aria-label="On this page" className="mt-12 border-t pt-5 sm:mt-14">
      <ol className="flex flex-wrap gap-x-7 gap-y-3 text-[15px]">
        {items.map((item, index) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="flex items-baseline gap-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="font-figure text-xs text-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

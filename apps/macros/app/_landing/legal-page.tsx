import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";
import { container, SiteFooter, SiteHeader } from "@/app/_landing/site";

export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <article className={cn(container, "pt-14 pb-24 sm:pt-20")}>
          <div className="max-w-2xl">
            <p className="eyebrow">Updated {updated}</p>
            <h1 className="mt-4 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.04] font-semibold tracking-[-0.04em]">
              {title}
            </h1>
            <div className="mt-6 text-lg leading-relaxed text-muted-foreground text-pretty">
              {intro}
            </div>
          </div>
          <div className="mt-14 flex max-w-2xl flex-col">{children}</div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t py-8 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

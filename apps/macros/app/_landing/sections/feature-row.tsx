import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";
import { container, SectionLabel } from "@/app/_landing/site";

export const sectionTitle =
  "text-[clamp(2rem,5.2vw,3.25rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance";

export const sectionLead =
  "text-lg leading-relaxed text-muted-foreground text-pretty";

function FeatureDetails({
  items,
}: {
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <dl className="border-b">
      {items.map(([term, description]) => (
        <div
          key={term}
          className="grid gap-1 border-t py-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:gap-6"
        >
          <dt className="text-[15px] font-semibold">{term}</dt>
          <dd className="text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FeatureRow({
  id,
  index,
  label,
  title,
  lead,
  details,
  visual,
  reverse = false,
}: {
  id: string;
  index: string;
  label: string;
  title: string;
  lead: ReactNode;
  details: ReadonlyArray<readonly [string, string]>;
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="py-20 sm:py-24">
      <div className={container}>
        <SectionLabel index={index}>{label}</SectionLabel>
        <div className="mt-12 grid items-center gap-16 lg:mt-16 lg:grid-cols-2 lg:gap-20">
          <div className={cn("reveal max-w-xl", reverse && "lg:order-2")}>
            <h2 id={`${id}-title`} className={sectionTitle}>
              {title}
            </h2>
            <div className={cn(sectionLead, "mt-5")}>{lead}</div>
            <div className="mt-10">
              <FeatureDetails items={details} />
            </div>
          </div>
          <div
            className={cn(
              "flex justify-center",
              reverse ? "lg:order-1" : "lg:justify-end",
            )}
          >
            {visual}
          </div>
        </div>
      </div>
    </section>
  );
}

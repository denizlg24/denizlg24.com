import { cn } from "@repo/ui/utils";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { container, SectionLabel } from "@/app/_landing/site";

export const sectionTitle =
  "text-[clamp(2rem,5.2vw,3.25rem)] leading-[1.04] font-semibold tracking-[-0.04em] text-balance";

export const sectionLead =
  "text-lg leading-relaxed text-muted-foreground text-pretty";

function FeatureHighlights({
  items,
}: {
  items: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
      {items.map(([title, description]) => (
        <li key={title} className="flex gap-3">
          <Check
            aria-hidden="true"
            className="mt-[3px] size-4 flex-none"
            strokeWidth={2.5}
          />
          <div>
            <h3 className="text-[15px] font-semibold">{title}</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function FeatureRow({
  id,
  label,
  title,
  lead,
  details,
  visual,
  reverse = false,
}: {
  id: string;
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
        <SectionLabel>{label}</SectionLabel>
        <div className="mt-12 grid items-center gap-16 lg:mt-16 lg:grid-cols-2 lg:gap-20">
          <div className={cn("reveal max-w-xl", reverse && "lg:order-2")}>
            <h2 id={`${id}-title`} className={sectionTitle}>
              {title}
            </h2>
            <div className={cn(sectionLead, "mt-5")}>{lead}</div>
            <div className="mt-10">
              <FeatureHighlights items={details} />
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

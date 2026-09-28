import { cn } from "@repo/ui/utils";
import { sectionLead, sectionTitle } from "@/app/_landing/sections/feature-row";
import {
  AppIcon,
  ComingSoonBadge,
  container,
  SectionLabel,
} from "@/app/_landing/site";

export function ComingSoon() {
  return (
    <section
      id="coming-soon"
      aria-labelledby="coming-soon-title"
      className="border-t py-20 sm:py-24"
    >
      <div className={container}>
        <SectionLabel>Availability</SectionLabel>
        <div className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-2 lg:items-end lg:gap-20">
          <h2
            id="coming-soon-title"
            className={cn(sectionTitle, "reveal max-w-xl")}
          >
            Coming soon to iPhone.
          </h2>
          <p className={cn(sectionLead, "reveal max-w-xl")}>
            Macros isn’t available to download yet. It’s in daily use while the
            last pieces come together, and it will open up to everyone once it’s
            ready.
          </p>
        </div>
      </div>
    </section>
  );
}

export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="border-t">
      <div
        className={cn(
          container,
          "flex flex-col items-center py-24 text-center sm:py-32",
        )}
      >
        <AppIcon size={80} className="reveal" />
        <h2
          id="closing-title"
          className={cn(sectionTitle, "reveal mt-8 max-w-2xl")}
        >
          <span className="block">Eat. Log. Weigh in.</span>
          <span className="block text-muted-foreground">
            Let the numbers settle.
          </span>
        </h2>
        <div className="reveal mt-9 flex justify-center">
          <ComingSoonBadge />
        </div>
      </div>
    </section>
  );
}

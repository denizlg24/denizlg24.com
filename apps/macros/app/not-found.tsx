import { cn } from "@repo/ui/utils";
import Link from "next/link";
import {
  container,
  MacroRule,
  primaryButton,
  SiteFooter,
  secondaryButton,
} from "@/app/_landing/site";
import { SiteHeader } from "@/app/_landing/site-header";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section
          aria-labelledby="not-found-title"
          className={cn(container, "pt-20 pb-28 sm:pt-28 sm:pb-36")}
        >
          <p className="eyebrow flex items-center gap-3">
            <MacroRule />
            404
          </p>
          <h1
            id="not-found-title"
            className="mt-6 max-w-3xl text-[clamp(2.5rem,8vw,4.5rem)] leading-[1] font-semibold tracking-[-0.05em] text-balance"
          >
            Nothing logged here.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            That page doesn’t exist, or it moved.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/" className={primaryButton}>
              Go to the overview
            </Link>
            <Link href="/download" className={secondaryButton}>
              Get Macros
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

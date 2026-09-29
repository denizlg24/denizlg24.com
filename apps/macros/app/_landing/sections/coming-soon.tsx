import { cn } from "@repo/ui/utils";
import { RequestAccessForm } from "@/app/_landing/request-access-form";
import { sectionLead, sectionTitle } from "@/app/_landing/sections/feature-row";
import {
  AppIcon,
  container,
  GetTheApp,
  primaryButton,
  SectionLabel,
} from "@/app/_landing/site";

export function ComingSoon() {
  return (
    <section
      id="get-macros"
      aria-labelledby="get-macros-title"
      className="border-t py-20 sm:py-24"
    >
      <div className={container}>
        <SectionLabel>Get Macros</SectionLabel>
        <div className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-2 lg:items-end lg:gap-20">
          <h2
            id="get-macros-title"
            className={cn(sectionTitle, "reveal max-w-xl")}
          >
            On Android today. On iPhone soon.
          </h2>
          <p className={cn(sectionLead, "reveal max-w-xl")}>
            Android phones can install Macros right now, free. The iPhone app
            opens to everyone once the last pieces are in place — or ask to try
            it early below.
          </p>
        </div>
        <div className="reveal mt-10 flex max-w-xl flex-col gap-3">
          <a href="/android/Macros.apk" className={cn(primaryButton, "w-fit")}>
            Download for Android
          </a>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            The first time, Android asks you to allow installs from your
            browser. Allow it, then open the file again.
          </p>
        </div>
        <div className="mt-16 grid gap-12 lg:mt-20 lg:grid-cols-2 lg:gap-20">
          <div className="reveal max-w-xl">
            <h3 className="text-2xl font-semibold tracking-tight">
              Try it early on iPhone
            </h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              A small number of iPhones can install Macros before it opens up.
              Early builds install only on iPhones registered in advance, so the
              request needs your iPhone’s UDID, an identifier every iPhone has.
            </p>
            <dl className="mt-8 border-b">
              {udidSteps.map(([term, description]) => (
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
          </div>
          <div className="reveal max-w-xl lg:pt-1">
            <RequestAccessForm />
          </div>
        </div>
      </div>
    </section>
  );
}

const udidSteps = [
  [
    "On a Mac",
    "Connect your iPhone with a cable and open Finder. Select your iPhone in the sidebar, then click the grey line of text under its name until it shows the UDID. Right-click it and choose Copy UDID.",
  ],
  [
    "On Windows",
    "Connect your iPhone and open the Apple Devices app (or iTunes on older Windows). Select your iPhone, then click the serial number on its summary until it changes to the UDID, and copy it.",
  ],
  [
    "Then",
    "Paste it below. It looks like 00008030-001A2B3C4D5E6F70. The serial number and the IMEI are different numbers and won’t work.",
  ],
] as const;

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
        <GetTheApp className="reveal mt-9 justify-center" />
      </div>
    </section>
  );
}

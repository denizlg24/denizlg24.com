import { cn } from "@repo/ui/utils";
import { ArrowDown, Plus } from "lucide-react";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { RequestAccessForm } from "@/app/_landing/request-access-form";
import { sectionLead, sectionTitle } from "@/app/_landing/sections/feature-row";
import {
  ANDROID_APK_HREF,
  AppIcon,
  container,
  GetTheApp,
  primaryButton,
  SectionLabel,
  secondaryButton,
} from "@/app/_landing/site";
import { latestAndroidRelease } from "@/app/android/release";

async function AndroidVersion() {
  const release = await latestAndroidRelease().catch(() => null);
  if (!release) return null;
  return (
    <p className="font-figure text-sm text-muted-foreground">
      Latest version {release.version}
    </p>
  );
}

function PlatformStatus({
  available,
  children,
}: {
  available: boolean;
  children: ReactNode;
}) {
  return (
    <p className="eyebrow flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          available ? "bg-macro-carbs" : "bg-foreground/35",
        )}
      />
      {children}
    </p>
  );
}

const ANDROID_STEPS = [
  "Download the file on your Android phone.",
  "Open it. The first time, Android asks you to allow installs from your browser — allow it, then open the file again.",
  "Open Macros and create an account with your email.",
] as const;

export function Platforms() {
  return (
    <section aria-label="Platforms" className="pt-6 pb-20 sm:pt-10 sm:pb-28">
      <div className={cn(container, "grid gap-x-16 lg:grid-cols-2")}>
        <div
          id="android"
          className="reveal flex flex-col gap-6 border-t pt-8 pb-14 lg:pb-0"
        >
          <PlatformStatus available>Android · Available now</PlatformStatus>
          <div className="flex flex-col gap-2">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
              Install it today.
            </h2>
            <Suspense fallback={null}>
              <AndroidVersion />
            </Suspense>
          </div>
          <a href={ANDROID_APK_HREF} className={cn(primaryButton, "w-fit")}>
            Download for Android
          </a>
          <ol className="flex flex-col border-b">
            {ANDROID_STEPS.map((step, index) => (
              <li
                key={step}
                className="grid grid-cols-[2rem_minmax(0,1fr)] border-t py-4 text-[15px] leading-relaxed"
              >
                <span className="font-figure text-muted-foreground">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            To update, download the newest version here and install it over the
            old one. Your log lives in your account, so nothing is lost.
          </p>
        </div>

        <div id="iphone" className="reveal flex flex-col gap-6 border-t pt-8">
          <PlatformStatus available={false}>
            iPhone · Coming soon
          </PlatformStatus>
          <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Early access, for now.
          </h2>
          <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            The iPhone app opens to everyone once the last pieces are in place.
            Until then, a small number of iPhones can install it early. Early
            builds only install on iPhones registered in advance, so the request
            asks for your iPhone’s UDID.
          </p>
          <a href="#early-access" className={cn(secondaryButton, "w-fit")}>
            Request early access
            <ArrowDown
              aria-hidden="true"
              className="size-4"
              strokeWidth={2.4}
            />
          </a>
        </div>
      </div>
    </section>
  );
}

const UDID_STEPS = [
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

export function EarlyAccess() {
  return (
    <section
      id="early-access"
      aria-labelledby="early-access-title"
      className="border-t py-20 sm:py-28"
    >
      <div className={container}>
        <SectionLabel>iPhone early access</SectionLabel>
        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-2 lg:gap-20">
          <div className="reveal max-w-xl">
            <h2 id="early-access-title" className={sectionTitle}>
              Try it early on iPhone.
            </h2>
            <p className={cn(sectionLead, "mt-5")}>
              Send your name, email and UDID. Once your iPhone has been added,
              the install link arrives by email.
            </p>
            <dl className="mt-10 border-b">
              {UDID_STEPS.map(([term, description]) => (
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
          <div className="reveal max-w-xl lg:pt-2">
            <RequestAccessForm />
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
  {
    question: "Is Macros free?",
    answer: "Yes. There’s no subscription, no premium tier and no advertising.",
  },
  {
    question: "Do I need an account?",
    answer:
      "Yes — an email address and a password. Your log is saved to your account, so it carries over to a new phone.",
  },
  {
    question: "Does it work offline?",
    answer:
      "Logging does: entries you make without a connection sync when you’re back online. Searching the catalogue and reading a label need a connection.",
  },
  {
    question: "Can I get my data out, or delete it?",
    answer: (
      <>
        Statistics export to CSV or JSON from the app, and deleting your account
        in Settings removes your data, photos included. The{" "}
        <Link href="/privacy">privacy policy</Link> has the details.
      </>
    ),
  },
  {
    question: "Why does the iPhone request need my UDID?",
    answer:
      "Until the iPhone app is public, a build only installs on iPhones registered with Apple in advance, and the UDID is what registers one.",
  },
  {
    question: "How do I update on Android?",
    answer:
      "Download the newest version from this page and install it over the old one. Every release is signed with the same key, so your phone accepts it as an update.",
  },
];

export function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="border-t py-20 sm:py-28"
    >
      <div className={container}>
        <SectionLabel>Questions</SectionLabel>
        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <h2 id="faq-title" className={cn(sectionTitle, "reveal max-w-md")}>
            Short answers.
          </h2>
          <div className="reveal border-b">
            {FAQ.map((item) => (
              <details key={item.question} className="group border-t">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <Plus
                    aria-hidden="true"
                    className="size-5 flex-none text-muted-foreground transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none"
                    strokeWidth={2}
                  />
                </summary>
                <div className="max-w-xl pb-6 text-[15px] leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ClosingCta({ id = "closing" }: { id?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t">
      <div
        className={cn(
          container,
          "flex flex-col items-center py-24 text-center sm:py-32",
        )}
      >
        <AppIcon size={80} className="reveal" />
        <h2
          id={`${id}-title`}
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

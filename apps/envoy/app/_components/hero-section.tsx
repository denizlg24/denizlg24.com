import { buttonVariants } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { CommandText } from "./command-text";
import { fetchLatestRelease } from "@/lib/github";

export async function HeroSection() {
  const latestVersion = await fetchLatestRelease("denizlg24", "envoy");

  return (
    <section className="flex flex-col items-center px-4 py-20 text-center">
      {latestVersion && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm text-primary">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
          </span>
          Version {latestVersion} Now Available
        </div>
      )}

      <h1 className="mb-6 max-w-4xl text-balance font-mono text-5xl font-bold tracking-tight text-foreground md:text-7xl drop-shadow-accent drop-shadow-lg">
        .env versioning made easy
      </h1>

      <p className="mb-12 max-w-2xl text-balance text-lg text-muted-foreground md:text-xl drop-shadow-accent drop-shadow-lg">
        <span className="font-bold">Envoy</span> is a CLI tool that brings
        version control to your environment variables.
      </p>

      <CommandText/>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className: "gap-2 border! border-border!",
          })}
          target="_blank"
          href={"https://github.com/denizlg24/envoy"}
        >
          View Documentation <ExternalLink />
        </Link>
      </div>
    </section>
  );
}

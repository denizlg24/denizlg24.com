import type {
  ChangelogBlock,
  ChangelogInline,
  ChangelogRelease,
} from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import { PageIntro } from "@/app/_landing/sections/page-intro";
import { container } from "@/app/_landing/site";
import { pageMetadata } from "@/app/metadata";
import { loadChangelog } from "@/lib/changelog/load";

export const metadata = pageMetadata(
  "What's new",
  "Every release of Macros for iPhone and Android, and what it changed.",
  "/changelog",
);

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(date: string) {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

export default async function ChangelogPage() {
  const releases = await loadChangelog();
  const latest = releases[0];

  return (
    <>
      <PageIntro
        eyebrow="What's new"
        title="Changelog"
        lead={
          <p>
            Every update to the app, newest first.
            {latest ? (
              <>
                {" "}
                The latest is{" "}
                <span className="font-medium text-foreground">
                  {latest.version}
                </span>
                {latest.date ? `, from ${formatDate(latest.date)}` : null}.
              </>
            ) : null}
          </p>
        }
      />
      <div className={cn(container, "pb-24")}>
        <ol className="flex flex-col">
          {releases.map((release) => (
            <Release key={release.version} release={release} />
          ))}
        </ol>
      </div>
    </>
  );
}

function Release({ release }: { release: ChangelogRelease }) {
  return (
    <li
      id={`v${release.version}`}
      className="grid scroll-mt-24 gap-4 border-t py-10 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10"
    >
      <div>
        <h2 className="font-figure text-2xl font-semibold tracking-[-0.03em]">
          <a href={`#v${release.version}`}>{release.version}</a>
        </h2>
        {release.date ? (
          <p className="mt-1 text-sm text-muted-foreground">
            <time dateTime={release.date}>{formatDate(release.date)}</time>
          </p>
        ) : null}
      </div>
      <div className="flex max-w-2xl flex-col gap-7">
        {release.sections.map((section, index) => (
          <section
            key={section.title ?? `intro-${index}`}
            className="flex flex-col gap-3"
          >
            {section.title ? (
              <h3 className="eyebrow">{section.title}</h3>
            ) : null}
            {section.blocks.map((block, blockIndex) => (
              <Block key={`${block.type}-${blockIndex}`} block={block} />
            ))}
          </section>
        ))}
      </div>
    </li>
  );
}

function Block({ block }: { block: ChangelogBlock }) {
  if (block.type === "paragraph") {
    return (
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        <Inline content={block.content} />
      </p>
    );
  }
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-muted-foreground marker:text-border">
      {block.items.map((item, index) => (
        <li key={index} className="pl-1">
          <Inline content={item} />
        </li>
      ))}
    </ul>
  );
}

function Inline({ content }: { content: ChangelogInline[] }) {
  return content.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case "strong":
        return (
          <strong key={key} className="font-semibold text-foreground">
            {token.text}
          </strong>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
          >
            {token.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={token.href}
            className="font-medium text-foreground underline decoration-border underline-offset-4"
          >
            {token.text}
          </a>
        );
      default:
        return token.text;
    }
  });
}

"use client";

import { AdminProvider } from "@repo/admin/provider";
import {
  SettingsGroup,
  SettingsShell,
  SettingsSkeleton,
} from "@repo/admin/settings/settings-shell";
import type {
  ChangelogBlock,
  ChangelogInline,
  ChangelogRelease,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { EmptyState } from "@repo/ui/empty-state";
import { compareVersions } from "@repo/utils/changelog";
import { useEffect, useState } from "react";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";
import { isTauri } from "@/lib/platform";
import { desktopPlatform } from "@/lib/platform-bridge";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function useInstalledVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined);
  }, []);
  return version;
}

export function ReleaseNotesPage({
  releases,
}: {
  releases: ChangelogRelease[];
}) {
  const { value, loading } = useDesktopAdmin();
  const installed = useInstalledVersion();

  return (
    <AdminProvider value={value}>
      {loading ? (
        <SettingsSkeleton active="release-notes" />
      ) : (
        <SettingsShell active="release-notes">
          {releases.length === 0 ? (
            <EmptyState label="No releases" />
          ) : (
            releases.map((release) => (
              <Release
                key={release.version}
                release={release}
                installed={installed}
              />
            ))
          )}
        </SettingsShell>
      )}
    </AdminProvider>
  );
}

function Release({
  release,
  installed,
}: {
  release: ChangelogRelease;
  installed: string | null;
}) {
  const current =
    installed !== null && compareVersions(release.version, installed) === 0;

  return (
    <SettingsGroup
      label={`v${release.version}`}
      actions={
        <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
          {current && <Badge variant="good">Installed</Badge>}
          {release.date && (
            <time dateTime={release.date}>
              {dateFormat.format(new Date(`${release.date}T00:00:00Z`))}
            </time>
          )}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {release.sections.map((section, index) => (
          <div
            key={section.title ?? `intro-${index}`}
            className="flex flex-col gap-1.5"
          >
            {section.title && (
              <h3 className="text-sm font-medium text-accent-strong">
                {section.title}
              </h3>
            )}
            {section.blocks.map((block, blockIndex) => (
              <Block key={`${block.type}-${blockIndex}`} block={block} />
            ))}
          </div>
        ))}
      </div>
    </SettingsGroup>
  );
}

function Block({ block }: { block: ChangelogBlock }) {
  if (block.type === "paragraph") {
    return (
      <p className="text-sm text-muted-foreground">
        <Inline content={block.content} />
      </p>
    );
  }
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-muted-foreground/50">
      {block.items.map((item, index) => (
        <li key={index}>
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
          <strong key={key} className="font-medium text-accent-strong">
            {token.text}
          </strong>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-accent-strong"
          >
            {token.text}
          </code>
        );
      case "link":
        return (
          <button
            key={key}
            type="button"
            className="text-accent-strong underline decoration-border underline-offset-4"
            onClick={() => void desktopPlatform.openExternal(token.href)}
          >
            {token.text}
          </button>
        );
      default:
        return token.text;
    }
  });
}

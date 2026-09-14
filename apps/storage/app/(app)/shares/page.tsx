"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { StorageShare } from "@repo/schemas/cloud";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/collapsible";
import { useCopy } from "@repo/ui/copy-button";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Copy,
  Eye,
  Folder,
  Link2,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { Thumbnail } from "@/components/thumbnail";
import { api, errorMessage } from "@/lib/api";
import { fileIcon, fileKind, kindColorClass } from "@/lib/file-kind";
import { keys } from "@/lib/folder-cache";
import {
  forgetShareLink,
  isLive,
  opensLabel,
  rememberedShareLink,
  rememberShareLink,
  shareUrl,
  statusLabel,
} from "@/lib/shares";

const PAST_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

function endedAt(share: StorageShare): number {
  const at = share.revokedAt ?? share.expiresAt ?? share.createdAt;
  return new Date(at).getTime();
}

type Scope = "mine" | "all";

export default function SharesPage() {
  const { user } = useSession();
  const [scope, setScope] = useState<Scope>("mine");
  const superuser = user.role === "superuser";
  const owner = superuser && scope === "all" ? "all" : undefined;
  const shares = useQuery({
    queryKey: [...keys.shares, owner ?? "mine"],
    queryFn: () => api.shares.list(owner),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const { live, past } = useMemo(() => {
    const all = shares.data ?? [];
    const cutoff = Date.now() - PAST_WINDOW_MS;
    return {
      live: all.filter(isLive),
      past: all
        .filter((share) => !isLive(share) && endedAt(share) >= cutoff)
        .sort((a, b) => endedAt(b) - endedAt(a)),
    };
  }, [shares.data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b px-4 pb-3 pt-3 md:px-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            Shared links
          </h1>
          <p className="text-sm text-muted-foreground">
            Every link you have created, and a way to stop sharing.
          </p>
        </div>
        {superuser && (
          <SegmentedControl
            ariaLabel="Whose links"
            value={scope}
            onValueChange={setScope}
            options={[
              { label: "Mine", value: "mine" },
              { label: "Everyone's", value: "all" },
            ]}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {shares.isPending ? (
          <ul className="divide-y">
            {[0, 1, 2].map((row) => (
              <li
                key={row}
                className="flex items-center gap-3 px-4 py-3 md:px-6"
              >
                <Skeleton className="size-12 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        ) : shares.isError ? (
          <div className="flex flex-col items-start gap-3 px-4 py-10 md:px-6">
            <p className="text-sm text-destructive" role="alert">
              Couldn't load your links: {errorMessage(shares.error)}
            </p>
            <Button variant="outline" onClick={() => void shares.refetch()}>
              Try again
            </Button>
          </div>
        ) : live.length === 0 && past.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
            <Link2
              className="size-10 text-muted-foreground/70"
              strokeWidth={1.5}
            />
            <p className="text-base font-medium">No links yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Share a file or folder from its menu and the link will be listed
              here.
            </p>
          </div>
        ) : (
          <>
            {live.length > 0 ? (
              <ul className="divide-y">
                {live.map((share) => (
                  <ShareRow
                    key={share.id}
                    share={share}
                    mine={share.ownerId === user.id}
                    showOwner={owner === "all"}
                  />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-sm text-muted-foreground md:px-6">
                Nothing is shared right now.
              </p>
            )}
            {past.length > 0 && (
              <PastLinks shares={past} showOwner={owner === "all"} />
            )}
          </>
        )}
        {!shares.isPending && !shares.isError && (
          <p className="px-4 py-6 text-xs text-muted-foreground md:px-6">
            Links made before this page existed aren't listed here. They keep
            working until they expire.
          </p>
        )}
      </div>
    </div>
  );
}

function ShareThumbnail({ share }: { share: StorageShare }) {
  if (share.kind === "folder") {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted/40">
        <Folder
          className={cn("size-6 fill-current", kindColorClass("folder"))}
          strokeWidth={1.5}
        />
      </div>
    );
  }
  return (
    <Thumbnail
      src={
        share.targetMissing
          ? null
          : api.url.thumbnail(share.targetId, 256, share.createdAt)
      }
      alt=""
      fallback={fileIcon(share.name, null)}
      className="size-12 shrink-0"
      iconClassName={cn("size-6", kindColorClass(fileKind(share.name, null)))}
    />
  );
}

function ShareRow({
  share,
  mine,
  showOwner,
}: {
  share: StorageShare;
  mine: boolean;
  showOwner: boolean;
}) {
  const client = useQueryClient();
  const { copied, copy } = useCopy(2_000);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    setLink(rememberedShareLink(share.id));
  }, [share.id]);

  const update = useMutation({
    mutationFn: (input: { revoke?: boolean; rotate?: boolean }) =>
      api.shares.update(share.id, input),
    onSuccess: async (result, input) => {
      if (result.token) {
        rememberShareLink(share.id, result.token);
        setLink(shareUrl(result.token));
        await copy(shareUrl(result.token));
      }
      if (input.revoke) forgetShareLink(share.id);
      await client.invalidateQueries({ queryKey: keys.shares });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <li className="flex items-center gap-3 px-4 py-3 md:px-6">
      <ShareThumbnail share={share} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {share.kind === "folder" && !share.targetMissing ? (
            <Link
              href={`/folders/${share.targetId}`}
              className="truncate underline-offset-2 hover:underline"
            >
              {share.name}
            </Link>
          ) : (
            <span className="truncate">{share.name}</span>
          )}
          {share.hasPassword && (
            <Badge variant="outline" className="gap-1 font-normal">
              <Lock className="size-3" />
              Password
            </Badge>
          )}
          {!share.allowDownload && (
            <Badge variant="outline" className="gap-1 font-normal">
              <Eye className="size-3" />
              View only
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {showOwner && share.ownerUsername && `${share.ownerUsername} · `}
          {statusLabel(share)} · {opensLabel(share)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {link ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => void copy(link)}
            aria-label={copied ? "Copied" : "Copy link"}
          >
            {copied ? (
              <Check className="size-4 text-status-good" />
            ) : (
              <Copy className="size-4" />
            )}
            <span className="hidden sm:inline">
              {copied ? "Copied" : "Copy"}
            </span>
          </Button>
        ) : mine ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={update.isPending}
            title="This browser doesn't have the link. A new one replaces it."
            onClick={() => update.mutate({ rotate: true })}
          >
            <Link2 className="size-4" />
            <span className="hidden sm:inline">New link</span>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-destructive hover:text-destructive"
          disabled={update.isPending}
          onClick={() => update.mutate({ revoke: true })}
        >
          Stop
        </Button>
      </div>
    </li>
  );
}

function PastLinks({
  shares,
  showOwner,
}: {
  shares: StorageShare[];
  showOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground md:px-6">
        <ChevronRight
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        Past links ({shares.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="divide-y border-t">
          {shares.map((share) => (
            <li
              key={share.id}
              className="flex items-center gap-3 px-4 py-2.5 opacity-70 md:px-6"
            >
              <ShareThumbnail share={share} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{share.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {showOwner &&
                    share.ownerUsername &&
                    `${share.ownerUsername} · `}
                  {statusLabel(share)} · shared{" "}
                  {formatRelative(share.createdAt)} · {opensLabel(share)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

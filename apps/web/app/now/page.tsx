import { formatDistanceToNow } from "date-fns";
import type { Metadata } from "next";
import { Suspense } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Skeleton } from "@/components/ui/skeleton";
import { getNowPageContent } from "@/lib/now-page";
import {
  GitHubContributions,
  GitHubContributionsSkeleton,
} from "./github-contributions";
import { GitHubRecentCommits } from "./github-recent-commits";
import { ResourceStatus } from "./resource-status";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: {
    absolute: "Now | Deniz Lopes Güneş",
  },
  description:
    "Discover what I'm up to right now, including my latest projects, learning endeavors, and real-time updates on my software development journey.",
  openGraph: {
    title: "Now | Deniz Lopes Güneş",
    description:
      "Discover what I'm up to right now, including my latest projects, learning endeavors, and real-time updates on my software development journey.",
    url: "https://denizlg24.com/now",
    type: "website",
    locale: "en_US",
    siteName: "Deniz Lopes Güneş Portfolio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Now | Deniz Lopes Güneş",
    description:
      "Discover what I'm up to right now, including my latest projects, learning endeavors, and real-time updates on my software development journey.",
  },
};

async function NowPageContent() {
  const doc = await getNowPageContent();

  if (!doc || !doc.content) {
    return null;
  }

  return (
    <div className="mt-12 text-left">
      <p className="text-xs text-muted-foreground mb-6">
        updated{" "}
        {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
      </p>
      <MarkdownRenderer content={doc.content} />
    </div>
  );
}

function NowPageContentSkeleton() {
  return (
    <div className="mt-12 text-left">
      <Skeleton className="h-3 w-32 mb-6" />
      <div className="space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <main className="flex flex-col items-center min-h-screen">
      <section className="w-full max-w-5xl mx-auto px-4 text-center items-center">
        <h1 className="sm:text-5xl text-4xl text-balance font-calistoga text-center">
          now.
        </h1>
        <h2 className="text-sm font-medium sm:text-base text-center">
          check out what i've been working on lately
        </h2>
        <div className="my-12"></div>
        <Suspense fallback={<GitHubContributionsSkeleton />}>
          <GitHubContributions />
        </Suspense>
        <Suspense fallback={<NowPageContentSkeleton />}>
          <NowPageContent />
        </Suspense>
        <div className="mt-12">
          <h2 className="text-2xl font-calistoga text-left mb-4">
            recent contributions
          </h2>
          <GitHubRecentCommits />
        </div>
        <ResourceStatus />
      </section>
    </main>
  );
}

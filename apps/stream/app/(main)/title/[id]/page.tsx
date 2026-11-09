import type { Metadata } from "next";
import { Suspense } from "react";

import {
  TitleDetails,
  TitleDetailsSkeleton,
} from "@/components/title/title-details";
import { findTitle } from "@/lib/catalog";

export async function generateMetadata({
  params,
}: PageProps<"/title/[id]">): Promise<Metadata> {
  const row = await findTitle((await params).id);
  return { title: row?.title ?? "Not found" };
}

export default async function TitlePage({ params }: PageProps<"/title/[id]">) {
  const { id } = await params;
  return (
    <div className="px-0 pt-16 pb-16 sm:px-[var(--gutter)] md:pt-24">
      <div className="mx-auto max-w-[72rem] overflow-hidden bg-raised sm:rounded-md">
        <Suspense fallback={<TitleDetailsSkeleton />}>
          <TitleDetails id={id} variant="page" />
        </Suspense>
      </div>
    </div>
  );
}

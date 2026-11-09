import { Suspense } from "react";

import {
  TitleDetails,
  TitleDetailsSkeleton,
} from "@/components/title/title-details";
import { TitleModal } from "@/components/title/title-modal";

export default async function TitleModalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <TitleModal key={id} titleId={id}>
      <Suspense fallback={<TitleDetailsSkeleton />}>
        <TitleDetails id={id} variant="modal" />
      </Suspense>
    </TitleModal>
  );
}

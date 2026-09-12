"use client";

import type { MacrosVisionLabelResponse } from "@repo/schemas/macros";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreateFoodPage } from "../../_components/create-food-page";
import { takeCreateFoodDraft } from "../../_lib/create-food-draft";

interface RouteDraft {
  barcode: string | null;
  scannedLabel: MacrosVisionLabelResponse | null;
  scannedLabelFormat: "eu" | "us";
}

const EMPTY_DRAFT: RouteDraft = {
  barcode: null,
  scannedLabel: null,
  scannedLabelFormat: "eu",
};

export function CreateFoodRouteClient({ barcode }: { barcode: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<RouteDraft>(() => ({
    ...EMPTY_DRAFT,
    barcode,
  }));

  useEffect(() => {
    const transferred = takeCreateFoodDraft();
    if (transferred) setDraft(transferred);
  }, []);

  return (
    <CreateFoodPage
      barcode={draft.barcode}
      scannedLabel={draft.scannedLabel}
      scannedLabelFormat={draft.scannedLabelFormat}
      onCancel={() => router.back()}
      onCreated={(food) => {
        // The library flashes the new row on arrival, which says "created" more
        // precisely than a message would.
        router.replace(`/app/foods?created=${food.id}`);
      }}
    />
  );
}

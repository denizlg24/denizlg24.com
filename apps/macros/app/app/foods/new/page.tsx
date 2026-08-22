import { pageMetadata } from "@/app/metadata";
import { CreateFoodRouteClient } from "./_components/create-food-route-client";

export const metadata = pageMetadata(
  "Create Food",
  "Create a custom food with serving sizes, nutrients, and an icon.",
);

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ barcode?: string }>;
}) {
  const { barcode } = await searchParams;
  return <CreateFoodRouteClient barcode={barcode?.trim() || null} />;
}

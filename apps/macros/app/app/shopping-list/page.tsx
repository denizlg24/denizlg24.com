import { pageMetadata } from "@/app/metadata";
import { ShoppingListClient } from "./_components/shopping-list-client";

export const metadata = pageMetadata(
  "Shopping",
  "Track what still needs buying, typed in or picked from the food catalogue.",
);

export default function Page() {
  return <ShoppingListClient />;
}

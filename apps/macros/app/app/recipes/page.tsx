import { pageMetadata } from "@/app/metadata"
import { RecipesPageClient } from "./_components/recipes-page-client"

export const metadata = pageMetadata(
  "Recipes",
  "Create and manage recipe snapshots for stable nutrition logging."
)

export default function RecipesPage() {
  return <RecipesPageClient />
}

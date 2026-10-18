import { notFound } from "next/navigation";
import { z } from "zod";
import { getRecipeDetail } from "@/lib/recipes/service";
import { KitchenGate } from "../_components/gate";
import { RecipeEditor } from "../_components/recipe-editor";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <KitchenGate>
      {async (session) => {
        const recipe = await getRecipeDetail(session.user.id, id).catch(
          () => null,
        );
        if (!recipe) notFound();
        return <RecipeEditor key={recipe.id} initial={recipe} />;
      }}
    </KitchenGate>
  );
}

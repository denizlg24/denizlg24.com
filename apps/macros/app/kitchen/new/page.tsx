import { KitchenGate } from "../_components/gate";
import { RecipeEditor } from "../_components/recipe-editor";

export const dynamic = "force-dynamic";

export default function NewRecipePage() {
  return <KitchenGate>{() => <RecipeEditor initial={null} />}</KitchenGate>;
}

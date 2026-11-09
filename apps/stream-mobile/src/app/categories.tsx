import { useLocalSearchParams } from "expo-router";
import { CategoriesScreen } from "@/features/browse/categories-screen";

export default function Categories() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  return (
    <CategoriesScreen
      type={type === "movie" || type === "series" ? type : null}
    />
  );
}

import { useLocalSearchParams } from "expo-router";
import { PortfolioScreen } from "@/features/money/portfolio-screen";

export default function Portfolio() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PortfolioScreen id={id} />;
}

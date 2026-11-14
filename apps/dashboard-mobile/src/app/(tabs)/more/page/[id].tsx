import { useLocalSearchParams } from "expo-router";
import { WorkspacePageScreen } from "@/features/workspace/page-screen";

export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkspacePageScreen key={id} id={id} />;
}

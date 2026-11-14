import { useLocalSearchParams } from "expo-router";
import { NewWorkspacePageScreen } from "@/features/workspace/capture-screen";

export default function NewPage() {
  const { parentId } = useLocalSearchParams<{ parentId?: string }>();
  return <NewWorkspacePageScreen parentId={parentId} />;
}

import { useLocalSearchParams } from "expo-router";
import { EditorScreen } from "@/features/profiles/editor-screen";

export default function ProfileEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <EditorScreen key={id ?? "new"} id={id ?? null} />;
}

import { useLocalSearchParams } from "expo-router";
import { NoteScreen } from "@/features/more/notes-screen";

export default function Note() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <NoteScreen id={id} />;
}

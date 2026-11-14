import { useLocalSearchParams } from "expo-router";
import { WorkspaceCaptureScreen } from "@/features/workspace/capture-screen";

export default function Capture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WorkspaceCaptureScreen id={id} />;
}

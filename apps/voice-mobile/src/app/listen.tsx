import { router } from "expo-router";
import { useEffect } from "react";
import { useVoice } from "@/features/voice/voice-controller";

/**
 * `voice://listen`: the Action Button, Siri, Control Center and the widgets
 * land here and the orb starts listening at once.
 */
export default function Listen() {
  const voice = useVoice();
  useEffect(() => {
    router.replace("/");
    void voice.start();
  }, [voice.start]);
  return null;
}

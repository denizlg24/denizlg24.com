import { CloudOff } from "lucide-react-native";
import { session } from "@/lib/auth";
import { Button } from "@/ui";
import { GateScreen } from "./gate-screen";

/** Stream or the sign-in service couldn't be reached. The session is kept. */
export function Unavailable({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <GateScreen
      icon={CloudOff}
      title="We can't reach Stream"
      message="This is usually a connection hiccup or a short break on our side. Check that you're online and try again in a moment. You're still signed in."
    >
      <Button
        label="Try again"
        size="large"
        block
        loading={retrying}
        onPress={onRetry}
      />
      <Button
        label="Sign out"
        variant="ghost"
        block
        onPress={() => void session.signOut()}
      />
    </GateScreen>
  );
}

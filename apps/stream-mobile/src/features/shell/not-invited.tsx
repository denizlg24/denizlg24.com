import { MailQuestion } from "lucide-react-native";
import { session } from "@/lib/auth";
import { Button } from "@/ui";
import { GateScreen } from "./gate-screen";

/** `GET /me` answered 403 `not_a_member`: signed in, but not part of the family yet. */
export function NotInvited() {
  return (
    <GateScreen
      icon={MailQuestion}
      title="You're not on the list yet"
      message="You signed in, but this account hasn't been invited to Stream. Ask Deniz to add you, then sign in again. If you have another account, sign out and try that one."
    >
      <Button
        label="Sign out"
        variant="secondary"
        size="large"
        block
        onPress={() => void session.signOut()}
      />
    </GateScreen>
  );
}

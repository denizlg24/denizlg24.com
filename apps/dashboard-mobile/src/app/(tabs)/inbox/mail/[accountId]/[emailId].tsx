import { useLocalSearchParams } from "expo-router";
import { MessageScreen } from "@/features/inbox/message-screen";

export default function Message() {
  const { accountId, emailId } = useLocalSearchParams<{
    accountId: string;
    emailId: string;
  }>();
  return <MessageScreen accountId={accountId} emailId={emailId} />;
}

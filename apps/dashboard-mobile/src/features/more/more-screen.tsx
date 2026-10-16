import { Row, Section } from "@repo/native-ui";
import { useRouter } from "expo-router";
import { useMemoryReview, useTasks } from "@/api/more";
import { TabPage } from "@/features/shell/tab-page";

export function MoreScreen() {
  const router = useRouter();
  const memory = useMemoryReview();
  const tasks = useTasks();
  const failed = tasks.data?.runs.filter(
    (run) => run.status === "failed",
  ).length;
  return (
    <TabPage title="More">
      <Section title="Agent">
        <Row title="Chat" chevron onPress={() => router.push("/chat")} />
        <Row
          title="Memory review"
          value={
            memory.data?.pendingCandidates
              ? String(memory.data.pendingCandidates)
              : undefined
          }
          valueTone="primary"
          chevron
          onPress={() => router.push("/more/memory")}
        />
        <Row
          title="Tasks"
          value={failed ? `${failed} failed` : undefined}
          valueTone="primary"
          chevron
          separator={false}
          onPress={() => router.push("/more/tasks")}
        />
      </Section>
      <Section title="Tools">
        <Row title="Notes" chevron onPress={() => router.push("/more/notes")} />
        <Row
          title="Resources"
          chevron
          onPress={() => router.push("/more/resources")}
        />
        <Row
          title="Authenticator"
          chevron
          separator={false}
          onPress={() => router.push("/more/authenticator")}
        />
      </Section>
      <Section title="App">
        <Row
          title="Settings"
          chevron
          separator={false}
          onPress={() => router.push("/more/settings")}
        />
      </Section>
    </TabPage>
  );
}

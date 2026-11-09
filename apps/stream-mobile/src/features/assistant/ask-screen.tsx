import {
  ASSISTANT_PROMPT_MAX,
  type AssistantResult,
  assistantPromptSchema,
} from "@repo/schemas/stream";
import { CloudOff, SearchX, Sparkles } from "lucide-react-native";
import { useState } from "react";
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAssistant } from "@/api/stream";
import { GridHeader } from "@/features/browse/grid-screen";
import { openTitle } from "@/features/title/open";
import { useAudience } from "@/lib/audience-store";
import { titleFacts } from "@/lib/format";
import {
  Button,
  Chip,
  colors,
  EmptyState,
  fonts,
  gutter,
  MetaRow,
  Poster,
  radius,
  Skeleton,
  spacing,
  Text,
} from "@/ui";

type Pick = AssistantResult["picks"][number];

export const IDEAS = [
  "Something funny and short for tonight",
  "A gripping thriller like Gone Girl",
  "A feel-good film we can all watch together",
  "A mind-bending sci-fi series",
  "A classic from the 80s",
  "A slow, beautiful drama",
];

export const KIDS_IDEAS = [
  "An animated adventure for the kids",
  "Something funny the whole family will enjoy",
  "A film about animals",
  "A magical fantasy adventure",
];

/** Say what you feel like watching; the assistant answers with titles and a reason for each. */
export function AskScreen() {
  const insets = useSafeAreaInsets();
  const { audience, key } = useAudience();
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const answer = useAssistant(key, asked);
  const picks = answer.data?.picks ?? [];
  const kids = audience.some((profile) => profile.kids);

  const ask = (text: string) => {
    const parsed = assistantPromptSchema.safeParse(text);
    if (!parsed.success || !parsed.data) return;
    Keyboard.dismiss();
    setDraft(parsed.data);
    setAsked(parsed.data);
  };

  return (
    <View style={styles.screen}>
      <GridHeader title="Ask Stream" />
      <FlatList
        data={picks}
        keyExtractor={(pick) => pick.title.id}
        renderItem={({ item }) => <PickRow pick={item} />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="display" accessibilityRole="header">
              What do you feel like watching?
            </Text>
            <View style={styles.field}>
              <Sparkles color={colors.amber} size={20} />
              <TextInput
                keyboardAppearance="dark"
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  if (!text.trim()) setAsked("");
                }}
                onSubmitEditing={() => ask(draft)}
                maxLength={ASSISTANT_PROMPT_MAX}
                placeholder="A cosy mystery, something like Paddington…"
                placeholderTextColor={colors.faint}
                returnKeyType="send"
                submitBehavior="blurAndSubmit"
                clearButtonMode="while-editing"
                selectionColor={colors.amber}
                accessibilityLabel="Describe what you'd like to watch"
                style={styles.input}
              />
            </View>
            <Button
              label="Ask"
              icon={Sparkles}
              size="large"
              rounded
              disabled={!draft.trim() || (answer.isFetching && draft === asked)}
              onPress={() => ask(draft)}
            />
            {asked ? null : (
              <View style={styles.ideas}>
                {(kids ? KIDS_IDEAS : IDEAS).map((idea) => (
                  <Chip
                    key={idea}
                    label={idea}
                    outline
                    onPress={() => ask(idea)}
                  />
                ))}
              </View>
            )}
            {answer.data && !answer.data.personal && picks.length > 0 ? (
              <Text variant="body" color="muted">
                These are the closest matches in the catalogue.
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !asked ? null : answer.isPending ? (
            <Thinking />
          ) : answer.isError ? (
            <EmptyState
              icon={CloudOff}
              title="We couldn't get any ideas"
              message="Stream didn't answer in time. Check your internet connection and try again."
              action={
                <Button
                  label="Try again"
                  onPress={() => void answer.refetch()}
                />
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Nothing fits that yet"
              message="Try asking another way, or with fewer details."
            />
          )
        }
      />
    </View>
  );
}

function PickRow({ pick }: { pick: Pick }) {
  const { title, reason } = pick;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title.title}. ${reason}`}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Poster title={title} width={84} />
      <View style={styles.copy}>
        <Text variant="title" numberOfLines={2}>
          {title.title}
        </Text>
        <MetaRow facts={titleFacts(title)} hide={["certification"]} />
        <Text variant="subheadline" color="muted" numberOfLines={3}>
          {reason}
        </Text>
      </View>
    </Pressable>
  );
}

function Thinking() {
  return (
    <View style={styles.thinking} accessibilityRole="progressbar">
      <View style={styles.status}>
        <Sparkles color={colors.amber} size={18} />
        <Text variant="body" color="muted" style={styles.grow}>
          Looking through the catalogue for you…
        </Text>
      </View>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.row}>
          <Skeleton style={{ width: 84, height: 126 }} />
          <View style={[styles.copy, styles.lines]}>
            <Skeleton style={{ height: 22, width: "70%" }} />
            <Skeleton style={{ height: 14, width: "45%" }} />
            <Skeleton style={{ height: 14, width: "90%" }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  grow: { flex: 1 },
  header: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: colors.lifted,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.paper,
    fontFamily: fonts.regular,
    fontSize: 17,
    paddingVertical: spacing.md,
  },
  ideas: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: gutter,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  lines: { gap: spacing.md, paddingTop: spacing.xs },
  thinking: { paddingTop: spacing.sm },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: gutter,
    paddingBottom: spacing.sm,
  },
});

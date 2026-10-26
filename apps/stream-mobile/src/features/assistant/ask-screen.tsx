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
import { useAssistant } from "@/api/stream";
import { openTitle } from "@/features/studio/open";
import { StudioHeader } from "@/features/studio/studio-header";
import { useAudience } from "@/lib/audience-store";
import { titleFacts } from "@/lib/format";
import {
  Button,
  Chip,
  colors,
  EmptyState,
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

/**
 * Say what you feel like watching; the assistant answers with titles and a
 * reason for each. Both layouts share it, classic with its bigger type.
 */
export function AskScreen({ classic = false }: { classic?: boolean }) {
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

  const list = (
    <FlatList
      style={styles.screen}
      data={picks}
      keyExtractor={(pick) => pick.title.id}
      renderItem={({ item }) => <PickRow pick={item} classic={classic} />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={classic ? styles.classicContent : styles.content}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text
            variant={classic ? "classicTitle" : "hero"}
            accessibilityRole="header"
          >
            What do you feel like watching?
          </Text>
          <View style={[styles.field, classic ? styles.classicField : null]}>
            <Sparkles color={colors.amber} size={classic ? 26 : 20} />
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                // Clearing the field brings the ideas back.
                if (!text.trim()) setAsked("");
              }}
              onSubmitEditing={() => ask(draft)}
              maxLength={ASSISTANT_PROMPT_MAX}
              placeholder="A cosy mystery, something like Paddington…"
              placeholderTextColor={colors.faint}
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              clearButtonMode="while-editing"
              accessibilityLabel="Describe what you'd like to watch"
              style={[styles.input, classic ? styles.classicInput : null]}
            />
          </View>
          <Button
            label="Ask"
            icon={Sparkles}
            size={classic ? "classic" : "large"}
            disabled={!draft.trim() || (answer.isFetching && draft === asked)}
            onPress={() => ask(draft)}
          />
          {asked ? null : (
            <View style={styles.ideas}>
              {(kids ? KIDS_IDEAS : IDEAS).map((idea) => (
                <Chip
                  key={idea}
                  label={idea}
                  large={classic}
                  onPress={() => ask(idea)}
                />
              ))}
            </View>
          )}
          {answer.data && !answer.data.personal && picks.length > 0 ? (
            <Text variant={classic ? "classicBody" : "body"} color="muted">
              These are the closest matches in the catalogue.
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !asked ? null : answer.isPending ? (
          <Thinking classic={classic} />
        ) : answer.isError ? (
          <EmptyState
            large={classic}
            icon={CloudOff}
            title="We couldn't get any ideas"
            message="Stream didn't answer in time. Check your internet connection and try again."
            action={
              <Button
                label="Try again"
                size={classic ? "classic" : "regular"}
                onPress={() => void answer.refetch()}
              />
            }
          />
        ) : (
          <EmptyState
            large={classic}
            icon={SearchX}
            title="Nothing fits that yet"
            message="Try asking another way, or with fewer details."
          />
        )
      }
    />
  );

  if (classic) return list;
  return (
    <View style={styles.screen}>
      <StudioHeader />
      {list}
    </View>
  );
}

function PickRow({ pick, classic }: { pick: Pick; classic: boolean }) {
  const { title, reason } = pick;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title.title}. ${reason}`}
      onPress={() => openTitle(title.id)}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Poster title={title} width={classic ? 96 : 84} />
      <View style={styles.copy}>
        <Text variant={classic ? "classicHeading" : "title"} numberOfLines={2}>
          {title.title}
        </Text>
        <MetaRow
          facts={titleFacts(title)}
          large={classic}
          hide={["certification"]}
        />
        <Text
          variant={classic ? "classicBody" : "body"}
          color="muted"
          numberOfLines={3}
        >
          {reason}
        </Text>
      </View>
    </Pressable>
  );
}

function Thinking({ classic }: { classic: boolean }) {
  return (
    <View style={styles.thinking} accessibilityRole="progressbar">
      <View style={styles.status}>
        <Sparkles color={colors.amber} size={classic ? 24 : 18} />
        <Text
          variant={classic ? "classicBody" : "body"}
          color="muted"
          style={styles.grow}
        >
          Looking through the catalogue for you…
        </Text>
      </View>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={styles.row}>
          <Skeleton
            style={{
              width: classic ? 96 : 84,
              height: (classic ? 96 : 84) * 1.5,
            }}
          />
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
  content: { paddingBottom: 140 },
  classicContent: { paddingBottom: spacing.xxxl * 2 },
  grow: { flex: 1 },
  header: {
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
    borderWidth: 2,
    borderColor: colors.hairline,
  },
  classicField: { minHeight: 64 },
  input: {
    flex: 1,
    color: colors.paper,
    fontSize: 18,
    paddingVertical: spacing.md,
  },
  classicInput: { fontSize: 22 },
  ideas: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  row: {
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: gutter,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  copy: { flex: 1, gap: spacing.xs },
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

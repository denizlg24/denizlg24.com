import {
  ASSISTANT_PROMPT_MAX,
  assistantPromptSchema,
} from "@repo/schemas/stream";
import { CloudOff, SearchX, Sparkles } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useAssistant } from "@/api/stream";
import { IDEAS, KIDS_IDEAS } from "@/features/assistant/ask-screen";
import { useAudience } from "@/lib/audience-store";
import { Button, colors, EmptyState, fonts, radius, spacing, Text } from "@/ui";
import {
  type RailItem,
  TvBackdrop,
  TvNavBar,
  TvRail,
  TvSpotlight,
} from "./chrome";
import { useFieldEscape } from "./field-escape";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { TV_SAFE } from "./layout";
import { openTvTitle } from "./open";
import { type Spotlight, useSpot, useSpotlight } from "./spotlight";

/**
 * Say what you feel like watching. OK on the field opens the TV's keyboard,
 * whose microphone key lets anyone just say it; the ideas below are one
 * press each. Picks come back as a row, each with its reason above it.
 */
export function TvAskScreen() {
  const { audience, key } = useAudience();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const [focused, setFocused] = useState(false);
  const escape = useFieldEscape(input, focused, true);
  const answer = useAssistant(key, asked);
  const spotlight = useSpotlight<RailItem>();
  const kids = audience.some((profile) => profile.kids);
  const items = useMemo<RailItem[]>(
    () =>
      (answer.data?.picks ?? []).map(({ title, reason }) => ({
        key: title.id,
        title,
        reason,
        onPress: () => openTvTitle(title.id),
      })),
    [answer.data],
  );

  const ask = (text: string) => {
    const parsed = assistantPromptSchema.safeParse(text);
    if (!parsed.success || !parsed.data) return;
    Keyboard.dismiss();
    setDraft(parsed.data);
    setAsked(parsed.data);
  };

  return (
    <View style={styles.screen}>
      <AskBackdrop spotlight={spotlight} />
      <TvNavBar current="ask" preferred={escape.navPreferred} />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          {/* With an answer on screen the question has done its job, and
              the picks need its height to fit without scrolling. */}
          {asked ? null : (
            <Text variant="hero">What do you feel like watching?</Text>
          )}
          <View style={styles.row}>
            <View style={[styles.field, focused ? styles.fieldFocused : null]}>
              <Sparkles
                color={focused ? colors.amber : colors.muted}
                size={22}
              />
              <TextInput
                ref={input}
                value={draft}
                onChangeText={(text) => {
                  setDraft(text);
                  if (!text.trim()) setAsked("");
                }}
                onSubmitEditing={() => ask(draft)}
                onFocus={() => {
                  setFocused(true);
                  escape.onFieldFocus();
                }}
                onBlur={() => setFocused(false)}
                maxLength={ASSISTANT_PROMPT_MAX}
                placeholder="A cosy mystery, something like Paddington"
                placeholderTextColor={colors.faint}
                returnKeyType="send"
                accessibilityLabel="Describe what you'd like to watch"
                style={styles.input}
              />
            </View>
            <Button
              label="Ask"
              icon={Sparkles}
              size="large"
              disabled={!draft.trim()}
              loading={answer.isFetching && draft === asked}
              onPress={() => ask(draft)}
            />
          </View>
        </View>

        {!asked ? (
          <View style={styles.ideas}>
            {(kids ? KIDS_IDEAS : IDEAS).map((idea) => (
              <Focusable
                key={idea}
                accessibilityRole="button"
                accessibilityLabel={idea}
                onPress={() => ask(idea)}
                style={styles.idea}
                radius={radius.pill}
                grow={1.03}
              >
                <Text variant="callout">{idea}</Text>
              </Focusable>
            ))}
          </View>
        ) : answer.isPending ? (
          <View style={styles.thinking}>
            <ActivityIndicator color={colors.amber} size="large" />
            <Text variant="body" color="muted">
              Looking through the catalogue. This can take up to twenty seconds.
            </Text>
          </View>
        ) : answer.isError ? (
          <EmptyState
            icon={CloudOff}
            title="We couldn't get any ideas"
            message="Stream didn't answer in time. Check that the TV is connected to the internet, then ask again."
            action={
              <Button
                label="Ask again"
                size="large"
                onPress={() => void answer.refetch()}
              />
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Nothing fits that yet"
            message="Try asking another way, or with fewer details."
          />
        ) : (
          <>
            <AskSpotlight spotlight={spotlight} />
            <TvRail
              label={
                answer.data?.personal
                  ? "Picked for you"
                  : "The closest matches in the catalogue"
              }
              items={items}
              onFocusItem={spotlight.set}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AskBackdrop({ spotlight }: { spotlight: Spotlight<RailItem> }) {
  return <TvBackdrop title={useSpot(spotlight)?.title ?? null} />;
}

function AskSpotlight({ spotlight }: { spotlight: Spotlight<RailItem> }) {
  const spot = useSpot(spotlight);
  return (
    <View style={styles.spot}>
      <TvSpotlight title={spot?.title ?? null} reason={spot?.reason} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  content: { gap: spacing.xl, paddingBottom: TV_SAFE.y + spacing.xl },
  head: { paddingHorizontal: TV_SAFE.x, gap: spacing.md, maxWidth: 760 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  fieldFocused: { borderColor: colors.amber },
  input: {
    flex: 1,
    minHeight: 52,
    color: colors.paper,
    fontFamily: fonts.regular,
    fontSize: 19,
  },
  ideas: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
    maxWidth: 860,
  },
  idea: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
  },
  thinking: {
    paddingHorizontal: TV_SAFE.x,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  spot: { minHeight: 96 },
});

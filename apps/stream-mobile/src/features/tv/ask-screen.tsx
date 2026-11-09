import {
  ASSISTANT_PROMPT_MAX,
  assistantPromptSchema,
} from "@repo/schemas/stream";
import { Sparkles } from "lucide-react-native";
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
import { colors, fonts, spacing } from "@/ui";
import { TitleLogo } from "./artwork";
import { TvBackdrop } from "./backdrop";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { CONTENT_X, TV_SAFE } from "./layout";
import { TvMeta } from "./meta";
import { openTvTitle } from "./open";
import { type RowEvents, TvRow, type TvRowModel, type TvTile } from "./row";
import { type Spotlight, useSpot, useSpotlight } from "./spotlight";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

/**
 * Say what you feel like watching, from Search. OK on the field opens the
 * TV's keyboard, whose microphone key lets anyone just say it; the ideas
 * are one press each. Picks come back as a row, each with its reason.
 */
export function TvAskScreen() {
  const { audience, key } = useAudience();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const [focused, setFocused] = useState(false);
  const answer = useAssistant(key, asked);
  const spotlight = useSpotlight<TvTile>();
  const kids = audience.some((profile) => profile.kids);
  const model = useMemo<TvRowModel | null>(() => {
    const picks = answer.data?.picks ?? [];
    if (picks.length === 0) return null;
    return {
      id: "picks",
      label: answer.data?.personal
        ? "Picked for you"
        : "The closest matches in the catalogue",
      kind: "poster",
      tiles: picks.map(({ title, reason }) => ({
        key: title.id,
        title,
        reason,
      })),
    };
  }, [answer.data]);
  const [events] = useState<RowEvents>(() => ({
    onTileFocus: (_row, row, column) => {
      const tile = row.tiles[column];
      if (tile) spotlight.set(tile);
      return true;
    },
    onTilePress: (tile) => openTvTitle(tile.title.id),
  }));

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
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          {asked ? null : (
            <TvText variant="marquee">What do you feel like watching?</TvText>
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
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxLength={ASSISTANT_PROMPT_MAX}
                placeholder="A cosy mystery, something like Paddington"
                placeholderTextColor={colors.faint}
                returnKeyType="send"
                accessibilityLabel="Describe what you'd like to watch"
                style={styles.input}
              />
            </View>
            <TvButton
              label="Ask"
              icon={Sparkles}
              disabled={!draft.trim()}
              loading={answer.isFetching && draft === asked}
              onPress={() => ask(draft)}
            />
          </View>
        </View>

        {!asked ? (
          <View style={styles.ideas}>
            {(kids ? KIDS_IDEAS : IDEAS).map((idea, index) => (
              <Focusable
                key={idea}
                accessibilityRole="button"
                accessibilityLabel={idea}
                preferred={index === 0}
                onPress={() => ask(idea)}
                ringless
                grow={1.04}
              >
                {(on) => (
                  <View style={[styles.idea, on ? styles.ideaFocused : null]}>
                    <TvText variant="bodyStrong" color={on ? "ink" : "paper"}>
                      {idea}
                    </TvText>
                  </View>
                )}
              </Focusable>
            ))}
          </View>
        ) : answer.isPending ? (
          <View style={styles.thinking}>
            <ActivityIndicator color={colors.amber} size="large" />
            <TvText variant="body" color="muted">
              Looking through the catalogue. This can take up to twenty seconds.
            </TvText>
          </View>
        ) : answer.isError ? (
          <View style={styles.message}>
            <TvText variant="heading">We couldn't get any ideas</TvText>
            <TvText variant="lede" color="muted">
              Stream didn't answer in time. Check that the TV is connected to
              the internet, then ask again.
            </TvText>
            <View style={styles.row}>
              <TvButton
                label="Ask again"
                preferred
                onPress={() => void answer.refetch()}
              />
            </View>
          </View>
        ) : !model ? (
          <View style={styles.message}>
            <TvText variant="heading">Nothing fits that yet</TvText>
            <TvText variant="lede" color="muted">
              Try asking another way, or with fewer details.
            </TvText>
          </View>
        ) : (
          <>
            <AskSpotlight spotlight={spotlight} />
            <TvRow model={model} index={0} events={events} preferFirst />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AskBackdrop({ spotlight }: { spotlight: Spotlight<TvTile> }) {
  return <TvBackdrop title={useSpot(spotlight)?.title ?? null} />;
}

function AskSpotlight({ spotlight }: { spotlight: Spotlight<TvTile> }) {
  const spot = useSpot(spotlight);
  return (
    <View style={styles.spot}>
      {spot ? (
        <>
          <TitleLogo title={spot.title} width={300} height={60} lines={1} />
          <TvMeta title={spot.title} />
          {spot.reason ? (
            <TvText variant="body" color="muted" numberOfLines={2}>
              {spot.reason}
            </TvText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  content: {
    gap: spacing.lg,
    paddingTop: TV_SAFE.y + spacing.md,
    paddingBottom: TV_SAFE.y + spacing.xl,
  },
  head: { paddingLeft: CONTENT_X, paddingRight: TV_SAFE.x, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  field: {
    flex: 1,
    maxWidth: 560,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.hairline,
    backgroundColor: colors.raised,
  },
  fieldFocused: { borderColor: colors.amber },
  input: {
    flex: 1,
    minHeight: 48,
    color: colors.paper,
    fontFamily: fonts.regular,
    fontSize: 17,
  },
  ideas: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
  },
  idea: {
    paddingHorizontal: spacing.lg,
    height: 38,
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: "rgba(239,233,223,0.1)",
  },
  ideaFocused: { backgroundColor: colors.paper },
  thinking: {
    paddingLeft: CONTENT_X,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  message: {
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    gap: spacing.md,
    maxWidth: 680,
  },
  spot: {
    minHeight: 130,
    paddingLeft: CONTENT_X,
    paddingRight: TV_SAFE.x,
    gap: spacing.sm,
    maxWidth: 620,
  },
});

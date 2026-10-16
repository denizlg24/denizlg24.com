import {
  colors,
  haptics,
  Notice,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import type { AgentUIMessage } from "@repo/schemas";
import {
  type AgentTurn,
  approvalReply,
  pendingApprovals,
  runningTool,
} from "@repo/utils/agent-stream";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { runTurn, useConversation, useDefaultModel } from "@/api/agent";
import { blocksOf, describeInput, toolLabel } from "./parts";

function ask(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message || undefined, [
      { text: "Deny", style: "destructive", onPress: () => resolve(false) },
      { text: "Approve", style: "default", onPress: () => resolve(true) },
    ]),
  );
}

/**
 * One conversation. YOLO is a state of this screen, not a setting: every
 * conversation opens with it off, because typed chat is where a mail send or
 * an order gets asked for.
 */
export function Thread({
  id,
  firstMessage,
}: {
  id: string;
  firstMessage?: string;
}) {
  const client = useQueryClient();
  const conversation = useConversation(id);
  const defaultModel = useDefaultModel();
  const [yolo, setYolo] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<AgentUIMessage | null>(null);
  const [live, setLive] = useState<AgentTurn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroll = useRef<ScrollView>(null);
  const started = useRef(false);
  const busy = live !== null || pending !== null;
  const model = conversation.data?.llmModel ?? defaultModel.data;

  const { refetch } = conversation;

  /** Runs a turn, then keeps answering approvals until the agent stops asking. */
  const converse = useCallback(
    async (first: AgentUIMessage, mode: boolean) => {
      if (!model) return;
      let message: AgentUIMessage | null = first;
      while (message) {
        setError(null);
        const controller = new AbortController();
        abort.current = controller;
        try {
          const done = await runTurn({
            conversationId: id,
            model,
            message,
            yolo: mode,
            signal: controller.signal,
            onTurn: setLive,
          });
          if (done.error) setError(done.error);
        } catch (cause) {
          if (!(cause instanceof Error && cause.name === "AbortError")) {
            setError(
              cause instanceof Error ? cause.message : "The turn failed",
            );
          }
        }
        abort.current = null;
        const stored = (await refetch()).data?.messages;
        void client.invalidateQueries({
          queryKey: ["conversations"],
          exact: true,
        });
        setLive(null);
        setPending(null);
        message = null;
        const last = stored?.at(-1);
        if (!last || controller.signal.aborted) break;
        const asks = pendingApprovals(last);
        if (asks.length === 0) break;
        haptics.warning();
        const decisions = new Map<string, boolean>();
        for (const part of asks) {
          decisions.set(
            part.approval.id,
            await ask(toolLabel(part), describeInput(part.input)),
          );
        }
        message = approvalReply(last, decisions);
      }
    },
    [client, id, model, refetch],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      const message: AgentUIMessage = {
        id: Crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: trimmed }],
      };
      setDraft("");
      setPending(message);
      haptics.light();
      void converse(message, yolo);
    },
    [busy, converse, yolo],
  );

  useEffect(() => {
    if (firstMessage && model && !started.current) {
      started.current = true;
      send(firstMessage);
    }
  }, [firstMessage, model, send]);

  useEffect(() => () => abort.current?.abort(), []);

  const stored = conversation.data?.messages ?? [];
  const shown: AgentUIMessage[] = [
    ...stored,
    ...(pending ? [pending] : []),
    ...(live ? [live.message] : []),
  ];
  const ticker = live ? runningTool(live.message) : null;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={styles.screen}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen
        options={{
          title: conversation.data?.title ?? "",
          headerRight: () =>
            yolo ? (
              <Text variant="footnote" weight="bold" tone="onBreak">
                YOLO
              </Text>
            ) : null,
        }}
      />
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        onContentSizeChange={() =>
          scroll.current?.scrollToEnd({ animated: true })
        }
      >
        {conversation.error ? (
          <Notice message={conversation.error.message} />
        ) : null}
        {!conversation.data && !firstMessage ? <ActivityIndicator /> : null}
        {shown.map((message) => (
          <Message key={message.id || "live"} message={message} />
        ))}
        {busy ? (
          <Text variant="footnote" tone="tertiary">
            {ticker ?? "…"}
          </Text>
        ) : null}
        {error ? <Notice message={error} /> : null}
      </ScrollView>
      <View style={styles.composer}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: yolo }}
          accessibilityLabel="YOLO"
          hitSlop={8}
          onPress={() => {
            haptics.selection();
            setYolo((value) => !value);
          }}
          style={[styles.yolo, yolo && styles.yoloOn]}
        >
          <SymbolView
            name={yolo ? "bolt.fill" : "bolt"}
            size={16}
            tintColor={yolo ? colors.onBreak : colors.tertiaryLabel}
          />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder="Ask"
          placeholderTextColor={colors.placeholder}
          style={[typeScale.body, styles.input, { color: colors.label }]}
        />
        {busy ? (
          <Pressable
            accessibilityLabel="Stop"
            hitSlop={8}
            onPress={() => abort.current?.abort()}
          >
            <SymbolView
              name="stop.circle.fill"
              size={28}
              tintColor={colors.label}
            />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="Send"
            hitSlop={8}
            disabled={!draft.trim() || !model}
            onPress={() => send(draft)}
          >
            <SymbolView
              name="arrow.up.circle.fill"
              size={28}
              tintColor={draft.trim() ? colors.label : colors.tertiaryLabel}
            />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const TOOL_STATE: Record<string, string> = {
  "input-streaming": "…",
  "input-available": "…",
  "approval-requested": "waiting",
  "approval-responded": "answered",
  "output-available": "",
  "output-error": "failed",
  "output-denied": "denied",
};

function Message({ message }: { message: AgentUIMessage }) {
  const blocks = blocksOf(message);
  if (blocks.length === 0) return null;
  const mine = message.role === "user";
  return (
    <View style={[styles.message, mine && styles.mine]}>
      {blocks.map((block) =>
        block.kind === "text" ? (
          <Text
            key={block.key}
            variant="body"
            selectable
            tone={mine ? "secondary" : "primary"}
          >
            {block.text}
          </Text>
        ) : block.kind === "tool" ? (
          <Text key={block.key} variant="footnote" tone="tertiary">
            ↳ {block.label}
            {TOOL_STATE[block.state] ? ` · ${TOOL_STATE[block.state]}` : ""}
          </Text>
        ) : block.kind === "notice" ? (
          <Text key={block.key} variant="footnote" tone="secondary">
            {block.text}
          </Text>
        ) : (
          <Text
            key={block.key}
            variant="footnote"
            weight="semibold"
            onPress={() => void WebBrowser.openBrowserAsync(block.url)}
          >
            {block.mediaType.startsWith("image/") ? "Image" : "File"}
          </Text>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  message: { gap: spacing.xs },
  mine: {
    borderLeftWidth: 2,
    borderColor: colors.separator,
    paddingLeft: spacing.md,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.background,
  },
  yolo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  yoloOn: { backgroundColor: colors.tertiaryFill },
  input: { flex: 1, maxHeight: 140, paddingVertical: spacing.xs },
});

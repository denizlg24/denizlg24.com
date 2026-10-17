import {
  Button,
  colors,
  HeaderButton,
  haptics,
  Notice,
  Row,
  spacing,
  Text,
  typeScale,
} from "@repo/native-ui";
import { type IEmailAccount, TRIAGE_CATEGORY_LABELS } from "@repo/schemas";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import {
  ActionSheetIOS,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  useComments,
  useContacts,
  useDecideSuggestion,
  useEmailAccounts,
  useEmails,
  useModerateComment,
  useSyncAccount,
  useTriageQueue,
} from "@/api/inbox";
import { useToday } from "@/api/today";
import { Segments } from "@/features/shell/segments";
import { SwipeRow } from "@/features/shell/swipe-row";
import { Dash, QueryState, TabPage } from "@/features/shell/tab-page";
import { ago, clock, dayLabel } from "@/lib/format";
import { pendingSuggestions } from "./triage-queue";

type View_ = "mail" | "triage" | "contacts" | "comments";
const VIEWS: View_[] = ["mail", "triage", "contacts", "comments"];

function isView(value: unknown): value is View_ {
  return VIEWS.some((view) => view === value);
}

export function InboxScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const view: View_ = isView(params.view) ? params.view : "mail";
  const today = useToday();
  const counts = today.data?.counts;
  const [accountId, setAccountId] = useState<string>();
  const accounts = useEmailAccounts();
  const account = accountId ?? accounts.data?.[0]?._id;
  const sync = useSyncAccount();

  return (
    <TabPage
      title="Inbox"
      actions={
        view === "mail" && account ? (
          <HeaderButton
            symbol="square.and.pencil"
            label="Compose"
            onPress={() => router.push(`/compose?accountId=${account}`)}
          />
        ) : undefined
      }
      onRefresh={() => {
        if (view === "mail" && account) sync.mutate(account);
        void today.refetch();
      }}
      refreshing={sync.isPending}
    >
      <Segments
        value={view}
        onChange={(next) => router.setParams({ view: next })}
        options={[
          { value: "mail", label: "Mail", count: counts?.unreadMail },
          { value: "triage", label: "Triage", count: counts?.triage },
          { value: "contacts", label: "Contacts", count: counts?.newContacts },
          {
            value: "comments",
            label: "Comments",
            count: counts?.pendingComments,
          },
        ]}
      />
      {view === "mail" ? (
        <MailView
          accountId={account}
          onAccount={setAccountId}
          syncError={sync.error}
        />
      ) : view === "triage" ? (
        <TriageView />
      ) : view === "contacts" ? (
        <ContactsView />
      ) : (
        <CommentsView />
      )}
    </TabPage>
  );
}

/**
 * One line, the whole address: several accounts share a local part
 * (`geral@` twice), so a row of short labels both overflowed and lied.
 */
function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: IEmailAccount[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const current = accounts.find((item) => item._id === value) ?? accounts[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Account"
      onPress={() =>
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...accounts.map((item) => item.user), "Cancel"],
            cancelButtonIndex: accounts.length,
          },
          (index) => {
            const picked = accounts[index];
            if (picked) {
              haptics.selection();
              onChange(picked._id);
            }
          },
        )
      }
      style={({ pressed }) => [styles.account, pressed && { opacity: 0.55 }]}
    >
      <Text variant="subheadline" weight="medium" numberOfLines={1}>
        {current?.user ?? "—"}
      </Text>
      <SymbolView
        name="chevron.up.chevron.down"
        size={12}
        tintColor={colors.secondaryLabel}
      />
    </Pressable>
  );
}

function MailView({
  accountId,
  onAccount,
  syncError,
}: {
  accountId: string | undefined;
  onAccount: (id: string) => void;
  syncError: Error | null;
}) {
  const router = useRouter();
  const accounts = useEmailAccounts();
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const emails = useEmails(accountId, submitted);
  const rows = emails.data?.pages.flatMap((page) => page.emails) ?? [];

  return (
    <View>
      {(accounts.data?.length ?? 0) > 1 ? (
        <AccountPicker
          accounts={accounts.data ?? []}
          value={accountId}
          onChange={onAccount}
        />
      ) : null}
      <TextInput
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => setSubmitted(search.trim())}
        returnKeyType="search"
        clearButtonMode="while-editing"
        placeholder="Search"
        placeholderTextColor={colors.placeholder}
        style={[typeScale.body, styles.search, { color: colors.label }]}
      />
      {syncError ? <Notice message={syncError.message} /> : null}
      <QueryState
        error={accounts.error ?? emails.error}
        loading={!emails.data && emails.isFetching}
      />
      {emails.data && rows.length === 0 ? <Dash /> : null}
      {rows.map((email) => {
        const sender = email.from[0];
        return (
          <Row
            key={email._id}
            title={sender?.name || sender?.address || "—"}
            subtitle={email.subject || "(no subject)"}
            value={
              dayLabel(email.date) === "Today"
                ? clock(email.date)
                : dayLabel(email.date)
            }
            valueTone={email.seen ? "secondary" : "primary"}
            trailing={email.seen ? null : <View style={styles.unread} />}
            onPress={() =>
              router.push(`/inbox/mail/${email.accountId}/${email._id}`)
            }
          />
        );
      })}
      {emails.hasNextPage ? (
        <Button
          label="More"
          variant="plain"
          size="small"
          loading={emails.isFetchingNextPage}
          onPress={() => void emails.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

function TriageView() {
  const router = useRouter();
  const queue = useTriageQueue();
  const decide = useDecideSuggestion();
  const items = pendingSuggestions(queue.data?.items ?? []);
  return (
    <View>
      {decide.error ? <Notice message={decide.error.message} /> : null}
      <QueryState error={queue.error} loading={!queue.data} />
      {queue.data && items.length === 0 ? <Dash /> : null}
      {items.map((item) => (
        <SwipeRow
          key={item.key}
          right={{
            label: "Accept",
            symbol: "checkmark",
            color: colors.working,
            run: () =>
              decide.mutate({
                triageId: item.triageId,
                suggestionId: item.suggestionId,
                type: item.type,
                action: "accept",
              }),
          }}
          left={{
            label: "Dismiss",
            symbol: "xmark",
            color: colors.secondaryLabel,
            run: () =>
              decide.mutate({
                triageId: item.triageId,
                suggestionId: item.suggestionId,
                type: item.type,
                action: "dismiss",
              }),
          }}
        >
          <Row
            title={item.title}
            subtitle={`${
              item.type === "task"
                ? "Task"
                : item.type === "event"
                  ? "Event"
                  : "Action"
            }${item.when ? ` · ${dayLabel(item.when)}` : ""} · ${item.sender} — ${item.subject}`}
            trailing={
              <Text variant="caption2" tone="tertiary" eyebrow>
                {TRIAGE_CATEGORY_LABELS[item.category]}
              </Text>
            }
            onPress={() => router.push(`/inbox/triage/${item.triageId}`)}
          />
        </SwipeRow>
      ))}
    </View>
  );
}

const CONTACT_TONE = {
  pending: "primary",
  read: "secondary",
  responded: "working",
  archived: "secondary",
} as const;

function ContactsView() {
  const router = useRouter();
  const contacts = useContacts();
  const rows = (contacts.data?.contacts ?? []).filter(
    (contact) => contact.status !== "archived",
  );
  return (
    <View>
      <QueryState error={contacts.error} loading={!contacts.data} />
      {contacts.data && rows.length === 0 ? <Dash /> : null}
      {rows.map((contact) => (
        <Row
          key={contact.ticketId}
          title={contact.name}
          subtitle={contact.message}
          value={contact.status}
          valueTone={CONTACT_TONE[contact.status]}
          onPress={() => router.push(`/inbox/contact/${contact.ticketId}`)}
        />
      ))}
    </View>
  );
}

function CommentsView() {
  const comments = useComments();
  const moderate = useModerateComment();
  const pending = (comments.data?.comments ?? []).filter(
    (comment) => !comment.isApproved && !comment.isDeleted,
  );
  return (
    <View>
      {moderate.error ? <Notice message={moderate.error.message} /> : null}
      <QueryState error={comments.error} loading={!comments.data} />
      {comments.data && pending.length === 0 ? <Dash /> : null}
      {pending.map((comment) => (
        <SwipeRow
          key={comment._id}
          right={{
            label: "Approve",
            symbol: "checkmark",
            color: colors.working,
            run: () => moderate.mutate({ id: comment._id, action: "approve" }),
          }}
          left={{
            label: "Reject",
            symbol: "xmark",
            color: colors.destructive,
            run: () => moderate.mutate({ id: comment._id, action: "reject" }),
          }}
        >
          <View style={styles.comment}>
            <View style={styles.commentHead}>
              <Text variant="subheadline" weight="semibold" numberOfLines={1}>
                {comment.authorName}
              </Text>
              <Text variant="footnote" tone="tertiary">
                {ago(comment.createdAt)}
              </Text>
            </View>
            <Text variant="body">{comment.content}</Text>
            {comment.blogTitle ? (
              <Text variant="footnote" tone="secondary" numberOfLines={1}>
                {comment.blogTitle}
              </Text>
            ) : null}
          </View>
          <View style={styles.rule} />
        </SwipeRow>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  search: {
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  unread: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.label,
  },
  comment: { paddingVertical: spacing.md, gap: spacing.xs },
  commentHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
});

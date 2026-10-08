import { format } from "date-fns";
import { useHiddenContributors, useUnhideContributor } from "@/api/moderation";
import { haptics } from "@/lib/haptics";
import { EmptyState, Row, Screen, Section, SwipeRow, VStack } from "@/ui";
import { NoticeSlot, useNotice } from "../shared/notice";
import { useRefresh } from "../shared/use-refresh";

export function HiddenContributorsScreen() {
  const blocks = useHiddenContributors();
  const unhide = useUnhideContributor();
  const { notice, showError, clear } = useNotice();
  const { refreshing, onRefresh } = useRefresh(blocks.refetch);

  function show(blockId: string) {
    clear();
    haptics.selection();
    unhide.mutate(blockId, { onError: showError });
  }

  const rows = blocks.data ?? [];

  return (
    <Screen
      stickyHeaderIndices={[0]}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      <NoticeSlot notice={notice} onDismiss={clear} />
      <VStack>
        {blocks.isSuccess && rows.length === 0 ? (
          <EmptyState
            icon="eye-off"
            title="No hidden contributors"
            message="When you hide the person who added a shared food, everything they added disappears from your searches. They’re listed here so you can undo it."
          />
        ) : (
          <Section
            title="Hidden"
            footer="Each person is listed by the food you hid them from. Swipe or tap Show to see their foods again."
          >
            {rows.map((block, index) => (
              <SwipeRow
                key={block.id}
                actions={[
                  {
                    label: "Show",
                    icon: "eye",
                    onPress: () => show(block.id),
                  },
                ]}
              >
                <Row
                  title={`Added ${block.label}`}
                  subtitle={`Hidden ${format(new Date(block.createdAt), "d MMM yyyy")}`}
                  separator={index < rows.length - 1}
                  accessibilityHint="Shows this contributor’s foods again"
                  onPress={() => show(block.id)}
                  disabled={unhide.isPending}
                />
              </SwipeRow>
            ))}
          </Section>
        )}
      </VStack>
    </Screen>
  );
}

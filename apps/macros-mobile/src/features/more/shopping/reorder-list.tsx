import { Host, List, Text as SwiftText } from "@expo/ui/swift-ui";
import { environment, listStyle } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, View } from "react-native";
import type { ShoppingListItem } from "@/api/shopping-list";

export interface ReorderListProps {
  items: readonly ShoppingListItem[];
  /** SwiftUI's `onMove`: `destination` indexes the list before the move. */
  onMove: (sources: number[], destination: number) => void;
}

export function ReorderList({ items, onMove }: ReorderListProps) {
  return (
    <View style={styles.reorder}>
      <Host style={styles.reorder}>
        <List
          modifiers={[
            listStyle("plain"),
            environment({ key: "editMode", value: "active" }),
          ]}
        >
          <List.ForEach onMove={onMove}>
            {items.map((item) => (
              <SwiftText key={item.id}>{item.label}</SwiftText>
            ))}
          </List.ForEach>
        </List>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  reorder: {
    flex: 1,
  },
});

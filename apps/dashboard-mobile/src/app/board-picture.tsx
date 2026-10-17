import { colors, HeaderButton, spacing } from "@repo/native-ui";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useBoard, useBoardPicture } from "@/api/board";
import { Dash } from "@/features/shell/tab-page";

/** The rendered board at full size; UIScrollView does the pinch. */
export default function BoardPicture() {
  const router = useRouter();
  const board = useBoard();
  const picture = useBoardPicture(board.data?.updatedAt);
  const { width, height } = useWindowDimensions();
  const data = picture.data;
  return (
    <View style={styles.screen}>
      <View style={styles.close}>
        <HeaderButton
          symbol="xmark"
          label="Close"
          onPress={() => router.back()}
        />
      </View>
      {data ? (
        <ScrollView
          maximumZoomScale={6}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Image
            source={{ uri: data.uri }}
            contentFit="contain"
            style={{
              width,
              height: Math.min(height, (width * data.height) / data.width),
            }}
          />
        </ScrollView>
      ) : (
        <Dash />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  close: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
    zIndex: 1,
  },
  content: { flexGrow: 1, justifyContent: "center" },
});

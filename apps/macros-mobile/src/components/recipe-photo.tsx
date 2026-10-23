import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { buildUrl } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Skeleton, Text } from "@/ui";

/** Relative image URLs are private API reads; only those receive the cookie. */
export function RecipePhoto({
  url,
  label,
  thumbnail = false,
  size = 52,
  style,
}: {
  url: string;
  label: string;
  thumbnail?: boolean;
  size?: number;
  /** Overrides the full-size frame: a card's aspect ratio or corners. */
  style?: StyleProp<ViewStyle>;
}) {
  const [source, setSource] = useState<{
    uri: string;
    headers?: Record<string, string>;
  } | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSource(null);
    if (url.startsWith("/")) {
      authClient
        .getCookie()
        .then((cookie) => {
          if (active)
            setSource({
              uri: buildUrl(url),
              headers: cookie ? { Cookie: cookie } : undefined,
            });
        })
        .catch(() => {
          if (active) setFailed(url);
        });
    } else setSource({ uri: url });
    return () => {
      active = false;
    };
  }, [url]);
  return (
    <View
      style={
        thumbnail
          ? [styles.thumb, { width: size, height: size }]
          : [styles.photo, style]
      }
    >
      {settled !== url ? (
        <Skeleton width="100%" height="100%" style={StyleSheet.absoluteFill} />
      ) : null}
      {failed === url ? (
        <Text variant="caption1" tone="secondary">
          Photo unavailable
        </Text>
      ) : source ? (
        <Image
          source={source}
          accessibilityLabel={label}
          accessible={!thumbnail}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory"
          recyclingKey={url}
          onLoad={() => setSettled(url)}
          onError={() => {
            setFailed(url);
            setSettled(url);
          }}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  photo: {
    width: "100%",
    aspectRatio: 1.5,
    overflow: "hidden",
    borderRadius: 12,
  },
  thumb: { width: 52, height: 52, overflow: "hidden", borderRadius: 10 },
});

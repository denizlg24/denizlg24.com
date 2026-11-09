import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { TvCollectionScreen } from "@/features/tv/collection-screen";

export default function Collection() {
  const raw = useLocalSearchParams<Record<string, string>>();
  const { label, params } = useMemo(() => {
    const { label: name, ...rest } = raw;
    return { label: name ?? "", params: rest };
  }, [raw]);
  return <TvCollectionScreen label={label} params={params} />;
}

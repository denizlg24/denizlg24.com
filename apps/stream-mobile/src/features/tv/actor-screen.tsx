import { router } from "expo-router";
import { RotateCcw } from "lucide-react-native";
import { useMemo } from "react";
import { useActorTitles } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { TvGridPage, TvPosterGrid } from "./poster-grid";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

/** Everything in the catalogue with one actor in it, newest first. */
export function TvActorScreen({ name }: { name: string }) {
  const { lead } = useAudience();
  const result = useActorTitles(name, lead.id);
  const titles = useMemo(
    () => result.data?.pages.flatMap((page) => page.titles) ?? [],
    [result.data],
  );
  const total = result.data?.pages[0]?.total ?? 0;

  return (
    <TvGridPage
      heading={name}
      detail={
        total > 0
          ? `${total} ${total === 1 ? "film or series" : "films and series"} in the catalogue`
          : null
      }
      loading={result.isPending}
      empty={
        result.isError && !result.data ? (
          <>
            <TvText variant="heading">This didn't load</TvText>
            <TvText variant="lede" color="muted">
              We couldn't reach Stream. Check that the TV is connected to the
              internet, then try again.
            </TvText>
            <TvButton
              label="Try again"
              icon={RotateCcw}
              preferred
              loading={result.isFetching}
              onPress={() => void result.refetch()}
            />
          </>
        ) : titles.length === 0 ? (
          <>
            <TvText variant="heading">Nothing with {name} yet</TvText>
            <TvText variant="lede" color="muted">
              None of their films or series are in the catalogue at the moment.
            </TvText>
            <TvButton label="Go back" preferred onPress={() => router.back()} />
          </>
        ) : null
      }
      footer={
        result.hasNextPage ? (
          <TvButton
            label="Show more"
            loading={result.isFetchingNextPage}
            onPress={() => void result.fetchNextPage()}
          />
        ) : null
      }
    >
      <TvPosterGrid titles={titles} keyPrefix="actor" preferFirst />
    </TvGridPage>
  );
}

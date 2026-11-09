import { genreSchema } from "@repo/schemas/stream";
import { router } from "expo-router";
import { RotateCcw } from "lucide-react-native";
import { useMemo } from "react";
import { TvGridPage, TvPosterGrid } from "./poster-grid";
import { useCollection } from "./queries";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

/** The `/titles` params a collection may carry; anything else is dropped. */
const ALLOWED = ["genres", "keyword", "type", "sort", "yearFrom", "yearTo"];

/**
 * Every title matching one genre or theme, from a search suggestion: the
 * TV's version of the phone's `browse` grid.
 */
export function TvCollectionScreen({
  label,
  params,
}: {
  label: string;
  params: Record<string, string>;
}) {
  const query = useMemo(() => {
    const picked: Record<string, string> = {};
    for (const key of ALLOWED) {
      const value = params[key];
      if (value) picked[key] = value;
    }
    return picked;
  }, [params]);
  const result = useCollection(query);
  const titles = useMemo(
    () => result.data?.pages.flatMap((page) => page.titles) ?? [],
    [result.data],
  );
  const total = result.data?.pages[0]?.total ?? 0;
  const genre = genreSchema.safeParse(query.genres);
  const heading = genre.success ? genre.data : label;

  return (
    <TvGridPage
      heading={heading}
      detail={
        total > 0
          ? `${total} ${total === 1 ? "film or series" : "films and series"}`
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
            <TvText variant="heading">Nothing here yet</TvText>
            <TvText variant="lede" color="muted">
              Nothing in the catalogue matches this at the moment.
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
      <TvPosterGrid titles={titles} keyPrefix="collection" preferFirst />
    </TvGridPage>
  );
}

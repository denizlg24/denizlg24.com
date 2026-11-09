import { router } from "expo-router";
import { House, RotateCcw } from "lucide-react-native";
import { useWatchlist } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { TvGridPage, TvPosterGrid } from "./poster-grid";
import { TvShell } from "./shell";
import { TvButton } from "./tv-button";
import { TvText } from "./tv-text";

/** The lead profile's list, newest first. */
export function TvListScreen() {
  const { lead } = useAudience();
  const list = useWatchlist(lead.id);
  const titles = list.data ?? [];
  const count = titles.length;

  return (
    <TvShell section="list">
      <TvGridPage
        heading="My List"
        detail={
          count > 0
            ? `${lead.name}'s list, ${count} ${count === 1 ? "title" : "titles"}`
            : null
        }
        loading={list.isPending}
        empty={
          list.isError && !list.data ? (
            <>
              <TvText variant="heading">Your list didn't load</TvText>
              <TvText variant="lede" color="muted">
                We couldn't reach Stream. Check that the TV is connected to the
                internet, then try again.
              </TvText>
              <TvButton
                label="Try again"
                icon={RotateCcw}
                preferred
                loading={list.isFetching}
                onPress={() => void list.refetch()}
              />
            </>
          ) : count === 0 ? (
            <>
              <TvText variant="heading">{lead.name}'s list is empty</TvText>
              <TvText variant="lede" color="muted">
                Open any film or series and choose My List. It shows up here,
                and on your phone too.
              </TvText>
              <TvButton
                label="Find something on Home"
                icon={House}
                preferred
                onPress={() => router.replace("/tv")}
              />
            </>
          ) : null
        }
      >
        <TvPosterGrid titles={titles} keyPrefix="list" preferFirst />
      </TvGridPage>
    </TvShell>
  );
}

import { useCallback, useState } from "react";

/**
 * Pull-to-refresh state driven by the user's gesture only. `isFetching` would
 * also spin for background refetches the user never asked for.
 */
export function useRefresh(refetchers: ReadonlyArray<() => Promise<unknown>>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.allSettled(refetchers.map((refetch) => refetch())).finally(
      () => setRefreshing(false),
    );
  }, [refetchers]);
  return { refreshing, onRefresh };
}

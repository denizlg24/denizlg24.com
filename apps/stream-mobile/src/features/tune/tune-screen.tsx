import { createStore } from "@/lib/store";
import { EMPTY_FILTERS, type TitleFilters } from "@/lib/title-query";

/** Tune's dials, kept while the screen is away. Only the TV's Tune reads it now. */
export const tuning = createStore<TitleFilters>(EMPTY_FILTERS);

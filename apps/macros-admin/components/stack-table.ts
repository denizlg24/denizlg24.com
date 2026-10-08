/**
 * Tables that become stacked rows below `md`: one DOM, no horizontal scroll on
 * a phone. Each row turns into a five-column grid (three content-sized, one
 * flexible, one trailing) and every cell places itself with `max-md:` utilities.
 */
export const stackTable = "max-md:block";
export const stackHead = "max-md:hidden";
export const stackBody = "max-md:block";
export const stackRow =
  "max-md:relative max-md:grid max-md:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-3 max-md:gap-y-1.5 max-md:py-3";
export const stackCell = "max-md:block max-md:p-0 max-md:whitespace-normal";
/** First line: the row's title across the four leading columns. */
export const stackLead =
  "max-md:col-span-4 max-md:col-start-1 max-md:row-start-1";
/** First line, trailing: a state badge beside the title. */
export const stackLeadEnd =
  "max-md:col-start-5 max-md:row-start-1 max-md:self-start max-md:justify-self-end";
/** A full-width line of its own. */
export const stackFull = "max-md:col-span-5 max-md:col-start-1";
export const stackEnd = "max-md:col-start-5 max-md:justify-self-end";
/** On the primary link of a stacked row: the whole row becomes its target. */
export const stackRowLink =
  "max-md:after:absolute max-md:after:inset-0 max-md:after:content-['']";
/** Secondary links in a stacked row stay clickable above the row target. */
export const stackAbove = "relative z-10";

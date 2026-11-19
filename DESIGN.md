# Stockwatcher design

## Direction

A market desk with the typography and ruled sections of a financial daily. The overview opens with a prompt and examples. The dashboard appears beside the conversation after the first request. Follow-ups update the result pane while the conversation stays in place. Moving from an index to a ticker keeps its chart and research one step apart.

## Tokens

- Surfaces use parchment green `#f7f8f4`, a slightly cooler sidebar `#eff1eb`, and white panels `#ffffff`.
- Text uses `#17231c` and `#59665e`. Forest `#174e3a` identifies the primary action. Gains use `#23744f` and losses use `#ad403c`, accompanied by signed values.
- Newsreader sets the page title. Inter sets labels, text, and tabular figures.
- The layout uses 14 px panel corners, 1 px dividers, and 18 px gaps at desktop width. Values and chart controls stay close to the associated series.
- On smaller screens, panels stack, benchmarks wrap, and navigation moves into a drawer. Large tables scroll in their own container.

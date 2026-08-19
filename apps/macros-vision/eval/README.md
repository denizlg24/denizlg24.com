# Vision golden set

`manifest.json` and `images/` contain 30 real, contributor-photographed
nutrition labels from Open Food Facts. Each manifest row keeps its source URL,
product page, language, expected fields, basis, and file checksum. The set is
stratified into 20 per-100 g EU-style labels and 10 per-serving US labels; the
report tracks both formats independently.

Open Food Facts is an open project under ODbL; retain attribution when reusing
the fixtures. Refresh deliberately with `uv run python eval/fetch_golden_set.py`
and review every diff. Run the model-in-the-loop evaluation with
`uv run python eval/evaluate.py`. Interpretation-only parser tests remain in CI;
the slower model evaluation is intended for parser/model changes and scheduled
checks.

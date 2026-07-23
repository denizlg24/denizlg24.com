# vendor/

Read-only reference material for the cloud rewrite program (`plans/cloud/`).

- `deniz-cloud/` — git submodule pinned to the old self-hosted platform's `main`.
  Executing agents read the old implementation here to preserve contracts (wire
  formats, hashes, on-disk layouts) while rewriting the implementation into this
  monorepo. **Never edit anything under this directory.** Removed by plan 013.

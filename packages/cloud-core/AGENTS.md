# packages/cloud-core

## Serving and reading files

- **Never read `c.res` before `await next()` in Hono middleware.** Doing so makes
  Hono rebuild the response via `new Response(res.body, res)`, which converts a
  `Bun.file()` blob into a stream, drops `Content-Length`, forces chunked encoding
  and loses `sendfile`. Large downloads then buffer in userspace until the process
  is OOM-killed. `packages/cloud-core/src/middleware/cors.ts` exists solely because
  `hono/cors` does this.
- **Serve files as `Bun.file()` / `.slice()`, never a hand-rolled ReadableStream.**
  Measured on a 5.8 GB file to a slow client: BunFile 36 MB steady, pull-stream
  607 MB then OOM. Keep `idleTimeout: 0` in `apps/api/src/index.ts`.
- **Never read a large file with `Bun.file(path).stream()` either.** Reading a
  629 MB file grew RSS by 680 MB that `Bun.gc(true)` would not reclaim; an
  `fs.open()` descriptor read into one reused `Buffer` grew it by 3 MB. This is
  why `writeArchive` and `computeChecksum` look the way they do. Anything that
  has to pass file bytes through JS — hashing, ZIP building, copying — reads
  through a descriptor into a fixed buffer, and multi-file work (ZIP downloads)
  is staged to disk first and then served as a `Bun.file()`.

## Storage

- **Storage files must be owned by uid 1000.** The API runs unprivileged as `bun`;
  anything written as root makes deletes, renames and uploads fail with EACCES
  while reads keep working.
- **S3 buckets are directories under `<SSD>/.s3-v2` with a `bucket.json`.** A
  per-project credential is restricted to one bucket named exactly the project
  slug, and that bucket is not created at provisioning time — the first
  `CreateBucket` makes it. Wrong bucket reads as `AccessDenied`, missing bucket as
  `NoSuchBucket`.
- **Nightly tiering is two tasks, and only one is right for a deployment.**
  `tiering_pass` is the legacy mover (SSD tree ↔ flat UUID store on the HDD);
  `namespace_tiering` is the broker one (same relative path on both branches,
  moved by the privileged host service). `seedDefaultOpsTasks` seeds whichever
  matches `STORAGE_NAMESPACE_MODE` and disables an enabled legacy row on a
  broker box; `/storage/tiering` and the `/disks` panel resolve the type the
  same way. Anything new that names `tiering_pass` literally will silently do
  nothing in production once the broker cutover lands. `namespace_checksum` is
  seeded alongside the broker one, an hour earlier, and is what makes it able to
  move anything at all.
- **The broker pass only moves on the watermark.** Age and size choose *which*
  files go, never *whether* any do. Both branches carry the same path, so
  demoting off a half-empty SSD relocates data for no reason. The legacy pass
  demotes on age or size alone because HDD placement there is also the
  addressing scheme.
- **Age and size rank the batch, they no longer filter it.** They used to be
  ANDed into `selectDemotions`, which let them decide *whether* after all: a
  namespace whose big files were recent and whose old files were small stayed
  above the high watermark forever with the pass reporting nothing to do. Files
  a rule names go first (`large`, then `cold`), and the coldest of the rest fill
  the rest of the gap under `watermark`, which is the only reason that can reach
  the target on its own. `planReason` on the report row says which applied —
  distinct from `reason`, which is why a non-`moved` outcome happened.
- **Nothing tiers until `namespace_checksum` has run.** A tier move verifies the
  copy against the recorded checksum, and only an API upload writes one: an
  entry adopted from SMB is stamped `checksumState: "pending"` and stays there.
  `recordChecksum` — the one operation that reaches `verified` — had no caller at
  all, so 81% of the store was unmovable regardless of disk pressure, and
  `assign`'s comment about the projector recomputing it described work that was
  never written. The backfill hashes those rows through the broker mount with
  `computeChecksum` and stamps the xattr over the socket, so the value survives
  re-projection. `verified` on the tiering report is what separates "nothing
  needs moving" from "nothing *can* move yet". A checksum the host proves stale
  (`deferred` / `source-changed-during-copy`, which is what an SMB overwrite
  leaves behind) is cleared so the next backfill recomputes it.
- **`files.tier` is a hint in broker mode, not a fact.** The projector never
  writes it; the branch holding the path is the authority. The pass over-reads
  by `placementLookahead`, asks `tier-locate` where each path actually is, and
  repairs stale rows before selecting — otherwise one drifted row leads every
  batch forever.
- **`STORAGE_MIGRATION_MODE` and `STORAGE_RESTORE_ACTIVE` need a container
  restart.** They are read once when `storageConfigFromEnv` runs. Setting one
  mid-restore does nothing until the API bounces, so bounce it — or disable the
  task — before starting the work they are meant to guard.
- **Branch tiering ops answer UNAVAILABLE until the host declares its roles.**
  `STORAGE_SSD_BRANCH_PATH` / `STORAGE_HDD_BRANCH_PATH` on
  `apps/storage-metadata`, both or neither. Unset means the pass reports
  `blockedBy: branch-usage-unavailable` — it never reads that as an empty
  namespace. And as with every change to that service, the host binary must be
  live before the API starts calling a new op — the terminal release lands
  without approval, the API release waits for one, so pushing both together
  gives the right order.
- **`tiering_pass` is live** as of 2026-07-26: enabled, `0 3 * * *`,
  `dryRun: false`. The gate it used to sit behind — review a dry run before
  arming it — has been passed. It genuinely relocates data between physical
  disks on every run, so treat changes to `packages/cloud-core/src/storage/tiering.ts`
  and to the watermark/age/size thresholds as production changes, and rehearse
  with a dry run first (`/disks` has the button, or set `dryRun: true` on the
  task config).
- **A tiering pass that fails on individual files still reports `completed`.**
  Per-file failures land in `metadata.tieringReport.failures`, not in the run
  status, so no task-failure notification fires for them. Read the report, not
  just the status.
- **A missing source blob is no longer a failure — the pass resolves it.**
  `ENOENT` on the copy routes into `resolveMissingSource`, which reports the
  file as `vanished` (row gone or moved since the batch was listed — the
  concurrent-delete race), `healed` (a verified blob was already at the
  destination, so the row is repointed), or `orphaned` (gone from both tiers,
  so the row is deleted and dropped from Meili, and a `tiering_orphaned`
  notification fires). Reaping requires the tier root to be non-empty: an
  unmounted disk makes every blob look deleted, and that path reports a failure
  instead of emptying the `files` table.
- **`files.mime_type` is null for most of the namespace, so nothing may key a
  decision on it alone.** It comes from a protected xattr only an API upload
  writes; 81% of rows have none, and 19 more carry a bare
  `application/octet-stream` from a tus client that did not care. With `nosniff`
  on, declaring that made every image, clip and PDF written over SMB unviewable.
  `mimeTypeForFilename` in `packages/schemas/src/cloud/file-types.ts` is the one
  table both sides use — `fileResponse` to declare a Content-Type and the storage
  app's `fileKind` to pick a renderer, which is why that classifies on the
  extension first and the MIME second. `isActiveContent` runs against the
  *resolved* type, so a derived `image/svg+xml` is still forced to download.
  An unknown extension is not refused: the preview reads a bounded head and
  decides text or binary from the bytes.
- **Thumbnails are subprocesses, and the cache is derived data.**
  `packages/cloud-core/src/storage/thumbnails.ts` spawns `vipsthumbnail`
  (images, PDFs; `vips-heif` for iPhone HEIC) and `ffmpeg` (a video poster
  frame) with `nice -n 10`, two at a time, 20 s each, into
  `STORAGE_THUMBNAIL_PATH` (default `<SSD>/.thumbs`), keyed
  `<w>/<id[0..2]>/<id>-<size>-<mtime>.webp`. Never a native module: `sharp`'s
  libvips cannot decode HEVC HEIC and its heap never shrinks. The API image
  installs `vips-tools vips-heif vips-poppler ffmpeg`; without them every
  thumbnail is a logged failure and the tile shows the glyph. `thumbnail_backfill`
  (nightly, 2 000/run) and `thumbnail_gc` (weekly) are seeded at boot — their
  enum values are migration **0046**, applied by hand before the API rolls.
  Upload finalize and the projector push ids onto `storage:thumbnails:warm` in
  Redis; one worker drains it. `rm -rf` of the cache is always safe.
- **A folder created through the API is stamped on create**, and adoption
  consults the projection before minting: a row at the path inserted in the
  last 60 s lends its id (`adoptWithProjectionClaim`). Before this, the watcher
  re-minted every new folder and the id the client held answered 404 until a
  refresh. `smb-sessions` on the host socket is the only writer of
  `smb_credentials.last_authenticated_at`; the API asks for it on every device
  list and persists anything newer, so the column fills only once the
  hand-deployed host binary carries the op.

## Forge environments and branch rules

A deploy target has three kinds of slot, and `deployments.kind` names which:
`production`, `environment` (a named custom environment such as staging) and
`preview`. `resolveBranchRoute` in `packages/cloud-core/src/deploy/environments.ts`
owns the whole branch-to-slot decision — production branch first and
unconditionally, then the highest-priority matching branch rule, then a preview.

- **`kind === "production"` almost never means what it used to.** The two places
  that genuinely mean production are custom domains, which only production
  carries, and promote, which only production is the target of. Everywhere else
  — routing, DNS GC, capacity, apply-env ordering, the preview auth gate — the
  question is stable-vs-ephemeral, and `isStableDeploymentKind` is that test.
- **An environment owns a hostname, not a domain row.** `deploy_domains` stays
  production-only. An environment is reached at a generated
  `<slug>-<env>-<random>.<zone>` stored on its own row, provisioned once at
  creation. That is what keeps promoting to production a real operation.
- **A capacity slot is `(target, kind, environment)`.** Each environment is
  charged the host's memory continuously, exactly like production — that is the
  real cost of adding one on a Pi. `supersedeOlderDeployments` keys on the same
  triple: without the environment, staging going ready supersedes the live `qa`
  container.
- **The `environment` env-var scope names one environment**, through
  `environmentId`. A staging deployment resolves `all` plus its own rows and
  never production's — inheriting them would hand staging the live database.
  The same reasoning maps `kind: "environment"` onto the *preview* side of a
  resource connection's scope.
- **A custom environment is gated like a preview, not like production.** Only
  production is public; `authorizePreviewRequest` tests `kind === "production"`.
- **Adding an enum value and using it need two migrations.** Postgres allows
  `ALTER TYPE ... ADD VALUE` in a transaction but refuses to let the new value
  be used in the same one, which is why `0037` holds only the two `ADD VALUE`
  statements and `0038` holds everything that compares against `'environment'`.
- **A manual deploy no longer chooses its kind.** `POST /targets/:id/deployments`
  derives it from the branch, so deploying the `staging` branch by hand lands in
  staging. The `kind` field on the input is accepted and ignored.

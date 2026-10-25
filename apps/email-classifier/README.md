# Email classifier

A CPU-friendly seven-label email classifier built with field-aware
TF-IDF, sender categories, structural email metadata, and classical
scikit-learn estimators. No model training or inference uses a language model,
or pretrained embedding.

Labels: `spam`, `newsletter`, `promo`, `purchases`, `fyi`,
`action-needed`, and `scheduled`.

## Forge

Deploy with `apps/email-classifier` as the root directory and the Nixpacks
builder. The workspace's `nixpacks.toml` forces Python 3.12 while Forge keeps
the monorepo root as the Docker context. Use `/healthz` as the health path. The
resolved start command must therefore include the selected directory:

```sh
cd apps/email-classifier && uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}
```

## Weekly retraining

`.github/workflows/email-classifier-retrain.yml` triggers the authenticated
`POST /api/retrain` endpoint every Monday at **03:17 UTC**, and also supports
manual workflow dispatch. The workflow monitors the returned run ID until it
finishes. Training runs in a separate, single-threaded worker process on the
long-lived Forge service, with a two-hour deadline. Do not enable this on
Vercel/serverless. Use one service replica; the OS file lock serializes workers
on its persistent volume, including manual triggers and concurrent requests.

Setup before enabling the schedule:

1. Mount a persistent volume at `/data/email-classifier` in Forge. **No existing
   dataset files are required.** Leave `seed/` absent or empty to enable automatic
   recovery from reviewed email records and saved bodies in MongoDB. The first
   run starts the recovery clock; subsequent runs email progress until there
   are enough reviewed examples. Keep this volume across deployments.
2. Set the classifier's retraining variables from `.env.example`, enabling
   `EMAIL_CLASSIFIER_RETRAIN_ENABLED=true`. Copy `MONGODB_URI` and the existing
   web **`RESEND_API_KEY`** into this service's environment using your secret
   manager. Never put them in the workflow, repo, or model artifacts. No new
   Resend key is required. The sender uses the web app's existing verified
   `denizgunes@oceaninformatix.com` address.
3. Set GitHub repository variable `EMAIL_CLASSIFIER_SERVICE_URL` to the HTTPS
   service origin (without `/api/classify`) and repository secret
   `EMAIL_CLASSIFIER_API_TOKEN` to the classifier's existing API bearer token.
4. Deploy this branch's classifier, dispatch the workflow manually, and check
   `GET /api/retrain` with the same bearer token. The schedule takes effect when
   the workflow reaches the default branch.

Each run emails **denizlg24@gmail.com** at start and completion: `skipped`,
`rejected`, `promoted`, or `failed`. Notifications contain counts, model versions,
metrics, and rejection reasons, never email bodies, subjects, senders, database
URLs, or exception messages. Resend requests retry with an idempotency key.
Notification failures appear in status and fail the monitoring workflow.

### Recovering a lost dataset

Missing default seed files trigger automatic recovery, rather than a failed
run. Historical human-reviewed examples can supply training data. Validation
uses a deterministic 20% of fresh thread/content groups whose message date and
MongoDB ingestion time are both after the first recovery run. Old messages
newly synced from IMAP cannot qualify as fresh validation. Untouched predictions
are never used as ground truth, and training a model cannot reconstruct its
original examples from the saved model artifact.

Until every category has at least five training and five fresh validation
examples, and training supports grouped cross-validation, runs report `skipped`
and email counts for each category. Review both correct predictions and mistakes
across all seven categories to fill gaps. Five validation examples are a minimum,
not an accuracy guarantee. Keep using the existing deployed model while this
data accumulates; no candidate is trained or promoted during recovery.

Once ready, the worker automatically writes `seed/train.jsonl`, `seed/eval.jsonl`,
and `seed/manifest.json`, publishing the complete directory atomically. It then
continues with normal retraining. Recovery joins exact duplicates and threads
before splitting, and refuses conflicting duplicate labels. The seed and
validation membership remain frozen across later runs. Back up the volume:
losing it restarts the collection period. A separate final test set is still
needed for an independent assessment of repeated validation results.

Existing prepared seed files are still supported: place all three in `seed/`
before the first run, or use the path overrides in `.env.example`. Both splits
must cover all categories, validation needs five examples per category, and
the incumbent must not have trained on validation. Partial datasets and missing
custom paths fail explicitly rather than being silently replaced. To recover
after losing custom seed files, unset the three path overrides to use the
default persistent-volume location.

The worker reads saved email bodies and selects human recategorizations (the
existing `llmCategory` snapshot) and explicitly reviewed labels. Untouched model
predictions are not treated as ground truth. Missing, truncated, and HTML-only
bodies are excluded. At least ten eligible human examples are required.
Corrections replace matching seed training examples; conflicting duplicate
labels fail the run. Holdout IDs, groups, and exact content are excluded from
training, and the existing leakage validator runs before fitting. Seed data
should preserve the same email IDs and thread group identifiers as the live
export (`accountId:threadId`, falling back to message ID). Legacy IDs/content
matches retain their original group IDs. Never include members of a held-out
thread in seed training data.

A dataset and implementation fingerprint avoids retraining unchanged data after
a completed attempt. Failed attempts retry on the next trigger. Changes in
labels or bodies change the fingerprint, as do classifier source changes. Keep
seed training examples to retain coverage of correctly classified mail; this
is not training exclusively on recent mistakes.

Candidates use the existing grouped cross-validation trainer with logistic
regression. Both incumbent and candidate are evaluated with production policy
rules on the same frozen validation split. Automatic promotion requires:

- Macro-F1 improvement of at least **0.005**.
- No per-category F1 drop larger than **0.02**.
- No decline in `action-needed` or `scheduled` recall.
- No increase in spam false positives.

A promoted artifact is size checked, hashed, deserialized, and smoke tested
before atomically updating `active.json`. Inference workers reload it on the
next request, overriding the bootstrap model configuration and version.
`previous.json` retains the preceding pointer; the configured original model
remains the bootstrap fallback when no pointer exists. To roll back, atomically
replace `active.json` with `previous.json` (or remove `active.json` to return to
the bootstrap model). Keep the artifact referenced by each pointer. Metrics are
retained per run under `runs/`; `status.json` records the latest run and
`worker.log` contains training progress. A rejected candidate never changes the
active pointer. Back up the volume, restrict its permissions, and periodically
prune unreferenced artifacts/logs according to available disk space.

If the host is killed or restarted during training, its last status may remain
`started`; GitHub reports a monitoring timeout and the next trigger can acquire
the released OS lock. A host outage cannot send a Resend notification. Validation
improvement does not guarantee improvement on every future email; monitor real
corrections and update the validation benchmark deliberately as preferences
change.

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

The workflow `.github/workflows/email-classifier-retrain.yml` triggers authenticated
`POST /api/retrain` every Monday at **03:17 UTC**, supports manual dispatch, and
monitors the returned run ID. Training runs in a separate process on the
long-lived Forge service. **No persistent volume or existing dataset files are
required.** Do not enable training on Vercel/serverless.

### Storage and rollout

- **S3** stores immutable model versions, recovered seed datasets, exact training
  snapshots, and evaluation reports. Reuse `EMAIL_CLASSIFIER_MODEL_S3_*`; those
  credentials need get/put access under a dedicated private prefix. The bootstrap
  model's original key is never overwritten. Verification checks the uploaded
  bytes by downloading and hashing them before publishing a MongoDB pointer.
- **MongoDB** stores the current and previous model pointers, recovery cutoff,
  seed manifest, dataset fingerprints, run status/history, and the worker lease.
  It uses the web app's `MONGODB_URI`, in `emailclassifierstates` and
  `emailclassifierruns`. State is namespaced by S3 endpoint, bucket, and prefix.
  Keep this database and bucket backed up together.
- **Temporary disk** holds training files and verified model caches. Every run
  restores its seed from S3 and cleans up its scratch directory on exit. Losing
  a container does not lose completed work or reset recovery.

Configure the classifier through Forge:

1. Retain its existing S3 endpoint, region, bucket, credentials, bootstrap key,
   SHA-256, and version. Set `EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX=retraining/v1/`.
   Use a distinct prefix for a preview deployment so it cannot publish a
   production model. Inference discovers remote models whenever the prefix is
   configured, even if training is later disabled.
2. Share the web app's existing `MONGODB_URI` and `RESEND_API_KEY` with the
   classifier. No new Resend key is needed; messages use the web app's verified
   `denizgunes@oceaninformatix.com` sender.
3. Set `EMAIL_CLASSIFIER_RETRAIN_ENABLED=true`. Remove the old
   `EMAIL_CLASSIFIER_RETRAIN_DIR`, `EMAIL_CLASSIFIER_TRAIN_PATH`,
   `EMAIL_CLASSIFIER_EVAL_PATH`, and `EMAIL_CLASSIFIER_MANIFEST_PATH` overrides.
   Apply the environment in Forge. There is no volume to provision.
4. In GitHub, set repository variable `EMAIL_CLASSIFIER_SERVICE_URL` to the
   classifier's HTTPS origin (without `/api/classify`) and secret
   `EMAIL_CLASSIFIER_API_TOKEN` to its existing bearer token. The weekly schedule
   starts when the workflow reaches the default branch.
5. Merge and deploy the PR, manually dispatch **Retrain email classifier**, then
   confirm the start/completion emails and authenticated `GET /api/retrain`.
   Run the first recovery attempt promptly: its timestamp establishes when
   fresh validation collection starts.

Changing configuration alone does not install this code; deploy the updated
classifier before invoking its new endpoints. Keep inference disabled on preview
instances unless they use isolated storage/state.

### Recovery when the original dataset is lost

The first run persists a recovery cutoff in MongoDB before querying mail.
Historical human-reviewed labels can supply training examples. A deterministic
20% of fresh thread/content groups are reserved for validation, with both message
date and MongoDB ingestion time after that cutoff. Old messages newly synced from
IMAP cannot qualify as fresh validation.

Only explicit reviews and human recategorizations are evidence. Untouched model
predictions are never treated as ground truth. Missing, truncated, and HTML-only
bodies are excluded. Review both correct predictions and mistakes across all
seven categories to fill gaps.

Until each category has at least five training and five fresh validation examples,
and training supports grouped cross-validation, runs report `skipped` and email
per-category counts. Five validation examples are a minimum, not an accuracy
guarantee. The current classifier keeps serving while data accumulates. No
candidate is trained or promoted during recovery.

Once enough data exists, the worker uploads and verifies all seed files before
publishing their manifest in MongoDB. Validation membership is frozen thereafter.
Exact duplicates and threads stay together, conflicting duplicate labels fail,
and the existing leakage validator checks the training/evaluation boundary.
Corrections replace matching training examples; validation IDs, content, and
known groups are excluded from training. A separate final test set is still
needed for an independent assessment of repeated validation results.

### Evaluation and promotion

A dataset/source fingerprint skips unchanged completed attempts. Failed attempts
retry on the next trigger. The existing trainer selects logistic regression
parameters through grouped cross-validation. Both incumbent and candidate are
evaluated with production policy rules on the same frozen validation benchmark.
Promotion requires:

- Macro-F1 improvement of at least **0.005**.
- No per-category F1 drop larger than **0.02**.
- No decline in `action-needed` or `scheduled` recall.
- No increase in spam false positives.

The candidate is size checked, hashed, deserialized, smoke tested, and uploaded
under a new immutable key. A MongoDB update changes the active pointer only after
upload verification and only while the worker owns its lease. The previous pointer
is retained. Failed uploads and rejected candidates leave the incumbent in place.
An interrupted upload can leave an unreferenced object; it cannot become active.

Inference polls MongoDB every 30 seconds and downloads changed models into a
checksum-verified local cache. Warm processes retain their last loaded model
through storage outages; cold starts can fall back to the configured bootstrap
model and retry discovery. Cache loss just causes a new download.

### Concurrency, status, and rollback

A server-time MongoDB lease serializes workers across processes, replicas, and
redeployments. The lease expires after 135 minutes; the worker has a two-hour
execution deadline. Every state mutation is fenced by its owner and unexpired
lease, so an expired worker cannot publish a model or overwrite a newer run.
Host crashes leave the lease until expiry; status then reports `failed` with
`WorkerLeaseExpired`, and another trigger can proceed. No TTL deletion of the
state document is used.

Each run emails **denizlg24@gmail.com** at start and completion: `skipped`,
`rejected`, `promoted`, or `failed`. Messages include counts, metrics, model
versions, and reasons, never email contents or credentials. Resend retries use
idempotency keys. Terminal status is published after notification delivery is
attempted, so the monitoring workflow can reliably detect notification failures.
A host/database outage cannot guarantee delivery; GitHub monitoring reports a
failed run or timeout.

Use authenticated **`POST /api/retrain/rollback`** to switch to the previous
verified model (or back to the configured bootstrap model after the first
promotion). It refuses rollback while a training lease is active or if another
update wins the race. The CLI equivalent inside the service is
`python -m email_classifier.retrain --rollback`. Inference observes the rollback
within its 30-second polling interval. Keep all referenced S3 objects; prune
only unreferenced old artifacts according to your retention policy.

Validation improvement cannot guarantee better results on every future email.
Monitor corrections and revise the benchmark deliberately as preferences change.

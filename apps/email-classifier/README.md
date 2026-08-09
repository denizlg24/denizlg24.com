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
the monorepo root as the Docker context. The start command is:

```sh
uvicorn main:app --host 0.0.0.0 --port ${PORT:-3000}
```

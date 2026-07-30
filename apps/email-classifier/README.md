# Email classifier

A CPU-friendly seven-label email classifier built with field-aware
TF-IDF, sender categories, structural email metadata, and classical
scikit-learn estimators. No model training or inference uses a language model,
or pretrained embedding.

Labels: `spam`, `newsletter`, `promo`, `purchases`, `fyi`,
`action-needed`, and `scheduled`.

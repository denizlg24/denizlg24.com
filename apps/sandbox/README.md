# sandbox

The agent's code sandbox. **Scaffold only — nothing executes code yet.**

## Why it exists

The eight sandbox tools (`sandbox_write_files`, `sandbox_run_command`,
`sandbox_read_file`, `sandbox_list_files`, `sandbox_port_url`, `sandbox_stop`,
plus `import_sandbox_spreadsheet` and `upload_sandbox_file`) ran on Vercel
Sandbox. That authenticated with a `VERCEL_OIDC_TOKEN` the Vercel runtime
injected; nothing injects it on Forge, so every call has failed since the move
off Vercel. `apps/web/lib/sandbox.ts` reports it correctly and the capability
behind it is simply gone.

This app is the replacement. It runs on Forge rather than the Pi: model-authored
code wants memory and CPU, and the Pi is serving the databases.

## State

`/healthz` answers. Every other route answers 501 naming what is missing. The
wire contract in `src/contract.ts` is settled — it reproduces what the tools
already expect — so the caller can be pointed here without renegotiating shapes.

## Before implementing

Settle isolation first. `FORWARDED_ENV_KEYS` in `apps/web/lib/sandbox.ts`
forwards `MONGODB_URI`, `DATABASE_URL`, `REDIS_URL`, the S3 access key and
secret, and `CLOUD_API_TOKEN` into every sandbox, and the agent's system prompt
tells the model the environment holds live production credentials. Handing that
set to arbitrary generated code is a decision to make deliberately: a read-only
replica URI and a bucket-scoped S3 credential would narrow it considerably.

The other open question is the execution boundary itself — a container per
conversation with CPU and memory caps is the obvious shape, but "obvious" is not
"safe", and this box also runs Forge.

Background: `docs/internal/plans/019-ui-ux-fixes-sep5.md`, section B10.

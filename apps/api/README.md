# Cloud API

A Hono API on Bun that serves the self-hosted cloud: authentication, the
storage namespace and its S3-compatible surface, the project platform, and the
superuser operations plane. It runs on the Raspberry Pi in a container, and it
is the API the cloud, storage and Forge dashboards consume.

## Surfaces

| Prefix | What it serves |
| --- | --- |
| `/api/auth/*` | Better Auth, the pending-user signup flow and two-factor enrolment |
| `/api/storage/*`, `/api/search` | The storage namespace and its search index |
| `/v2` | Path-style S3-compatible API, resolving credentials from the database |
| `/api/projects/*` | Project provisioning and the databases handed to project clients |
| `/api/db/postgres/*`, `/api/db/mongodb/*` | Strict-superuser database inspection |
| `/api/forge-preview-auth` | Forward-auth target for Forge preview hostnames |
| `/api/ops/*` | Superuser-only operations plane |
| `/healthz` | Public health, outside the API prefix |

Endpoints are protected by either a human session or a scoped API key.

Provisioning uses admin database connections, while the Mongo sync worker
deliberately runs on the lower-privilege connection — the worker's job does not
need administrative rights, and giving it any would widen the blast radius of a
sync bug.

Preview authentication accepts a superuser session or a deployment-scoped share
grant, which is what lets a preview deployment be shared without making it
public.

## Operations plane

- `overview` and `metrics` expose current and historical host, disk, network
  and container telemetry. The runtime samples every 30 seconds; raw rows are
  retained for at least 24 hours and a rollup task keeps aggregates for 90 days.
- `tasks` manages cron and one-off executors and retains run logs.
- `containers` lists and restarts containers through a constrained Docker
  proxy. The API never mounts the raw Docker socket.
- `health` aggregates PostgreSQL, MongoDB, search, Redis, disk headroom and
  optional tunnel readiness.
- `terminal` mints a short-lived, single-use ticket; the websocket route
  validates it independently before proxying to the host terminal service,
  which is never published.
- `tools/*` reverse-proxies the database administration interfaces for the
  admin UI, superuser only.

## Configuration

The API is configured entirely through the environment. Beyond the database,
cache, search and storage connection values, three secrets carry existing data
and cannot be rotated casually: the JWT secret signs storage share links, and
two separate encryption keys protect project database credentials and stored S3
credentials. Authentication and encryption secrets must be at least 32 bytes.

Other values configure the addresses returned to project clients, the operations
plane's device and backup paths, the Docker proxy endpoint, the reboot sentinel
path, optional notification and health-probe URLs, and the terminal service
endpoint with its shared ticket secret.

Legacy shared S3 credentials, if configured, are idempotently migrated at
startup into a full-access row not scoped to any project; startup fails on a
collision or a changed secret rather than overwriting one.

## Development

```sh
bun run cloud:dev:infra                        # shared dev services
bun --env-file=.env run --cwd apps/api dev     # the API
```

Tests that need real infrastructure — provisioning, crash resume, sync,
metrics, executors and the backup and rollup paths — are opt-in behind an
environment flag so the default test run stays hermetic. The development
compose file exposes only the constrained Docker proxy, on loopback. Separate
smoke harnesses exercise the S3 and resumable-upload surfaces against a running
instance and take their own configuration.

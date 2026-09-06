# sandbox

Conversation-scoped TypeScript/JavaScript and Python execution for the agent.
The API is a trusted control plane; generated code runs only in short-lived OCI
containers and never in the API process.

## Isolation boundary

Production requires a hardened OCI runtime such as gVisor (`runsc`). The service
refuses `runc` when `NODE_ENV=production`. Each conversation gets one container
with:

- no network namespace and no production credentials;
- no host bind mounts or Docker socket;
- a read-only root filesystem and disposable 512 MB `/workspace` tmpfs;
- all Linux capabilities dropped plus `no-new-privileges`;
- fixed CPU, memory, process, file-descriptor, output and wall-clock limits;
- uid 1000, an init process, no restart policy, and a maximum 60-minute TTL.

The controller needs access to a Docker-compatible API to create the child
containers. It must point at a dedicated rootless Docker daemon owned by an
unprivileged `sandbox-runner` account, or at a dedicated worker VM. Never mount
the Forge host's system Docker socket: access to that socket is host-root access.
The child containers never see either daemon. On a shared Forge host, the
rootless daemon, `runsc`, and the network/mount restrictions above are all
mandatory.

**A rootless daemon needs `runsc` wrapped to enforce any limit at all.**
`runsc` links only go-systemd's system-bus constructors, so creating a
container's cgroup hits polkit and fails with `Interactive authentication
required`; the cgroupfs driver fails too, because `runsc` writes the *root*
`cgroup.subtree_control` no matter which parent it is given. Its only working
mode is `--ignore-cgroups`, under which no cgroup is created and `--memory`,
`--memory-swap`, `--cpus` and `--pids-limit` are accepted and silently ignored.
So the daemon's `runsc` runtime must point at a wrapper that puts each `create`
in a transient `systemd-run --user --scope` carrying the limits read out of the
OCI bundle — the user manager makes that scope on the session bus, where polkit
does not apply, and the processes `runsc` forks inherit its cgroup. On Forge
that is `/usr/local/bin/runsc-scoped`. Point `runtimes.runsc.path` straight at
`/usr/bin/runsc` and every limit above becomes decorative.

`/healthz` checks the daemon, rootless mode, configured runtime, and runtime
image. It returns 503 instead of letting Forge mark a non-executing deployment
ready. `SANDBOX_REQUIRE_ROOTLESS=false` is only appropriate when the daemon is
inside a dedicated disposable worker VM.

Port 3000 previews stay inside the network-less child. The controller fetches
them with a fixed helper and returns a five-minute signed URL on the sandbox's
dedicated origin with a restrictive CSP. This supports ordinary HTTP previews;
WebSockets and streaming responses are intentionally unsupported.

## Runtime

Build and publish `runtime.Dockerfile`, then set `SANDBOX_RUNTIME_IMAGE` to an
immutable digest and pull that digest into the sandbox daemon. Bun executes
`.js`, `.jsx`, `.ts`, and `.tsx` files directly;
`python3` executes Python. The image includes `pip` and `venv`, but the default
network policy is offline, so add libraries to the image rather than allowing
unrestricted package-manager egress.

## Configuration

`SANDBOX_API_TOKEN` is a random 32-byte-or-longer shared secret used by the web
app and controller. `SANDBOX_API_URL` is the internal control URL;
`SANDBOX_PUBLIC_URL` is a dedicated browser-preview origin. Resource controls
are in `.env.example`. `SANDBOX_DOCKER_HOST` is mandatory in production and is
passed explicitly on every Docker CLI call, so the controller cannot inherit
Forge's general `DOCKER_HOST`; the system socket is rejected.

The eight tools are registered only when both the URL and token are set. The
web client no longer imports `@vercel/sandbox` and no database, Redis, S3, or
cloud token is forwarded into generated code.

## Local verification

Build the runtime, opt into ordinary Docker only for local development, then run
the app with a long random token:

```sh
docker build -f apps/sandbox/runtime.Dockerfile -t denizlg24/sandbox-runtime:local .
SANDBOX_API_TOKEN=development-token-at-least-32-characters \
SANDBOX_CONTAINER_RUNTIME=runc bun run --cwd apps/sandbox dev
```

`runc` is accepted only outside production. A production smoke test must also
verify that the daemon has `runsc` installed before enabling the tools.

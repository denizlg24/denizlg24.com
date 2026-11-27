# apps/terminal — web-terminal daemon

## Deployment

- **The terminal binds loopback or the Tailscale address, never a public one**, and
  runs as root only with `TERMINAL_ALLOW_ROOT=1`. It is a compiled binary
  (`bun build --compile --target=bun-linux-arm64`) installed at
  `/usr/local/bin/cloud-terminal`, shipped by `release-cloud-terminal.yml` on
  every push to `main` that touches `apps/terminal`, `apps/storage-metadata`,
  `cloud-core`, `schemas` or the lockfile.

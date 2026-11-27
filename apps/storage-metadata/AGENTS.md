# apps/storage-metadata — host metadata service

## Release and restarts

- **`apps/storage-metadata` rides `release-cloud-terminal.yml` with the terminal, and its ordering matters.**
  It is a compiled binary at `/usr/local/bin/cloud-storage-metadata` under
  `deniz-cloud-storage-metadata.service`; the workflow installs it and restarts
  the unit while preserving the storage boundary target. It needs no approval,
  whereas the `Release cloud API` workflow's **Deploy to Pi job waits on a manual
  environment approval** — so a push that changes both lands the host binary
  first, which is the order a new socket op needs. Because the API keeps working
  against an old service, nothing reports a metadata release that failed: check
  the workflow, not `/healthz`. For a hotfix without a push: `bun run build:pi`,
  then `dd` the binary over (a shell `cat` corrupts it), `install -m 0755`,
  `systemctl restart`.
- **Restarting the metadata service takes the whole storage boundary down.**
  `deniz-cloud-storage.target` `Requires=` it, so a restart stops the target,
  and a restart whose start fails leaves it stopped: `Restart=` brings metadata
  back alone, and the watchdog only waits for the target, never starts it. On
  2026-10-01 that left the API crash-looping on the broker witness for 2.5 h.
  The workflow therefore installs and restarts only binaries whose bytes
  changed (the build is reproducible), starts the target again whenever it was
  up before, even when the metadata restart fails, and fails verification if
  metadata runs under a stopped target. When restarting by hand, follow it with
  `systemctl start deniz-cloud-storage.target`.

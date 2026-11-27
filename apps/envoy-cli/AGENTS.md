# Envoy CLI (`envy`)

## Release ownership

- Do not restore subtree sync. `apps/envoy-cli` is maintained directly here,
  and the nested standalone-repository workflows were removed.
- CLI releases use `envoy-v<version>` tags so they cannot collide with tags for
  other applications in the monorepo.
- The updater and installers read releases from `denizlg24/denizlg24.com`.
- A release starts when the version in `apps/envoy-cli/Cargo.toml` changes on
  `main`; update `Cargo.lock` in the same change.
- Before archiving `denizlg24/envoy`, publish one final release there containing
  a build with the new update endpoint. Older installed binaries only poll that
  repository and otherwise cannot discover the monorepo release feed.

# CI and releases

## Pull requests

`.github/workflows/ci.yml` runs a small change selector on every pull request and
push to `main`. It runs JavaScript build, typecheck, tests, and Biome only for
JavaScript workspace changes; migration checks for Macros database changes;
Python checks for `apps/macros-vision` and `apps/email-classifier`; Rust checks
for `apps/envoy-cli`; Go checks for `apps/ssh-server`; Python syntax checks for
the sandbox runtime; and `actionlint` for workflow changes. A missing diff base
runs all checks.
JavaScript build, typecheck, and tests use Turborepo's affected-package scope;
root configuration and lockfile changes run every package. The Tectonic cache
and warmup run only when the web package is affected. Biome still checks the
whole repository when the JavaScript job runs.

The selector also validates release workspace dependencies. When a new
workspace dependency is added to the API or markets relay, update its Dockerfile
manifest and source copies. Release path filters checked here must
cover their transitive runtime workspaces, root `package.json`, and `bun.lock`.
The check covers the API, relay, terminal, storage metadata, and deploy-agent
releases and fails CI if an input is missing.

`macros-mobile.yml` builds native apps on relevant pull requests. On `main`, it
runs for a version change in `apps/macros-mobile/package.json`; a device approval
dispatch builds only the ad hoc iOS variant. Signing and publication remain in
the `macros-release` environment. One Linux job typechecks and tests the mobile
code and shared domain logic before any native build starts.

## Container releases

`release-cloud.yml`, `release-markets-relay.yml`, and
`release-sandbox-runtime.yml` call `build-image.yml`. The shared workflow builds
amd64 and arm64 on native GitHub runners, pushes architecture tags, runs each
image on its matching runner, and publishes the commit SHA manifest only after
both checks pass. It then updates `latest`. Each image and architecture has a
separate GHCR BuildKit cache tag (`buildcache-amd64` and `buildcache-arm64`).
Cache export errors do not block a verified image release.

The API and markets relay Dockerfiles install only their workspace dependency
trees. They copy all workspace manifests for Bun 1.3.3 compatibility before
copying service source files, so source-only edits reuse the dependency layer.
The build still uses the committed `bun.lock` with `--frozen-lockfile`.

To deploy a previous API or relay image, manually run its release workflow with
the full 40-character commit SHA in `image_tag`. The shared build workflow
checks that the existing tag has both release architectures before skipping the
build. Set `mode` to `validate` to exercise the tailnet, asset copy, image pull,
and Compose render without starting containers.

## Local validation

From the repository root:

```sh
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
python3 scripts/ci/check_release_workspaces.py
actionlint -shellcheck= .github/workflows/*.yml
git diff --check
```

`actionlint` omits ShellCheck because existing release-note scripts contain
style warnings; shell scripts in DR have a separate ShellCheck gate.

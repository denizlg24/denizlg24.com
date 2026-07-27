# Envoy

Envoy is encrypted, Git-style version control for environment files. It lets
individuals and teams synchronize `.env` files without committing plaintext
secrets to Git or trusting the storage service with encryption keys.

[Website](https://envoy.denizlg24.com) ·
[CLI documentation](../envoy-cli) ·
[crates.io](https://crates.io/crates/envoy-cli)

## What Envoy provides

- Local encryption before any data leaves the machine
- Familiar add, diff, commit, log, push, and pull workflows
- Redacted diffs that show changed variable names without revealing values
- Encrypted, content-addressed blob and commit storage
- Project membership and per-file access controls
- GitHub authentication for remote projects
- Non-interactive CLI inputs for CI and agent workflows

## How it works

The `envy` CLI manages files and cryptographic material locally. The Envoy
service stores encrypted blobs, commit history, project membership, and access
policies. Plaintext secret values and project passphrases are never sent to the
service.

```text
.env files
    ↓ encrypt locally
envy CLI
    ↓ encrypted blobs and commits
Envoy service
```

Each managed file has an independently derived key. Commits refer to encrypted
manifests and content-addressed blobs, allowing Envoy to synchronize history
without learning the contents of a file.

## Get the CLI

```bash
cargo install envoy-cli
```

Prebuilt installers and the complete command reference are available in the
[Envoy CLI documentation](../envoy-cli).

## Security model

Envoy treats the remote service as untrusted:

- Encryption and decryption happen locally.
- Project keys and file keys remain on the client.
- Files use authenticated encryption.
- The server stores ciphertext, hashes, membership, and access metadata.
- Restricted files are available only to the owner and explicitly granted
  project members.

The detailed cryptographic design is documented in
[IMPLEMENTATION_SECURITY.md](../envoy-cli/docs/IMPLEMENTATION_SECURITY.md).

## Source

The public service and API live in this directory. The Rust client lives in
[`apps/envoy-cli`](../envoy-cli), and their shared, versioned wire-contract
fixtures live in [`apps/envoy-cli/contracts`](../envoy-cli/contracts).

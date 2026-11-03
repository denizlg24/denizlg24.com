# syntax=docker/dockerfile:1.7

# The image every sprint run executes in: Claude Code plus what a repository's
# own typecheck and tests usually need. The root filesystem is mounted
# read-only; the worktree, /out, /tmp and the bun cache are the writable parts.
# Bumping Claude Code is a deliberate image release, and the runner pins this
# image by digest.
FROM debian:trixie-slim

# The monorepo's pinned Bun (root package.json `packageManager`).
ARG BUN_VERSION=1.3.14
ARG NODE_MAJOR=24
# Exact, never a range: stream-json shapes and CLI flags are what the runner
# parses, and harness/claude-code.ts names the same version.
ARG CLAUDE_CODE_VERSION=2.1.317

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git gnupg iptables jq python3 \
    python3-venv ripgrep unzip xz-utils \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs gh \
  && rm -rf /var/lib/apt/lists/*

RUN case "$(dpkg --print-architecture)" in \
      amd64) bun_arch=x64 ;; \
      arm64) bun_arch=aarch64 ;; \
      *) echo "unsupported architecture" >&2; exit 1 ;; \
    esac \
  && curl -fsSL -o /tmp/bun.zip \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip" \
  && unzip -q /tmp/bun.zip -d /tmp \
  && install -m 0755 "/tmp/bun-linux-${bun_arch}/bun" /usr/local/bin/bun \
  && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && rm -rf /tmp/bun.zip "/tmp/bun-linux-${bun_arch}"

RUN npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && npm cache clean --force

# The run token lives in /run/creds/github-token and is rewritten while a run
# lasts; git and gh read it on every call instead of holding a copy.
COPY --chmod=0555 apps/agent-runner/runtime/git-credential-sprint /usr/local/bin/git-credential-sprint
COPY --chmod=0555 apps/agent-runner/runtime/gh /usr/local/bin/gh
COPY --chmod=0444 apps/agent-runner/runtime/gitconfig /etc/gitconfig

RUN groupadd --gid 1000 agent \
  && useradd --uid 1000 --gid 1000 --home-dir /tmp/home --no-create-home --shell /bin/bash agent

ENV HOME=/tmp/home \
  BUN_INSTALL_CACHE_DIR=/cache/bun \
  DISABLE_AUTOUPDATER=1

USER 1000:1000
WORKDIR /tmp
CMD ["sleep", "infinity"]

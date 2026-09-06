# syntax=docker/dockerfile:1.7

# Credential-free execution image. Bun executes JavaScript and TypeScript
# directly; CPython covers Python. The root filesystem is mounted read-only and
# only /workspace and /tmp are writable at runtime.
FROM oven/bun:1.4.0-debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates coreutils python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY --chmod=0555 apps/sandbox/runtime/sandbox-file.py /usr/local/bin/sandbox-file
COPY --chmod=0555 apps/sandbox/runtime/sandbox-http.py /usr/local/bin/sandbox-http

WORKDIR /workspace
USER bun
CMD ["sleep", "infinity"]

#!/bin/bash
# Build script for Linux binary

set -e

echo "Building Linux binary..."
echo ""

# Detect current architecture
ARCH=$(uname -m)

if [ "$ARCH" = "x86_64" ]; then
    TARGET="x86_64-unknown-linux-gnu"
elif [ "$ARCH" = "aarch64" ]; then
    TARGET="aarch64-unknown-linux-gnu"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

echo "Target: $TARGET"
echo ""

# Add target
rustup target add "$TARGET"

# Build
cargo build --release --target "$TARGET"

echo ""
echo "✓ Linux binary created at: target/$TARGET/release/envy"

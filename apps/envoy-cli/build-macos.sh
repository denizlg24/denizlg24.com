#!/bin/bash
# Build script for macOS binaries (Intel and Apple Silicon)
# Must be run on macOS!

set -e

echo "Building macOS binaries..."
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ Error: This script must be run on macOS!"
    echo ""
    echo "Cross-compiling to macOS from Linux/Windows is not supported."
    echo ""
    echo "Options:"
    echo "  1. Run this script on a Mac"
    echo "  2. Use GitHub Actions (automatic on release)"
    echo "  3. Push a tag: git tag v0.1.0 && git push --tags"
    echo ""
    exit 1
fi

# Detect current architecture
CURRENT_ARCH=$(uname -m)

# Add targets
echo "Adding Rust targets..."
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin

# Build for Intel
echo ""
echo "Building for Intel (x86_64)..."
cargo build --release --target x86_64-apple-darwin

# Build for Apple Silicon
echo ""
echo "Building for Apple Silicon (aarch64)..."
cargo build --release --target aarch64-apple-darwin

echo ""
echo "✓ Binaries created:"
echo "  Intel:         target/x86_64-apple-darwin/release/envy"
echo "  Apple Silicon: target/aarch64-apple-darwin/release/envy"
echo ""

# Optional: Create universal binary
if command -v lipo &> /dev/null; then
    echo "Creating universal binary..."
    mkdir -p target/universal-apple-darwin/release
    lipo -create \
        target/x86_64-apple-darwin/release/envy \
        target/aarch64-apple-darwin/release/envy \
        -output target/universal-apple-darwin/release/envy
    echo "✓ Universal binary: target/universal-apple-darwin/release/envy"
fi

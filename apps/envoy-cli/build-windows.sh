#!/bin/bash


set -e

echo "Building Windows binary..."


if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
    echo "MinGW toolchain not found. Installing..."
    

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get &> /dev/null; then
            echo "Installing via apt..."
            sudo apt-get update
            sudo apt-get install -y mingw-w64
        elif command -v dnf &> /dev/null; then
            echo "Installing via dnf..."
            sudo dnf install -y mingw64-gcc
        elif command -v pacman &> /dev/null; then
            echo "Installing via pacman..."
            sudo pacman -S --noconfirm mingw-w64-gcc
        else
            echo "Error: Could not detect package manager. Please install mingw-w64 manually."
            exit 1
        fi
    else
        echo "Error: This script is for Linux only. Use GitHub Actions for automated builds."
        exit 1
    fi
fi

echo "Adding Rust Windows target..."
rustup target add x86_64-pc-windows-gnu

echo "Building..."
cargo build --release --target x86_64-pc-windows-gnu

echo ""
echo "✓ Windows binary created at: target/x86_64-pc-windows-gnu/release/envy.exe"

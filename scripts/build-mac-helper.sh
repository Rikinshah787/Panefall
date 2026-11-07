#!/usr/bin/env bash
# Compiles the macOS window tracker into build/bin/panefall-window-tracker.
# Builds a universal binary (Apple silicon + Intel) and skips work when it is up to date.
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build:helper: not on macOS, skipping"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/native/mac/WindowTracker.swift"
OUT_DIR="$ROOT/build/bin"
OUT="$OUT_DIR/panefall-window-tracker"
mkdir -p "$OUT_DIR"

if [[ -x "$OUT" && "$OUT" -nt "$SRC" ]]; then
  echo "build:helper: up to date"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos11" "$SRC" -o "$TMP/tracker-$arch"
done
lipo -create "$TMP/tracker-arm64" "$TMP/tracker-x86_64" -output "$OUT"
chmod +x "$OUT"
echo "build:helper: built $OUT"

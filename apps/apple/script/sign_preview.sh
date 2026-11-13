#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/build/macos/Build/Products/Debug/TRLKA.app"
# Xcode's Debug/Preview libraries need inside-out signatures before the app.
# This is an ad-hoc local preview signature, not Developer ID distribution.
for library in "$APP/Contents/MacOS/"*.dylib; do
  if [[ -f "$library" ]]; then codesign --force --sign - "$library"; fi
done
for framework in "$APP/Contents/Frameworks/"*.framework; do
  if [[ -d "$framework" ]]; then codesign --force --sign - "$framework"; fi
done
codesign --force --sign - --entitlements "$ROOT/Configuration/macOS.entitlements" "$APP"
codesign --verify --deep --strict "$APP"

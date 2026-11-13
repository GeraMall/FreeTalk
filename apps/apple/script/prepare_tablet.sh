#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
pnpm install --frozen-lockfile
node scripts/android/export-native-translations.mjs --apple
TRLKA_TABLET_PLATFORM=ios pnpm --filter @freetalk/desktop exec vite build --config vite.android-tablet.config.ts
test -s apps/apple/build/tablet/android-tablet.html

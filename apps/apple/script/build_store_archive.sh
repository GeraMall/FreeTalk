#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'App Store archives require macOS and Xcode.' >&2; exit 1; }
[[ "${DEVELOPMENT_TEAM:-}" =~ ^[A-Z0-9]{10}$ ]] || { echo 'Set DEVELOPMENT_TEAM to your Apple Developer team ID.' >&2; exit 1; }
sdk="$(xcrun --sdk iphoneos --show-sdk-version)"
[[ "${sdk%%.*}" -ge 26 ]] || { echo 'Select Xcode 26 or later.' >&2; exit 1; }

bash script/prepare_tablet.sh
xcodegen generate --spec project.yml
archive="$PWD/build/TRLKA-AppStore.xcarchive"
[[ ! -e "$archive" ]] || { echo "Archive already exists at $archive." >&2; exit 1; }
xcodebuild -project TRLKA.xcodeproj -scheme TRLKA-iOS -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" CODE_SIGN_STYLE=Automatic archive
app="$archive/Products/Applications/TRLKA.app"
codesign --verify --deep --strict "$app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")" = com.trlka.ios
test -f "$app/PrivacyInfo.xcprivacy"
echo "Signed archive for Xcode Organizer: $archive"

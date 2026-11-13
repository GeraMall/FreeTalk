#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == Darwin ]] || { echo 'Build requires macOS and Xcode.' >&2; exit 1; }
command -v xcodegen >/dev/null || { echo 'Install XcodeGen: brew install xcodegen' >&2; exit 1; }
bash script/prepare_tablet.sh
xcodegen generate --spec project.yml
xcodebuild -project TRLKA.xcodeproj -scheme TRLKA-iOS -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build/ipa-device \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO ENABLE_DEBUG_DYLIB=NO \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
APP="$ROOT/build/ipa-device/Build/Products/Release-iphoneos/TRLKA.app"
test -f "$APP/Info.plist"
test -x "$APP/TRLKA"
STAGING="$(mktemp -d "$ROOT/build/ipa-stage.XXXXXX")"
mkdir "$STAGING/Payload"
ditto "$APP" "$STAGING/Payload/TRLKA.app"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")"
IPA="$ROOT/build/TRLKA-$VERSION-iOS-unsigned.ipa"
if [[ -e "$IPA" ]]; then echo 'Output already exists; move it before rebuilding.' >&2; exit 1; fi
(cd "$STAGING" && /usr/bin/zip -qry "$IPA" Payload)
python3 script/verify_ipa.py "$IPA"
shasum -a 256 "$IPA" > "$IPA.sha256"
echo "Unsigned IPA for local re-signing: $IPA"

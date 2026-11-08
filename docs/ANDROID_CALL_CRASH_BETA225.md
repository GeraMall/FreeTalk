# Android beta225 — packaged call startup crash

## Reproduction and cause

The exact private beta224 APK was installed on the dedicated Android16 emulator.
Debug native media startup succeeded (three create/close cycles), but the minified
release APK crashed when the WebRTC library loaded. A pure Java instrumentation
probe was used so the release test did not depend on obfuscated Kotlin/debug-only
app classes. The original APK produced:

```text
ClassNotFoundException: org.jni_zero.JniInit
jni_zero.cc:38 Failed to find class org/jni_zero/JniInit
Fatal signal 4 ... libjingle_peerconnection_so.so ... JNI_OnLoad
```

R8's `usage.txt` showed `org.jni_zero.JniInit` and `JniUtil` removed. The WebRTC144
AAR contains those native-referenced classes but no consumer ProGuard rules. The
existing `org.webrtc.**` keep rule did not cover the separate JNI Zero package.
This native fatal error cannot be caught by the Kotlin startup `runCatching`.

## Change

- Preserve `org.jni_zero.**` classes/members alongside the existing WebRTC rule.
- Android only: versionCode225 / versionName0.4.0-beta.225. Desktop/web stay224.
- Add actual foreground-service + NativeCallMedia startup/close/restart coverage.
- Add `WebRtcReleaseProbe` in the **test APK only**. It can run against the same-key
  minified app and validates native library loading, audio factory, peer creation,
  mute/unmute and an audio SDP offer. The optional `callProbeRunner` Gradle property
  changes only the test runner, with the normal AndroidJUnitRunner as default.
- `scripts/android/verify-webrtc-jni.py` verifies real DEX class definitions. It
  rejects the original224 APK and accepts225. Run it for future Android releases.

The runtime application change is the R8 keep rule, not an audio-engine rewrite.
No service/API/schema/DNS/HA updates or Windows/Mac changes are required.

## Verification

Source of packaged app: `1748ec5` (runtime fix `3189242`).

- 31 JVM tests, seven emulator UI/native tests: passed.
- Debug native service/media created, closed and restarted three times.
- Release R8/packaging/lint: passed; lint0errors/36warnings/6hints.
- Three native startup/audio-peer/SDP probes against the exact release225 APK:
  passed; no new crash-buffer entries.
- Direct replacement of the original release224 by release225 succeeded, same
  package UID and same signing certificate; no uninstall was used.
- Four ABIs retained; SDK29–36. All31 tablet/translation assets compared bytewise
  by SHA256 against224 and remained unchanged (asset rebuild intentionally skipped).
- A physical phone call, microphone/Bluetooth quality and actual two-party network
  media are **not** certified by these emulator startup checks. User phone retest
  remains required; do not claim every Android call issue is resolved.

## Private artifact

`outputs/android/beta225-preview/Trlka_0.4.0-beta.225_android.apk`

- Size:55,748,972bytes.
- SHA256:`eaaa984490b3c7a2321395d7620aa1caee3e59758f68f62baa54cffa3faab6b6`.
- CertificateSHA256:
  `0e976d57328c2101de52de7cf24c7c15c8ea8b18ce881bcd8f553020d42ba88c`.
- Machine-readable evidence:`outputs/android/beta225-preview/verification.json`.
- Root-cause and final logs:`outputs/doc-review/android225-*`.

This is a private replacement APK, not a public Android rollout or Play signing
migration. Preserve the development key for upgrades; do not change application ID.

To run the release probe: build `assembleDebugAndroidTest` with
`-PcallProbeRunner=io.freetalk.probe.WebRtcReleaseProbe`, install the **release** APK
and the same-key test APK, grant microphone permission on the dedicated emulator,
then run `am instrument -w io.freetalk.mobile.test/io.freetalk.probe.WebRtcReleaseProbe`.
Success requires `nativeCallStartup=passed`; instrumentation exit0 alone is not
sufficient because Android can return0 even after a process crash.

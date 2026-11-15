# Android beta.230: shared mobile settings

The Android settings screen now bundles the actual React `SettingsPanel` and the same seven style sheets used by mobile web. The profile, audio, interface, video/sounds, devices, recording preferences, chats and About pages no longer have separate Compose designs. The rest of the application and calls remain native.

Profile editing, image preparation and previews, account sessions, password actions, theme synchronization, languages, cache, diagnostics, Android file pickers and the microphone sample use a restricted Kotlin bridge. Session tokens never enter the settings page. Its network access is limited to bundled assets and public profile images; authenticated account operations use the existing native API client. API errors preserve their codes. Pending replies carry a page ID so a language reload cannot apply an old result to a new request.

The bridge validates endpoint paths, methods, settings fields, ranges and image data. The preview fixture is available only in debug builds. The loader remains until React has laid out the screen and WebView confirms a rendered frame; a renderer failure offers a fresh view. File and permission requests are cancelled when the screen closes.

Audio preferences are applied to the native engine: input/output, gain, echo/noise processing, typing attenuation and microphone transmission modes. VAD and the hold-to-talk control gate PCM before WebRTC instead of stopping capture. A closed gate can therefore hear the next utterance. A real pair of native engines remained connected while processing preferences changed; both capture counters continued increasing. Native chat also applies message size, wallpaper and compact/bubble preferences.

Validation before packaging:

- Formatting, ESLint, all workspace typechecks, 932 JS/TS tests and all workspace builds passed.
- 47 Android JVM tests passed, including bridge boundaries and PCM gating.
- 13 emulator UI/native tests passed: all eight sections, profile editing/saving, chat during a minimized call, native audio negotiation/live preferences, three call start/close cycles and existing navigation/contrast checks. A subsequent first-paint check exercises the final loader change separately.
- Sixteen actual Android section/theme layouts were captured at approximately 393 CSS pixels in dark and light themes without horizontal overflow. Profile and video screenshots were visually reviewed.
- The native microphone produced a real four-second WAV (512082 data-URL characters). Both prepared avatar and cover images survived the Kotlin profile bridge in the offline fixture. This does not claim an authenticated production upload was performed.
- At 320 CSS pixels, the focused profile field and Done action remain above the real Android keyboard. The native photo picker opened and returned safely; changing language through the shared control persisted across reload; the black theme was checked separately.

Evidence and preview images are under `outputs/doc-review/android230-*` and `outputs/mobile/beta230/previews/`. The final APK and signed package manifest are under `outputs/mobile/beta230/`.

Final package: source `e80a7532e2cd6b5d03de1292895622100e679df9`, `Trlka_0.4.0-beta.230_android.apk`, 87812186 bytes, SHA256 `05d27e7fa8162d12ebf872a9e924a1849a87a0f0dda29881e4fca36a342ae68f`. Certificate SHA256 remains `0e976d57328c2101de52de7cf24c7c15c8ea8b18ce881bcd8f553020d42ba88c`. Final R8/JNI verification, 47 JVM tests and lint passed (zero errors; 48 warnings). All 52 shared-settings assets exactly match the debug build used for visual QA. Installing release229→release230 retained UID10270 and the hash of existing UI preferences; three exact-release native audio factory/peer/SDP probes passed with an empty crash buffer. This checks package/data continuity, not an authenticated physical-phone session.

Platform limits remain: Android system-audio sharing is unavailable and its setting rolls back with an explanation. The native call engine does not yet implement call recording or transmitted camera background effects; their shared preference/editor screens do not establish those capabilities. Some desktop sound/decoration and automatic update options still depend on platform support. No claim of complete media-feature parity or physical-phone call QA is made. The visual screens are shared; system file/permission dialogs and font rendering follow Android.

This is a private design preview pending owner review, preserving package `io.freetalk.mobile` and its existing signing key. Do not publish it to public update feeds automatically. The website call/chat hotfix was published independently as `910b338`; see `WEB_CALL_CHAT_HOTFIX_20261115.md`. iOS and public Mac/Windows installers are unchanged by this Android work.

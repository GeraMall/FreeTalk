# Android native beta.224 — private preview

Baseline: `io.freetalk.mobile` 0.3.0-preview.1, versionCode 18, from
`D:/FreeTalk-android/output/android-preview/TRLKA-0.3.0-preview.1.apk`.
This is the Kotlin client, not the retired Tauri Android package. VersionCode224
and the same preview signing certificate preserve the upgrade path. No public
Android feed or server deployment is performed here.

## Included

- Validated email/username/password/date of birth; optional display name;
  recovery code expiry explanation and resend flow.
- Allowlisted primary/reserve API selection with credential-free health probes.
  Safe reads may fail over once; writes are never blindly replayed. Offline
  session restore preserves the stored login instead of logging the user out.
- Recent chats, saved messages, archive, pin/mute/delete/block actions;
  cached conversation/profile display and deduplicated refreshes.
- Image/file upload and download, completed download checkmark, reply/edit/delete,
  reactions, multiple selection/copy/forward, typing, group reader details.
  Video link covers use the existing authenticated metadata/image service for
  YouTube/Rutube/VK; links open through Android's external viewer.
- Circular bot avatar, cancel shortcut, cached bottom-first history and unread
  badge; foreground notifications update the open bot conversation too.
- Local default/light/black themes, seven interface languages and opt-in theme
  synchronization with the existing appearance API. Authentication stays dark.
  System icon contrast follows the actual surface.
- Native call remains active while using the bundled current React game tablet:
  chess, mines, fleet, monopoly, millionaire, poker. Native mute/deafen controls,
  participant avatars/speaking state, age restrictions, private game snapshots
  and activity pointers use the existing server protocol. No account tokens are
  passed into the isolated game renderer; arbitrary navigation is blocked.
- Compact ephemeral room chat: reply/edit/copy/delete, reactions under bubbles,
  photos/files up to10MB. Room file access stays pinned to the node that issued
  its token. Edits do not reorder messages. No pin/selection/readers menu here.

## Verification and limits

Desktop full check passed with the Android tablet bridge (565 desktop tests).
Native JVM tests, Android lint, six offline emulator screen checks and release
R8 packaging are run separately; final artifact hashes and upgrade verification
are recorded after packaging. The existing native preview and new debug build
have certificate SHA256:
`0e976d57328c2101de52de7cf24c7c15c8ea8b18ce881bcd8f553020d42ba88c`.

This preview uses that existing development certificate for compatibility; it
is not a Play Store production signing migration. Debug design fixtures exist
only in the debug source set and are excluded from the release APK.

Emulator checks cannot certify real phone microphones, Bluetooth routing,
background restrictions or camera/screen capture. A physical phone call test is
still necessary. Native game avatars currently use photos/speaking/mute state,
not live camera textures inside the game WebView. The desktop embedded external
video player and GIF/sticker library are not native Android parity features in
this preview. WebSocket room loss still ends the native room with an explicit
message; this work does not promise seamless call migration between servers.

Mac source capture correction is documented separately in
`MAC_SCREEN_CAPTURE_BETA224.md`; no API/signaling restart is required for either
client preview.

## Final artifact verification

Packaged from source `e36609bcfecf`; `android224-package14.log` completed
successfully: 31 JVM tests, six emulator screen tests, release lint (0 errors;
36 warnings/6 hints), R8 and release packaging. The full workspace check also
passed (`android224-full-check-final.log`, desktop565).

APK: `outputs/android/beta224-preview/Trlka_0.4.0-beta.224_android.apk`,
55,748,972 bytes, SHA256
`af1fd480682b94fa65764a6fbbb58b26f0afdff89609660d48f828d20c2af8ab`.
Package/version/SDK29–36/four ABIs and APK v2 signature were checked. Bundled
tablet HTML, JS,25 sound assets and translation catalog are present; the debug
preview activity is absent from release dex.

On the dedicated Android16 emulator: installed the old18 APK, seeded harmless
theme/text-size preferences, upgraded directly to the release224 APK and cold
launched it successfully. A same-key debug224 reinstall confirmed those exact
preferences survived; final release224 was reinstalled and cold launched again.
No crash-buffer entries. Authentication stays dark despite a saved light theme;
light chat system icons have dark contrast. This validates local preference
preservation, not a real user's signed-in session or a physical call.

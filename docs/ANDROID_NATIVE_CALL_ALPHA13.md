# Android native call alpha.13

Experimental native call implementation; not a production-verified media release.

## Implemented

- Native WebRTC audio, mute, camera, remote video, TURN configuration from signaling.
- Server roster, owner changes, server room timer, mute and local/remote speech indicators.
- Room chat/history and reactions using the existing signaling protocol.
- Invite copy/share and user-triggered sends to friends or existing chats.
- Communication-device selection (Android 12+ device list; legacy speaker/SCO routing).
- Screen sharing after Android MediaProjection consent, capped at 720x1280/15fps with preserved aspect ratio. No system-audio capture.
- Foreground call notification with return/end actions, capture cleanup and audio-focus handling.
- Four unit tests for roster, ownership/mute events, bounded/deduplicated chat and room cleanup.

## Verification boundary

Build, lint and JVM tests do not prove a real call works. No Android device is attached to this workspace. Before wider release, test:

1. Android ↔ web and Android ↔ Android audio in both directions; simultaneous joining and mute.
2. Camera enable/disable/re-enable on both ends; two simultaneous video sources.
3. Screen sharing, cancellation, system stop, rotation, and leaving while sharing.
4. Wired/Bluetooth output, unplugging, denied permissions and incoming cellular calls.
5. Background/locked-screen call, foreground notification actions and return to the app.
6. Invitations, room chat and all reactions with multiple participants.
7. TURN-only network and lost/recovered network; full signaling reconnect is not implemented in this alpha.

The existing web client is unchanged. This alpha replaces the previous native screen's UI-only microphone/camera toggles, which did not create a media connection.

Implementation references: https://github.com/webrtc-sdk/android and https://developer.android.com/media/grow/media-projection.

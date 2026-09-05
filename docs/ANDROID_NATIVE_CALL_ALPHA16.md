# Native Android alpha.16

Fixes the reported Android-to-PC SDP overlap (`have-remote-offer`). Each peer now
serializes SDP creation, local/remote application, rollback, and candidate handling.
Incoming offers retain ownership through answer application; renegotiation events
cannot start a competing offer while native asynchronous operations are pending.
The existing deterministic polite/impolite roles remain compatible with desktop.
Pending media changes retry after returning to stable. Departed peers discard queued work.

Audio enters communication mode before initializing WebRTC. Available headsets take
precedence, otherwise the loudspeaker is selected. The previous route is restored
on exit. Room volume keys control the voice-call stream; no system volume is forced
and no arbitrary track amplification is applied. Echo cancellation, noise suppression
and automatic gain control are explicitly requested via WebRTC audio constraints.

Reference: https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/media_constraints.cc

Verification: four queue regression tests cover remote-offer ownership, collision
ordering, failure completion/idempotence and peer departure. These are JVM queue
tests, not an on-device WebRTC interoperability test.

Required physical retest: install alpha.16 over the existing app; call desktop
with speaker and with a headset; check both directions, voice-call volume keys,
simultaneous join and camera toggles. No Android device was attached during this fix;
actual microphone loudness and acoustic echo cannot be verified by the build.

# Chord Library 1.0.3 — Android QR scanner test build

Android build number: 4. This draft contains an Android APK only.

## Changes

- Detach the camera preview before releasing its native handler after recognizing a QR code. The old order disposed a preview that was still attached to the page.
- Protect each camera cleanup operation so a cleanup error cannot escape the scan callback and lose the scanned result. Keep cancellation, background cleanup and image selection safe during camera release.
- Include release diagnostics under the `ChordLibrary.QR` Android log tag without recording scanned QR payloads.

## Validation and installation

All seven scanner regression tests passed in Release mode. Five of these tests fail against the previous scanner source. Tests use the actual page and MAUI controls with a simulated native handler; physical camera behavior on the affected phone remains unconfirmed.

The local Android Release publish passed with no build warnings/errors. APK v2/v3 signature verification passed, using the existing Ruach Systems signing certificate. Package metadata confirms version 1.0.3, build 4, minimum Android API 24 and ARM64/x64 support. This is a local build, not a passing hosted CI result.

Download `ChordLibrary-1.0.3-android.apk` from the draft assets and install it over the previous release APK. Do not uninstall the existing app. Retry live QR recognition, scan more than once, cancel, background/resume and select a QR image on the affected phone.

The repository is private. Sign into an account with draft-release access on your phone to download the APK. This release remains an unpublished draft pending device testing.

SHA-256: `21df2ff25fd19a16eba94f0bff39081e4497d66ab05e25de62466435b6a680dc`.

[GitHub release downloads](https://github.com/Ruach-Systems/ruach-chord-keep/releases)

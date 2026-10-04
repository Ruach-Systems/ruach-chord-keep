# Chord Library 1.0.1

Android build number: 2. Windows: x64, unsigned installer.

## Changes

- Sync downloads only changes since each account's saved checkpoint. Existing installations need one baseline download after upgrading. Latest updates win automatically, including deletions; conflicts no longer require confirmation.
- Account settings use Google sign-in only. Removed the connection editor and local-library import button from the account dialog. Google profile photos appear when available; older saved sessions receive profile metadata on their next token refresh or sign-in.
- Android Add song → QR code opens a live scanner, with an option to choose a QR image from file storage. QR import is hidden on desktop; QR sharing remains available.
- The mobile library drawer starts below the header, including devices with safe-area spacing.

## Validation and installation

Local validation: 55 Core, 58 Supabase, 12 shared-session and 15 JavaScript tests passed. Windows Release and Android Debug builds passed. Browser layout checks verified the mobile drawer with an enlarged header and safe-area inset. The release workflow additionally validates packaged artifacts and Windows installation/uninstall.

Install the Windows setup executable or signed Android APK. Android build 2 uses the existing release signing identity for updates from release build 1. Development APKs use a different signature. Keep existing local data when updating; do not uninstall a development build without exporting its data first.

No new database migration is required. This is a draft for device testing: Android live camera/file-picker behavior and installation/upgrade on real phones still need verification before publication. Distribution remains private while the source repository is private.

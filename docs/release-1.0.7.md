# Chord Library 1.0.7 — SQLite local storage

Windows x64 installer (unsigned) and signed Android APK, build 8.

## Changes

- Windows and Android now store the offline library in relational SQLite tables for songs, setlists, ordered membership, preferences and sync state. Only changed rows are written.
- Existing native JSON profiles migrate automatically on first access, preserving songs/chord text, setlist order and repeats, unknown fields, preferences, queued edits/deletions, local operation versions and cloud download checkpoints.
- Migration commits in one transaction. Failed migrations roll back and remain retryable; the original JSON and its existing backup are retained unchanged. Successfully migrated JSON is not replayed over later SQLite edits.
- Original app JSON exports remain supported: version 1 playlists, version 2 setlists, and single-song files. Imported songs/setlists use relational SQLite locally and the existing relational PostgreSQL backend when synced.
- Local edits commit with their pending upload; downloaded records commit with their checkpoints. Incremental downloads, event-driven refresh and automatic latest-update-wins behavior continue unchanged.

## Installation

Install over the existing release app. **Do not uninstall the Android app**: build 8 retains the existing application ID and release signing key. Export a current JSON backup before upgrading. The unsigned Windows installer can show an unknown-publisher warning.

Local migration requires no Supabase schema change. The retained old JSON is a pre-upgrade recovery copy; use Export data for a current portable backup.

## Build and acceptance

Source: `a9fcb1654de4a5f3e32ab6b6f86dc9c2dbee4d0f`, tag `v1.0.7`.

The [Release packages run 37432177932](https://github.com/Ruach-Systems/ruach-chord-library/actions/runs/37432177932) succeeded and created this unpublished draft.

- All 159 .NET tests passed (65 Core, 29 shared session, 7 native scanner and 58 Supabase), plus 25 JavaScript checks. Windows/Android validation builds had zero warnings/errors.
- Windows silent installation, installed-file comparison and uninstall passed on the runner. The downloaded installer reports product version 1.0.7 and is unsigned, as requested.
- The downloaded Android APK passed v2/v3 signature verification with the existing certificate SHA-256 `95831c04603c22a2ff37b9873949c9b3f973213ba6bb25f6ae4e4691df223fb8`. Manifest checks confirm app ID `com.louiejeg.chordlibrary`, version 1.0.7/build 8, minimum API 24, target API 36 and no debuggable flag. SQLite native runtimes are present for ARM64 and x64.
- All five downloads matched the checksum manifest and GitHub asset digests. Build metadata and the reserved tag identify the expected source commit, version, build number and unsigned Windows state.

| Download | Bytes | SHA-256 |
| --- | ---: | --- |
| `ChordLibrary-1.0.7-windows-x64-setup.exe` | 84,436,119 | `425ea5633df56a8c1e67c58508690942a607c88666e7b401fb17bfe2e48be408` |
| `ChordLibrary-1.0.7-android.apk` | 44,313,430 | `5824710440c14bd584224cf2187ba925b92802abe50eb9d3bc67c3ed939fcb2a` |

Other assets: `SHA256SUMS.txt`, `release-info.json` and `WINDOWS-UNSIGNED.txt`.

Physical-device upgrade, offline edit/restart/export and two-device synchronization still require acceptance testing. Keep this release an unpublished draft. Future release generation requires a new explicit instruction.

The repository is private; downloading from the draft requires a GitHub account with repository access. [Open GitHub Releases](https://github.com/Ruach-Systems/ruach-chord-library/releases) and select the 1.0.7 draft. GitHub can change a draft's direct URL when its details are edited.

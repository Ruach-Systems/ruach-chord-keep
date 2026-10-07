# Build and distribute releases

The product is now **ChordKeep**. Future workflow runs use ChordKeep release titles and download filenames; previously published Chord Library assets keep their original names. The application ID, signing identity and Windows installer AppId remain stable. See [identity and upgrade compatibility](identity.md). Workflows remain manual and require an explicit release instruction.

The source repository is private. GitHub Releases and Actions downloads require repository access. General distribution can use a separate public download repository, a website, or app stores without making this source public. This workflow does not change repository visibility, deploy database migrations, publish to stores, or update installed apps automatically.

Releases are created only on an explicit user request for each release. Code changes, commits, pushes and successful validation do not authorize generating a release or draft. The release workflows are manually dispatched; publishing a draft requires separate instruction.

## Release button

1. Open [Actions → Release packages](https://github.com/Ruach-Systems/ruach-chord-keep/actions/workflows/release.yml).
2. Click **Run workflow**, keep branch **main**, enter a new three-part version such as `1.0.0`, and an Android build number such as `1`. Increase the build number for every published update; it is Android's upgrade sequence, independent of the display version.
3. Leave **Allow unsigned Windows installer** selected until a trusted Windows certificate is configured. The resulting installer can show Windows unknown-publisher warnings. Selecting this option permits unsigned output; an available certificate is still used and signing failures stop the job.
4. Preparation reserves the version's Git tag at the exact source commit. The workflow then runs tests, builds an x64 Windows installer and signed Android APK, tests silent Windows installation/uninstall, verifies the APK signature, generates SHA-256 checksums and creates a **draft release**. Missing Android signing secrets, invalid input, failed checks or a failed package stop the release. Each version is new; existing releases are not overwritten.
5. Download the packages from the draft (or Actions artifact), test them on real devices, then click **Publish release** when ready. Publishing is manual. Failed runs create no release; job artifacts are retained for 14 days, while attached release assets remain with the release.

If a build fails after preparation, its reserved tag remains. Use **Re-run failed jobs** to continue the same source commit. If source changes are needed, choose a new version and build number; the workflow will not move an existing tag. Reserving the tag first and creating the release using that tag avoids a stale `target_commitish` when main advances during a long build. A failed final draft/upload step can leave a partial draft; inspect its assets before publication rather than publishing blindly.

If packaging succeeded but the draft step needs recovery, use **Actions → Create draft from verified build → Run workflow**, supplying its version and the original Release packages run ID. It verifies the successful package job, source commit/tag, artifact metadata and all checksums before creating a draft, without rebuilding. The source run's artifact must still be within its 14-day retention period. It refuses to replace an existing release.

Windows setup installs per user without requesting administrator access. It bundles the .NET and Windows App SDK runtimes, and a Microsoft-signed WebView2 bootstrapper. Internet is needed only for prerequisite installation when WebView2 is missing. It creates a Start menu shortcut and uninstall entry. The installed app's local data is outside its installation folder and is not intentionally removed by the installer.

Android users download the APK and allow installation from their download source. The existing application ID remains `com.louiejeg.chordlibrary`; keep it stable for updates. Release and development APKs have different signatures. Export local data before uninstalling a development APK to switch to the release build. APK updates signed with the same release key and a higher build number can replace the previous release. There is no built-in automatic updater.

## Android signing setup (once)

On Windows with GitHub CLI authenticated and a JDK installed:

```powershell
./scripts/initialize-android-signing.ps1 -KeyTool 'C:\path\to\jdk\bin\keytool.exe' -UploadSecrets
```

The helper creates a long-lived release key, or reuses its existing local backup. It refuses to generate a new identity if GitHub already has Android secrets. It configures these repository secrets without printing their values:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded release keystore |
| `ANDROID_STORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_PASSWORD` | Key password |
| `ANDROID_KEY_ALIAS` | `ruach-chord-library` |

The backup is under ignored `.local/release-signing/`, restricted to the current Windows account and SYSTEM. Its password file uses Windows DPAPI, tied to this user/machine. **A copied DPAPI file alone is not a portable password backup.** Preserve the keystore and securely store its password in your password manager. GitHub Secrets are not a retrievable backup. Do not regenerate this key after distributing the APK.

To load the protected password locally without printing it:

```powershell
$securePassword = Import-Clixml .local/release-signing/password.dpapi.xml
$env:ANDROID_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password
$env:ANDROID_KEY_PASSWORD = $env:ANDROID_STORE_PASSWORD
try {
    ./scripts/publish-android.ps1 -Version 1.0.0 -BuildNumber 1 -KeystorePath (Resolve-Path .local/release-signing/chord-library-release.keystore)
} finally {
    Remove-Item Env:ANDROID_STORE_PASSWORD, Env:ANDROID_KEY_PASSWORD
}
```

## Optional trusted Windows signing

Supply `WINDOWS_CERTIFICATE_BASE64` (PFX with private key, Base64 encoded) and `WINDOWS_CERTIFICATE_PASSWORD` in GitHub repository secrets. The workflow signs the application executable and installer with SHA-256 and a timestamp, and requires valid signatures. Certificates that require hardware/cloud signing need a corresponding signing integration; this PFX path does not cover them. Trusted signing does not guarantee the absence of SmartScreen reputation warnings.

Without a certificate, use the explicit unsigned option. The draft includes `WINDOWS-UNSIGNED.txt`. Local equivalent:

```powershell
./scripts/publish-windows.ps1 -Version 1.0.0 -BuildNumber 1 -AllowUnsigned
```

Both local publishers use `artifacts/release/<version>/<platform>/` and refuse to reuse an existing output folder. The Windows publisher downloads a pinned, checksum-verified Inno Setup compiler and verifies Microsoft's signature on the WebView2 bootstrapper. Signing material and build output are never uploaded as source or included in release assets.

## Validation and limitations

- **Verify** runs on main pushes, pull requests and manual dispatch, with no signing credentials. It runs the existing C#/JavaScript suites and builds both targets.
- **Release packages** only runs on main, uses read-only permissions while building, and grants contents-write permission only to the short tag-preparation and final draft jobs. Actions are pinned to commit hashes. Signing secrets are scoped to the steps that need them.
- All packages in a draft come from the same commit. `release-info.json` records that commit, version, Android build number and Windows signing status. `SHA256SUMS.txt` lets recipients verify downloaded files.
- Passing a workflow establishes build/package checks, not real-device production readiness. Verify installation/upgrade, signup/recovery, configured Google sign-in, import of an actual export and two-device/offline sync before publishing. See [validation](validation.md).
- The current workflow distributes an APK. Google Play's AAB, store submission, cloud Windows signing and automatic application updates are separate additions.
- Hosted runner availability and private-repository Actions usage are governed by your GitHub plan. Failures remain visible in Actions; no failed build is published automatically.

References: [Microsoft Windows publishing](https://learn.microsoft.com/en-us/dotnet/maui/windows/deployment/publish-unpackaged-cli?view=net-maui-10.0), [Android signing](https://learn.microsoft.com/en-us/dotnet/maui/android/deployment/publish-cli?view=net-maui-10.0), [WebView2 deployment](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

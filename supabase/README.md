# Supabase setup and migration

This folder contains the manual database migrations, database security tests, and C# transport/authentication tests. On October 3, 2026, migrations 001–003 and Windows/Android redirect URLs were applied to project `ykfmjwlouvbapzqlqczw` through its Chrome dashboard. Active storage is relational PostgreSQL. Hosted relational/security checks passed, including account cleanup after forward fix 003; test fixtures were rolled back. Google provider setup and live authentication/device checks remain outstanding; no real Firebase export or user migration has been performed.

## Configure a project

1. Create or select the destination Supabase project. Test first in a disposable development project.
2. Review and apply the numbered SQL files in `migrations/` in order using the Supabase SQL editor. `001` establishes revision transport; `002` converts storage to typed relational tables; subsequent forward migrations complete database fixes. Each file runs once, not automatically at app startup. See [relational schema](RELATIONAL_SCHEMA.md).
3. Supply only the project URL and **publishable key** to the native app. A legacy `anon` key is also accepted. Never put a secret key, `service_role` key, database password, Google client secret, or Firebase admin credential in this app, its WebView, source files, or exports.
4. Enable the desired Supabase Auth providers. Configure email confirmation, recovery email delivery, and the project's Site URL before testing password recovery. Email/password registration may return a confirmation requirement instead of a session.
5. For Google, configure the Google provider in the Supabase dashboard and register the Supabase provider callback URL with Google. The native app begins sign-in using `SupabaseAuthClient.BeginGoogleSignInAsync` and passes the resulting app callback to `CompleteGoogleSignInAsync`.
6. Allow the actual native callback URI in Supabase Auth redirect URLs. The callback supplied to the C# method has no query or fragment; the client adds a random `app_state` query. An example narrow development pattern is `chordlibrary://auth/callback*`. The native host's registered scheme/path and the configured allow-list must match. Confirm the exact pattern with a development sign-in before release. Prefer verified HTTPS app links where available for a production app.
7. Complete the release checks below with two separate test users before importing valuable data.

Supabase documents [native app redirects](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [redirect allow-list patterns](https://supabase.com/docs/guides/auth/redirect-urls), and the [PKCE code exchange](https://supabase.com/docs/guides/auth/sessions/pkce-flow). The REST client follows the official [Auth OpenAPI contract](https://github.com/supabase/auth/blob/master/openapi.yaml).

## Password recovery with the default email

The default Supabase recovery email works without editing templates or changing a plan. Request recovery in the native app, then **copy the reset link's address from the email without opening it** and paste it into the app's recovery field. Opening the link first may consume its one-time token. If it has already been opened or expired, request a fresh recovery email. Email link wrappers from tracking/security services are not accepted; the pasted link must be the original URL for the configured Supabase project.

The auth client validates the project's exact origin, `/auth/v1/verify` path, and `type=recovery`, then exchanges the URL's `token` as a `token_hash` in a POST to the configured project's verification endpoint. It does not navigate to the pasted URL, follow `redirect_to`, or store/log the link. Foreign projects, duplicate/missing/invalid parameters, URL credentials, and fragments are rejected before any network request. HTTP links are accepted only for a matching configured loopback development project; hosted projects require HTTPS.

This uses `RequestPasswordResetAsync(email, null)` followed by `VerifyRecoveryLinkAsync(pastedLink)` and `UpdatePasswordAsync(newPassword)`. It avoids dependence on a working browser redirect or a desktop callback listener. The same default-email mechanism is available for signup through `VerifySignupLinkAsync(pastedLink)`, which accepts only `type=signup` and establishes the confirmed account's native session. Supabase's [Auth OpenAPI contract](https://github.com/supabase/auth/blob/master/openapi.yaml) specifies the GET link's `token` parameter and the POST verification body's `token_hash` plus `type`.

A successful verification signs in the recovery account even if a subsequent password change is rejected by a password policy; the host must select and display that authenticated account consistently. Verification failures must not attempt a password update. Test real delivery, a valid original link, wrong-action/foreign links, and expired/used links before release.

### Optional emailed code

If email template editing is available for the project, an emailed code can also be used. In the Supabase dashboard, edit **Authentication → Email Templates → Reset password** to include `{{ .Token }}`. This is optional; no plan upgrade, SMTP change, or template edit is required for the default-link workflow above. Example code template:

```html
<h2>Reset your Chord Library password</h2>
<p>Enter this recovery code in Chord Library:</p>
<p><strong>{{ .Token }}</strong></p>
<p>If you did not request this, you can ignore this email.</p>
```

Keep the code as text; do not convert it to a number because it can begin with zero. Its configured length, expiry, and rate limits are controlled by Supabase. The app requests it with `RequestPasswordResetAsync(email, null)`, verifies it with `VerifyRecoveryCodeAsync(email, code)`, then changes the password with `UpdatePasswordAsync(newPassword)` using the returned authenticated session.

The default link-only template does not display a code; use the copied link with that template. Supabase documents the [email template token variable](https://supabase.com/docs/guides/auth/auth-email-templates) and [OTP verification types including recovery](https://supabase.com/docs/reference/csharp/auth-verifyotp).

## Move an existing user's library

1. In the original app, sign in to the intended Firebase account, wait for its sync to finish, and use its complete JSON export. Preserve that original export as a backup.
2. In the native app, sign in to the destination **Supabase** account.
3. Use the native import action for that exported JSON file. Review its song/setlist counts and warnings. Version 1/2 backups, legacy `playlists`, song IDs, setlist order and unknown JSON properties are handled by the core importer. Existing ID collisions use the importer review/merge behavior rather than silently deleting the existing library.
4. Open several songs and playlists locally, then sync to Supabase. The first upload creates rows owned by the currently signed-in Supabase user; the owner is determined by `auth.uid()` on the server, never by the import file.
5. Sign in to the same Supabase account on a second installation and sync to verify the imported data independently.

The old app's JSON export contains library data, not authentication passwords, password hashes, Google credentials, or refresh tokens. Signing in with the same Google account through the new Supabase project creates/uses a Supabase identity. It does not automatically attach the old Firestore library. The explicit library import provides that transfer.

Firebase user IDs and Supabase `auth.users.id` UUIDs are different identity namespaces. Song/setlist IDs remain text so they do not have to be regenerated. The app never interprets a Firebase UID or an email address inside imported content as authorization to read another user's records.

For an administrator-led migration of every account, prepare an independently verified mapping from `firebase_uid` to `supabase_user_uuid` and retain it as a private migration audit artifact. Verify ownership through an authorized authentication migration or authenticated account-linking process. Do not let a public client claim a Firebase UID or use an unverified matching email as proof of ownership. Bulk Auth migration is a separate privileged operation; Supabase provides a [Firebase Auth migration guide](https://supabase.com/docs/guides/platform/migrating-to-supabase/firebase-auth). No admin credentials or bulk auth migration are included in the native client.

## Data and conflict behavior

Active storage uses `public.songs`, `public.setlists` and `public.setlist_songs`. Song/setlist attributes have typed columns, dates are `timestamptz`, and ordered membership rows have compound foreign keys that include the owner. Optional `extra_fields` JSONB retains unknown future properties only; constraints exclude known attributes. `public.library_documents` is now a read-only view that constructs the legacy-compatible REST response from relational rows. It stores no document payloads. The earlier table is retained in the client-inaccessible `chordlibrary_private` archive.

- All client reads are protected by RLS and require `owner_id = auth.uid()`.
- Clients cannot insert, update or delete the tables or view directly. The `apply_library_document` RPC always derives the owner from the authenticated JWT, writes typed fields and updates ordered memberships transactionally.
- `p_expected_revision = null` means insert-only. Existing different content returns a conflict. Updates/deletes require the last known revision, preventing stale offline copies from overwriting another device.
- Identical retry payloads succeed without producing another revision. This recovers safely when an upload succeeded but its response was lost.
- Deletes remain tombstones so another device cannot silently resurrect a deleted record. Do not purge tombstones until a separately designed device/cursor retention policy exists.
- A per-owner database transaction lock orders committed revisions. Pulls use keyset pagination and continue until an empty page, including when a project's REST row limit is smaller than the requested page size.
- Sync downloads into clean local records, then uploads pending changes. Conflicts preserve the local content and return the remote content for review. Errors do not acknowledge pending edits or tombstones. An acknowledgment only clears the exact local version that was uploaded.
- Local libraries use `guest` and `user:<Supabase UUID>` profiles. Account changes do not silently migrate guest data or another user's data. Native session secrets remain outside all library snapshots and exports.

The current coordinator performs complete paginated pulls on each sync. This favors recovery and correctness over incremental bandwidth. An incremental cursor can be added later only if the cursor and every accepted local change are committed atomically.

## Run checks

From the repository root:

```powershell
dotnet test supabase/tests/ChordLibrary.Supabase.Tests.csproj
```

These tests use an in-memory HTTP handler, never a hosted backend. They exercise password and PKCE flows, refresh rotation, outage behavior, secret-key rejection, 1,201-row pagination, tombstones, failed upload persistence, account scoping and conflict retention.

With `psql` and a **disposable Supabase development database**, apply the migration and run:

```powershell
psql "$env:CHORDLIBRARY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/001_library.sql
psql "$env:CHORDLIBRARY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_revisions.sql
psql "$env:CHORDLIBRARY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/002_relational_library.sql
psql "$env:CHORDLIBRARY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/003_account_delete_cascade.sql
psql "$env:CHORDLIBRARY_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/002_relational_tests.sql
```

The SQL test fixtures and their data are rolled back. The migration itself creates persistent tables/functions and must only be applied to the intended project. The test script checks two-user isolation, denied anonymous access/direct writes, insert-only collisions, stale-write rejection, idempotent retries, preserved JSON, and tombstones. These checks were executed successfully through the authorized project's SQL Editor (with the psql-only `\echo` replaced by a result query). PostgreSQL sequence values can advance despite rollback; no test users or documents remain.

Before release, verify live email confirmation/recovery, Google redirect handling on Windows and Android, refresh/relaunch, two-device conflicts, offline edits/deletes, account switching, exports/imports with real representative data, and the SQL tests against the actual schema. C# tests and a successful native build do not establish hosted configuration or authentication readiness.

# Google Drive backup and recovery (Stages 24–25)

Google Drive is optional. File backups and offline brewing work without a Google
connection. There is no automatic background sync or remembered login.

## Google app configuration

CoffeeOS ships with the public web OAuth client registered for this app:

`336592974400-o78vsk4u36ggvfj5u72ppmif98sktsqj.apps.googleusercontent.com`

Users can select **Connect Google Drive** directly in IO. There is no client-ID
entry field or temporary diagnostic panel. No client secret, service-account key
or refresh token belongs in the browser build.

The Google Cloud project must enable **Google Drive API**, configure consent
branding/audience, and authorize the exact JavaScript origins used for CoffeeOS.
The registered origin is **only** `https://krischris.github.io` (origins do not
include `/CoffeeOS/`). Localhost is not registered; real login must use the
deployed origin. Local automated tests mock Google and need no additional
authorized origin. For an External app in Testing, add the Google accounts being
used as test users. Grant only
`https://www.googleapis.com/auth/drive.file`, `openid`, and `email`.
The GIS popup token model does not require a redirect callback URL.

For public OAuth branding, use `https://krischris.github.io/CoffeeOS/` as the
application homepage and `https://krischris.github.io/CoffeeOS/privacy.html` as
the privacy-policy URL after deploying the build that includes it. The app's
About & privacy header link opens the same text in a scrollable overlay; the
public URL also works independently without login or database initialization.
The homepage includes an app description and a direct privacy-policy link in its
initial HTML, readable without JavaScript. This basic view also remains visible
during startup or a startup failure; successful startup replaces it with the app.

For a separate deployment, `VITE_GOOGLE_CLIENT_ID` can override the public default
in `.env.local` or through the Pages workflow's matching Actions variable.
An unset or empty variable uses the app's registered public client ID.

See Google's [setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
and [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Connect and sync

**Connect** opens a small CoffeeOS authorization window. Press **Continue with
Google** there to select your account and grant permissions. Return to CoffeeOS.
Your selected email appears after the token's scopes and Google's userinfo
response have been checked. If your browser blocks the authorization window,
allow it and try again; Disconnect cancels a pending connection immediately.
Closed windows also expire after three minutes.

One sync runs after authorization:

- A collection with any beans or sessions uploads a new immutable `.coffeeos`
  snapshot. Older files stay in Drive.
- A successfully opened, unchanged empty collection downloads and validates the
  most recently uploaded completed snapshot and imports it transactionally.
- Empty local and empty cloud collections show “No Drive backup yet.” There is no
  empty upload, and a failed lookup is never treated as empty history.

**Sync now** repeats that behavior once. Saving a brew, navigating, reloading and
completing an import do not trigger a sync. Counts and date describe the captured
snapshot; edits during upload wait for your next Sync now. A write during recovery
stops the import, including a write followed by deletion back to empty.

Drive transfers and local `.coffeeos` backups have no application-imposed
collection size cap. Browser capacity, the version 1 ZIP format and Google Drive
quotas still apply. Users manage their own storage and data usage.
The Drive folder has the visible name **CoffeeOS Backups**, but discovery uses
private app metadata, not the display name or a remembered folder ID. Renaming
it does not change its identity. All marked folders are retained; the lowest folder
ID is the stable upload destination. Paginated history discovers completed
app-marked snapshots throughout the authorized account, including moved files.
Incomplete searches stop safely. Ordering uses server `createdTime`, then file ID
ascending for ties; this is upload order, not proof of latest edits.

Uploads use Google's [resumable protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
with 1 MiB chunks and app properties `coffeeosKind=snapshot-v1`, `backupId` and
`archiveSha256`. The folder retains `coffeeosKind=backups-folder-v1`. Success
requires server size and SHA-256 verification. Interrupted chunks query the same
session's confirmed offset before resending. Transient reads/status probes retry
up to three times with bounded backoff. An uncertain upload is reconciled using
the same backup ID; no blind second upload is started. Expired sessions stop with
an unconfirmed result: inspect history and keep a local backup before a new sync.

Progress reports transferred bytes. Cancel stops pending requests, but a request
already accepted by Google may finish. Refresh history before starting another
upload. Authorization expiry offers **Reconnect to resume transfer** from a new
user gesture. Choose the same account; the pending operation resumes without
another connect-time sync. Session URLs, tokens, archive buffers and account state
stay in memory only. Reloading loses the transfer session; inspect history before
starting again. No account preferences or remembered authorization are persisted.

## Restore and switch accounts

**Restore from Drive** lists completed snapshots. After a sync upload, the
previous latest cloud snapshot stays selected, so the new upload does not obscure
it. Choose an older snapshot explicitly if a newer one cannot be validated.
**Review selected backup** pins its file ID and validated archive bytes, and shows
cloud/local counts, added/overwritten records and local-only records.

- **Merge with local collection** adds new IDs, updates differing matching IDs
  (even if the cloud data is older), and keeps local-only records.
- **Replace local collection** is a separate explicit confirmation. It adopts
  exactly the reviewed snapshot, removing local-only records, including when the
  snapshot is empty. An immutable durable recovery copy is retained first. Both
  tables change together inside a transaction; storage/backend identity stays the
  same. If recovery creation or pre-commit work fails, local records are kept.
- Local changes after preview require review of refreshed counts and another
  confirmation. Cancel leaves the collection unchanged. A post-commit storage
  warning means the change happened: export a backup, do not repeat the restore.
- **Recovery backups** below the import controls prepares downloadable `.coffeeos`
  copies. Import one to merge earlier records back. Recovery copies remain after
  reload; neither successful restores nor Disconnect delete them.

Restoring never immediately uploads its result. Use Sync now explicitly later.
**Switch account** clears the old token, pending state and selections. Connect the
new account, then explicitly select **Enable backup to this account** before any
collection transfer. **Disconnect** keeps all local records and Drive files; it
does not revoke Google's grant. Manage that separately in your Google account.

The app still uses the registered OAuth client and existing scopes. No Google
Console publication or consent changes are performed by this implementation;
Testing-mode access is not evidence that all Google users can authorize.

## Automated verification

The temporary Stage 26 panel was removed in Stage 28. Adapter self-tests and the
read-only round-trip helper are now in `tests/driveChecks.ts`, outside the normal
app bundle. Run `uv run npm run test:drive` against Vite with isolated Safari, or
`TEST_FIREFOX=1 uv run npm run test:drive` against the isolated Firefox endpoint.
Those regressions simulate Drive and do not establish real Google authorization.
The normal Connect/Sync now flow is used for live-service acceptance.

## Your live device acceptance checklist

Keep a local file backup first. No destructive test/reset is needed in your
normal browser profile.

- Connect on your iPhone in Safari. Confirm the selected account, isolated
  database page and successful small upload. Inspect the new `.coffeeos` file
  in Drive. Note any visible error if authorization or transfer fails.
- Sync again and confirm a separate snapshot exists and earlier files remain.
- Use a genuinely fresh browser profile or another device on the **same origin**
  to recover the uploaded fixture into its empty collection. Compare beans,
  photos, linked sessions, comments, nulls, dates and numeric precision. Reload
  and compare again. Do not clear your original browser's storage to test this.
- Repeat authorization in Home Screen mode. Check touch targets, keyboard and
  background/foreground interruption. Desktop Safari automation does not cover
  physical iOS behavior.
- Disconnect, deny authorization, and try offline usage: brewing and local file
  backups should remain available. Corrupt or unsupported newest cloud backups must
  stop recovery clearly and leave local data intact.

## Isolation and deployment

The main database page keeps COOP `same-origin` and COEP `require-corp`.
`drive-auth.html` alone uses COOP `same-origin-allow-popups` and COEP `unsafe-none`
so Google's popup can return its callback. Google's script loads only inside this
optional helper. The isolated database page receives the result over a random,
one-time same-origin BroadcastChannel with a three-minute lifetime. Tokens are
never sent in URLs, logs, exports or persistent storage. The URL fragment carries
only the random channel name and is immediately removed by the helper.

Vite dev/preview and the existing isolation service worker apply the helper-only
exception. An independent static host that adds isolation headers itself must
configure that same exception; its HTTP headers cannot be weakened by HTML meta
tags. GitHub Pages relies on the scoped service worker for isolation; test the
actual deployed origin and updated service worker before claiming login works.
The helper does not register a worker, open the database or select a backend.
All existing storage identifiers and the deployment origin remain unchanged.

References: [GIS popup/COOP setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[token API](https://developers.google.com/identity/oauth2/web/reference/js-reference),
[Drive upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[file metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
and [listing completeness](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).

## Capacity and verification limits

Stage 29 removed the former Drive/local size ceilings; this workflow preserves
that decision. Downloads enforce the server-declared byte length while reading,
then verify archive hashes and schema. Packaging, validation and pinned previews
still hold full archives in memory. A configured unlimited size is not an iPhone
memory guarantee. Backgrounding/closing the app can interrupt transfers.

Local simulated-service checks are distinct from real Google testing. Stage 24
was accepted by the user on 2026-10-27 after private testing. Stage 25 still needs
live history, interrupted transfer/reauthorization, cross-profile restore and
physical iPhone/Home Screen verification on the deployed origin. Do these with
dedicated fixtures and a local backup; desktop automation cannot establish them.

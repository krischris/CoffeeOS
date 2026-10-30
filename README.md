# CoffeeOS

A personal coffee journal for keeping track of your beans, recipes, and how each
cup turned out. Designed for iPhone and iPad, it runs in your browser and can be
added to your Home Screen.

[Open CoffeeOS](https://krischris.github.io/CoffeeOS/)

## Your daily workflow

1. **Add your beans** in Bean Manager, with optional roast and freeze dates and a
   photo of the bag.
   Swipe a bean right for Edit or left for Delete; the three-dot menu offers both.
   Edit uses the same form, with Save and Cancel.
2. **Log a brew** in Brew Controller. Choose your beans, record your recipe and
   results, and leave tasting notes. Measurements are optional; adding dose, yield,
   and TDS gives you a live extraction calculation and brewing control chart.
3. **Look back and adjust.** Browse your sessions or a bean's brew history to find
   what worked. Tap the filter icon beside Your brew sessions to choose a bean;
   tap it again to clear the filter. You can edit past sessions as you refine your notes.
4. **Keep a backup** from the IO tab. Save or share a single `.coffeeos` file with
   your beans, sessions, and photos. Review a backup before importing; matching
   records are updated and unrelated records stay. Older CSV and Parquet backups
   can still be imported.

## Your data and privacy

Your collection is stored in your browser on your device and normally survives
closing and reopening the app. No account is needed. CoffeeOS has no ads,
analytics, or developer-operated server receiving your coffee records.

Browser storage is not a backup: clearing site data, private browsing, or device
storage cleanup can remove it. Data does not automatically follow you to another
browser or device. Keep regular backup files, especially before switching devices.
If saved storage cannot be opened safely, CoffeeOS shows a recoverable error and
keeps the original data rather than opening an empty replacement.

## Use CoffeeOS offline

Open CoffeeOS while connected and check **IO → Offline use**. Keep it open until
it says **Ready for offline use**; the first preparation downloads the app and its
local database runtime. You can then close and reopen CoffeeOS without a network
connection, log brews, manage beans, and prepare or import local backups. Google
Drive still needs an internet connection. Native sharing and cloud-backed Files
locations depend on your device and the destination's availability.

App updates download while you are online and take effect after all CoffeeOS
windows are closed and reopened. A failed download keeps the previous complete
offline version. Browser cleanup or storage eviction can remove offline files;
reopen online to prepare them again and keep regular backups of your collection.

**Google Drive backups are optional.** Connecting uploads a snapshot of a nonempty
collection, or restores the latest uploaded backup into an empty collection.
**Sync now** repeats this once; there is no background sync. Drive history offers
validated previews, merge or explicitly confirmed replacement with a retained
recovery copy. Transfers use resumable chunks with progress and cancellation. Earlier Drive backups
are kept. Disconnecting keeps your local records and cloud files. Backup files
are not password-protected or encrypted by CoffeeOS.

See **About & privacy** in the app for the full privacy policy.

Bean photos are prepared on the device as WebP at or below 100 kB. On the first
upgrade, existing readable JPEG photos convert automatically after CoffeeOS saves
a downloadable recovery under IO. Later launches keep the converted bytes.
Historical damaged photo bytes remain preserved with an IO notice, and old
JPEG backups remain importable. New backups require WebP-capable CoffeeOS
(archive format 4); keep your original backups when updating.

## Development testing

Use the repository's `$coffeeos-tests` agent skill or `uv run npm test` for the
full automated regression suite. It manages local test servers/browser profiles
and reports issues in `TESTS.md`. Implementers address that file first and run
focused checks; test runners run and report without fixing code. See the
[test harness guide](tests/README.md) for setup, coverage and adding regressions.

For independent code reviews, use the reviewer role in [AGENTS.md](AGENTS.md).
Ask to “review new changes” for the next uncovered range plus working changes,
“audit the whole codebase” for current behavior across subsystems, or “recheck
the review findings” for a focused follow-up. An explicit range overrides defaults.
Reviewers run basic checks and small bug reproductions, then hand findings to
implementers in [REVIEW.md](REVIEW.md). Asking to assess and apply fixes uses the
implementer role; its self-check does not supply independent sign-off.
[REVIEW_LEDGER.md](REVIEW_LEDGER.md) distinguishes inspected ranges, scoped
audits and rechecks from independent sign-off and full-suite results.

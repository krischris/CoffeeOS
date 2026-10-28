# CoffeeOS backup formats 1, 2 and 3

This is the normative archive and logical data schema contract. The generated
[example-v1.coffeeos](fixtures/example-v1.coffeeos) includes three beans (one with
a JPEG, one with no sessions), two sessions, nulls, empty strings, Unicode,
a multiline comment, microsecond timestamps and binary64 precision examples.

## Container and identification

A `.coffeeos` file is an ordinary, unencrypted, single-disk ZIP, with exactly
three files at its root: `manifest.json`, `beans.parquet`, `brew_sessions.parquet`.
No directories, duplicate names, symlinks, additional files, encryption, ZIP64,
absolute paths or path traversal are accepted. Local and central metadata must
agree, file ranges must not overlap, and CRC32 must match. Standard ZIP extra
fields and comments are allowed; ZIP64/AES extra fields are rejected. Data
descriptors (with or without signature) are supported. Export uses STORE;
import supports STORE and raw DEFLATE. Tables are independently readable standard
Parquet, never joined. Empty tables carry the full schema and are valid.

Downloads use `application/zip` and a filename such as
`CoffeeOS-2026-10-27T143000Z.coffeeos`. Filename and MIME type are hints only:
import validates contents and accepts a `.zip` copy and empty/generic MIME types.
No registered CoffeeOS media type is claimed.

The implementation pins MIT-licensed **fflate 0.8.3**. Its installed `zipSync`
(level 0) writes STORE; its incremental `Inflate` receives 1024-byte input chunks.
An independent header/directory audit precedes extraction, because a ZIP decoder
alone does not enforce the contract. Only fixed entry names enter memory; no
archive path is written to browser storage. The dependency is browser JavaScript
and uses typed arrays; Safari is checked with the application. Its general ZIP
limits are deliberately narrowed by this reader. The distributed license is
`public/fflate.LICENSE.txt`. See [fflate documentation](https://github.com/101arrowz/fflate).

## Manifest

`manifest.json` is UTF-8 JSON (invalid UTF-8 or JSON fails). Required properties:

| Property | Type and rule |
| --- | --- |
| `format` | String, exactly `coffeeos-backup` |
| `format_version` | Integer, 1 normally; 2 for legacy photos; 3 for historical whitespace fields (contracts below) |
| `data_schema_version` | Integer, exactly 1 (logical backup schema, independent of internal database schema) |
| `backup_id` | UUID with standard hyphens, RFC variant and version 1–8; identifies this export, never database or record identity |
| `exported_at` | UTC ISO 8601 `YYYY-MM-DDTHH:mm:ss[.fraction]Z`, 1–6 fractional digits when present, valid calendar date/time |
| `producer` | Object: `name` exactly `CoffeeOS`, `version` nonblank string, informational |
| `tables` | Array of exactly two descriptors, uniquely named `beans` and `brew_sessions`; descriptor order does not matter |

Each table descriptor requires `name`, exact `path` (`beans.parquet` or
`brew_sessions.parquet`), `row_count`, `byte_length`, `sha256`, `columns`, and
`primary_key: ["id"]`. Row counts and byte lengths are nonnegative safe integers;
length covers the entire uncompressed Parquet file. SHA-256 is 64 lowercase hex
digits over those exact bytes, including headers and footer. The sessions
descriptor also requires:

```json
"foreign_keys": [
  {"columns": ["bean_id"], "references": {"table": "beans", "columns": ["id"]}}
]
```

Beans may omit `foreign_keys` or specify `[]`. All identifiers and key descriptors
are validated against this contract; none are executed as SQL. `columns` is an
ordered array, with `name`, `logical_type`, `nullable`, and `unit` exactly as below.
Unknown informational object properties are ignored at all levels. They cannot
change required fields, units, array shapes, keys or compatibility. Producer
version is never a compatibility gate or storage identifier. Unsupported format
or data-schema versions fail before table loading, requiring an explicit future
reader/migration and fixtures.

Checksums detect corruption and mismatched files, **not authenticity**. This
archive contains readable personal data, comments and photos. It provides no
encryption. Opening it requires no account, password or network service.

## Logical tables and Parquet representation

The ordered columns are:

| Table | Column | `logical_type` | `nullable` | `unit` |
| --- | --- | --- | --- | --- |
| beans | id | string | false | omitted |
| beans | name | string | false | omitted |
| beans | roast_date | date | true | omitted |
| beans | freeze_date | date | true | omitted |
| beans | created_at | timestamp_us_utc | false | omitted |
| beans | photo_jpeg | jpeg_data_url | true | omitted |
| brew_sessions | id | string | false | omitted |
| brew_sessions | bean_id | string | false | omitted |
| brew_sessions | brewed_at | timestamp_us_utc | false | omitted |
| brew_sessions | dose_g | binary64 | true | g |
| brew_sessions | water_g | binary64 | true | g |
| brew_sessions | time_str | string | true | omitted |
| brew_sessions | temp_c | binary64 | true | degC |
| brew_sessions | grind_um | binary64 | true | um |
| brew_sessions | comment | string | true | omitted |
| brew_sessions | yield_g | binary64 | true | g |
| brew_sessions | tds_pct | binary64 | true | percentage_points |
| brew_sessions | extraction_pct | binary64 | true | percentage_points |

`id`, `bean_id`, and bean `name` must be nonblank strings. IDs are unique per
table and sessions must reference beans **inside the archive**, even if the
local collection contains the missing bean. Dates/timestamps must be finite and
within years 0001–9999; dates are Gregorian calendar days. Numeric values are
finite IEEE 754 binary64, including zero; numbers are not recalculated or rounded.
`time_str` retains its original duration notation verbatim, with no numeric unit
assigned. Null, empty string and literal `\N` remain distinct. Photos remain in
`beans.photo_jpeg` as bounded JPEG base64 data URL strings (maximum 2,000,000
characters), consistent with existing photos. New archive validation also checks base64 encoding and JPEG start/end markers.

The pinned DuckDB-Wasm 1.33.1-dev57.0 emits BYTE_ARRAY with String/UTF8 annotation
for strings and photos, INT32 with Date annotation for dates, INT64 with
Timestamp(isAdjustedToUTC=false, timeUnit=microseconds) for timestamps, and
DOUBLE for numbers. Parquet columns are OPTIONAL, including required logical
fields; required values are enforced by manifest/schema and row validation.
The pinned runtime can normalize IEEE negative zero to positive zero when
materializing tables (also present in historical imports). Numerical zero is
preserved; sign-bit fidelity for zero is not guaranteed by this reader. This
boundary is separate from decimal precision and is recorded in PLAN.md.

The local DuckDB `TIMESTAMP` is timezone-naive: CoffeeOS interprets its stored
calendar components as UTC. External readers must apply that convention without
converting the values through local time. Export/import copies database tables
directly; table records never pass through JavaScript Date or JSON. See the
independent-reader verification below for emitted annotations and exact values.

`bean_name` is a derived session display field and is excluded. Paths, backend
metadata, lock names, credentials, browser settings and device identity are
excluded. Existing database and snapshot identities do not change.

## Format 2: preserve historically accepted damaged photos

New photo writes and default legacy imports require canonical base64 with JPEG
start/end markers. A historical CSV/Parquet file can contain photo strings accepted
by earlier builds that fail those checks. **Import an older backup → Preserve
damaged legacy photo bytes** explicitly allows the old bounded JPEG-prefix/base64
shape, without rewriting, decoding or discarding its bytes. Existing saved values
remain accessible on startup, and an unchanged historical photo can be retained
when editing its bean. Replacement photos still use the new validation.

Exports inspect their actual staged tables before offering a download. Healthy
collections retain format 1. A collection or immutable recovery containing those
old opaque photo values exports `format_version: 2`, `data_schema_version: 1`,
and the required manifest property `photo_encoding: "legacy-opaque-v1"`. This is
an explicit compatibility contract: only photo validation changes; the three
archive files, Parquet schemas, field meanings/units, checksums, limits and merge
rules remain identical. Format 2 readers accept the historical bounded photo
shape, keep the exact original string and disclose that some photos may not
display. They do not promise that the retained bytes decode as an image.

Format 2 filenames include `-legacy-photos-v2`; export and restore previews state
the compatibility requirement. Earlier CoffeeOS readers reject format 2 rather
than losing photos. Upgrade those readers before restoring it. Existing format 1
archives remain readable. Original historical files, original stored snapshots
and retained recovery bytes are never rewritten by this validation change.

If an earlier build produced an unreadable format 1 archive containing a damaged
photo, keep the original archive, extract its two Parquet files with a standard ZIP
reader, and import them through the explicit legacy preservation option. This
retains every original table value; the next export uses readable format 2. Drive
sync with a local legacy-photo collection checks the cloud archive format before
accepting an equal fingerprint, uploading a new format 2 snapshot when an old
format 1 snapshot would otherwise be reused. Older Drive files remain intact.

## Consistency, bounds and merge

Both tables and their counts are captured in one serialized database operation.
Application writes cannot interleave. Logical readability is checked in a separate serialized staging/rollback operation.
Hashing and ZIP packaging run outside the database queue. Export fails without replacing an earlier prepared download
if the collection cannot fit the reader's limits.

There is no application-imposed cap on archive or total expanded collection
size. The manifest is limited to **64 KiB**; the ordinary ZIP format's 32-bit
sizes and offsets still apply (ZIP64 is unsupported). Entry sizes are inspected
before extraction; actual output is bounded by the declared entry size during
incremental decompression, with
length/CRC and SHA-256 checks afterward. Declared row counts never size an
allocation. A ZIP bomb with dishonest sizes fails before staging. Staging also
checks the actual ordered Parquet schema, counts, finite values, required fields,
unique IDs, photos and internal relationships before any live write.

Removing the collection size cap does not guarantee that every iOS device
can process every possible compressed Parquet file. Users manage storage and data
usage. Desktop Safari photo fixture
measurements and physical-device gaps are recorded in PLAN.md. A 30-photo,
30.8 MB archive completed on desktop but had high coarse process RSS (about
2.1 GiB across new Safari/WebKit processes). Processing at or above 1 GB has not
been measured. The six-photo 6.2 MB fixture completed with an
aggregate peak around 1.3 GiB; shared/native memory is included, so this is not
a JavaScript heap measurement or proof of physical iPhone safety. Parquet decoding
has its own working memory in DuckDB beyond the archive buffers.

Selection validates and previews date, producer, counts, and new/updated/unchanged
records. Cancel makes no live changes. Confirmation merges by ID, updates differing
matches, and retains records absent from the backup. **Even an older backup can
overwrite matching records.** This is not replacement restore. A changed local
collection refreshes the preview and requires a second confirmation. Both tables
apply in one transaction through the existing durable snapshot path. For the
IndexedDB backend, the snapshot transaction stays open until SQL COMMIT resolves,
so a failed SQL commit cannot publish a candidate snapshot. An IndexedDB abort
after SQL commit preserves the earlier durable snapshot and reports the committed
write warning. Pre-commit
errors roll back; an error confirming post-commit durability reports the committed
write warning and refreshes displayed data. Users must avoid duplicate retries
and save a backup before closing the tab in that case.

## Additive import recovery storage

Before an archive merge overwrites any existing record, CoffeeOS captures both
live Parquet tables and counts, then atomically **adds** an IndexedDB record in
the existing `coffeos-snapshots` database (version 1), `snapshots` object store:

- key: `import-recovery-v1:<random UUID>`
- value: `{version: 1, exported_at: UTC timestamp, counts: {beans, brew_sessions},
  data: {beans: Uint8Array, brew_sessions: Uint8Array}}`

`add`, not `put`, prevents replacement even on a key collision. No recovery copy
is rotated or silently discarded. Failure (including quota, blocked storage, or
an undownloadably large recovery snapshot) aborts before live mutation. Copies
may remain after a failed/rolled-back import; each is still a valid pre-import
collection. No copy is necessary when every record is new or unchanged. This
storage is also required for OPFS imports that overwrite records; it does not
switch the selected backend. Existing `tables-v1`, `backend-v1`,
`schema-v1-before-photos`, OPFS database/WAL files and ownership lock are unchanged.

IO lists every recovery copy after reload. Click **Prepare recovery backup**, then
**Download recovery backup** to get a `.coffeeos` archive. Review and merge it using
the normal picker. No automatic reset or destructive rollback is provided.

## Historical formats

The collapsed **Import an older backup** retains combined or separate CSV/Parquet
imports, including mixed formats, optional historical photo fields, and partial
imports. Absent historical photo columns keep existing photos; explicit null
photos remain meaningful. Unquoted CSV `\N` means NULL; quoted `""` and `"\N"`
retain empty strings and the literal marker. New archives never contain CSV.

## Read outside CoffeeOS

Python 3, `zipfile`, and PyArrow (install separately) can read the fixture:

```python
from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json
import pyarrow.parquet as pq

with ZipFile('docs/fixtures/example-v1.coffeeos') as z:
    manifest = json.loads(z.read('manifest.json'))
    entries = {name: z.read(name) for name in z.namelist()}
    for spec in manifest['tables']:
        raw = entries[spec['path']]
        table = pq.read_table(BytesIO(raw))
        assert table.num_rows == spec['row_count']
        assert len(raw) == spec['byte_length']
        assert hashlib.sha256(raw).hexdigest() == spec['sha256']
        print(spec['name'], pq.ParquetFile(BytesIO(raw)).schema)
        print(table.to_pylist())
with ZipFile('repacked.zip', 'w', compression=ZIP_DEFLATED) as z:
    for name, raw in entries.items():
        z.writestr(name, raw)
```

`repacked.zip` is importable by CoffeeOS. No CoffeeOS-specific reader is needed to
read either Parquet table. Do not edit/repack only one entry without updating the
manifest hashes, lengths and row counts; validation will reject the mismatch.

## Format 3: preserve historical whitespace-only required text

Default CSV/Parquet imports now apply the archive's nonblank rule to bean IDs,
bean names, session IDs and session bean IDs. Validation uses the same SQL
whitespace predicate for every default import. Rejected imports do not change
live records or saved snapshots.

Older builds accepted some whitespace-only values (for example a quoted tab ID
or newline name). Existing storage remains readable without migration or
normalization. **Import an older backup → Preserve legacy whitespace-only names
and IDs exactly** explicitly permits these historical values. The older minimum
validation still applies: NULL, empty/space-trimmed-empty required strings,
duplicate keys, orphan sessions and invalid dates/numbers remain rejected.
Damaged photos have their own independent preservation checkbox.

A collection or immutable recovery containing these values exports format 3,
with `data_schema_version: 1`, `text_encoding: "legacy-whitespace-v1"` and
`photo_encoding: "legacy-opaque-v1"`. Format 3 includes format 2's photo
preservation allowance, whether or not that particular collection needs it.
All schemas, table paths, hashes, limits, relationships and units are unchanged.
Every original string is preserved, including IDs and foreign keys; no trimming,
replacement labels or reassigned IDs occur. The filename includes
`-legacy-fields-v3`, and local/Drive previews disclose the required reader version.

Healthy exports still use format 1; damaged-photo-only exports still use format 2.
Older readers reject format 3. If an old format 1/2 archive contains whitespace
fields that its reader rejects, retain the original, extract both Parquet tables,
and import using the explicit legacy text option (and photo option if needed).
The next export produces readable format 3. Recovery downloads inspect the saved
bytes, so older immutable copies work without rewriting their keys or payloads.
Drive creates a new readable compatibility backup even when an unreadable older
archive has the same content fingerprint; the original remote file is retained.

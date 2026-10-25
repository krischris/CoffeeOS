# DuckDB Parquet extensions

Signed DuckDB v1.5.4 extension binaries, compatible with the pinned
`@duckdb/duckdb-wasm` 1.33.1-dev57.0 runtime. They are imported through Vite and
served from the app's own origin for IndexedDB snapshots. Signature verification
remains enabled. Vite preserves the canonical filename in a hashed directory
because DuckDB derives the extension entry point from the filename.

Sources (download with `curl --compressed` to decode HTTP content encoding):

- EH: https://extensions.duckdb.org/v1.5.4/wasm_eh/parquet.duckdb_extension.wasm
- MVP: https://extensions.duckdb.org/v1.5.4/wasm_mvp/parquet.duckdb_extension.wasm
- License: https://github.com/duckdb/duckdb/blob/v1.5.4/LICENSE

SHA-256 of decoded files:

```text
eh   4845705bbd69fc9ad52878d96a505c73cae4a6c509822079cc2413e5eb437f95
mvp  b64c255a7f7d06cc234535b2f0ecab345fda91bffff5509d3179004bc13aa19a
```

When upgrading DuckDB-Wasm, replace both extensions with signed binaries matching
its embedded DuckDB version and repeat the Firefox persistence tests for EH and
MVP. DuckDB is distributed under the [MIT license](../../../public/duckdb.LICENSE.txt),
which is also included in the built site.

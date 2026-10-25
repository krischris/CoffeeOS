import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  build: {
    rolldownOptions: {
      output: {
        // DuckDB derives an extension's entry point from its filename. Hash the
        // directory instead, preserving both cache busting and the expected name.
        assetFileNames: (asset) => asset.names.includes('parquet.duckdb_extension.wasm')
          ? 'assets/duckdb/[hash]/parquet.duckdb_extension.wasm'
          : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
});

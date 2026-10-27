import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  plugins: [{
    name: 'drive-authorization-headers',
    configureServer(server) { server.middlewares.use(authorizationHeaders); },
    configurePreviewServer(server) { server.middlewares.use(authorizationHeaders); },
  }],
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

// Only this static helper may retain Google's popup relationship. The database
// document, workers and every other asset retain the configured isolation policy.
function authorizationHeaders(req: { url?: string }, res: { setHeader: (name: string, value: string) => unknown }, next: () => void): void {
  if (new URL(req.url ?? '/', 'http://localhost').pathname.endsWith('/drive-auth.html')) {
    // Vite's later static middleware also sets server.headers. Intercept these
    // two fields for this response so it cannot overwrite the helper policy.
    const original = res.setHeader.bind(res);
    res.setHeader = (name, value) => original(name,
      name.toLowerCase() === 'cross-origin-opener-policy' ? 'same-origin-allow-popups'
        : name.toLowerCase() === 'cross-origin-embedder-policy' ? 'unsafe-none' : value);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}

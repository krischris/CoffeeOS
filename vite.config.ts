import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base: './',
  plugins: [offlineBuild(), {
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

// Generate from final output, including copied public files and Vite-managed
// DuckDB assets. Build identity belongs only to the shell cache, never user data.
function offlineBuild(): Plugin {
  return {
    name: 'coffeeos-offline-build',
    apply: 'build',
    async writeBundle(options) {
      const directory = resolve(options.dir!);
      const paths: string[] = [];
      async function visit(folder: string): Promise<void> {
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          const path = resolve(folder, entry.name);
          if (entry.isDirectory()) await visit(path);
          else paths.push(relative(directory, path).split('\\').join('/'));
        }
      }
      await visit(directory);
      const files = [];
      for (const path of paths.sort()) {
        const bytes = await readFile(resolve(directory, path));
        files.push({ path, hash: createHash('sha256').update(bytes).digest('hex') });
      }
      const id = createHash('sha256').update(JSON.stringify(files)).digest('hex');
      const workerPath = resolve(directory, 'coi-serviceworker.js');
      const worker = await readFile(workerPath, 'utf8');
      const placeholder = 'const offlineBuild = null;';
      if (!worker.includes(placeholder)) throw new Error('Missing offline build placeholder');
      await writeFile(workerPath, worker.replace(placeholder, `const offlineBuild = ${JSON.stringify({ id, files })};`));
    },
  };
}

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

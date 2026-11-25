import { defineConfig } from 'vite';

// Build id written to /version.json so an open game can tell a newer version is live.
const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev-' + Date.now().toString(36);
function versionFile() {
  return { name: 'version-file', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }); } };
}
export default defineConfig({
  plugins: [versionFile()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
  server: { host: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});

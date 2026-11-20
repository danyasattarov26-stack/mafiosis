import { defineConfig } from 'vite';

// Serves the Vercel function in api/game.js during `vite dev` / `vite preview`,
// so the whole game (accounts, saves, friends) runs locally too.
function localApi() {
  const handle = async (req, res, next) => {
    if (!req.url.startsWith('/api/game')) return next();
    try {
      const mod = await import('./api/game.js');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
      const fn = mod[req.method] || mod.default;
      const r = await fn(request);
      res.statusCode = r.status;
      r.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { console.error(e); res.statusCode = 500; res.end('{"error":"local api crashed"}'); }
  };
  return { name: 'local-api', configureServer(s) { s.middlewares.use(handle); }, configurePreviewServer(s) { s.middlewares.use(handle); } };
}

// Build id baked into the app and written to /version.json, so open games can tell a newer version is live.
const BUILD = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev-' + Date.now().toString(36);
function versionFile() {
  return { name: 'version-file', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }); } };
}

export default defineConfig({
  plugins: [localApi(), versionFile()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
  server: { host: true },
});

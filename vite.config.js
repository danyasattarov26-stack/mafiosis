import { defineConfig } from 'vite';

// Locally, serve /api/scores from the same handler Vercel runs (it keeps scores in memory without a Blob token).
function localApi() {
  const handle = async (req, res, next) => {
    if (!req.url.startsWith('/api/scores')) return next();
    const api = await import('./api/scores.js');
    let body = ''; for await (const c of req) body += c;
    const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? body : undefined });
    const out = await (req.method === 'POST' ? api.POST : api.GET)(request);
    res.statusCode = out.status; out.headers.forEach((v, k) => res.setHeader(k, v)); res.end(await out.text());
  };
  return { name: 'local-api', configureServer(s) { s.middlewares.use(handle); }, configurePreviewServer(s) { s.middlewares.use(handle); } };
}

export default defineConfig({ plugins: [localApi()], build: { target: 'es2022', chunkSizeWarningLimit: 1200 } });

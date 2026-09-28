// Minimal static file server for local preview: node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] || 8080);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const path = normalize(join(root, url === '/' ? 'index.html' : url));
  if (!path.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}`));

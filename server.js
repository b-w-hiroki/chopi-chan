// ちょぴちゃん — ローカル確認用の静的サーバー（任意・依存ゼロ）
// 本番は GitHub Pages（site/ を配信）。手元で確認したいときだけ `node server.js`。
// ※ file:// で直接開くと fetch が動かないため、ローカル確認はこのサーバー経由で。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'site');
const PORT = process.env.PORT || 4321;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🍙 chopi-chan（ローカル確認用）`);
  console.log(`  → http://${HOST}:${PORT}\n`);
});

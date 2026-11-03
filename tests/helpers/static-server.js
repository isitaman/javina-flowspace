/* Server statis untuk `web/` — dipakai tes E2E supaya tidak bergantung
 * pada python/`http.server` dan bisa jalan di CI (Linux) maupun lokal. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB_ROOT = path.resolve(__dirname, '..', '..', 'web');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function start(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = '/';
      try {
        urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      } catch (e) { /* URL aneh: biarkan default */ }
      if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';

      const rel = path.normalize(urlPath).replace(/^([/\\])+/, '');
      const filePath = path.resolve(WEB_ROOT, rel);

      // Jangan izinkan keluar dari web/ (path traversal).
      if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found: ' + urlPath);
          return;
        }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://127.0.0.1:${actual}/` });
    });
  });
}

module.exports = { start, WEB_ROOT };

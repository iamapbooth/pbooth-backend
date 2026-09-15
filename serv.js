const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PHOTOS_DIR = path.join(__dirname, 'photos');

if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJSON(res, 404, { ok: false, error: 'not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  // capture the photo
  if (pathname === '/api/capture' && req.method === 'POST') {
    try {
      const raw = await readBody(req, 25 * 1024 * 1024); // 25MB cap
      const body = JSON.parse(raw.toString('utf8'));
      const dataUrl = body.image || '';
      const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
      if (!match) {
        sendJSON(res, 400, { ok: false, error: 'expected a base64 PNG or JPEG data URL in "image"' });
        return;
      }
      const ext = match[1] === 'jpeg' ? 'jpg' : 'png';
      const buffer = Buffer.from(match[2], 'base64');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filterTag = body.filter ? `-${safeFilename(String(body.filter))}` : '';
      const filename = `pbooth-${stamp}${filterTag}.${ext}`;
      const filePath = path.join(PHOTOS_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      sendJSON(res, 200, {
        ok: true,
        filename,
        url: `/photos/${filename}`,
        bytes: buffer.length,
        savedAt: new Date().toISOString(),
      });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // saved phototoshotot
  if (pathname === '/api/photos' && req.method === 'GET') {
    try {
      const files = fs.readdirSync(PHOTOS_DIR)
        .filter((f) => /\.(png|jpe?g)$/i.test(f))
        .map((f) => {
          const stat = fs.statSync(path.join(PHOTOS_DIR, f));
          return { filename: f, url: `/photos/${f}`, bytes: stat.size, mtime: stat.mtime.toISOString() };
        })
        .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
        .slice(0, 100);
      sendJSON(res, 200, { ok: true, count: files.length, photos: files });
    } catch (err) {
      sendJSON(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  // deleeteing a phototototoshotot
  if (pathname.startsWith('/api/photos/') && req.method === 'DELETE') {
    const filename = safeFilename(pathname.replace('/api/photos/', ''));
    fs.unlink(path.join(PHOTOS_DIR, filename), (err) => {
      if (err) { sendJSON(res, 404, { ok: false, error: 'not found' }); return; }
      sendJSON(res, 200, { ok: true, deleted: filename });
    });
    return;
  }

  // saved
  if (pathname.startsWith('/photos/')) {
    const filePath = path.join(PHOTOS_DIR, safeFilename(pathname.replace('/photos/', '')));
    serveStatic(req, res, filePath);
    return;
  }

  // fonrtend
  let staticPath = pathname === '/' ? '/index.html' : pathname;
  staticPath = path.join(PUBLIC_DIR, staticPath);
  if (!staticPath.startsWith(PUBLIC_DIR)) {
    sendJSON(res, 403, { ok: false, error: 'forbidden' });
    return;
  }
  serveStatic(req, res, staticPath);
});

server.listen(PORT, () => {
  console.log(`pbooth: http://localhost:${PORT}`);
  console.log(`Saving photos to: ${PHOTOS_DIR}`);
});
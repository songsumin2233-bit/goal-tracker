// 이 PC에서 앱을 여는 작은 정적 서버. 열기.bat이 실행한다. (사용: node scripts/serve.mjs)
// 브라우저 데이터는 주소(포트 포함)마다 따로 저장되므로 포트를 고정한다.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const PORT = 5173;
const URL_ = `http://localhost:${PORT}/`;
const root = fileURLToPath(new URL('../', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
};

function openBrowser() {
  const cmd = process.platform === 'win32' ? `start "" "${URL_}"` : process.platform === 'darwin' ? `open "${URL_}"` : `xdg-open "${URL_}"`;
  exec(cmd);
}

const server = createServer(async (req, res) => {
  let path;
  try {
    path = normalize(join(root, decodeURIComponent(new URL(req.url, URL_).pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep) && path + sep !== root) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('찾을 수 없어요');
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // 이미 켜져 있으면(다른 창에서 실행 중) 브라우저만 연다
    console.log(`이미 ${URL_} 에서 실행 중이에요. 브라우저만 열게요.`);
    openBrowser();
    setTimeout(() => process.exit(0), 500);
  } else {
    console.error(e.message);
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`내 목표 앱을 열었어요: ${URL_}`);
  console.log('이 창을 닫으면 앱 서버도 꺼져요. (데이터는 브라우저에 그대로 남아요)');
  if (!process.env.NO_OPEN) openBrowser();
});

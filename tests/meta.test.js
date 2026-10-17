import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { APP_NAME, APP_VERSION } from '../js/config.js';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');

test('앱 이름·버전이 config.js와 일치한다 (다르면 npm run sync)', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, APP_NAME);
  assert.equal(manifest.short_name, APP_NAME);
  assert.match(read('sw.js'), new RegExp(`const VERSION = '${APP_VERSION.replace(/\./g, '\\.')}';`));
  assert.match(read('index.html'), new RegExp(`<title>${APP_NAME}</title>`));
});

test('GitHub Pages 하위 경로를 위해 모든 경로가 상대 경로(./)다', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) assert.ok(icon.src.startsWith('./'), icon.src);
  const html = read('index.html');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) assert.ok(url.startsWith('./'), url);
  assert.match(read('js/pwa.js'), /register\('\.\/sw\.js'\)/);
});

test('서비스워커가 캐시하는 파일이 모두 존재한다', () => {
  const list = [...read('sw.js').matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]).filter(p => p !== './');
  assert.ok(list.length > 5);
  for (const p of list) assert.ok(existsSync(new URL(p, root)), `${p} 없음`);
});

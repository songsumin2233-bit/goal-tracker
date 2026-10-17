// js/config.js의 앱 이름·버전을 manifest.webmanifest, sw.js, index.html에 맞춰 넣는다.
// 사용: npm run sync
import { readFileSync, writeFileSync } from 'node:fs';
import { APP_NAME, APP_VERSION } from '../js/config.js';

const root = new URL('../', import.meta.url);
const edit = (file, fn) => {
  const url = new URL(file, root);
  const before = readFileSync(url, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(url, after);
    console.log(`갱신: ${file}`);
  }
};

edit('manifest.webmanifest', s => {
  const m = JSON.parse(s);
  m.name = APP_NAME;
  m.short_name = APP_NAME;
  return `${JSON.stringify(m, null, 2).replace(/\{\s+"src": ([^\n]+),\s+"sizes": ([^\n]+),\s+"type": ([^\n]+),\s+"purpose": ([^\n]+)\s+\}/g, '{ "src": $1, "sizes": $2, "type": $3, "purpose": $4 }')}\n`;
});
edit('sw.js', s => s.replace(/const VERSION = '[^']*';/, `const VERSION = '${APP_VERSION}';`));
edit('index.html', s => s.replace(/<title>[^<]*<\/title>/, `<title>${APP_NAME}</title>`));
console.log(`이름 "${APP_NAME}", 버전 ${APP_VERSION}`);

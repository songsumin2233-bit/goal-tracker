// 앱 아이콘(192·512px PNG)을 외부 도구 없이 그린다. 사용: npm run icons
// 진한 청록 배경 + 진행 링(3/4) + 체크 표시. 내용은 가운데 안전 영역(지름 80%) 안에 둬서 maskable로도 쓴다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 118, 110];
const FG = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 단위 좌표(0~1)에서 흰색 불투명도(0~1)
function shade(u, v) {
  const r = Math.hypot(u - 0.5, v - 0.5);
  const ring = Math.abs(r - 0.28) <= 0.04;
  if (ring) {
    let ang = Math.atan2(u - 0.5, -(v - 0.5)); // 위쪽에서 시계 방향
    if (ang < 0) ang += Math.PI * 2;
    return ang <= Math.PI * 1.5 ? 1 : 0.3;
  }
  // 링 끝을 둥글게
  const endA = [0.5, 0.22], endB = [0.22, 0.5];
  if (Math.hypot(u - endA[0], v - endA[1]) <= 0.04 || Math.hypot(u - endB[0], v - endB[1]) <= 0.04) return 1;
  const check = [[0.395, 0.51], [0.47, 0.585], [0.615, 0.425]];
  if (distToSegment(u, v, check[0], check[1]) <= 0.035 || distToSegment(u, v, check[1], check[2]) <= 0.035) return 1;
  return 0;
}

function draw(size) {
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) a += shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
      }
      a /= SS * SS;
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) rgb[i + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  return png(size, rgb);
}

const dir = new URL('../icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(new URL(`icon-${size}.png`, dir), draw(size));
  console.log(`icons/icon-${size}.png`);
}

// 날짜는 항상 'YYYY-MM-DD' 문자열로 다룬다.
// 문자열을 Date로 파싱하면 UTC로 해석되므로, 연·월·일 숫자로 '일 번호'를 직접 계산한다.

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = n => String(n).padStart(2, '0');
const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function parseYMD(s) {
  if (typeof s !== 'string') return null;
  const m = YMD_RE.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export const isYMD = s => parseYMD(s) !== null;

export const formatYMD = (y, m, d) => `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`;

// 1970-01-01을 0으로 하는 일 번호 (그레고리력, 시간대와 무관)
export function dayNumber(s) {
  const p = parseYMD(s);
  if (!p) throw new RangeError(`날짜 형식이 아니에요: ${s}`);
  let { y, m, d } = p;
  if (m <= 2) y -= 1;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return formatYMD(y, m, d);
}

// b − a (일)
export const diffDays = (a, b) => dayNumber(b) - dayNumber(a);
export const addDays = (s, n) => fromDayNumber(dayNumber(s) + n);
export const weekday = s => WEEKDAYS[(((dayNumber(s) + 4) % 7) + 7) % 7]; // 1970-01-01은 목요일

// 타임스탬프(ms)나 Date를 기기 로컬 시간 기준 날짜 문자열로
export function localYMD(t) {
  const dt = t instanceof Date ? t : new Date(t);
  return formatYMD(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

// 로컬 시간 기준 그 날짜의 특정 시각 타임스탬프
export function localTime(s, hour = 12) {
  const { y, m, d } = parseYMD(s);
  return new Date(y, m - 1, d, hour).getTime();
}

export const todayYMD = () => localYMD(new Date());

// '11/10'
export function formatMD(s) {
  const p = parseYMD(s);
  return p ? `${p.m}/${p.d}` : '';
}

// '11/10 (화)'
export const formatMDW = s => `${formatMD(s)} (${weekday(s)})`;

// '2026년 11월 10일'
export function formatLong(s) {
  const p = parseYMD(s);
  return p ? `${p.y}년 ${p.m}월 ${p.d}일` : '';
}

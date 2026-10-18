// 저장·불러오기·검증. 나중에 클라우드 동기화로 바꿀 때 이 모듈만 바꾸면 되도록 한곳에 모은다.

import { isYMD, addDays, localTime } from './date.js';
import { MEASURES } from './core.js';

export const STORAGE_KEY = 'goals.v1';
export const BROKEN_KEY = 'goals.v1.broken';
const GOAL_STATUSES = ['active', 'done', 'dropped'];
const THEMES = ['auto', 'light', 'dark'];
const MAX_ERRORS = 20;

export function emptyDB(settings = {}) {
  return {
    version: 1,
    goals: [],
    tasks: [],
    logs: [],
    extensions: [],
    settings: { theme: 'auto', lastBackupAt: null, sample: false, ...settings },
  };
}

export function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = v => typeof v === 'string';

// 불러온 JSON(문자열 또는 객체)을 검증·정규화한다. 틀린 곳은 errors에 모아 돌려준다.
export function validateDB(input) {
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['JSON 형식이 아니에요. 괄호나 쉼표가 빠졌는지 확인하세요.'] };
    }
  }
  if (!isObj(obj)) return { ok: false, errors: ['최상위 값이 { } 객체가 아니에요.'] };

  const errors = [];
  const err = msg => { if (errors.length < MAX_ERRORS) errors.push(msg); };

  if (obj.version !== 1) err(`version은 1이어야 해요 (지금: ${JSON.stringify(obj.version)})`);
  if (!Array.isArray(obj.goals)) err('goals 목록이 없어요.');
  for (const key of ['tasks', 'logs', 'extensions']) {
    if (obj[key] !== undefined && !Array.isArray(obj[key])) err(`${key}는 목록([ ])이어야 해요.`);
  }
  if (errors.length) return { ok: false, errors };

  const goals = [];
  const goalIds = new Set();
  obj.goals.forEach((g, i) => {
    const at = `goals[${i}]`;
    if (!isObj(g)) return err(`${at}: 객체가 아니에요.`);
    if (!isStr(g.id) || !g.id) return err(`${at}.id: 비어 있어요.`);
    if (goalIds.has(g.id)) return err(`${at}.id: "${g.id}"가 중복돼요.`);
    const title = isStr(g.title) ? g.title.trim() : '';
    if (!title) err(`${at}.title: 제목이 비어 있어요.`);
    if (!MEASURES.includes(g.measure)) err(`${at}.measure: ${MEASURES.join(' / ')} 중 하나여야 해요.`);
    if (!isYMD(g.startDate)) err(`${at}.startDate: YYYY-MM-DD 날짜가 아니에요.`);
    if (!isYMD(g.dueDate)) err(`${at}.dueDate: YYYY-MM-DD 날짜가 아니에요.`);
    else if (isYMD(g.startDate) && g.dueDate < g.startDate) err(`${at}.dueDate: 시작일보다 빨라요.`);
    const status = g.status ?? 'active';
    if (!GOAL_STATUSES.includes(status)) err(`${at}.status: active / done / dropped 중 하나여야 해요.`);
    if (g.originalDueDate != null && !isYMD(g.originalDueDate)) err(`${at}.originalDueDate: 날짜가 아니에요.`);
    if (g.closedAt != null && !isYMD(g.closedAt)) err(`${at}.closedAt: 날짜가 아니에요.`);

    let startValue = null;
    let targetValue = null;
    if (g.measure === 'cumulative') {
      if (!isNum(g.targetValue) || g.targetValue <= 0) err(`${at}.targetValue: 0보다 큰 숫자여야 해요.`);
      startValue = 0;
      targetValue = g.targetValue;
    } else if (g.measure === 'current') {
      if (!isNum(g.startValue)) err(`${at}.startValue: 숫자가 아니에요.`);
      if (!isNum(g.targetValue)) err(`${at}.targetValue: 숫자가 아니에요.`);
      else if (g.targetValue === g.startValue) err(`${at}.targetValue: 시작값과 같으면 계산할 수 없어요.`);
      startValue = g.startValue;
      targetValue = g.targetValue;
    }
    goalIds.add(g.id);
    goals.push({
      id: g.id,
      title,
      category: isStr(g.category) ? g.category.trim() : '',
      measure: g.measure,
      unit: (g.measure === 'cumulative' || g.measure === 'current') && isStr(g.unit) ? g.unit.trim() : '',
      startValue,
      targetValue,
      startDate: g.startDate,
      dueDate: g.dueDate,
      originalDueDate: g.originalDueDate ?? null,
      status,
      closedAt: status === 'active' ? null : (g.closedAt ?? g.dueDate),
      createdAt: isNum(g.createdAt) ? g.createdAt : 0,
    });
  });

  const tasks = [];
  const taskIds = new Set();
  (obj.tasks ?? []).forEach((t, i) => {
    const at = `tasks[${i}]`;
    if (!isObj(t)) return err(`${at}: 객체가 아니에요.`);
    if (!isStr(t.id) || !t.id || taskIds.has(t.id)) return err(`${at}.id: 비어 있거나 중복돼요.`);
    if (!goalIds.has(t.goalId)) return err(`${at}.goalId: 없는 목표("${t.goalId}")를 가리켜요.`);
    const title = isStr(t.title) ? t.title.trim() : '';
    if (!title) err(`${at}.title: 비어 있어요.`);
    if (t.dueDate != null && !isYMD(t.dueDate)) err(`${at}.dueDate: 날짜가 아니에요.`);
    if (t.startDate != null) {
      if (!isYMD(t.startDate)) err(`${at}.startDate: 날짜가 아니에요.`);
      else if (!isYMD(t.dueDate)) err(`${at}.startDate: 마감일 없이 시작일만 있어요.`);
      else if (t.dueDate < t.startDate) err(`${at}.dueDate: 시작일보다 빨라요.`);
    }
    if (t.doneAt != null && !isNum(t.doneAt)) err(`${at}.doneAt: 숫자(시각)가 아니에요.`);
    taskIds.add(t.id);
    const done = t.done === true;
    tasks.push({
      id: t.id,
      goalId: t.goalId,
      title,
      startDate: t.startDate ?? null,
      dueDate: t.dueDate ?? null,
      done,
      doneAt: done ? (t.doneAt ?? null) : null,
      order: isNum(t.order) ? t.order : i,
    });
  });

  const logs = [];
  const logIds = new Set();
  (obj.logs ?? []).forEach((l, i) => {
    const at = `logs[${i}]`;
    if (!isObj(l)) return err(`${at}: 객체가 아니에요.`);
    if (!isStr(l.id) || !l.id || logIds.has(l.id)) return err(`${at}.id: 비어 있거나 중복돼요.`);
    if (!goalIds.has(l.goalId)) return err(`${at}.goalId: 없는 목표("${l.goalId}")를 가리켜요.`);
    if (!isYMD(l.date)) err(`${at}.date: 날짜가 아니에요.`);
    if (!isNum(l.value)) err(`${at}.value: 숫자가 아니에요.`);
    logIds.add(l.id);
    logs.push({ id: l.id, goalId: l.goalId, date: l.date, value: l.value, note: isStr(l.note) ? l.note : '' });
  });

  const extensions = [];
  (obj.extensions ?? []).forEach((x, i) => {
    const at = `extensions[${i}]`;
    if (!isObj(x)) return err(`${at}: 객체가 아니에요.`);
    if (!goalIds.has(x.goalId)) return err(`${at}.goalId: 없는 목표를 가리켜요.`);
    if (!isYMD(x.from) || !isYMD(x.to)) err(`${at}: from/to가 날짜가 아니에요.`);
    extensions.push({ goalId: x.goalId, from: x.from, to: x.to, at: isNum(x.at) ? x.at : 0 });
  });

  const s = isObj(obj.settings) ? obj.settings : {};
  const settings = {
    theme: THEMES.includes(s.theme) ? s.theme : 'auto',
    lastBackupAt: isNum(s.lastBackupAt) ? s.lastBackupAt : null,
    sample: s.sample === true,
  };

  if (errors.length) return { ok: false, errors };
  return { ok: true, db: { version: 1, goals, tasks, logs, extensions, settings } };
}

export const serialize = db => JSON.stringify(db, null, 2);

// storage는 localStorage와 같은 getItem/setItem을 가진 객체 (테스트에서 바꿔 끼울 수 있게)
export function loadDB(storage = globalThis.localStorage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: 'unavailable', db: emptyDB(), errors: ['이 브라우저에서는 저장소를 쓸 수 없어요.'] };
  }
  if (raw == null) return { status: 'empty', db: null };
  const res = validateDB(raw);
  if (res.ok) return { status: 'ok', db: res.db };
  // 읽을 수 없는 데이터는 지우지 않고 따로 보관한다
  try { storage.setItem(BROKEN_KEY, raw); } catch { /* 보관 실패는 무시 */ }
  return { status: 'corrupt', db: emptyDB(), errors: res.errors };
}

export function saveDB(db, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(db));
    return { ok: true };
  } catch (e) {
    const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
    return {
      ok: false,
      error: quota ? '저장 공간이 부족해서 저장하지 못했어요. 백업 후 오래된 기록을 지워 주세요.' : '저장하지 못했어요. 브라우저 설정(개인정보 보호 모드 등)을 확인해 주세요.',
    };
  }
}

// 처음 열었을 때 보여 줄 예시. 오늘 기준으로 날짜를 잡아 상태가 골고루 나오게 한다.
//  체중(현재값형, 앞서감) · 운동(누적형, 뒤처짐) · 킥오프 준비(체크리스트, 순조) · 보고서(직접 %, 기한 초과)
export function createSampleDB(today, now) {
  const d = n => addDays(today, n);
  const db = emptyDB({ sample: true });
  const goal = (id, title, category, measure, start, due, extra = {}) => db.goals.push({
    id, title, category, measure, unit: '', startValue: null, targetValue: null,
    startDate: d(start), dueDate: d(due), originalDueDate: null, status: 'active', closedAt: null, createdAt: now,
    ...extra,
  });
  let n = 0;
  const log = (goalId, day, value, note = '') => db.logs.push({ id: `sl${++n}`, goalId, date: d(day), value, note });

  goal('sg1', '체중 5kg 줄이기', '일상', 'current', -45, 45, { unit: 'kg', startValue: 75, targetValue: 70 });
  log('sg1', -45, 75, '시작');
  log('sg1', -31, 74.2);
  log('sg1', -17, 73.1);
  log('sg1', -3, 71.8, '야식 끊은 효과');

  goal('sg2', '12주 동안 운동 36회', '일상', 'cumulative', -42, 42, { unit: '회', startValue: 0, targetValue: 36 });
  for (let i = 0; i < 12; i++) log('sg2', -41 + Math.round(i * 3.4), 1);

  goal('sg3', '신규 프로젝트 킥오프 준비', '업무', 'checklist', -14, 14);
  const tasks = [
    ['이해관계자 목록 정리', null, -12],
    ['목표·범위 초안 작성', null, -9],
    ['일정표 초안', null, -6],
    ['예산 요청서 제출', null, -2],
    ['킥오프 안건 공유', -1, null],
    ['회의실·화상 링크 준비', 0, null],
    ['역할 분담표 확정', 2, null, -1],
    ['킥오프 발표 자료 리허설', 5, null, 3],
  ];
  tasks.forEach(([title, due, doneDay, start], i) => db.tasks.push({
    id: `st${i + 1}`, goalId: 'sg3', title,
    startDate: start == null ? null : d(start),
    dueDate: due == null ? null : d(due),
    done: doneDay != null,
    doneAt: doneDay != null ? localTime(d(doneDay), 18) : null,
    order: i,
  }));

  goal('sg4', '3분기 업무 보고서 작성', '업무', 'manual', -40, -3);
  log('sg4', -35, 20, '목차 확정');
  log('sg4', -20, 50);
  log('sg4', -6, 80, '검토만 남음');

  return db;
}

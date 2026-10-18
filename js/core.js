// 달성률·기대 진행률·상태 계산. DOM과 현재 시각을 쓰지 않는 순수 함수만 둔다.
// 오늘 날짜는 항상 today('YYYY-MM-DD') 인자로 받는다.

import { diffDays, isYMD, localYMD, formatMD } from './date.js';

export const MEASURES = ['checklist', 'cumulative', 'current', 'manual'];

export const MEASURE_INFO = {
  checklist: { label: '체크리스트', example: '이사 준비, 자격증 1~10장' },
  cumulative: { label: '누적형 수치', example: '운동 36회, 책 20권' },
  current: { label: '현재값형 수치', example: '체중 75→70kg, 토익 점수' },
  manual: { label: '직접 %', example: '보고서 작성, 포트폴리오' },
};

export const STATUS_LABEL = {
  overdue: '기한 초과',
  behind: '뒤처짐',
  onTrack: '순조',
  ahead: '앞서감',
  achieved: '달성',
  notStarted: '시작 전',
  done: '완료',
  dropped: '포기',
};

const STATUS_RANK = { overdue: 0, behind: 1, onTrack: 2, ahead: 3, achieved: 4, notStarted: 5 };
const GAP_THRESHOLD = 10; // %p

export const clamp01 = x => Math.min(1, Math.max(0, x));
export const round1 = x => Math.round(x * 10) / 10;

// 날짜순, 같은 날이면 입력 순서(배열 순서)대로 정렬한 그 목표의 기록
export function orderedLogs(goalId, logs) {
  return logs
    .map((log, i) => ({ log, i }))
    .filter(x => x.log.goalId === goalId)
    .sort((a, b) => (a.log.date < b.log.date ? -1 : a.log.date > b.log.date ? 1 : a.i - b.i))
    .map(x => x.log);
}

export function latestLog(goalId, logs) {
  const list = orderedLogs(goalId, logs);
  return list.length ? list[list.length - 1] : null;
}

export const goalTasks = (goalId, tasks) =>
  tasks.filter(t => t.goalId === goalId).sort((a, b) => a.order - b.order);

// 값 하나로부터 달성률(제한 없음)을 계산
function progressFromValue(goal, value) {
  switch (goal.measure) {
    case 'cumulative': return value / goal.targetValue;
    case 'current': return (value - goal.startValue) / (goal.targetValue - goal.startValue) || 0; // -0 방지
    case 'manual': return value / 100;
    default: return 0;
  }
}

// 달성률 (0 미만·1 초과도 그대로 돌려준다. 표시할 때 제한)
export function rawProgress(goal, db) {
  switch (goal.measure) {
    case 'checklist': {
      const ts = db.tasks.filter(t => t.goalId === goal.id);
      return ts.length ? ts.filter(t => t.done).length / ts.length : 0;
    }
    case 'cumulative': {
      const sum = db.logs.filter(l => l.goalId === goal.id).reduce((s, l) => s + l.value, 0);
      return progressFromValue(goal, sum);
    }
    case 'current': {
      const last = latestLog(goal.id, db.logs);
      return progressFromValue(goal, last ? last.value : goal.startValue);
    }
    case 'manual': {
      const last = latestLog(goal.id, db.logs);
      return last ? progressFromValue(goal, last.value) : 0;
    }
    default:
      return 0;
  }
}

// 시간 경과율. today < 시작일이면 0, 기간이 0일이면 마감일 당일부터 1.
export function expectedProgress(goal, today) {
  const elapsed = diffDays(goal.startDate, today);
  if (elapsed < 0) return 0;
  const total = diffDays(goal.startDate, goal.dueDate);
  if (total <= 0) return today >= goal.dueDate ? 1 : 0;
  return clamp01(elapsed / total);
}

// 목표 하나의 현재 상태를 한 번에 계산
export function evaluate(goal, db, today) {
  const raw = rawProgress(goal, db);
  const progress = clamp01(raw);
  const expected = expectedProgress(goal, today);
  const gap = round1((progress - expected) * 100);
  const daysLeft = diffDays(today, goal.dueDate);
  let status;
  if (goal.status === 'done' || goal.status === 'dropped') status = goal.status;
  else if (raw >= 1) status = 'achieved';
  else if (today > goal.dueDate) status = 'overdue';
  else if (today < goal.startDate) status = 'notStarted';
  else if (gap >= GAP_THRESHOLD) status = 'ahead';
  else if (gap <= -GAP_THRESHOLD) status = 'behind';
  else status = 'onTrack';
  const noTasks = goal.measure === 'checklist' && !db.tasks.some(t => t.goalId === goal.id);
  return { raw, progress, over: raw > 1, expected, gap, daysLeft, status, noTasks };
}

// 현황 정렬: 기한 초과 → 뒤처짐(괴리 작은 순) → 순조 → 앞서감 → 달성 → 시작 전, 같으면 마감일 가까운 순
export function compareEvaluated(a, b) {
  const r = STATUS_RANK[a.e.status] - STATUS_RANK[b.e.status];
  if (r) return r;
  if (a.e.status === 'behind' && a.e.gap !== b.e.gap) return a.e.gap - b.e.gap;
  if (a.g.dueDate !== b.g.dueDate) return a.g.dueDate < b.g.dueDate ? -1 : 1;
  return a.g.title.localeCompare(b.g.title, 'ko');
}

export function activeEvaluated(db, today) {
  return db.goals
    .filter(g => g.status === 'active')
    .map(g => ({ g, e: evaluate(g, db, today) }))
    .sort(compareEvaluated);
}

// 화면 표시용 퍼센트. 33.3% → '33%', 99.96% → '99%'(달성 전엔 100%로 올리지 않음)
export const pctNumber = p => (p >= 1 ? 100 : Math.min(99, Math.floor(round1(clamp01(p) * 100))));

export function formatProgress(raw) {
  if (raw > 1) return '100% · 초과 달성';
  return `${pctNumber(raw)}%`;
}

export function formatGap(gap) {
  const sign = gap > 0 ? '+' : gap < 0 ? '−' : '';
  return `${sign}${Math.abs(gap).toFixed(1)}%p`;
}

export function dueLabel(daysLeft) {
  if (daysLeft > 0) return `D-${daysLeft}`;
  if (daysLeft === 0) return 'D-day';
  return `${-daysLeft}일 지남`;
}

// 숫자 표시: 소수 둘째 자리까지, 불필요한 0 제거
export function formatNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

// 수치형 목표의 숫자 요약: '12 / 36회', '75 → 70kg (현재 72kg)'
export function valueSummary(goal, db) {
  const u = goal.unit || '';
  if (goal.measure === 'cumulative') {
    const sum = db.logs.filter(l => l.goalId === goal.id).reduce((s, l) => s + l.value, 0);
    return `${formatNumber(sum)} / ${formatNumber(goal.targetValue)}${u}`;
  }
  if (goal.measure === 'current') {
    const last = latestLog(goal.id, db.logs);
    const cur = last ? last.value : goal.startValue;
    return `${formatNumber(goal.startValue)} → ${formatNumber(goal.targetValue)}${u} (현재 ${formatNumber(cur)}${u})`;
  }
  if (goal.measure === 'checklist') {
    const ts = db.tasks.filter(t => t.goalId === goal.id);
    return ts.length ? `할 일 ${ts.filter(t => t.done).length} / ${ts.length}개` : '';
  }
  return '';
}

// 기록 값 표시: '+1회', '72kg', '45%'
export function formatLogValue(goal, value) {
  if (goal.measure === 'cumulative') return `${value >= 0 ? '+' : ''}${formatNumber(value)}${goal.unit || ''}`;
  if (goal.measure === 'current') return `${formatNumber(value)}${goal.unit || ''}`;
  return `${formatNumber(value)}%`;
}

// 추이 그래프용: 기록이 있는 날짜마다 그날 끝의 달성률(제한 없음)
export function progressSeries(goal, db) {
  if (goal.measure === 'checklist') {
    const ts = db.tasks.filter(t => t.goalId === goal.id);
    const doneDates = ts.filter(t => t.done && t.doneAt != null).map(t => localYMD(t.doneAt)).sort();
    const points = [];
    doneDates.forEach((date, i) => {
      const p = { date, progress: (i + 1) / ts.length };
      if (points.length && points[points.length - 1].date === date) points[points.length - 1] = p;
      else points.push(p);
    });
    return { points, count: doneDates.length };
  }
  const logs = orderedLogs(goal.id, db.logs);
  const points = [];
  let sum = 0;
  for (const log of logs) {
    sum += log.value;
    const value = goal.measure === 'cumulative' ? sum : log.value;
    const p = { date: log.date, progress: progressFromValue(goal, value) };
    if (points.length && points[points.length - 1].date === log.date) points[points.length - 1] = p;
    else points.push(p);
  }
  return { points, count: logs.length };
}

// 현황 상단 배너 숫자
export function summary(db, today) {
  const list = activeEvaluated(db, today);
  const activeIds = new Set(list.map(x => x.g.id));
  return {
    activeCount: list.length,
    overdue: list.filter(x => x.e.status === 'overdue'),
    behind: list.filter(x => x.e.status === 'behind'),
    dueTodayTasks: db.tasks.filter(t => !t.done && t.dueDate === today && activeIds.has(t.goalId)).length, // 마감이 오늘인 것만
  };
}

// 할 일 날짜 입력(시작·마감, 둘 다 선택) 검사. 하나만 있으면 그날 하루짜리, 같으면 시작일은 버린다.
export function validateTaskDates(start, due) {
  const s = isYMD(start) ? start : null;
  const d = isYMD(due) ? due : null;
  if (s && d && d < s) return { ok: false, error: '마감일이 시작일보다 빨라요' };
  if (s && !d) return { ok: true, startDate: null, dueDate: s };
  return { ok: true, startDate: s && s !== d ? s : null, dueDate: d };
}

// '오늘' 탭: 날짜 있는 미완료 할 일을 지난/오늘(진행 중 포함)/이번 주(내일~6일 뒤 시작)로, 오늘 완료한 할 일은 따로
export function taskGroups(db, today) {
  const active = new Set(db.goals.filter(g => g.status === 'active').map(g => g.id));
  const groups = { past: [], today: [], week: [], doneToday: [] };
  for (const t of db.tasks) {
    if (!active.has(t.goalId)) continue;
    if (t.done) {
      if (t.doneAt != null && localYMD(t.doneAt) === today) groups.doneToday.push(t);
      continue;
    }
    if (!t.dueDate) continue;
    const begin = diffDays(today, t.startDate || t.dueDate);
    if (t.dueDate < today) groups.past.push(t);
    else if (begin <= 0) groups.today.push(t);
    else if (begin <= 6) groups.week.push(t);
  }
  const byDate = (a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.order - b.order;
  groups.past.sort(byDate);
  groups.today.sort(byDate);
  groups.week.sort(byDate);
  groups.doneToday.sort((a, b) => b.doneAt - a.doneAt);
  return groups;
}

// 지난 목표: 원래 마감일 대비 언제 끝났는지
export function closedTimingLabel(goal) {
  if (!goal.closedAt) return '';
  const base = goal.originalDueDate || goal.dueDate;
  const d = diffDays(base, goal.closedAt);
  if (d < 0) return `원래 마감보다 ${-d}일 일찍 끝냄`;
  if (d === 0) return '원래 마감일에 끝냄';
  return `원래 마감보다 ${d}일 늦게 끝냄`;
}

// 마감 연장 이력: '원래 마감 11/10 → 11/30 (1회 연장)'
export function extensionLabel(goal, extensions) {
  const list = extensions.filter(x => x.goalId === goal.id).sort((a, b) => a.at - b.at);
  if (!list.length) return '';
  const chain = [goal.originalDueDate || list[0].from, ...list.map(x => x.to)].map(formatMD).join(' → ');
  return `원래 마감 ${chain} (${list.length}회 연장)`;
}

// 입력 문자열을 숫자로. 빈 값은 null, 숫자가 아니면 NaN
export function parseNumber(str) {
  const s = String(str ?? '').trim().replace(/,/g, '');
  if (s === '') return null;
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

function checkNonNegative(n, emptyMsg) {
  if (n === null) return emptyMsg;
  if (Number.isNaN(n)) return '숫자로 입력하세요';
  if (n < 0) return '0 이상의 숫자를 입력하세요';
  return null;
}

// 목표 추가·수정 폼 검증. 칸별 오류 메시지와 정리된 값을 돌려준다.
export function validateGoalInput(input) {
  const errors = {};
  const title = String(input.title ?? '').trim();
  const category = String(input.category ?? '').trim();
  const unit = String(input.unit ?? '').trim();
  const measure = input.measure;
  const { startDate, dueDate } = input;

  if (!title) errors.title = '제목을 입력하세요';
  else if (title.length > 100) errors.title = '제목은 100자 이내로 입력하세요';
  if (category.length > 20) errors.category = '분류는 20자 이내로 입력하세요';
  if (!isYMD(startDate)) errors.startDate = '시작일을 선택하세요';
  if (!isYMD(dueDate)) errors.dueDate = '마감일을 선택하세요';
  else if (isYMD(startDate) && dueDate < startDate) errors.dueDate = '마감일이 시작일보다 빨라요';
  if (!MEASURES.includes(measure)) errors.measure = '측정 방식을 고르세요';

  let startValue = null;
  let targetValue = null;
  if (measure === 'cumulative') {
    targetValue = parseNumber(input.targetValue);
    const e = checkNonNegative(targetValue, '목표값을 입력하세요');
    if (e) errors.targetValue = e;
    else if (targetValue === 0) errors.targetValue = '0보다 큰 값을 입력하세요';
    startValue = 0;
  } else if (measure === 'current') {
    startValue = parseNumber(input.startValue);
    targetValue = parseNumber(input.targetValue);
    const es = checkNonNegative(startValue, '시작값을 입력하세요');
    const et = checkNonNegative(targetValue, '목표값을 입력하세요');
    if (es) errors.startValue = es;
    if (et) errors.targetValue = et;
    if (!es && !et && startValue === targetValue) errors.targetValue = '시작값과 같으면 달성률을 계산할 수 없어요';
  }
  const numeric = measure === 'cumulative' || measure === 'current';
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { title, category, startDate, dueDate, measure, unit: numeric ? unit : '', startValue, targetValue },
  };
}

// 기록 값 검증
export function validateLogValue(measure, str) {
  const n = parseNumber(str);
  if (n === null) return { error: '값을 입력하세요' };
  if (Number.isNaN(n)) return { error: '숫자로 입력하세요' };
  if (measure === 'cumulative' && n <= 0) return { error: '0보다 큰 값을 입력하세요' };
  if (measure === 'current' && n < 0) return { error: '0 이상의 숫자를 입력하세요' };
  if (measure === 'manual' && (n < 0 || n > 100)) return { error: '0~100 사이로 입력하세요' };
  return { value: n };
}

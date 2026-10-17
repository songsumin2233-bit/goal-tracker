import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate, expectedProgress, rawProgress, round1, compareEvaluated, formatProgress, formatGap,
  dueLabel, validateGoalInput, validateLogValue, progressSeries, taskGroups, summary, extensionLabel,
  closedTimingLabel, valueSummary,
} from '../js/core.js';
import { diffDays, addDays, dayNumber, fromDayNumber, localTime, weekday } from '../js/date.js';

const START = '2026-10-01';
const DUE = '2026-12-30';
const TODAY = '2026-11-15';

const goal = (extra = {}) => ({
  id: 'g', title: '목표', category: '', measure: 'manual', unit: '', startValue: null, targetValue: null,
  startDate: START, dueDate: DUE, originalDueDate: null, status: 'active', closedAt: null, createdAt: 0,
  ...extra,
});
const db = (goals, { tasks = [], logs = [] } = {}) => ({ goals, tasks, logs, extensions: [] });
const logsOf = (goalId, values, date = '2026-10-10') =>
  values.map((value, i) => ({ id: `l${i}`, goalId, date, value, note: '' }));

// ── 프롬프트 4번 검증용 예시 ──────────────────────────────

test('기간 10/01~12/30은 90일, 11/15의 기대 진행률은 50%', () => {
  assert.equal(diffDays(START, DUE), 90);
  assert.equal(diffDays(START, TODAY), 45);
  assert.equal(expectedProgress(goal(), TODAY), 0.5);
});

test('현재값형 75→70kg, 최신 72kg → 60%, +10.0%p, 앞서감(경계값)', () => {
  const g = goal({ measure: 'current', unit: 'kg', startValue: 75, targetValue: 70 });
  const e = evaluate(g, db([g], { logs: logsOf('g', [74, 72]) }), TODAY);
  assert.equal(round1(e.raw * 100), 60);
  assert.equal(e.gap, 10);
  assert.equal(formatGap(e.gap), '+10.0%p');
  assert.equal(e.status, 'ahead');
});

test('누적형 36회 목표에 +1 기록 12개 → 33.3%, −16.7%p, 뒤처짐', () => {
  const g = goal({ measure: 'cumulative', unit: '회', startValue: 0, targetValue: 36 });
  const e = evaluate(g, db([g], { logs: logsOf('g', Array(12).fill(1)) }), TODAY);
  assert.equal(round1(e.raw * 100), 33.3);
  assert.equal(e.gap, -16.7);
  assert.equal(formatGap(e.gap), '−16.7%p');
  assert.equal(e.status, 'behind');
});

test('체크리스트 10개 중 7개 완료 → 70%', () => {
  const g = goal({ measure: 'checklist' });
  const tasks = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`, goalId: 'g', title: `할 일 ${i}`, dueDate: null, done: i < 7, doneAt: i < 7 ? 1 : null, order: i,
  }));
  assert.equal(round1(rawProgress(g, db([g], { tasks })) * 100), 70);
});

test('직접 % 45% → −5.0%p, 순조', () => {
  const g = goal();
  const e = evaluate(g, db([g], { logs: logsOf('g', [45]) }), TODAY);
  assert.equal(e.gap, -5);
  assert.equal(formatGap(e.gap), '−5.0%p');
  assert.equal(e.status, 'onTrack');
});

test('같은 기간에서 달성률 40% → −10.0%p, 뒤처짐(경계값)', () => {
  const g = goal();
  const e = evaluate(g, db([g], { logs: logsOf('g', [40]) }), TODAY);
  assert.equal(e.gap, -10);
  assert.equal(e.status, 'behind');
});

test('마감 11/10, 오늘 11/15, 달성률 80%, 진행 중 → 기한 초과', () => {
  const g = goal({ dueDate: '2026-11-10' });
  const e = evaluate(g, db([g], { logs: logsOf('g', [80]) }), TODAY);
  assert.equal(e.status, 'overdue');
  assert.equal(dueLabel(e.daysLeft), '5일 지남');
});

test('시작 12/01, 오늘 11/15 → 시작 전, 기대 진행률 0%', () => {
  const g = goal({ startDate: '2026-12-01' });
  const e = evaluate(g, db([g]), TODAY);
  assert.equal(e.expected, 0);
  assert.equal(e.status, 'notStarted');
});

test('날짜 차이는 시간대와 상관없이 같다 (TZ=' + (process.env.TZ ?? '기본') + ')', () => {
  assert.equal(diffDays('2026-10-01', '2026-12-30'), 90);
  assert.equal(diffDays('2026-03-01', '2026-03-31'), 30); // 미국 서머타임 시작 구간
  assert.equal(diffDays('2026-11-01', '2026-11-02'), 1); // 미국 서머타임 종료일
  assert.equal(addDays('2026-12-30', 2), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  for (const s of ['1970-01-01', '2000-02-29', '2026-10-17', '2100-12-31']) assert.equal(fromDayNumber(dayNumber(s)), s);
  assert.equal(weekday('2026-10-17'), '토');
});

// ── 그 밖의 규칙 ─────────────────────────────────────────

test('완료·포기한 목표는 현황 상태가 아닌 done/dropped', () => {
  assert.equal(evaluate(goal({ status: 'done', closedAt: TODAY }), db([]), TODAY).status, 'done');
  assert.equal(evaluate(goal({ status: 'dropped', closedAt: TODAY }), db([]), TODAY).status, 'dropped');
});

test('달성률 100% 이상이면 마감이 지났어도 달성, 표시는 100% · 초과 달성', () => {
  const g = goal({ measure: 'cumulative', startValue: 0, targetValue: 10, dueDate: '2026-11-01' });
  const e = evaluate(g, db([g], { logs: logsOf('g', [6, 6]) }), TODAY);
  assert.equal(e.status, 'achieved');
  assert.equal(e.progress, 1);
  assert.equal(formatProgress(e.raw), '100% · 초과 달성');
  assert.equal(formatProgress(1), '100%');
  assert.equal(formatProgress(0.333), '33%');
  assert.equal(formatProgress(0.57), '57%');
  assert.equal(formatProgress(0.9996), '99%');
});

test('현재값형 최신값: 날짜가 가장 늦은 기록, 같은 날이면 나중에 입력한 것', () => {
  const g = goal({ measure: 'current', startValue: 75, targetValue: 70 });
  const logs = [
    { id: 'a', goalId: 'g', date: '2026-11-10', value: 71, note: '' },
    { id: 'b', goalId: 'g', date: '2026-11-01', value: 70, note: '' },
    { id: 'c', goalId: 'g', date: '2026-11-10', value: 73, note: '' },
  ];
  assert.equal(round1(rawProgress(g, db([g], { logs })) * 100), 40);
  assert.equal(valueSummary(g, db([g], { logs })), '75 → 70 (현재 73)');
});

test('현재값형 기록이 없으면 시작값 → 0%, 증가 목표도 계산된다', () => {
  const down = goal({ measure: 'current', startValue: 75, targetValue: 70 });
  assert.equal(rawProgress(down, db([down])), 0);
  const up = goal({ measure: 'current', startValue: 600, targetValue: 800 });
  assert.equal(rawProgress(up, db([up], { logs: logsOf('g', [700]) })), 0.5);
});

test('할 일이 없는 체크리스트는 0%이고 noTasks 표시', () => {
  const g = goal({ measure: 'checklist' });
  const e = evaluate(g, db([g]), TODAY);
  assert.equal(e.progress, 0);
  assert.equal(e.noTasks, true);
});

test('기간이 0일이면 마감일 당일부터 기대 진행률 1', () => {
  const g = goal({ startDate: '2026-11-15', dueDate: '2026-11-15' });
  assert.equal(expectedProgress(g, '2026-11-14'), 0);
  assert.equal(expectedProgress(g, '2026-11-15'), 1);
});

test('마감 연장 후에는 시작일 그대로, 새 마감일로 기대 진행률을 다시 계산', () => {
  const g = goal({ dueDate: '2026-11-30', originalDueDate: '2026-11-10' });
  assert.equal(expectedProgress(g, TODAY), 45 / 60);
  const ext = [{ goalId: 'g', from: '2026-11-10', to: '2026-11-30', at: 1 }];
  assert.equal(extensionLabel(g, ext), '원래 마감 11/10 → 11/30 (1회 연장)');
});

test('현황 정렬: 기한 초과 → 뒤처짐(괴리 작은 순) → 순조 → 앞서감 → 달성 → 시작 전, 같으면 마감 가까운 순', () => {
  const item = (id, status, gap = 0, dueDate = DUE) => ({ g: { id, title: id, dueDate }, e: { status, gap } });
  const list = [
    item('시작전', 'notStarted'),
    item('순조2', 'onTrack', 0, '2026-12-20'),
    item('달성', 'achieved'),
    item('뒤처짐-12', 'behind', -12),
    item('앞서감', 'ahead', 20),
    item('초과', 'overdue'),
    item('순조1', 'onTrack', 0, '2026-12-01'),
    item('뒤처짐-30', 'behind', -30),
  ];
  assert.deepEqual(list.sort(compareEvaluated).map(x => x.g.id),
    ['초과', '뒤처짐-30', '뒤처짐-12', '순조1', '순조2', '앞서감', '달성', '시작전']);
});

test('D-day 표시', () => {
  assert.equal(dueLabel(12), 'D-12');
  assert.equal(dueLabel(0), 'D-day');
  assert.equal(dueLabel(-3), '3일 지남');
});

test('목표 입력 검증: 빈 제목, 시작일보다 빠른 마감일, 음수·문자 수치, 시작값=목표값을 막는다', () => {
  const base = { title: '운동', category: '일상', startDate: START, dueDate: DUE, measure: 'cumulative', targetValue: '36', unit: '회' };
  assert.equal(validateGoalInput(base).ok, true);
  assert.equal(validateGoalInput({ ...base, title: '   ' }).errors.title, '제목을 입력하세요');
  assert.equal(validateGoalInput({ ...base, dueDate: '2026-09-30' }).errors.dueDate, '마감일이 시작일보다 빨라요');
  assert.equal(validateGoalInput({ ...base, targetValue: '-5' }).errors.targetValue, '0 이상의 숫자를 입력하세요');
  assert.equal(validateGoalInput({ ...base, targetValue: '삼십' }).errors.targetValue, '숫자로 입력하세요');
  assert.equal(validateGoalInput({ ...base, targetValue: '' }).errors.targetValue, '목표값을 입력하세요');
  assert.equal(validateGoalInput({ ...base, targetValue: '0' }).errors.targetValue, '0보다 큰 값을 입력하세요');
  const cur = { ...base, measure: 'current', startValue: '70', targetValue: '70' };
  assert.equal(validateGoalInput(cur).errors.targetValue, '시작값과 같으면 달성률을 계산할 수 없어요');
  assert.equal(validateGoalInput({ ...cur, startValue: '1e2x' }).errors.startValue, '숫자로 입력하세요');
  const manual = validateGoalInput({ ...base, measure: 'manual', targetValue: '' });
  assert.equal(manual.ok, true);
  assert.equal(manual.value.targetValue, null);
});

test('기록 값 검증', () => {
  assert.equal(validateLogValue('cumulative', '1').value, 1);
  assert.ok(validateLogValue('cumulative', '0').error);
  assert.ok(validateLogValue('current', '-1').error);
  assert.equal(validateLogValue('current', '72.5').value, 72.5);
  assert.ok(validateLogValue('manual', '101').error);
  assert.ok(validateLogValue('manual', 'abc').error);
});

test('추이: 기록 날짜마다 그날 끝의 달성률, 체크리스트는 doneAt 날짜로', () => {
  const g = goal({ measure: 'cumulative', startValue: 0, targetValue: 10 });
  const logs = [
    { id: 'a', goalId: 'g', date: '2026-10-05', value: 2, note: '' },
    { id: 'b', goalId: 'g', date: '2026-10-03', value: 1, note: '' },
    { id: 'c', goalId: 'g', date: '2026-10-05', value: 1, note: '' },
  ];
  const s = progressSeries(g, db([g], { logs }));
  assert.equal(s.count, 3);
  assert.deepEqual(s.points.map(p => [p.date, round1(p.progress * 100)]), [['2026-10-03', 10], ['2026-10-05', 40]]);

  const c = goal({ measure: 'checklist' });
  const tasks = [
    { id: 't1', goalId: 'g', title: 'a', dueDate: null, done: true, doneAt: localTime('2026-10-04', 23), order: 0 },
    { id: 't2', goalId: 'g', title: 'b', dueDate: null, done: true, doneAt: localTime('2026-10-02', 0), order: 1 },
    { id: 't3', goalId: 'g', title: 'c', dueDate: null, done: false, doneAt: null, order: 2 },
    { id: 't4', goalId: 'g', title: 'd', dueDate: null, done: false, doneAt: null, order: 3 },
  ];
  assert.deepEqual(progressSeries(c, db([c], { tasks })).points, [
    { date: '2026-10-02', progress: 0.25 }, { date: '2026-10-04', progress: 0.5 },
  ]);
});

test('오늘 탭 묶음과 상단 배너 숫자', () => {
  const active = goal({ id: 'a', measure: 'checklist' });
  const closed = goal({ id: 'b', measure: 'checklist', status: 'done', closedAt: TODAY });
  const t = (id, goalId, dueDate, done = false, doneAt = null) => ({ id, goalId, title: id, dueDate, done, doneAt, order: 0 });
  const data = db([active, closed], {
    tasks: [
      t('지난', 'a', '2026-11-13'),
      t('오늘', 'a', TODAY),
      t('6일뒤', 'a', '2026-11-21'),
      t('7일뒤', 'a', '2026-11-22'),
      t('날짜없음', 'a', null),
      t('오늘완료', 'a', null, true, localTime(TODAY, 9)),
      t('어제완료', 'a', null, true, localTime('2026-11-14', 9)),
      t('지난목표', 'b', TODAY),
    ],
  });
  const g = taskGroups(data, TODAY);
  assert.deepEqual(g.past.map(x => x.id), ['지난']);
  assert.deepEqual(g.today.map(x => x.id), ['오늘']);
  assert.deepEqual(g.week.map(x => x.id), ['6일뒤']);
  assert.deepEqual(g.doneToday.map(x => x.id), ['오늘완료']);
  assert.equal(summary(data, TODAY).dueTodayTasks, 1);
});

test('지난 목표: 원래 마감일 대비 언제 끝났는지', () => {
  assert.equal(closedTimingLabel(goal({ status: 'done', closedAt: '2026-12-28' })), '원래 마감보다 2일 일찍 끝냄');
  assert.equal(closedTimingLabel(goal({ status: 'done', closedAt: '2027-01-02', dueDate: '2027-01-10', originalDueDate: DUE })), '원래 마감보다 3일 늦게 끝냄');
  assert.equal(closedTimingLabel(goal({ status: 'dropped', closedAt: DUE })), '원래 마감일에 끝냄');
});

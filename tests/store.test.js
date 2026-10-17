import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDB, loadDB, saveDB, createSampleDB, serialize, emptyDB, STORAGE_KEY, BROKEN_KEY } from '../js/store.js';
import { evaluate } from '../js/core.js';

const memoryStorage = (init = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
};

test('예시 데이터: 측정 방식 4가지, 상태 앞서감·순조·뒤처짐·기한 초과가 하나씩', () => {
  for (const today of ['2026-10-17', '2027-01-01', '2028-02-29']) {
    const db = createSampleDB(today, 0);
    assert.deepEqual(db.goals.map(g => g.measure).sort(), ['checklist', 'cumulative', 'current', 'manual']);
    assert.deepEqual(db.goals.map(g => evaluate(g, db, today).status).sort(), ['ahead', 'behind', 'onTrack', 'overdue']);
    assert.equal(validateDB(db).ok, true);
  }
});

test('내보내기 → 불러오기 하면 그대로 돌아온다', () => {
  const db = createSampleDB('2026-10-17', 1);
  const res = validateDB(serialize(db));
  assert.equal(res.ok, true);
  assert.deepEqual(res.db, db);
});

test('잘못된 JSON은 이유를 알려주고 거절한다', () => {
  assert.equal(validateDB('{ 이건 JSON 아님').ok, false);
  assert.equal(validateDB('[]').ok, false);
  assert.match(validateDB({ version: 2, goals: [] }).errors[0], /version/);
  const bad = createSampleDB('2026-10-17', 0);
  bad.goals[0].dueDate = '2026-13-40';
  bad.goals[1].title = '';
  bad.logs.push({ id: 'x', goalId: '없는목표', date: '2026-10-01', value: 1 });
  const res = validateDB(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some(e => e.includes('goals[0].dueDate')));
  assert.ok(res.errors.some(e => e.includes('goals[1].title')));
  assert.ok(res.errors.some(e => e.includes('없는목표')));
});

test('빠진 칸은 기본값으로 채운다', () => {
  const res = validateDB({
    version: 1,
    goals: [{ id: 'g1', title: ' 독서 ', measure: 'manual', startDate: '2026-10-01', dueDate: '2026-10-31' }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.db.goals[0].title, '독서');
  assert.equal(res.db.goals[0].status, 'active');
  assert.deepEqual(res.db.tasks, []);
  assert.equal(res.db.settings.theme, 'auto');
});

test('저장·불러오기, 깨진 데이터는 따로 보관', () => {
  const storage = memoryStorage();
  assert.equal(loadDB(storage).status, 'empty');
  const db = createSampleDB('2026-10-17', 0);
  assert.equal(saveDB(db, storage).ok, true);
  assert.deepEqual(loadDB(storage).db, db);

  const broken = memoryStorage({ [STORAGE_KEY]: '{"version":1,' });
  const res = loadDB(broken);
  assert.equal(res.status, 'corrupt');
  assert.equal(broken.data[BROKEN_KEY], '{"version":1,');
});

test('저장 실패(용량 초과)를 알려준다', () => {
  const full = {
    getItem: () => null,
    setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; },
  };
  const res = saveDB(emptyDB(), full);
  assert.equal(res.ok, false);
  assert.match(res.error, /저장 공간/);
});

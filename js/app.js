// 화면 렌더링과 이벤트. 계산은 core.js, 저장은 store.js에 맡긴다.

import { APP_NAME, APP_VERSION } from './config.js';
import * as D from './date.js';
import * as C from './core.js';
import * as S from './store.js';
import { initPWA } from './pwa.js';

const main = document.getElementById('main');
const noticesEl = document.getElementById('notices');
const sheet = document.getElementById('sheet');
const toastEl = document.getElementById('toast');
const fab = document.getElementById('fab');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const goalHref = id => `#goal/${encodeURIComponent(id)}`;
const today = () => D.todayYMD();

let db;
const ui = {
  filter: null,        // 분류 필터 (null = 전체)
  armed: null,         // '한 번 더 누르기' 대기 중인 버튼 key
  armTimer: 0,
  form: null,          // 펼친 인라인 입력 { kind: 'record' | 'extend', id }
  focusAfter: null,    // 다음 렌더 후 포커스할 선택자
  doneOpen: false,     // '오늘 완료' 펼침 여부
  importText: '',
  importResult: null,  // validateDB 결과 + source
  lastWidth: 0,
  notices: { load: null, save: null, update: null, install: null, ios: null },
};

const findGoal = id => db.goals.find(g => g.id === id);

// ── 저장 ────────────────────────────────────────────────

function persist() {
  const r = S.saveDB(db);
  ui.notices.save = r.ok ? null : r.error;
  return r.ok;
}

function commit(mutate) {
  mutate();
  ui.form = null;
  disarm();
  persist();
  render();
}

// 바꾸기 전 상태를 기억해 두고 토스트에서 되돌릴 수 있게 한다
function commitWithUndo(message, mutate) {
  const before = structuredClone(db);
  commit(mutate);
  toast(message, () => {
    db = before;
    persist();
    render();
  });
}

// ── 토스트 ──────────────────────────────────────────────

let toastTimer = 0;
function toast(message, undo = null) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button">되돌리기</button>' : ''}`;
  toastEl.hidden = false;
  if (undo) toastEl.querySelector('button').addEventListener('click', () => { hideToast(); undo(); });
  toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
}
function hideToast() { toastEl.hidden = true; }

// ── 테마 ────────────────────────────────────────────────

function applyTheme() {
  const theme = db.settings.theme;
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
}

// ── 라우팅 ──────────────────────────────────────────────

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('goal/')) return { tab: null, goalId: h.slice(5) };
  if (['today', 'past', 'settings'].includes(h)) return { tab: h };
  return { tab: 'home' };
}

// ── 공용 조각 ───────────────────────────────────────────

// confirmLabel이 있으면 한 번 더 눌러야 실행되는 버튼
function actionBtn(action, id, label, { cls = '', confirm = null, aria = '' } = {}) {
  const key = `${action}|${id}`;
  const armed = confirm && ui.armed === key;
  return `<button type="button" class="btn ${cls}${armed ? ' armed' : ''}" data-action="${action}" data-id="${esc(id)}"`
    + `${confirm ? ` data-confirm="${esc(confirm)}" data-label="${esc(label)}"` : ''}`
    + `${aria ? ` aria-label="${esc(aria)}"` : ''}>${esc(armed ? confirm : label)}</button>`;
}

function relDate(d, t) {
  const n = D.diffDays(t, d);
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === -1) return '어제';
  if (n < 0) return `${-n}일 지남`;
  return D.formatMDW(d);
}

function dateChip(d, t) {
  const n = D.diffDays(t, d);
  return `<span class="date-chip${n < 0 ? ' late' : n === 0 ? ' today' : ''}">${relDate(d, t)}</span>`;
}

const badge = status => `<span class="badge">${C.STATUS_LABEL[status]}</span>`;

// ── 알림 영역 (모든 화면 공통) ──────────────────────────

function viewNotices() {
  const n = ui.notices;
  const out = [];
  if (n.load) {
    out.push(`<div class="notice error" role="alert"><p><b>저장된 데이터를 읽을 수 없었어요.</b> 원본은 브라우저 저장소의 "${S.BROKEN_KEY}"에 따로 보관했어요. 백업 파일이 있으면 설정 → 불러오기로 복원하세요.</p>
      <ul>${n.load.slice(0, 5).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
      ${actionBtn('dismiss', 'load', '닫기')}</div>`);
  }
  if (n.save) out.push(`<div class="notice error" role="alert"><p>${esc(n.save)}</p></div>`);
  if (n.update) {
    out.push(`<div class="notice info"><p><b>새 버전이 있어요.</b></p>${actionBtn('apply-update', '', '새로고침', { cls: 'btn-primary' })}</div>`);
  }
  if (n.install) {
    out.push(`<div class="notice info"><p>앱으로 설치하면 홈 화면에서 바로 열 수 있어요.</p><div class="btn-row">
      ${actionBtn('install', '', '설치', { cls: 'btn-primary' })}${actionBtn('dismiss', 'install', '나중에', { cls: 'btn-ghost' })}</div></div>`);
  }
  if (n.ios) {
    out.push(`<div class="notice warn"><p><b>홈 화면에 추가해야 데이터가 안전해요.</b> 아이폰 Safari는 홈 화면에 추가하지 않은 사이트의 데이터를 오래 쓰지 않으면 지울 수 있어요.
      아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요.</p>${actionBtn('dismiss', 'ios', '알겠어요')}</div>`);
  }
  return out.join('');
}

// ── 현황 탭 ─────────────────────────────────────────────

function viewSummary(t) {
  const s = C.summary(db, t);
  if (!s.activeCount) return '';
  const items = [];
  if (s.overdue.length) {
    items.push(`<button type="button" class="st-overdue" data-action="jump" data-id="${esc(s.overdue[0].g.id)}"><span class="dot"></span>기한 초과 ${s.overdue.length}개</button>`);
  }
  if (s.behind.length) {
    items.push(`<button type="button" class="st-behind" data-action="jump" data-id="${esc(s.behind[0].g.id)}"><span class="dot"></span>뒤처진 목표 ${s.behind.length}개</button>`);
  }
  if (s.dueTodayTasks) {
    items.push(`<button type="button" style="--st: var(--accent)" data-action="go" data-id="today"><span class="dot"></span>오늘 마감 할 일 ${s.dueTodayTasks}개</button>`);
  }
  if (!items.length) {
    return `<div class="summary st-onTrack"><p class="all-good"><span class="dot" style="display:inline-block;margin-right:8px"></span>모든 목표가 순조로워요</p></div>`;
  }
  return `<div class="summary" role="group" aria-label="요약">${items.join('')}</div>`;
}

function backupNudge(t) {
  if (db.settings.sample || !db.goals.length) return '';
  const last = db.settings.lastBackupAt;
  const ref = last ?? Math.min(...db.goals.map(g => g.createdAt || Date.now()));
  if (D.diffDays(D.localYMD(ref), t) <= 14) return '';
  const msg = last == null ? '아직 백업한 적이 없어요.' : '마지막 백업이 2주가 넘었어요.';
  return `<div class="notice"><p class="small">${msg} 폰을 바꾸거나 브라우저 데이터가 지워질 때를 대비해 백업해 두세요.</p><a class="btn" href="#settings">백업하기</a></div>`;
}

function viewCard(g, e, t) {
  const st = e.status;
  const pct = C.pctNumber(e.raw);
  const expPct = C.pctNumber(e.expected);
  let nums;
  if (st === 'notStarted') nums = `${D.formatMDW(g.startDate)}에 시작 · 기간 ${D.diffDays(g.startDate, g.dueDate)}일`;
  else if (st === 'achieved') nums = `<b>달성 ${C.formatProgress(e.raw)}</b>`;
  else if (st === 'overdue') nums = `<b>달성 ${pct}%</b> · 마감 ${D.formatMD(g.dueDate)} 지남`;
  else nums = `<b>달성 ${pct}%</b> · 기대 ${expPct}% (${C.formatGap(e.gap)})`;
  const showMark = st !== 'notStarted' && st !== 'achieved';
  const bar = `<div class="bar" role="img" aria-label="달성 ${pct}%${showMark ? `, 지금쯤 기대 진행률 ${expPct}%` : ''}">
    <div class="bar-fill" style="width:${pct}%"></div>
    ${showMark ? `<div class="bar-mark" style="left:${(e.expected * 100).toFixed(1)}%" title="지금쯤 여기까지 했어야 함"></div>` : ''}</div>`;
  const vals = C.valueSummary(g, db);

  const btns = [];
  if (st === 'overdue') {
    btns.push(actionBtn('complete', g.id, '완료', { cls: 'btn-primary' }));
    btns.push(actionBtn('open-extend', g.id, '마감 연장'));
    btns.push(actionBtn('drop', g.id, '포기', { cls: 'btn-danger', confirm: '한 번 더 누르면 포기' }));
  }
  if (st === 'achieved') btns.push(actionBtn('complete', g.id, '완료 처리', { cls: 'btn-primary' }));
  if (g.measure === 'cumulative') {
    btns.push(actionBtn('plus-one', g.id, '+1', { aria: `${g.title}에 +1${g.unit} 기록` }));
  } else if (g.measure === 'current' || g.measure === 'manual') {
    btns.push(actionBtn('open-record', g.id, '기록', { aria: `${g.title} 기록하기` }));
  }
  let form = '';
  if (ui.form?.id === g.id) form = ui.form.kind === 'extend' ? viewExtendForm(g, t) : viewRecordForm(g);

  return `<article class="card st-${st}" id="goal-${esc(g.id)}">
    <div class="card-head"><a class="card-title" href="${goalHref(g.id)}">${esc(g.title)}</a>${badge(st)}</div>
    <div class="meta">${g.category ? `<span class="tag">${esc(g.category)}</span>` : ''}
      <span class="due${e.daysLeft < 0 ? ' late' : ''}">${C.dueLabel(e.daysLeft)}</span><span>${C.MEASURE_INFO[g.measure].label}</span></div>
    ${bar}
    <p class="nums">${nums}</p>
    ${vals ? `<p class="vals">${esc(vals)}</p>` : ''}
    ${e.noTasks ? `<p class="nums"><a class="hint-link link-btn" href="${goalHref(g.id)}">할 일을 추가하세요</a></p>` : ''}
    ${btns.length ? `<div class="actions btn-row">${btns.join('')}</div>` : ''}
    ${form}
  </article>`;
}

function viewRecordForm(g) {
  const isManual = g.measure === 'manual';
  const unit = isManual ? '%' : g.unit;
  const last = C.latestLog(g.id, db.logs);
  const fid = `qr-${g.id}`;
  return `<form class="inline-form" data-form="quick-record" data-id="${esc(g.id)}" novalidate>
    <label for="${esc(fid)}">${isManual ? '오늘 달성률' : '오늘 값'}${unit ? ` (${esc(unit)})` : ''}</label>
    <div class="row">
      <input class="input grow" id="${esc(fid)}" name="value" inputmode="decimal" autocomplete="off"
        placeholder="${last ? `지난 기록 ${C.formatNumber(last.value)}` : ''}" aria-describedby="${esc(fid)}-err">
      <button class="btn btn-primary">저장</button>
      <button type="button" class="btn btn-ghost" data-action="close-form" data-id="">취소</button>
    </div>
    <p class="field-error" id="${esc(fid)}-err" data-err="value"></p>
  </form>`;
}

function viewExtendForm(g, t) {
  const base = g.dueDate > t ? g.dueDate : t;
  const min = D.addDays(g.dueDate, 1) > t ? D.addDays(g.dueDate, 1) : t;
  const fid = `ex-${g.id}`;
  return `<form class="inline-form" data-form="extend" data-id="${esc(g.id)}" novalidate>
    <label for="${esc(fid)}">새 마감일</label>
    <p class="small muted" style="margin:-2px 0 6px">지금 마감 ${D.formatMDW(g.dueDate)} · 시작일은 그대로예요</p>
    <div class="row">
      <input type="date" class="input grow" id="${esc(fid)}" name="to" value="${D.addDays(base, 7)}" min="${min}" aria-describedby="${esc(fid)}-err">
      <button class="btn btn-primary">연장</button>
      <button type="button" class="btn btn-ghost" data-action="close-form" data-id="">취소</button>
    </div>
    <p class="field-error" id="${esc(fid)}-err" data-err="to"></p>
  </form>`;
}

function viewHome(t) {
  const head = `<header class="page-head"><div><h1>현황</h1><p class="sub">${D.formatLong(t)} (${D.weekday(t)})</p></div></header>`;
  const sample = db.settings.sample
    ? `<div class="notice info"><p><b>예시 데이터예요.</b> 둘러본 뒤 지우고 내 목표를 추가하세요.</p>${actionBtn('clear-sample', '', '예시 지우고 시작', { cls: 'btn-primary' })}</div>`
    : '';
  const list = C.activeEvaluated(db, t);
  if (!list.length) {
    const hasPast = db.goals.length > 0;
    return `${head}${sample}<div class="empty"><div class="big" aria-hidden="true">🎯</div>
      <h2>${hasPast ? '진행 중인 목표가 없어요' : '아직 목표가 없어요'}</h2>
      <p>목표와 마감일을 정하면 계획대로 가고 있는지 바로 보여 드려요.</p>
      ${actionBtn('open-add', '', hasPast ? '새 목표 추가' : '첫 목표 추가하기', { cls: 'btn-primary' })}</div>`;
  }
  const cats = [...new Set(list.map(x => x.g.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  if (ui.filter && !cats.includes(ui.filter)) ui.filter = null;
  const chips = cats.length
    ? `<div class="chips" role="group" aria-label="분류 필터">
        <button type="button" class="chip" data-action="filter" data-id="" aria-pressed="${ui.filter === null}">전체</button>
        ${cats.map(c => `<button type="button" class="chip" data-action="filter" data-id="${esc(c)}" aria-pressed="${ui.filter === c}">${esc(c)}</button>`).join('')}
      </div>`
    : '';
  const shown = ui.filter ? list.filter(x => x.g.category === ui.filter) : list;
  return `${head}<div class="stack">
    ${viewSummary(t)}
    ${backupNudge(t)}
    ${sample}
    <div>${chips}<p class="legend"><span class="mark-sample" aria-hidden="true"></span>막대 위 세로선 = 지금쯤 여기까지 했어야 하는 지점</p></div>
    <div>${shown.map(({ g, e }) => viewCard(g, e, t)).join('')}</div>
  </div>`;
}

// ── 목표 상세 ───────────────────────────────────────────

function viewChart(g, e, t) {
  const { points, count } = C.progressSeries(g, db);
  if (count < 2) return '<p class="empty-note">기록이 2개 이상 쌓이면 그래프가 보여요.</p>';
  const closed = g.status !== 'active';
  const startDn = D.dayNumber(g.startDate);
  const dueDn = D.dayNumber(g.dueDate);
  const lastDn = D.dayNumber(points[points.length - 1].date);
  const lineEndDn = D.dayNumber(closed ? (g.closedAt || g.dueDate) : t);
  const firstDn = Math.min(startDn, D.dayNumber(points[0].date));
  const endDn = Math.max(dueDn, lastDn, lineEndDn);
  const W = Math.round(Math.max(280, Math.min(688, (main.clientWidth || 360) - 34)));
  const H = 220, L = 42, R = 14, T = 18, B = 28;
  const span = Math.max(1, endDn - firstDn);
  const x = dn => +(L + ((dn - firstDn) / span) * (W - L - R)).toFixed(1);
  const y = p => +(T + (1 - C.clamp01(p)) * (H - T - B)).toFixed(1);

  const expected = `M${x(startDn)},${y(0)} L${x(dueDn)},${y(1)}${endDn > dueDn ? ` L${x(endDn)},${y(1)}` : ''}`;
  let actual = `M${x(firstDn)},${y(0)}`;
  for (const p of points) actual += ` H${x(D.dayNumber(p.date))} V${y(p.progress)}`;
  if (lineEndDn > lastDn) actual += ` H${x(Math.min(lineEndDn, endDn))}`;
  const dots = points.map(p => `<circle class="pt" cx="${x(D.dayNumber(p.date))}" cy="${y(p.progress)}" r="3.5"/>`).join('');
  const grid = [0, 0.5, 1].map(p => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}"/>
    <text class="axis" x="${L - 6}" y="${y(p) + 4}" text-anchor="end">${p * 100}%</text>`).join('');
  const dueX = x(dueDn);
  const xLabels = `<text class="axis" x="${x(startDn)}" y="${H - 8}" text-anchor="start">${D.formatMD(g.startDate)} 시작</text>
    <text class="axis" x="${dueX}" y="${H - 8}" text-anchor="${dueX > W - 60 ? 'end' : 'middle'}">${D.formatMD(g.dueDate)} 마감</text>`;
  const todayDn = D.dayNumber(t);
  const todayLine = !closed && todayDn >= firstDn && todayDn <= endDn
    ? `<line class="today" x1="${x(todayDn)}" x2="${x(todayDn)}" y1="${T - 6}" y2="${H - B}"/>
       <text class="today-text" x="${x(todayDn)}" y="${T - 8}" text-anchor="${x(todayDn) > W - 30 ? 'end' : x(todayDn) < L + 20 ? 'start' : 'middle'}">오늘</text>`
    : '';
  const lastP = points[points.length - 1];
  const desc = `${D.formatLong(g.startDate)}부터 ${D.formatLong(g.dueDate)}까지의 진행 추이. `
    + `기대 진행선은 시작일 0%에서 마감일 100%까지 곧게 오르고, 실제 진행선은 기록 ${count}개로 그렸어요. `
    + `가장 최근 기록(${D.formatMD(lastP.date)}) 기준 달성률은 ${C.pctNumber(lastP.progress)}%`
    + (closed ? '예요.' : `, 오늘의 기대 진행률은 ${C.pctNumber(e.expected)}%예요.`);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="chart-title chart-desc">
      <title id="chart-title">진행 추이 그래프</title><desc id="chart-desc">${esc(desc)}</desc>
      ${grid}${xLabels}
      <path class="expected" d="${expected}"/>
      <path class="actual" d="${actual}"/>${dots}
      ${todayLine}
    </svg>
    <div class="chart-legend" aria-hidden="true"><span><i class="lg-actual"></i>실제 진행</span><span><i class="lg-expected"></i>기대 진행</span>${todayLine ? '<span><i class="lg-today"></i>오늘</span>' : ''}</div>`;
}

function viewLogs(g, t, closed) {
  const logs = C.orderedLogs(g.id, db.logs).reverse();
  const valueLabel = {
    cumulative: `증가량${g.unit ? ` (${esc(g.unit)})` : ''}`,
    current: `그날의 값${g.unit ? ` (${esc(g.unit)})` : ''}`,
    manual: '달성률 (%)',
  }[g.measure];
  const form = closed ? '' : `<form data-form="add-log" data-id="${esc(g.id)}" novalidate style="margin-bottom:12px">
      <div class="grid-2">
        <div class="field"><label for="log-date">날짜</label><input type="date" class="input" id="log-date" name="date" value="${t}" aria-describedby="log-date-err"><p class="field-error" id="log-date-err" data-err="date"></p></div>
        <div class="field"><label for="log-value">${valueLabel}</label><input class="input" id="log-value" name="value" inputmode="decimal" autocomplete="off" value="${g.measure === 'cumulative' ? '1' : ''}" aria-describedby="log-value-err"><p class="field-error" id="log-value-err" data-err="value"></p></div>
      </div>
      <div class="field" style="margin-top:12px"><label for="log-note">메모 (선택)</label><input class="input" id="log-note" name="note" maxlength="200" autocomplete="off"></div>
      <button class="btn btn-primary">기록 추가</button>
    </form>`;
  const rows = logs.map(l => `<li>
      <div class="grow"><span class="log-value">${esc(C.formatLogValue(g, l.value))}</span> <span class="sub">${D.formatMDW(l.date)}</span>
      ${l.note ? `<div class="sub">${esc(l.note)}</div>` : ''}</div>
      ${closed ? '' : actionBtn('delete-log', l.id, '삭제', { cls: 'btn-ghost btn-danger', confirm: '한 번 더', aria: `${D.formatMD(l.date)} 기록 삭제` })}
    </li>`).join('');
  return `<section class="panel" aria-labelledby="rec-h"><div class="section-title"><h2 id="rec-h">기록</h2><span class="small muted">${logs.length}건</span></div>
    ${form}
    ${logs.length ? `<ul class="list">${rows}</ul>` : '<p class="empty-note">아직 기록이 없어요.</p>'}</section>`;
}

function viewTasks(g, t, closed) {
  const tasks = C.goalTasks(g.id, db.tasks);
  const done = tasks.filter(x => x.done).length;
  const rows = tasks.map(task => `<li>
      <label class="check"><input type="checkbox" data-toggle="task" data-id="${esc(task.id)}"${task.done ? ' checked' : ''}${closed ? ' disabled' : ''}>
        <span><span class="t">${esc(task.title)}</span>${task.dueDate && !task.done ? dateChip(task.dueDate, t) : ''}</span></label>
      ${closed ? '' : actionBtn('delete-task', task.id, '삭제', { cls: 'btn-ghost btn-danger', confirm: '한 번 더', aria: `${task.title} 삭제` })}
    </li>`).join('');
  const form = closed ? '' : `<form data-form="add-task" data-id="${esc(g.id)}" novalidate style="margin-top:12px">
      <div class="field"><label for="task-title">새 할 일</label><input class="input" id="task-title" name="title" maxlength="100" autocomplete="off" aria-describedby="task-title-err"><p class="field-error" id="task-title-err" data-err="title"></p></div>
      <div class="row"><div class="grow field" style="margin:0"><label for="task-date">날짜 (선택)</label><input type="date" class="input" id="task-date" name="dueDate"></div>
      <button class="btn btn-primary" style="align-self:flex-end">추가</button></div>
    </form>`;
  return `<section class="panel" aria-labelledby="task-h"><div class="section-title"><h2 id="task-h">할 일</h2><span class="small muted">완료 ${done} / ${tasks.length}</span></div>
    ${tasks.length ? `<ul class="list">${rows}</ul>` : '<p class="empty-note">할 일을 추가하면 완료한 비율이 달성률이 돼요.</p>'}
    ${form}</section>`;
}

function viewGoal(g, t) {
  const e = C.evaluate(g, db, t);
  const closed = g.status !== 'active';
  const st = e.status;
  const stat = (label, value) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`;
  const noGap = closed || st === 'notStarted' || st === 'achieved';
  const stats = `<dl class="stats">
    ${stat('달성률', C.formatProgress(e.raw))}
    ${stat('기대 진행률', closed ? '—' : `${C.pctNumber(e.expected)}%`)}
    ${stat('괴리', noGap ? '—' : C.formatGap(e.gap))}
    ${stat(closed ? '종료일' : '남은 기간', closed ? D.formatMD(g.closedAt) : C.dueLabel(e.daysLeft))}
  </dl>`;
  const vals = C.valueSummary(g, db);
  const ext = C.extensionLabel(g, db.extensions);

  let banner = '';
  if (closed) {
    banner = `<div class="notice ${g.status === 'done' ? 'info' : ''}"><p>${g.status === 'done' ? '완료' : '포기'}한 목표예요 · ${D.formatMD(g.closedAt)} 종료 · ${C.closedTimingLabel(g)}</p>${actionBtn('reopen', g.id, '다시 열기')}</div>`;
  } else if (st === 'achieved') {
    banner = `<div class="notice info"><p><b>목표를 달성했어요!</b> 완료 처리하면 지난 목표로 옮겨져요.</p>${actionBtn('complete', g.id, '완료 처리', { cls: 'btn-primary' })}</div>`;
  } else if (st === 'overdue') {
    banner = `<div class="notice error"><p><b>마감이 지났어요.</b> 완료, 마감 연장, 포기 중에 골라 주세요.</p><div class="btn-row">
      ${actionBtn('complete', g.id, '완료', { cls: 'btn-primary' })}${actionBtn('open-extend', g.id, '마감 연장')}${actionBtn('drop', g.id, '포기', { cls: 'btn-danger', confirm: '한 번 더 누르면 포기' })}</div></div>`;
  }
  const extendForm = ui.form?.kind === 'extend' && ui.form.id === g.id ? viewExtendForm(g, t) : '';

  const nTasks = db.tasks.filter(x => x.goalId === g.id).length;
  const nLogs = db.logs.filter(x => x.goalId === g.id).length;
  const related = [nTasks && `할 일 ${nTasks}개`, nLogs && `기록 ${nLogs}건`].filter(Boolean).join('과 ');
  const deleteArmed = ui.armed === `delete-goal|${g.id}`;
  const actions = [
    actionBtn('open-edit', g.id, '수정'),
    !closed && st !== 'overdue' ? actionBtn('open-extend', g.id, '마감 연장') : '',
    !closed && st !== 'overdue' ? actionBtn('complete', g.id, '완료 처리') : '',
    !closed && st !== 'overdue' ? actionBtn('drop', g.id, '포기', { cls: 'btn-danger', confirm: '한 번 더 누르면 포기' }) : '',
    actionBtn('delete-goal', g.id, '삭제', { cls: 'btn-danger', confirm: '한 번 더 누르면 삭제' }),
  ].join('');

  return `<a class="back" href="${closed ? '#past' : '#home'}">‹ ${closed ? '지난 목표' : '현황'}</a>
    <header class="detail-head st-${st}">
      <h1>${esc(g.title)}</h1>
      <div class="badges">${badge(st)}${g.category ? `<span class="tag">${esc(g.category)}</span>` : ''}<span class="small muted">${C.MEASURE_INFO[g.measure].label}</span></div>
      <p class="small muted" style="margin-top:6px">${D.formatLong(g.startDate)} ~ ${D.formatLong(g.dueDate)} · ${D.diffDays(g.startDate, g.dueDate)}일</p>
      ${vals ? `<p style="margin-top:2px">${esc(vals)}</p>` : ''}
      ${ext ? `<p class="small muted">${esc(ext)}</p>` : ''}
    </header>
    <div class="stack" style="margin-top:12px">
      ${banner}${extendForm}
      ${stats}
      <section class="panel chart" aria-labelledby="chart-h"><div class="section-title"><h2 id="chart-h">추이</h2></div>${viewChart(g, e, t)}</section>
      ${g.measure === 'checklist' ? viewTasks(g, t, closed) : viewLogs(g, t, closed)}
      <section aria-label="목표 관리"><div class="btn-row">${actions}</div>
        ${deleteArmed && related ? `<p class="field-error delete-warn" style="margin-top:8px">이 목표의 ${related}이 함께 지워져요.</p>` : ''}</section>
    </div>`;
}

// ── 오늘 탭 ─────────────────────────────────────────────

function taskRow(task, t) {
  const g = findGoal(task.goalId);
  return `<li><div class="grow">
      <label class="check"><input type="checkbox" data-toggle="task" data-id="${esc(task.id)}"${task.done ? ' checked' : ''}><span><span class="t">${esc(task.title)}</span></span></label>
      <div class="sub" style="padding-left:34px">${task.dueDate && !task.done ? `${dateChip(task.dueDate, t)} · ` : ''}<a href="${goalHref(g.id)}">${esc(g.title)}</a></div>
    </div></li>`;
}

function viewToday(t) {
  const gr = C.taskGroups(db, t);
  const head = `<header class="page-head"><div><h1>오늘</h1><p class="sub">${D.formatLong(t)} (${D.weekday(t)}) · 날짜가 있는 할 일</p></div></header>`;
  const section = (title, list, cls = '') => `<section class="panel"><div class="section-title"><h2>${title}</h2><span class="badge ${cls}">${list.length}개</span></div>
    ${list.length ? `<ul class="list">${list.map(x => taskRow(x, t)).join('')}</ul>` : '<p class="empty-note">없어요.</p>'}</section>`;
  if (!gr.past.length && !gr.today.length && !gr.week.length && !gr.doneToday.length) {
    return `${head}<div class="empty"><div class="big" aria-hidden="true">🗓️</div><h2>이번 주 할 일이 없어요</h2>
      <p>체크리스트 목표의 할 일에 날짜를 넣으면 여기에 모여요.</p><a class="btn" href="#home">현황 보기</a></div>`;
  }
  return `${head}<div>
    ${gr.past.length ? section('지난 할 일', gr.past, 'st-overdue') : ''}
    ${section('오늘', gr.today, 'st-onTrack')}
    ${gr.week.length ? section('이번 주', gr.week, 'st-notStarted') : ''}
    ${gr.doneToday.length ? `<section><details class="folded panel" id="done-today"${ui.doneOpen ? ' open' : ''}><summary>오늘 완료 ${gr.doneToday.length}개</summary>
      <ul class="list">${gr.doneToday.map(x => taskRow(x, t)).join('')}</ul></details></section>` : ''}
  </div>`;
}

// ── 지난 목표 탭 ────────────────────────────────────────

function viewPast(t) {
  const head = '<header class="page-head"><div><h1>지난 목표</h1><p class="sub">완료하거나 포기한 목표</p></div></header>';
  const closed = db.goals.filter(g => g.status !== 'active')
    .sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || '') || b.createdAt - a.createdAt);
  if (!closed.length) {
    return `${head}<div class="empty"><div class="big" aria-hidden="true">📦</div><h2>아직 끝낸 목표가 없어요</h2><p>완료하거나 포기한 목표가 여기에 모여요.</p></div>`;
  }
  return head + closed.map(g => {
    const e = C.evaluate(g, db, t);
    const n = db.extensions.filter(x => x.goalId === g.id).length;
    return `<article class="card st-${g.status}">
      <div class="card-head"><a class="card-title" href="${goalHref(g.id)}">${esc(g.title)}</a>${badge(g.status)}</div>
      <div class="meta">${g.category ? `<span class="tag">${esc(g.category)}</span>` : ''}<span>${D.formatLong(g.closedAt)} 종료</span></div>
      <p class="nums"><b>최종 달성 ${C.formatProgress(e.raw)}</b></p>
      <p class="vals">${C.closedTimingLabel(g)}${n ? ` · 마감 ${n}회 연장` : ''}</p>
      <div class="actions btn-row">${actionBtn('reopen', g.id, '다시 열기')}</div>
    </article>`;
  }).join('');
}

// ── 설정 탭 ─────────────────────────────────────────────

function viewImportResult() {
  const r = ui.importResult;
  if (!r) return '';
  if (!r.ok) {
    return `<div class="notice error" role="alert"><p><b>불러올 수 없어요.</b> 지금 데이터는 그대로예요. (${esc(r.source)})</p>
      <ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>${actionBtn('import-cancel', '', '닫기')}</div>`;
  }
  const d = r.db;
  return `<div class="notice warn"><p><b>목표 ${d.goals.length}개 · 할 일 ${d.tasks.length}개 · 기록 ${d.logs.length}건</b>을 불러와 지금 데이터를 모두 덮어써요. (${esc(r.source)})</p>
    <div class="btn-row">${actionBtn('import-apply', '', '덮어쓰기', { cls: 'btn-danger', confirm: '한 번 더 누르면 덮어쓰기' })}${actionBtn('import-cancel', '', '취소', { cls: 'btn-ghost' })}</div></div>`;
}

function viewSettings(t) {
  const last = db.settings.lastBackupAt;
  const days = last == null ? null : D.diffDays(D.localYMD(last), t);
  const lastLabel = last == null ? '아직 백업한 적 없어요' : days === 0 ? '오늘' : `${days}일 전`;
  const themes = [['auto', '자동'], ['light', '라이트'], ['dark', '다크']];
  return `<header class="page-head"><div><h1>설정</h1></div></header>
    <div class="stack">
    <section class="panel"><fieldset style="border:0;margin:0;padding:0"><legend><h2 style="margin-bottom:10px">화면 테마</h2></legend>
      <div class="segmented">${themes.map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" data-change="theme"${db.settings.theme === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">자동은 기기의 라이트/다크 설정을 따라가요.</p></fieldset>
    </section>

    <section class="panel stack" aria-labelledby="backup-h">
      <h2 id="backup-h">백업</h2>
      <p class="small muted">데이터는 이 기기의 브라우저에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우면 사라지니 가끔 백업해 두세요.</p>
      <p><b>마지막 백업:</b> ${lastLabel}</p>
      <div class="btn-row">${actionBtn('export-file', '', '파일로 내보내기', { cls: 'btn-primary' })}${actionBtn('copy-json', '', '클립보드에 복사')}</div>
      <h3>불러오기</h3>
      <p class="small muted">불러오면 지금 데이터를 모두 덮어써요. 덮어쓰기 전에 한 번 더 확인해요.</p>
      <div class="btn-row"><input type="file" id="import-file" class="visually-hidden file-input" accept=".json,application/json" data-change="import-file"><label class="btn" for="import-file">백업 파일 선택</label></div>
      <form data-form="import-text" novalidate>
        <div class="field"><label for="import-text">또는 백업 내용(JSON) 붙여넣기</label><textarea class="input" id="import-text" name="text" rows="4" spellcheck="false">${esc(ui.importText)}</textarea></div>
        <button class="btn">내용 확인</button>
      </form>
      ${viewImportResult()}
    </section>

    <section class="panel stack" aria-labelledby="wipe-h">
      <h2 id="wipe-h">전체 삭제</h2>
      <p class="small muted">모든 목표·할 일·기록을 지워요. 지우기 전에 백업해 두세요.</p>
      <div>${actionBtn('wipe', '', '전체 삭제', { cls: 'btn-danger', confirm: '한 번 더 누르면 모두 삭제' })}</div>
    </section>

    <section class="panel" aria-labelledby="about-h">
      <h2 id="about-h" style="margin-bottom:8px">앱 정보</h2>
      <p>${esc(APP_NAME)} <span class="muted">버전 ${esc(APP_VERSION)}</span></p>
      <p class="small muted">인터넷 없이도 동작해요. 데이터는 서버로 보내지 않아요.</p>
    </section>
    </div>`;
}

// ── 목표 추가·수정 시트 ─────────────────────────────────

function viewGoalForm(g, t) {
  const locked = !!g && (db.logs.some(l => l.goalId === g.id) || db.tasks.some(x => x.goalId === g.id));
  const m = g ? g.measure : 'cumulative';
  const cats = [...new Set(['일상', '업무', ...db.goals.map(x => x.category).filter(Boolean)])];
  const err = id => `<p class="field-error" id="e-${id}" data-err="${id}"></p>`;
  const num = v => (v == null ? '' : C.formatNumber(v));
  const opts = C.MEASURES.map(key => `<label class="measure-opt"><input type="radio" name="measure" value="${key}"${key === m ? ' checked' : ''}${locked && key !== m ? ' disabled' : ''}>
      <b>${C.MEASURE_INFO[key].label}</b><span>${C.MEASURE_INFO[key].example}</span></label>`).join('');
  return `<form data-form="goal" data-id="${esc(g?.id ?? '')}" data-measure="${m}" novalidate>
    <div class="sheet-inner">
      <div class="sheet-head"><h2 id="sheet-title">${g ? '목표 수정' : '새 목표'}</h2>
        <button type="button" class="btn btn-ghost icon-btn" data-action="close-sheet" data-id="" aria-label="닫기">✕</button></div>

      <div class="field"><label for="f-title">제목</label>
        <input class="input" id="f-title" name="title" maxlength="100" autocomplete="off" placeholder="예: 12주 동안 운동 36회" value="${esc(g?.title ?? '')}" aria-describedby="e-title">${err('title')}</div>

      <div class="field"><label for="f-category">분류 (선택)</label>
        <input class="input" id="f-category" name="category" list="cat-list" maxlength="20" autocomplete="off" placeholder="일상, 업무 등" value="${esc(g?.category ?? '')}" aria-describedby="e-category">
        <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>${err('category')}</div>

      <div class="grid-2" style="margin-bottom:16px">
        <div class="field"><label for="f-start">시작일</label><input type="date" class="input" id="f-start" name="startDate" value="${g?.startDate ?? t}" aria-describedby="e-startDate">${err('startDate')}</div>
        <div class="field"><label for="f-due">마감일</label><input type="date" class="input" id="f-due" name="dueDate" value="${g?.dueDate ?? ''}" aria-describedby="e-dueDate">${err('dueDate')}</div>
      </div>

      <div class="field"><fieldset class="measure-options"><legend>측정 방식</legend>${opts}</fieldset>
        ${locked ? '<p class="hint">기록이나 할 일이 있어서 측정 방식을 바꿀 수 없어요. 다른 방식으로 재려면 새 목표를 만드세요.</p>' : ''}${err('measure')}</div>

      <div class="num-grid for-m for-numeric">
        <div class="field for-m for-current"><label for="f-startValue">시작값</label><input class="input" id="f-startValue" name="startValue" inputmode="decimal" autocomplete="off" placeholder="예: 75" value="${num(g?.startValue)}" aria-describedby="e-startValue">${err('startValue')}</div>
        <div class="field"><label for="f-targetValue">목표값</label><input class="input" id="f-targetValue" name="targetValue" inputmode="decimal" autocomplete="off" placeholder="예: 36" value="${num(g?.targetValue)}" aria-describedby="e-targetValue">${err('targetValue')}</div>
        <div class="field"><label for="f-unit">단위 (선택)</label><input class="input" id="f-unit" name="unit" maxlength="10" autocomplete="off" placeholder="회, kg, 권, 점" value="${esc(g?.unit ?? '')}"></div>
      </div>

      <div class="field for-m for-checklist">${g
        ? '<p class="hint">할 일은 목표 상세 화면에서 추가·체크해요.</p>'
        : `<label for="f-tasks">할 일 (한 줄에 하나씩, 나중에 추가해도 돼요)</label><textarea class="input" id="f-tasks" name="tasks" rows="4" placeholder="1장 정리&#10;2장 정리"></textarea>`}</div>
      <p class="hint for-m for-manual" style="margin-bottom:16px">기록할 때 진행 정도를 0~100%로 적어요.</p>

      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost" data-action="close-sheet" data-id="">취소</button>
        <button class="btn btn-primary">${g ? '저장' : '추가'}</button>
      </div>
    </div>
  </form>`;
}

function openSheet(goalId = null) {
  const g = goalId ? findGoal(goalId) : null;
  sheet.innerHTML = viewGoalForm(g, today());
  if (typeof sheet.showModal === 'function') sheet.showModal();
  else sheet.setAttribute('open', '');
  sheet.querySelector('#f-title').focus();
}

function closeSheet() {
  if (typeof sheet.close === 'function') sheet.close();
  else sheet.removeAttribute('open');
}

// ── 폼 오류 표시 (다시 그리지 않고 그 자리에서) ───────────

function clearErrors(form) {
  form.querySelectorAll('[data-err]').forEach(p => { p.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
}

function showErrors(form, errors) {
  let first = null;
  for (const [name, msg] of Object.entries(errors)) {
    const p = form.querySelector(`[data-err="${name}"]`);
    if (p) p.textContent = msg;
    const input = form.elements[name];
    if (input && !(input instanceof RadioNodeList)) {
      input.setAttribute('aria-invalid', 'true');
      first ??= input;
    }
  }
  first?.focus();
}

// ── 화면 그리기 ─────────────────────────────────────────

const VIEWS = { home: viewHome, today: viewToday, past: viewPast, settings: viewSettings };

function focusSelector() {
  const el = document.activeElement;
  if (!el || el === document.body || !(main.contains(el) || noticesEl.contains(el))) return null;
  if (el.dataset.action) return `[data-action="${el.dataset.action}"][data-id="${CSS.escape(el.dataset.id ?? '')}"]`;
  if (el.dataset.toggle) return `[data-toggle="${el.dataset.toggle}"][data-id="${CSS.escape(el.dataset.id ?? '')}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  return null;
}

function render() {
  const t = today();
  const r = route();
  let tab = r.tab;
  let html;
  if (r.goalId) {
    const g = findGoal(r.goalId);
    tab = g && g.status !== 'active' ? 'past' : 'home';
    html = g ? viewGoal(g, t) : '<div class="empty"><h2>목표를 찾을 수 없어요</h2><p>삭제되었을 수 있어요.</p><a class="btn" href="#home">현황으로</a></div>';
  } else {
    html = VIEWS[tab](t);
  }
  const keep = ui.focusAfter ?? focusSelector();
  ui.focusAfter = null;
  noticesEl.innerHTML = viewNotices();
  main.innerHTML = html;
  ui.lastWidth = main.clientWidth;

  document.querySelectorAll('.tabbar a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const gr = C.taskGroups(db, t);
  const count = gr.past.length + gr.today.length;
  const countEl = document.getElementById('today-count');
  countEl.hidden = count === 0;
  countEl.textContent = count;
  countEl.setAttribute('aria-label', `할 일 ${count}개`);
  fab.hidden = !(tab === 'home' && !r.goalId);

  if (keep) document.querySelector(keep)?.focus({ preventScroll: true });
}

// ── 동작 ────────────────────────────────────────────────

function arm(btn, key) {
  disarm();
  ui.armed = key;
  btn.textContent = btn.dataset.confirm;
  btn.classList.add('armed');
  const sel = `[data-action="${btn.dataset.action}"][data-id="${CSS.escape(btn.dataset.id ?? '')}"]`;
  ui.armTimer = setTimeout(() => {
    if (ui.armed !== key) return;
    ui.armed = null;
    // 그사이 다시 그려졌을 수 있어 현재 화면에서 버튼을 다시 찾는다
    const b = document.querySelector(sel);
    if (b) {
      b.textContent = b.dataset.label;
      b.classList.remove('armed');
    }
    document.querySelector('.delete-warn')?.remove();
  }, 5000);
}

function disarm() {
  clearTimeout(ui.armTimer);
  ui.armed = null;
}

function addLog(g, date, value, note = '') {
  db.logs.push({ id: S.uid('l'), goalId: g.id, date, value, note });
}

function closeGoal(g, status) {
  g.status = status;
  g.closedAt = today();
}

const ACTIONS = {
  'open-add': () => openSheet(),
  'open-edit': id => openSheet(id),
  'close-sheet': () => closeSheet(),
  filter: id => { ui.filter = id || null; render(); },
  go: id => { location.hash = `#${id}`; },
  jump: id => {
    ui.filter = null;
    render();
    const card = document.getElementById(`goal-${id}`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.querySelector('.card-title').focus({ preventScroll: true });
  },
  'open-record': id => { ui.form = { kind: 'record', id }; ui.focusAfter = `#${CSS.escape(`qr-${id}`)}`; render(); },
  'open-extend': id => { ui.form = { kind: 'extend', id }; ui.focusAfter = `#${CSS.escape(`ex-${id}`)}`; render(); },
  'close-form': () => { ui.form = null; render(); },
  'plus-one': id => {
    const g = findGoal(id);
    commitWithUndo(`${g.title} +1${g.unit} 기록했어요`, () => addLog(g, today(), 1));
  },
  complete: id => {
    const g = findGoal(id);
    commitWithUndo('완료했어요. 지난 목표로 옮겼어요', () => closeGoal(g, 'done'));
  },
  drop: id => {
    const g = findGoal(id);
    commitWithUndo('포기한 목표로 옮겼어요', () => closeGoal(g, 'dropped'));
  },
  reopen: id => {
    const g = findGoal(id);
    commit(() => { g.status = 'active'; g.closedAt = null; });
    toast('다시 진행 중으로 옮겼어요');
  },
  'delete-goal': id => {
    const g = findGoal(id);
    const back = g.status === 'active' ? '#home' : '#past';
    commitWithUndo('목표를 삭제했어요', () => {
      db.goals = db.goals.filter(x => x.id !== id);
      db.tasks = db.tasks.filter(x => x.goalId !== id);
      db.logs = db.logs.filter(x => x.goalId !== id);
      db.extensions = db.extensions.filter(x => x.goalId !== id);
    });
    location.hash = back;
  },
  'delete-log': id => commit(() => { db.logs = db.logs.filter(x => x.id !== id); }),
  'delete-task': id => commit(() => { db.tasks = db.tasks.filter(x => x.id !== id); }),
  'clear-sample': () => {
    commit(() => { db = S.emptyDB({ theme: db.settings.theme }); });
    toast('예시를 지웠어요. 첫 목표를 추가해 보세요');
  },
  'export-file': () => {
    db.settings.lastBackupAt = Date.now();
    const blob = new Blob([S.serialize(db)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_NAME}-백업-${today()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    persist();
    render();
    toast('백업 파일을 저장했어요');
  },
  'copy-json': async () => {
    const before = db.settings.lastBackupAt;
    db.settings.lastBackupAt = Date.now();
    try {
      await navigator.clipboard.writeText(S.serialize(db));
      persist();
      render();
      toast('복사했어요. 메모 앱 등에 붙여 넣어 보관하세요');
    } catch {
      db.settings.lastBackupAt = before;
      toast('복사하지 못했어요. 파일로 내보내기를 써 주세요');
    }
  },
  'import-apply': () => {
    const next = ui.importResult?.db;
    if (!next) return;
    ui.importResult = null;
    ui.importText = '';
    commit(() => { db = next; });
    applyTheme();
    toast('불러왔어요');
  },
  'import-cancel': () => { ui.importResult = null; render(); },
  wipe: () => {
    commitWithUndo('모두 지웠어요', () => { db = S.emptyDB({ theme: db.settings.theme, lastBackupAt: db.settings.lastBackupAt }); });
  },
  'apply-update': () => ui.notices.update?.(),
  install: () => ui.notices.install?.(),
  dismiss: id => {
    if (id === 'ios') ui.notices.ios?.();
    ui.notices[id] = null;
    render();
  },
};

const FORMS = {
  goal: form => {
    const fd = new FormData(form);
    const id = form.dataset.id;
    const g = id ? findGoal(id) : null;
    const res = C.validateGoalInput({
      title: fd.get('title'), category: fd.get('category'),
      startDate: fd.get('startDate'), dueDate: fd.get('dueDate'), measure: fd.get('measure'),
      startValue: fd.get('startValue'), targetValue: fd.get('targetValue'), unit: fd.get('unit'),
    });
    clearErrors(form);
    if (!res.ok) return showErrors(form, res.errors);
    const v = res.value;
    if (g) {
      commit(() => Object.assign(g, v));
      toast('저장했어요');
    } else {
      const ng = { id: S.uid('g'), ...v, originalDueDate: null, status: 'active', closedAt: null, createdAt: Date.now() };
      const lines = v.measure === 'checklist'
        ? String(fd.get('tasks') ?? '').split('\n').map(s => s.trim()).filter(Boolean)
        : [];
      commit(() => {
        db.goals.push(ng);
        lines.forEach((title, i) => db.tasks.push({
          id: S.uid('k'), goalId: ng.id, title: title.slice(0, 100), dueDate: null, done: false, doneAt: null, order: i,
        }));
      });
      toast('목표를 추가했어요');
    }
    closeSheet();
  },
  'quick-record': form => {
    const g = findGoal(form.dataset.id);
    const r = C.validateLogValue(g.measure, form.elements.value.value);
    clearErrors(form);
    if (r.error) return showErrors(form, { value: r.error });
    commitWithUndo(`${C.formatLogValue(g, r.value)} 기록했어요`, () => addLog(g, today(), r.value));
  },
  extend: form => {
    const g = findGoal(form.dataset.id);
    const to = form.elements.to.value;
    const t = today();
    clearErrors(form);
    let error = null;
    if (!D.isYMD(to)) error = '날짜를 고르세요';
    else if (to <= g.dueDate) error = `지금 마감일(${D.formatMD(g.dueDate)})보다 뒤 날짜를 고르세요`;
    else if (to < t) error = '오늘이나 그 뒤 날짜를 고르세요';
    if (error) return showErrors(form, { to: error });
    commit(() => {
      db.extensions.push({ goalId: g.id, from: g.dueDate, to, at: Date.now() });
      if (!g.originalDueDate) g.originalDueDate = g.dueDate;
      g.dueDate = to;
    });
    toast(`마감을 ${D.formatMD(to)}로 연장했어요`);
  },
  'add-log': form => {
    const g = findGoal(form.dataset.id);
    const date = form.elements.date.value;
    const r = C.validateLogValue(g.measure, form.elements.value.value);
    const errors = {};
    if (!D.isYMD(date)) errors.date = '날짜를 고르세요';
    if (r.error) errors.value = r.error;
    clearErrors(form);
    if (Object.keys(errors).length) return showErrors(form, errors);
    ui.focusAfter = '#log-value';
    commit(() => addLog(g, date, r.value, form.elements.note.value.trim().slice(0, 200)));
    toast('기록했어요');
  },
  'add-task': form => {
    const g = findGoal(form.dataset.id);
    const title = form.elements.title.value.trim();
    const due = form.elements.dueDate.value;
    clearErrors(form);
    if (!title) return showErrors(form, { title: '할 일을 입력하세요' });
    const order = Math.max(-1, ...db.tasks.filter(x => x.goalId === g.id).map(x => x.order)) + 1;
    ui.focusAfter = '#task-title';
    commit(() => db.tasks.push({
      id: S.uid('k'), goalId: g.id, title: title.slice(0, 100), dueDate: D.isYMD(due) ? due : null, done: false, doneAt: null, order,
    }));
  },
  'import-text': form => {
    ui.importText = form.elements.text.value;
    if (!ui.importText.trim()) {
      ui.importResult = { ok: false, errors: ['붙여넣은 내용이 없어요.'], source: '붙여넣기' };
    } else {
      ui.importResult = { ...S.validateDB(ui.importText), source: '붙여넣기' };
    }
    render();
  },
};

function toggleTask(id, checked) {
  const task = db.tasks.find(x => x.id === id);
  if (!task) return;
  commit(() => {
    task.done = checked;
    task.doneAt = checked ? Date.now() : null;
  });
  const g = findGoal(task.goalId);
  toast(`${g.title} · 달성 ${C.formatProgress(C.rawProgress(g, db))}`);
}

// ── 이벤트 연결 ─────────────────────────────────────────

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const { action } = el.dataset;
  const id = el.dataset.id ?? '';
  if (el.dataset.confirm) {
    const key = `${action}|${id}`;
    if (ui.armed !== key) {
      arm(el, key);
      if (action === 'delete-goal') render(); // 함께 지워지는 항목 안내를 보여준다
      return;
    }
  }
  disarm();
  ACTIONS[action]?.(id, el);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  FORMS[form.dataset.form]?.(form);
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.toggle === 'task') {
    toggleTask(el.dataset.id, el.checked);
  } else if (el.name === 'measure' && el.form?.dataset.form === 'goal') {
    el.form.dataset.measure = el.value;
  } else if (el.dataset.change === 'theme') {
    commit(() => { db.settings.theme = el.value; });
    applyTheme();
  } else if (el.dataset.change === 'import-file') {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch { text = ''; }
    ui.importResult = { ...S.validateDB(text), source: file.name };
    render();
  }
});

document.addEventListener('toggle', e => {
  if (e.target.id === 'done-today') ui.doneOpen = e.target.open;
}, true);

sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });

window.addEventListener('hashchange', () => {
  ui.form = null;
  disarm();
  render();
  window.scrollTo(0, 0);
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

window.addEventListener('resize', () => {
  if (route().goalId && Math.abs(main.clientWidth - ui.lastWidth) > 20) render();
});

window.addEventListener('storage', e => {
  if (e.key !== S.STORAGE_KEY) return;
  const r = S.loadDB();
  if (r.status === 'ok') { db = r.db; applyTheme(); render(); }
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ── 시작 ────────────────────────────────────────────────

function boot() {
  document.title = APP_NAME;
  const loaded = S.loadDB();
  if (loaded.status === 'empty') {
    db = S.createSampleDB(today(), Date.now());
    persist();
  } else {
    db = loaded.db;
    if (loaded.status === 'corrupt') ui.notices.load = loaded.errors;
    if (loaded.status === 'unavailable') ui.notices.save = loaded.errors[0];
  }
  applyTheme();
  render();
  initPWA({
    onUpdate: apply => { ui.notices.update = apply; render(); },
    onInstallable: prompt => { ui.notices.install = prompt; render(); },
    onIOSHint: dismiss => { ui.notices.ios = dismiss; render(); },
  });
}

boot();

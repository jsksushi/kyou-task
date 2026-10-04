/* きょうのタスク v1 */
'use strict';

const STORE_KEY = 'kyou-task-data-v1';
const TODAY_ID = 'today';
const PALETTE = ['#fbe3d6','#fff4c2','#d7ecfb','#dcf2e0','#fde2ea','#e4f1f0','#efe6d8','#e8eaed'];
const WD = ['日','月','火','水','木','金','土'];

/* ---------- 日付ユーティリティ ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const lastDayOfMonth = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function dueLabel(k) {
  const t = todayKey();
  if (k === t) return '今日';
  if (k === addDays(t, 1)) return '明日';
  if (k === addDays(t, -1)) return '昨日';
  const d = parseKey(k);
  const y = d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '/' : '';
  return `${y}${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`;
}

/* ---------- 繰り返しルール ---------- */
function ruleMatches(rule, k) {
  const d = parseKey(k);
  switch (rule.type) {
    case 'daily': return true;
    case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly': return (rule.days || []).includes(d.getDay());
    case 'monthly': return d.getDate() === Math.min(rule.dom || 1, lastDayOfMonth(d));
    case 'monthEnd': return d.getDate() === lastDayOfMonth(d);
  }
  return false;
}
function nextOccurrence(rule, fromKey) {
  let k = fromKey;
  for (let i = 0; i < 400; i++) { if (ruleMatches(rule, k)) return k; k = addDays(k, 1); }
  return fromKey;
}
function ruleLabel(r) {
  switch (r.type) {
    case 'daily': return '毎日';
    case 'weekdays': return '平日';
    case 'weekly': {
      const order = [1, 2, 3, 4, 5, 6, 0];
      return '毎週 ' + order.filter(x => (r.days || []).includes(x)).map(x => WD[x]).join('・');
    }
    case 'monthly': return `毎月 ${r.dom}日`;
    case 'monthEnd': return '毎月 末日';
  }
  return '';
}

/* ---------- データ ---------- */
function defaultState() {
  return {
    version: 1,
    lists: [
      { id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] },
      { id: uid(), name: '⭐ 今日できたら', color: PALETTE[1] },
      { id: uid(), name: '📅 今週', color: PALETTE[2] },
      { id: uid(), name: '🏖 土日やる', color: PALETTE[3] },
    ],
    tasks: [],
    rules: [],
    memos: [{ id: uid(), text: '✍ ここはメモ欄です（件数には入りません）\nクリックで編集できます。URLはクリックで開けます。\nhttps://www.google.com', createdAt: Date.now() }],
    lastDate: todayKey(),
  };
}
let S;
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    S = raw ? JSON.parse(raw) : defaultState();
  } catch (e) { S = defaultState(); }
  if (!S.lists.some(l => l.id === TODAY_ID)) S.lists.unshift({ id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] });
  S.tasks ||= []; S.rules ||= []; S.memos ||= [];
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { alert('保存に失敗しました：' + e.message); }
}
const listById = id => S.lists.find(l => l.id === id);
const taskById = id => S.tasks.find(t => t.id === id);
const ruleById = id => S.rules.find(r => r.id === id);

/* ---------- 日次処理 ---------- */
// 繰り返しタスクを「出てくる日」ごとに1件ずつ作る（やり残しも回ごとに残る）
function generateRepeats() {
  const t = todayKey();
  for (const r of S.rules) {
    let k = r.lastGenerated ? addDays(r.lastGenerated, 1) : t;
    let guard = 0;
    while (k <= t && guard++ < 400) {
      if (ruleMatches(r, k)) {
        S.tasks.push({
          id: uid(), title: r.title, listId: r.listId, due: k, time: r.time || '',
          memo: r.memo || '', ruleId: r.id, done: false, createdAt: Date.now(),
        });
      }
      r.lastGenerated = k;
      k = addDays(k, 1);
    }
  }
}
// 期限が今日以前になった未完了タスクを「今日」へ自動移動
function autoMoveToToday() {
  const t = todayKey();
  for (const x of S.tasks) {
    if (x.done || !x.due || x.due > t || x.listId === TODAY_ID || x.pinnedOut) continue;
    x.origListId = x.listId;
    x.listId = TODAY_ID;
  }
}
function dailyRefresh() {
  generateRepeats();
  autoMoveToToday();
  S.lastDate = todayKey();
  save();
}

/* ---------- 件数・バッジ ---------- */
function isCounted(x, t = todayKey()) {
  if (x.done) return false;
  if (x.due && x.due <= t) return true;                // 期限が今日・過去（繰り返し含む）
  if (x.listId === TODAY_ID && !(x.due && x.due > t)) return true; // 今日リスト（先の日付を指定したものは除く）
  return false;
}
function isOverdue(x) {
  if (x.done || !x.due) return false;
  const t = todayKey();
  if (x.due < t) return true;
  return x.due === t && x.time && x.time < nowHM();
}
function updateBadge() {
  const n = S.tasks.filter(x => isCounted(x)).length;
  document.getElementById('cnt').textContent = n;
  document.title = n > 0 ? `(${n}) きょうのタスク` : 'きょうのタスク';
  try {
    if ('setAppBadge' in navigator) {
      if (n > 0) navigator.setAppBadge(n).catch(() => {});
      else navigator.clearAppBadge().catch(() => {});
    }
  } catch (e) { /* 非対応環境では何もしない */ }
}

/* ---------- 表示 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function linkify(s) {
  return esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function sortTasks(a, b) {
  const ka = (a.due || '9999-99-99') + (a.time || '99:99');
  const kb = (b.due || '9999-99-99') + (b.time || '99:99');
  return ka < kb ? -1 : ka > kb ? 1 : (a.createdAt || 0) - (b.createdAt || 0);
}

function taskRow(x) {
  const t = todayKey();
  const cls = ['item'];
  if (isOverdue(x)) cls.push('overdue');
  if (x.done) cls.push('done');
  else if (x.listId === TODAY_ID && x.due && x.due > t) cls.push('future');
  const meta = [];
  if (x.due) meta.push(`<span class="due">⏰ ${dueLabel(x.due)}${x.time ? ' ' + x.time : ''}</span>`);
  else if (x.time) meta.push(`<span class="due">⏰ ${x.time}</span>`);
  const r = x.ruleId && ruleById(x.ruleId);
  if (r) meta.push(`<span class="tag">🔁 ${ruleLabel(r)}</span>`);
  if (x.listId === TODAY_ID && x.origListId && listById(x.origListId)) meta.push(`<span class="tag">📂 ${esc(listById(x.origListId).name)}</span>`);
  const btn = x.done
    ? `<button class="donebtn" data-undo="${x.id}" title="未完了に戻す">戻す</button>`
    : `<button class="donebtn" data-done="${x.id}" title="完了にする">完了</button>`;
  return `<div class="${cls.join(' ')}" data-id="${x.id}" draggable="${!x.done}">
    <div class="body">
      <div class="title" data-edit="${x.id}">${esc(x.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
      ${x.memo ? `<div class="tmemo">${linkify(x.memo)}</div>` : ''}
    </div>${btn}</div>`;
}

function render() {
  const t = todayKey();
  const board = document.getElementById('board');
  const html = [];
  for (const L of S.lists) {
    const open = S.tasks.filter(x => x.listId === L.id && !x.done).sort(sortTasks);
    const doneToday = S.tasks.filter(x => x.listId === L.id && x.done && x.doneDate === t)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    html.push(`<section class="col" style="background:${esc(L.color)}" data-list="${L.id}">
      <h2>${esc(L.name)}<span class="n">${open.length}件</span></h2>
      ${open.map(taskRow).join('') || '<div class="empty">タスクはありません</div>'}
      <div class="addrow">
        <input class="add" data-add="${L.id}" placeholder="＋ タスクを追加（Enter）">
        <button class="more" data-addmore="${L.id}" title="日時やメモを付けて追加">詳しく</button>
      </div>
      ${doneToday.length ? `<details ${openDetails.has(L.id) ? 'open' : ''} data-det="${L.id}"><summary>完了 ${doneToday.length}件</summary>${doneToday.map(taskRow).join('')}</details>` : ''}
    </section>`);
  }
  html.push(`<section class="col memo">
    <h2>✍ メモ<span class="n">件数に含めない</span></h2>
    ${S.memos.map(m => `<div class="memocard" data-memo="${m.id}">${linkify(m.text)}</div>`).join('')}
    <textarea class="memoadd" id="memoAdd" rows="1" placeholder="＋ メモを追加（Ctrl+Enterで確定）"></textarea>
  </section>`);
  // 入力途中の内容とフォーカスを保持
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.add ? { id: active.dataset.add, v: active.value } : null;
  board.innerHTML = html.join('');
  if (keep) {
    const el = board.querySelector(`[data-add="${keep.id}"]`);
    if (el) { el.value = keep.v; el.focus(); }
  }
  updateBadge();
}
const openDetails = new Set();

/* ---------- タスク操作 ---------- */
function completeTask(id) {
  const x = taskById(id); if (!x) return;
  x.done = true; x.doneAt = Date.now(); x.doneDate = todayKey();
  save(); render();
}
function undoTask(id) {
  const x = taskById(id); if (!x) return;
  x.done = false; delete x.doneAt; delete x.doneDate;
  if (!listById(x.listId)) x.listId = TODAY_ID;
  autoMoveToToday();
  save(); render();
}
function quickAdd(listId, title) {
  title = title.trim(); if (!title) return;
  const x = { id: uid(), title, listId, due: '', time: '', memo: '', done: false, createdAt: Date.now() };
  S.tasks.push(x);
  save(); render();
}
function moveTask(id, listId) {
  const x = taskById(id); if (!x || x.listId === listId) return;
  x.listId = listId;
  delete x.origListId;
  // 期限が今日以前のタスクを手で「今日」以外へ動かしたら、自動で戻さない
  x.pinnedOut = listId !== TODAY_ID && !!x.due && x.due <= todayKey();
  save(); render();
}

/* ---------- タスク編集ダイアログ ---------- */
const dlgTask = document.getElementById('dlgTask');
let editing = null; // {mode:'task'|'new'|'rule', id, listId}
let fDueVal = '', fTimeVal = '';

function fillListSelect(sel, value) {
  sel.innerHTML = S.lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  sel.value = value;
}
function setDue(v) {
  fDueVal = v;
  document.getElementById('fDue').value = v;
  const t = todayKey();
  document.querySelectorAll('[data-due]').forEach(b => {
    const d = b.dataset.due;
    b.classList.toggle('on', (d === 'none' && !v) || (d === 'today' && v === t) || (d === 'tomorrow' && v === addDays(t, 1)));
  });
}
function setTime(v) {
  fTimeVal = v;
  document.getElementById('fTime').value = v;
  document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('on', b.dataset.time === v));
}
function setRepeatUI(type, days, dom) {
  document.getElementById('fRepeat').value = type || '';
  document.querySelectorAll('#rowWeekdays input').forEach(c => { c.checked = (days || []).includes(Number(c.value)); });
  document.getElementById('fDom').value = dom || new Date().getDate();
  repeatChanged();
}
function repeatChanged() {
  const v = document.getElementById('fRepeat').value;
  document.getElementById('rowWeekdays').hidden = v !== 'weekly';
  document.getElementById('rowDom').hidden = v !== 'monthly';
  const hint = document.getElementById('repeatHint');
  if (editing && editing.mode === 'rule') hint.textContent = '「なし」にして保存すると、この繰り返し設定を削除します（出てきているタスクは残ります）。';
  else if (v) hint.textContent = '設定した日になると自動でタスクが出てきます。やり残した回は赤字で残ります。';
  else hint.textContent = '';
}
function readRepeat() {
  const type = document.getElementById('fRepeat').value;
  if (!type) return null;
  const days = [...document.querySelectorAll('#rowWeekdays input:checked')].map(c => Number(c.value));
  const dom = Math.min(31, Math.max(1, Number(document.getElementById('fDom').value) || 1));
  return { type, days, dom };
}

function openTaskDialog(mode, id, listId, presetTitle) {
  editing = { mode, id, listId };
  const titleEl = document.getElementById('taskDlgTitle');
  const rowDue = document.getElementById('rowDue');
  document.getElementById('btnTaskDelete').hidden = mode === 'new';
  rowDue.hidden = mode === 'rule';
  if (mode === 'task') {
    const x = taskById(id);
    const r = x.ruleId && ruleById(x.ruleId);
    titleEl.textContent = 'タスクを編集';
    document.getElementById('fTitle').value = x.title;
    fillListSelect(document.getElementById('fList'), x.listId);
    setDue(x.due || ''); setTime(x.time || '');
    setRepeatUI(r ? r.type : '', r ? r.days : [], r ? r.dom : null);
    document.getElementById('fMemo').value = x.memo || '';
  } else if (mode === 'rule') {
    const r = ruleById(id);
    titleEl.textContent = '繰り返し設定を編集';
    document.getElementById('fTitle').value = r.title;
    fillListSelect(document.getElementById('fList'), r.listId);
    setDue(''); setTime(r.time || '');
    setRepeatUI(r.type, r.days, r.dom);
    document.getElementById('fMemo').value = r.memo || '';
  } else {
    titleEl.textContent = 'タスクを追加';
    document.getElementById('fTitle').value = presetTitle || '';
    fillListSelect(document.getElementById('fList'), listId);
    setDue(''); setTime('');
    setRepeatUI('', [], null);
    document.getElementById('fMemo').value = '';
  }
  repeatChanged();
  dlgTask.showModal();
  document.getElementById('fTitle').focus();
}

function saveTaskDialog() {
  const title = document.getElementById('fTitle').value.trim();
  if (!title) { document.getElementById('fTitle').focus(); return false; }
  const listId = document.getElementById('fList').value;
  const time = fTimeVal;
  const memo = document.getElementById('fMemo').value;
  const rep = readRepeat();
  if (rep && rep.type === 'weekly' && rep.days.length === 0) { alert('毎週の曜日を1つ以上選んでください'); return false; }
  const t = todayKey();

  if (editing.mode === 'rule') {
    const r = ruleById(editing.id);
    if (!rep) {
      if (!confirm('この繰り返し設定を削除します。よろしいですか？\n（すでに出ているタスクは残ります）')) return false;
      S.rules = S.rules.filter(z => z.id !== r.id);
      S.tasks.forEach(x => { if (x.ruleId === r.id) delete x.ruleId; });
    } else {
      Object.assign(r, { title, listId, time, memo, ...rep });
      // まだ完了していない今後分（今日以降の未完了）にも反映
      S.tasks.forEach(x => { if (x.ruleId === r.id && !x.done && x.due >= t) { x.title = title; x.time = time; x.memo = memo; } });
    }
    save(); render(); return true;
  }

  let x;
  if (editing.mode === 'new') {
    x = { id: uid(), title, listId, due: '', time: '', memo: '', done: false, createdAt: Date.now() };
    S.tasks.push(x);
  } else {
    x = taskById(editing.id);
  }
  const prevList = x.listId, prevDue = x.due;
  x.title = title; x.time = time; x.memo = memo; x.due = fDueVal;
  if (listId !== prevList) { x.listId = listId; delete x.origListId; }
  if (x.due !== prevDue) delete x.pinnedOut;
  if (listId !== prevList) x.pinnedOut = listId !== TODAY_ID && !!x.due && x.due <= t;
  // 「今日」に自動移動されていたタスクの期限を先に延ばしたら、元のリストへ戻す
  if (x.listId === TODAY_ID && x.origListId && x.due && x.due > t && listById(x.origListId)) {
    x.listId = x.origListId; delete x.origListId;
  }

  // 繰り返し設定
  const cur = x.ruleId && ruleById(x.ruleId);
  if (rep && cur) {
    Object.assign(cur, { title, listId: x.listId === TODAY_ID && x.origListId ? x.origListId : x.listId, time, memo, ...rep });
  } else if (rep && !cur) {
    const home = x.listId === TODAY_ID && x.origListId && listById(x.origListId) ? x.origListId : x.listId;
    const r = { id: uid(), title, listId: home, time, memo, ...rep };
    // このタスクを初回分にする：期限がルールに合わなければ次の該当日にそろえる
    const base = x.due || t;
    x.due = ruleMatches(r, base) ? base : nextOccurrence(r, base);
    r.lastGenerated = x.due < t ? t : x.due;
    x.ruleId = r.id;
    S.rules.push(r);
  } else if (!rep && cur) {
    if (!confirm('繰り返しを止めます。このタスクは通常のタスクとして残ります。よろしいですか？')) return false;
    S.rules = S.rules.filter(z => z.id !== cur.id);
    S.tasks.forEach(z => { if (z.ruleId === cur.id) delete z.ruleId; });
  }
  autoMoveToToday();
  save(); render();
  return true;
}

/* ---------- メモ ---------- */
const dlgMemo = document.getElementById('dlgMemo');
let editingMemo = null;
function addMemo(text) {
  if (!text.trim()) return;
  S.memos.push({ id: uid(), text: text.replace(/\s+$/, ''), createdAt: Date.now() });
  save(); render();
  document.getElementById('memoAdd').focus();
}

/* ---------- リスト管理 ---------- */
const dlgLists = document.getElementById('dlgLists');
let deletingList = null;
function renderListRows() {
  const box = document.getElementById('listRows');
  box.innerHTML = S.lists.map((l, i) => {
    const cnt = S.tasks.filter(x => x.listId === l.id || x.origListId === l.id).length + S.rules.filter(r => r.listId === l.id).length;
    const others = S.lists.filter(o => o.id !== l.id);
    return `<div class="lrow" data-lid="${l.id}">
      <input type="text" value="${esc(l.name)}" data-lname="${l.id}">
      <div class="swatches">${PALETTE.map(c => `<button class="sw ${c === l.color ? 'on' : ''}" style="background:${c}" data-lcolor="${l.id}" data-c="${c}" title="${c}"></button>`).join('')}</div>
      <button class="btn small" data-lup="${l.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn small" data-ldown="${l.id}" ${i === S.lists.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small danger" data-ldel="${l.id}" ${l.id === TODAY_ID ? 'disabled title="「今日」は削除できません"' : ''}>削除</button>
      ${deletingList === l.id ? `<div class="delbox">
        ${cnt ? `中のタスク・繰り返し設定（${cnt}件）の移動先：<select data-lmoveto>${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>` : '中にタスクはありません。'}
        <button class="btn small danger" data-ldelok="${l.id}">削除する</button>
        <button class="btn small" data-ldelcancel>やめる</button>
      </div>` : ''}
    </div>`;
  }).join('');
}
function deleteList(id, moveTo) {
  S.tasks.forEach(x => {
    if (x.listId === id) { x.listId = moveTo; }
    if (x.origListId === id) x.origListId = moveTo;
  });
  S.rules.forEach(r => { if (r.listId === id) r.listId = moveTo; });
  S.lists = S.lists.filter(l => l.id !== id);
  deletingList = null;
  save(); render(); renderListRows();
}

/* ---------- 繰り返し一覧・完了履歴 ---------- */
function renderRuleRows() {
  const box = document.getElementById('ruleRows');
  if (!S.rules.length) { box.innerHTML = '<p class="empty">繰り返しタスクはまだありません。タスクの編集画面で「繰り返し」を設定すると追加されます。</p>'; return; }
  const t = todayKey();
  box.innerHTML = S.rules.map(r => {
    const L = listById(r.listId);
    const next = nextOccurrence(r, addDays(r.lastGenerated || t, 1));
    return `<div class="hrow">
      <span class="dot" style="background:${L ? esc(L.color) : '#ccc'}"></span>
      <div class="t">${esc(r.title)}<div class="s">🔁 ${ruleLabel(r)}${r.time ? ' ' + r.time + 'まで' : ''}／${L ? esc(L.name) : ''}／次回 ${dueLabel(next)}</div></div>
      <button class="btn small" data-redit="${r.id}">編集</button>
    </div>`;
  }).join('');
}
function renderHistoryRows() {
  const box = document.getElementById('historyRows');
  const done = S.tasks.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  document.getElementById('btnHistoryClear').disabled = !done.length;
  if (!done.length) { box.innerHTML = '<p class="empty">完了したタスクはまだありません。</p>'; return; }
  let lastDay = '';
  box.innerHTML = done.map(x => {
    const L = listById(x.listId);
    const head = x.doneDate !== lastDay ? `<div class="s" style="margin-top:10px;font-weight:600">${x.doneDate ? dueLabel(x.doneDate) : '日付不明'}</div>` : '';
    lastDay = x.doneDate;
    return `${head}<div class="hrow">
      <span class="dot" style="background:${L ? esc(L.color) : '#ccc'}"></span>
      <div class="t">${esc(x.title)}<div class="s">${L ? esc(L.name) : ''}${x.due ? '／期限 ' + dueLabel(x.due) : ''}</div></div>
      <button class="btn small" data-hundo="${x.id}">戻す</button>
      <button class="btn small danger" data-hdel="${x.id}">削除</button>
    </div>`;
  }).join('');
}

/* ---------- バックアップ ---------- */
function exportJSON() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `kyou-task-backup_${keyOf(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importJSON(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = JSON.parse(fr.result);
      if (!Array.isArray(data.lists) || !Array.isArray(data.tasks)) throw new Error('きょうのタスクのバックアップ形式ではありません');
      if (!confirm(`読み込みます。今のデータは置き換わります。\nリスト ${data.lists.length}件／タスク ${data.tasks.length}件／メモ ${(data.memos || []).length}件`)) return;
      S = data; S.rules ||= []; S.memos ||= [];
      if (!S.lists.some(l => l.id === TODAY_ID)) S.lists.unshift({ id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] });
      dailyRefresh(); render();
      document.getElementById('dlgBackup').close();
      alert('読み込みました');
    } catch (e) { alert('読み込めませんでした：' + e.message); }
  };
  fr.readAsText(file);
}

/* ---------- イベント ---------- */
function bind() {
  const board = document.getElementById('board');

  board.addEventListener('click', e => {
    const el = e.target;
    if (el.closest('a')) return; // リンクはそのまま開く
    if (el.dataset.done) return completeTask(el.dataset.done);
    if (el.dataset.undo) return undoTask(el.dataset.undo);
    if (el.dataset.edit) return openTaskDialog('task', el.dataset.edit);
    if (el.dataset.addmore) {
      const inp = board.querySelector(`[data-add="${el.dataset.addmore}"]`);
      const v = inp ? inp.value : '';
      if (inp) inp.value = '';
      return openTaskDialog('new', null, el.dataset.addmore, v);
    }
    const mc = el.closest('[data-memo]');
    if (mc) {
      editingMemo = mc.dataset.memo;
      document.getElementById('mText').value = S.memos.find(m => m.id === editingMemo).text;
      dlgMemo.showModal();
    }
  });
  board.addEventListener('toggle', e => {
    const d = e.target; if (!d.dataset || !d.dataset.det) return;
    d.open ? openDetails.add(d.dataset.det) : openDetails.delete(d.dataset.det);
  }, true);
  board.addEventListener('keydown', e => {
    const el = e.target;
    if (e.isComposing || e.keyCode === 229) return; // 日本語変換中のEnterは無視
    if (el.dataset.add && e.key === 'Enter') { e.preventDefault(); const v = el.value; el.value = ''; quickAdd(el.dataset.add, v); }
    if (el.id === 'memoAdd' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const v = el.value; el.value = ''; addMemo(v); }
  });
  board.addEventListener('input', e => {
    if (e.target.id === 'memoAdd') { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
  });
  board.addEventListener('focusout', e => {
    // メモ欄はフォーカスが外れたら確定
    if (e.target.id === 'memoAdd' && e.target.value.trim()) {
      const v = e.target.value; e.target.value = ''; addMemo(v);
      document.getElementById('memoAdd').blur();
    }
  });

  // ドラッグ＆ドロップでリスト移動
  let dragId = null;
  board.addEventListener('dragstart', e => {
    const it = e.target.closest && e.target.closest('.item');
    if (!it) return;
    dragId = it.dataset.id; it.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
  });
  board.addEventListener('dragend', () => {
    dragId = null;
    board.querySelectorAll('.dragging,.dragover').forEach(n => n.classList.remove('dragging', 'dragover'));
  });
  board.addEventListener('dragover', e => {
    const col = e.target.closest('[data-list]');
    if (!col || !dragId) return;
    e.preventDefault();
    board.querySelectorAll('.dragover').forEach(n => n !== col && n.classList.remove('dragover'));
    col.classList.add('dragover');
  });
  board.addEventListener('drop', e => {
    const col = e.target.closest('[data-list]');
    if (!col || !dragId) return;
    e.preventDefault();
    moveTask(dragId, col.dataset.list);
  });

  // タスクダイアログ
  document.querySelectorAll('[data-due]').forEach(b => b.onclick = () => {
    const t = todayKey();
    setDue(b.dataset.due === 'none' ? '' : b.dataset.due === 'today' ? t : addDays(t, 1));
  });
  document.getElementById('fDue').onchange = e => setDue(e.target.value);
  document.querySelectorAll('[data-time]').forEach(b => b.onclick = () => setTime(b.dataset.time));
  document.getElementById('fTime').onchange = e => setTime(e.target.value);
  document.getElementById('fRepeat').onchange = repeatChanged;
  document.getElementById('taskForm').onsubmit = e => { e.preventDefault(); if (saveTaskDialog()) dlgTask.close(); };
  document.getElementById('btnTaskCancel').onclick = () => dlgTask.close();
  document.getElementById('btnTaskDelete').onclick = () => {
    if (editing.mode === 'rule') {
      if (!confirm('この繰り返し設定を削除します。よろしいですか？\n（すでに出ているタスクは残ります）')) return;
      S.rules = S.rules.filter(r => r.id !== editing.id);
      S.tasks.forEach(x => { if (x.ruleId === editing.id) delete x.ruleId; });
      save(); render(); renderRuleRows(); dlgTask.close(); return;
    }
    const x = taskById(editing.id);
    if (!confirm(`「${x.title}」を削除します。よろしいですか？${x.ruleId ? '\n（今回分のみ削除。繰り返し設定は残ります）' : ''}`)) return;
    S.tasks = S.tasks.filter(z => z.id !== x.id);
    save(); render(); dlgTask.close();
  };
  dlgTask.addEventListener('close', () => { if (document.getElementById('dlgRules').open) renderRuleRows(); });
  // タイトル欄でEnter→保存（日本語変換中は除く）
  document.getElementById('fTitle').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); if (saveTaskDialog()) dlgTask.close(); }
  });

  // メモダイアログ
  document.getElementById('memoForm').onsubmit = e => {
    e.preventDefault();
    const m = S.memos.find(z => z.id === editingMemo);
    const v = document.getElementById('mText').value;
    if (!v.trim()) { S.memos = S.memos.filter(z => z.id !== editingMemo); }
    else m.text = v.replace(/\s+$/, '');
    save(); render(); dlgMemo.close();
  };
  document.getElementById('btnMemoCancel').onclick = () => dlgMemo.close();
  document.getElementById('btnMemoDelete').onclick = () => {
    if (!confirm('このメモを削除します。よろしいですか？')) return;
    S.memos = S.memos.filter(z => z.id !== editingMemo);
    save(); render(); dlgMemo.close();
  };

  // ヘッダーボタン
  document.getElementById('btnLists').onclick = () => { deletingList = null; renderListRows(); dlgLists.showModal(); };
  document.getElementById('btnRules').onclick = () => { renderRuleRows(); document.getElementById('dlgRules').showModal(); };
  document.getElementById('btnHistory').onclick = () => { renderHistoryRows(); document.getElementById('dlgHistory').showModal(); };
  document.getElementById('btnBackup').onclick = () => document.getElementById('dlgBackup').showModal();
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('dialog').close());

  // リスト管理
  const lr = document.getElementById('listRows');
  lr.addEventListener('input', e => {
    const id = e.target.dataset.lname; if (!id) return;
    listById(id).name = e.target.value; save(); render();
  });
  lr.addEventListener('click', e => {
    const d = e.target.dataset;
    const idx = id => S.lists.findIndex(l => l.id === id);
    if (d.lcolor) { listById(d.lcolor).color = d.c; save(); render(); renderListRows(); }
    else if (d.lup) { const i = idx(d.lup); [S.lists[i - 1], S.lists[i]] = [S.lists[i], S.lists[i - 1]]; save(); render(); renderListRows(); }
    else if (d.ldown) { const i = idx(d.ldown); [S.lists[i + 1], S.lists[i]] = [S.lists[i], S.lists[i + 1]]; save(); render(); renderListRows(); }
    else if (d.ldel) { deletingList = d.ldel; renderListRows(); }
    else if (d.ldelok) {
      const sel = lr.querySelector('[data-lmoveto]');
      deleteList(d.ldelok, sel ? sel.value : TODAY_ID);
    }
    else if ('ldelcancel' in d) { deletingList = null; renderListRows(); }
  });
  document.getElementById('btnListAdd').onclick = () => {
    const used = S.lists.map(l => l.color);
    S.lists.push({ id: uid(), name: '新しいリスト', color: PALETTE.find(c => !used.includes(c)) || PALETTE[7] });
    save(); render(); renderListRows();
    const inputs = lr.querySelectorAll('[data-lname]');
    const last = inputs[inputs.length - 1]; last.focus(); last.select();
  };

  // 繰り返し一覧・履歴
  document.getElementById('ruleRows').addEventListener('click', e => {
    if (e.target.dataset.redit) openTaskDialog('rule', e.target.dataset.redit);
  });
  document.getElementById('btnHistoryClear').onclick = () => {
    const n = S.tasks.filter(x => x.done).length;
    if (!n) return;
    if (!confirm(`完了したタスク ${n}件をすべて削除します。\n元に戻せません。よろしいですか？\n（未完了のタスクと繰り返し設定はそのまま残ります）`)) return;
    S.tasks = S.tasks.filter(x => !x.done);
    save(); render(); renderHistoryRows();
  };
  document.getElementById('historyRows').addEventListener('click', e => {
    const d = e.target.dataset;
    if (d.hundo) { undoTask(d.hundo); renderHistoryRows(); }
    if (d.hdel) {
      const x = taskById(d.hdel);
      if (!confirm(`「${x.title}」を完全に削除します。よろしいですか？`)) return;
      S.tasks = S.tasks.filter(z => z.id !== d.hdel); save(); render(); renderHistoryRows();
    }
  });

  // バックアップ
  document.getElementById('btnExport').onclick = exportJSON;
  document.getElementById('fileImport').onchange = e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; };

  // 日付の変化・時刻超過のチェック
  const overdueSig = () => S.tasks.filter(isOverdue).map(x => x.id).join(',');
  let lastSig = overdueSig();
  const tick = () => {
    if (S.lastDate !== todayKey()) { dailyRefresh(); render(); lastSig = overdueSig(); }
    else {
      // 時刻を過ぎて赤表示に変わるタスクがあれば描き直す（入力中・ドラッグ中は待つ）
      const sig = overdueSig();
      if (sig !== lastSig && !dragId && !document.querySelector('dialog[open]') && !board.contains(document.activeElement)) { render(); lastSig = sig; }
      else updateBadge();
    }
  };
  setInterval(tick, 30 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('focus', tick);
  // 別タブ・別ウィンドウで変更されたら反映
  window.addEventListener('storage', e => { if (e.key === STORE_KEY) { load(); render(); } });
}

/* ---------- 起動 ---------- */
load();
dailyRefresh();
bind();
render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

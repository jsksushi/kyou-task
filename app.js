/* きょうのタスク（クラウド同期対応・クラシックRPG風デザイン） */
'use strict';

// ▼ 改修してアップするたびに、ここと version.json と sw.js の CACHE を同じ番号にそろえて上げる
const APP_VERSION = '4.0.2';
const STORE_KEY = 'kyou-task-data-v1';
const TODAY_ID = 'today';
const PALETTE = ['#fbe3d6','#fff4c2','#d7ecfb','#dcf2e0','#fde2ea','#e4f1f0','#efe6d8','#e8eaed','#ece3f7'];
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
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let cloudReady = false;          // クラウドのデータを読み込み終わったか
const genIds = new Set();        // 繰り返しで自動生成したタスクID（同期時に完了状態を上書きしないため）

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
// type: daily | weekdays | weekly | monthly | monthEnd | custom（v3.4〜）
// custom の項目：interval（◯ごと）, unit（day|week|month|year）, days（週の曜日）, monthMode（dom|nth|end）, dom, nth（1〜4、-1＝最終）, nthDay（曜日）,
//               start（開始日）, endMode（never|count|until）, count, until
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const mondayOf = k => addDays(k, -((parseKey(k).getDay() + 6) % 7));
function customBase(r, k) {
  const start = r.start || k;
  if (k < start) return false;
  const d = parseKey(k), s0 = parseKey(start), n = Math.max(1, Number(r.interval) || 1);
  switch (r.unit) {
    case 'day': return diffDays(start, k) % n === 0;
    case 'week': {
      const days = r.days && r.days.length ? r.days : [s0.getDay()];
      return days.includes(d.getDay()) && (diffDays(mondayOf(start), mondayOf(k)) / 7) % n === 0;
    }
    case 'month': {
      const md = (d.getFullYear() - s0.getFullYear()) * 12 + d.getMonth() - s0.getMonth();
      if (md % n !== 0) return false;
      if (r.monthMode === 'end') return d.getDate() === lastDayOfMonth(d);
      if (r.monthMode === 'nth') {
        if (d.getDay() !== Number(r.nthDay)) return false;
        return Number(r.nth) === -1 ? d.getDate() + 7 > lastDayOfMonth(d) : Math.ceil(d.getDate() / 7) === Number(r.nth);
      }
      return d.getDate() === Math.min(Number(r.dom) || s0.getDate(), lastDayOfMonth(d));
    }
    case 'year': {
      const yd = d.getFullYear() - s0.getFullYear();
      return yd % n === 0 && d.getMonth() === s0.getMonth() && d.getDate() === Math.min(s0.getDate(), lastDayOfMonth(d));
    }
  }
  return false;
}
// 「◯回で終わる」の最後の日（計算結果を覚えておく）
const lastDayCache = new Map();
function customLastDay(r) {
  const sig = JSON.stringify([r.interval, r.unit, r.days, r.monthMode, r.dom, r.nth, r.nthDay, r.start, r.count]);
  if (lastDayCache.has(sig)) return lastDayCache.get(sig);
  let k = r.start || todayKey(), c = 0, last = null;
  const want = Math.max(1, Number(r.count) || 1);
  for (let i = 0; i < 40000; i++) { if (customBase(r, k) && ++c >= want) { last = k; break; } k = addDays(k, 1); }
  lastDayCache.set(sig, last || '9999-12-31');
  return lastDayCache.get(sig);
}
function ruleMatches(rule, k) {
  const d = parseKey(k);
  if (rule.start && k < rule.start) return false;   // 開始日より前は出さない
  switch (rule.type) {
    case 'custom':
      if (rule.endMode === 'until' && rule.until && k > rule.until) return false;
      if (rule.endMode === 'count' && k > customLastDay(rule)) return false;
      return customBase(rule, k);
    case 'daily': return true;
    case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly': return (rule.days || []).includes(d.getDay());
    case 'monthly': return d.getDate() === Math.min(rule.dom || 1, lastDayOfMonth(d));
    case 'monthEnd': return d.getDate() === lastDayOfMonth(d);
  }
  return false;
}
// 次に出てくる日（見つからない＝終了した繰り返しは null）
function nextOccurrence(rule, fromKey) {
  let k = fromKey;
  const lim = rule.type === 'custom' ? 3700 : 400;
  for (let i = 0; i < lim; i++) { if (ruleMatches(rule, k)) return k; k = addDays(k, 1); }
  return null;
}
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const mdLabel = k => { const d = parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
// カスタムの内容を短い文にする（一覧やタスクのタグ用）
function customLabel(r) {
  const n = Math.max(1, Number(r.interval) || 1), s0 = parseKey(r.start || todayKey());
  let t = '';
  if (r.unit === 'day') t = n === 1 ? '毎日' : `${n}日ごと`;
  else if (r.unit === 'week') {
    const days = r.days && r.days.length ? r.days : [s0.getDay()];
    t = (n === 1 ? '毎週 ' : `${n}週ごと `) + WD_ORDER.filter(x => days.includes(x)).map(x => WD[x]).join('・');
  } else if (r.unit === 'month') {
    t = (n === 1 ? '毎月 ' : `${n}か月ごと `) + (r.monthMode === 'end' ? '末日'
      : r.monthMode === 'nth' ? (Number(r.nth) === -1 ? '最終' : `第${r.nth}`) + WD[Number(r.nthDay) || 0] + '曜日'
      : `${Number(r.dom) || s0.getDate()}日`);
  } else if (r.unit === 'year') t = (n === 1 ? '毎年 ' : `${n}年ごと `) + `${s0.getMonth() + 1}/${s0.getDate()}`;
  if (r.endMode === 'count') t += `（${r.count}回まで）`;
  else if (r.endMode === 'until' && r.until) t += `（${mdLabel(r.until)}まで）`;
  return t;
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
    case 'custom': return customLabel(r);
  }
  return '';
}

/* ---------- データ ---------- */
function defaultState() {
  return {
    version: DATA_VERSION,
    lists: [
      { id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] },
      { id: uid(), name: '⭐ 今日できたら', color: PALETTE[1] },
      { id: uid(), name: '📅 今週', color: PALETTE[2] },
      { id: uid(), name: '🏖 土日やる', color: PALETTE[3] },
      { id: MEMO_ID, name: '✏️ メモ', color: '#ece3f7', type: 'memo' },
    ],
    tasks: [],
    rules: [],
    memos: [{ id: uid(), listId: MEMO_ID, text: '✏️ ここはメモ欄です（件数には入りません）\nクリックで編集できます。URLはクリックで開けます。\nhttps://www.google.com', createdAt: Date.now() }],
    lastDate: todayKey(),
  };
}
let S;
/*
  データの互換性ルール（改修するときは必ず守る）
  ・保存名 STORE_KEY は変えない（変えると今までのデータが読めなくなる）
  ・データの形を変えるときは DATA_VERSION を1つ上げ、MIGRATIONS に「古い形→新しい形」の変換を足す
  ・項目を消したり名前を変えたりせず、足すだけにするのが基本
  ・変換の前には、元のデータを自動で退避保存する（kyou-task-data-backup-v◯）
*/
const DATA_VERSION = 1;
const MIGRATIONS = {
  // 例）2: d => { d.tasks.forEach(t => t.priority ??= 0); return d; },
};
function migrate(d, raw) {
  const from = d.version || 1;
  if (from >= DATA_VERSION) return d;
  try { localStorage.setItem(`${STORE_KEY.replace('-v1', '')}-backup-v${from}`, raw); } catch (e) {}
  for (let v = from + 1; v <= DATA_VERSION; v++) if (MIGRATIONS[v]) d = MIGRATIONS[v](d);
  d.version = DATA_VERSION;
  return d;
}
function load() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) { S = defaultState(); }
  else {
    try {
      S = migrate(JSON.parse(raw), raw);
      if (!Array.isArray(S.lists) || !Array.isArray(S.tasks)) throw new Error('形式が違います');
    } catch (e) {
      // 読めなかったデータは消さずに退避してから、まっさらで起動する
      try { localStorage.setItem(`kyou-task-data-broken-${Date.now()}`, raw); } catch (_) {}
      alert('保存データを読み込めませんでした。元のデータは退避してあります。\nバックアップのJSONがあれば「💾 バックアップ」から読み込んでください。');
      S = defaultState();
    }
  }
  if (!S.lists.some(l => l.id === TODAY_ID)) S.lists.unshift({ id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] });
  S.tasks ||= []; S.rules ||= []; S.memos ||= [];
  ensureMemoLists(); ensureRepeatList();
}
function save() {
  // 端末内にも控えを残す（すぐ起動するため＆万一の保険）
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { console.warn('local save failed', e); }
  if (window.Cloud) window.Cloud.push(S);
}
const listById = id => S.lists.find(l => l.id === id);
const MEMO_ID = 'memo';                                      // 最初からあるメモ列のID
const isMemoList = l => !!l && l.type === 'memo';
// v3.9.1 繰り返し系：繰り返しの設定（親🔁）は、この専用のリストでだけ作れる。ほかのリストの親もここへまとめる
const REPEAT_ID = 'repeat';
const isRepeatList = l => !!l && l.type === 'repeat';
const repeatList = () => S.lists.find(isRepeatList);
const taskLists = () => S.lists.filter(l => !isMemoList(l) && !isRepeatList(l));   // ふつうのタスクを置けるリスト
const memoLists = () => S.lists.filter(isMemoList);
// 繰り返し系リストの用意（何度呼んでも同じ結果）。名前に「繰り返し」が入ったリストがあればそれを専用にする。なければ作る
function ensureRepeatList() {
  let R = repeatList();
  if (!R) {
    R = S.lists.find(l => !isMemoList(l) && l.id !== TODAY_ID && /繰り返し|くりかえし|繰返/.test(String(l.name)));
    if (R) R.type = 'repeat';
    else { R = { id: REPEAT_ID, name: '🔁 繰り返し系', color: '#fde2ea', type: 'repeat' }; S.lists.push(R); }
  }
  S.rules.forEach(r => { if (r.listId !== R.id) r.listId = R.id; });   // ほかのリストにあった親はお引っ越し
  S.tasks.forEach(x => {
    if (x.listId === R.id) { x.listId = TODAY_ID; delete x.origListId; }   // ふつうのタスクは置けないので「今日」へ
    if (x.origListId === R.id) delete x.origListId;
  });
}
// メモ列の用意：古いデータ（メモ列がリストになっていない）をメモ用リストに移す。何度呼んでも同じ結果
function ensureMemoLists() {
  let changed = false;
  if (!memoLists().length) {
    S.lists.push({ id: MEMO_ID, name: '✏️ メモ', color: '#ece3f7', type: 'memo' });
    changed = true;
  }
  const first = memoLists()[0].id;
  for (const m of S.memos) if (!m.listId || !isMemoList(listById(m.listId))) { m.listId = first; changed = true; }
  return changed;
}
const taskById = id => S.tasks.find(t => t.id === id);
const ruleById = id => S.rules.find(r => r.id === id);

/* ---------- 日次処理 ---------- */
// 繰り返しタスクを「出てくる日」ごとに1件ずつ作る（やり残しも回ごとに残る）
// v3.5：繰り返しは「親」（設定そのもの。元のリストに残る）と「分身」（その日の分。🔥今日に出る）に分けた。
// 分身は clone:true。開始日以降で、対象の曜日・日付になった日に1件ずつ作る（やり残しは回ごとに残る）
function migrateRuleTasks() {
  // v3.4 までの「繰り返しのタスク自体が初回分を兼ねる」形を、親と分身の形にそろえる（何度呼んでも同じ結果）
  const t = todayKey();
  S.tasks = S.tasks.filter(x => {
    if (!x.ruleId || x.clone) return true;
    const r = ruleById(x.ruleId);
    if (!r) { delete x.ruleId; return true; }
    if (x.done || (x.due && x.due <= t)) { x.clone = true; return true; }   // もう出ている回 → 分身としてそのまま残す
    // 先の日付・日付なしの回は、親が代わりに表示するので消す（その日が来たら分身が出る）
    if (x.due && !r.start && ruleMatches(r, x.due)) r.start = x.due;
    if (r.lastGenerated && r.lastGenerated >= t) r.lastGenerated = addDays(t, -1);
    return false;
  });
}
function generateRepeats() {
  migrateRuleTasks();
  const t = todayKey();
  for (const r of S.rules) {
    // 「作成済み」の印が未来の日付のまま残っていたら、今日から判定し直す（古い設定は、印の日がルールに合っていれば開始日に）
    if (r.lastGenerated && r.lastGenerated > t) {
      if (!r.start && ruleMatches(r, r.lastGenerated)) r.start = r.lastGenerated;
      r.lastGenerated = addDays(t, -1);
    }
    let k = r.lastGenerated ? addDays(r.lastGenerated, 1) : t;
    let guard = 0;
    while (k <= t && guard++ < 400) {
      const gid = `${r.id}_${k}`;
      // 同じ日の分がすでにある（別の端末で作った分・完了ずみ含む）なら作らない
      if (ruleMatches(r, k) && !taskById(gid) && !S.tasks.some(x => x.ruleId === r.id && x.due === k)) {
        genIds.add(gid);
        S.tasks.push({
          id: gid, title: r.title, listId: TODAY_ID, origListId: r.listId !== TODAY_ID && !isRepeatList(listById(r.listId)) ? r.listId : undefined, due: k, time: r.time || '',
          memo: r.memo || '', ruleId: r.id, clone: true, done: false, createdAt: Date.now(), order: newOrder(),
        });
      }
      r.lastGenerated = k;
      k = addDays(k, 1);
    }
  }
}
// 親に出す「次は ◯」：今日の分がもう出ていれば明日以降から探す
function nextOfRule(r) {
  const t = todayKey();
  return nextOccurrence(r, r.lastGenerated && r.lastGenerated >= t ? addDays(t, 1) : t);
}
// 期限が今日以前になった未完了タスクを「今日」へ自動移動
function autoMoveToToday() {
  const t = todayKey();
  for (const x of S.tasks) {
    if (x.done || !x.due || x.due > t || x.listId === TODAY_ID || x.pinnedOut) continue;
    x.origListId = x.listId;
    x.listId = TODAY_ID;
    x.order = newOrder();   // 自動で「今日」に来たものは一番下
  }
}
function dailyRefresh() {
  generateRepeats();
  autoMoveToToday();
  ensureOrder();
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
  // v3.4：アプリのタイトルバーは「きょうのタスク（のこり3）ver3.4」。先頭をアプリ名と同じにすると二重表示にならない
  document.title = n > 0 ? `きょうのタスク（のこり${n}）ver${APP_VERSION}` : `きょうのタスク ver${APP_VERSION}`;
  // きょうの しんちょく：今日クリアした分 ／（クリアした分＋のこり）
  const t = todayKey();
  const doneToday = S.tasks.filter(x => x.done && x.doneDate === t && ((x.due && x.due <= t) || x.listId === TODAY_ID)).length;
  const total = doneToday + n;
  document.getElementById('prog').textContent = `${doneToday} / ${total}`;
  const cells = Math.min(total, 10), on = total ? Math.round(doneToday / total * cells) : 0;
  document.getElementById('gauge').innerHTML = Array.from({ length: cells }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
  try {
    if ('setAppBadge' in navigator && !IS_IOS) { // iPhoneではアイコンの数字は出さない
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

/* v3.8 リスト（窓・タブ）の並び順を入れ替える：id を targetId の前（after=true なら後ろ）へ */
function moveList(id, targetId, after) {
  if (!id || id === targetId) return;
  const L = listById(id); if (!L) return;
  const rest = S.lists.filter(l => l.id !== id);
  let i = rest.findIndex(l => l.id === targetId);
  if (i < 0) i = rest.length; else if (after) i++;
  rest.splice(i, 0, L);
  S.lists = rest;
  save(); render();
}
/* v3.6 手で並べた順（task.order：小さいほど上）。期限・時刻は並び順には使わず、裏の仕組み（今日への移動・赤字・件数）だけに使う */
const newOrder = () => Date.now() + Math.random();          // 新しく入ってきたものは一番下
const byOrder = (a, b) => {
  const oa = a.order ?? Infinity, ob = b.order ?? Infinity;
  return oa === ob ? sortTasks(a, b) : oa < ob ? -1 : 1;
};
// 並び順がまだ無いタスクに付ける（v3.5 までのデータは、今までの並び＝期限順のまま始める）
function ensureOrder() {
  let changed = false;
  for (const L of S.lists) {
    const open = S.tasks.filter(x => x.listId === L.id && !x.done);
    const none = open.filter(x => typeof x.order !== 'number').sort(sortTasks);
    if (!none.length) continue;
    const hasAny = open.length > none.length;
    none.forEach((x, i) => { x.order = hasAny ? newOrder() + i : i; });
    changed = true;
  }
  return changed;
}
// リストの中の位置へ動かす（beforeId の直前。null なら一番下）
function placeTask(id, listId, beforeId) {
  const x = taskById(id); if (!x) return;
  if (isRepeatList(listById(listId))) { render(); showMsg('「繰り返し系」には ふつうの タスクは おけない。'); return; }
  if (x.listId !== listId) {
    x.listId = listId;
    delete x.origListId;
    // 期限が今日以前のタスクを手で「今日」以外へ動かしたら、自動で戻さない
    x.pinnedOut = listId !== TODAY_ID && !!x.due && x.due <= todayKey();
  }
  ensureOrder();
  const rest = S.tasks.filter(z => z.listId === listId && !z.done && z.id !== id).sort(byOrder);
  const i = beforeId ? rest.findIndex(z => z.id === beforeId) : -1;
  if (i < 0) x.order = rest.length ? rest[rest.length - 1].order + 1 : 0;
  else if (i === 0) x.order = rest[0].order - 1;
  else x.order = (rest[i - 1].order + rest[i].order) / 2;
  save(); render();
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
    ? `<button class="donebtn" data-undo="${x.id}" title="未完了に戻す">もどす</button>`
    : `<button class="donebtn" data-done="${x.id}" title="完了にする">完了</button>`;
  return `<div class="${cls.join(' ')}" data-id="${x.id}" draggable="${!x.done && !isMobile()}">
    <div class="body">
      <div class="title" data-edit="${x.id}">${esc(x.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
      ${x.memo ? `<div class="tmemo">${linkify(x.memo)}</div>` : ''}
    </div>${btn}</div>`;
}

// v3.5 繰り返しの「親」：元のリストにずっと残る。完了ボタンなし、押すと繰り返しの設定を編集
function parentRow(r) {
  const nx = nextOfRule(r);
  return `<div class="item parent" data-rule="${r.id}">
    <div class="body">
      <div class="title">🔁 ${esc(r.title)}</div>
      <div class="meta"><span class="tag">${ruleLabel(r)}${r.time ? ' ' + r.time + 'まで' : ''}</span><span class="next">${nx ? '次は ' + dueLabel(nx) : '（おわり）'}</span></div>
      ${r.memo ? `<div class="tmemo">${linkify(r.memo)}</div>` : ''}
    </div></div>`;
}
// リストの色（パステル）を、黒いウィンドウの上で読める明るい色にする
function lightColor(hex) {
  try {
    const n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 12) return '#ffffff';
    const k = 0.55; // 彩度を上げる
    const f = v => Math.round(Math.min(255, mx - (mx - v) / k)).toString(16).padStart(2, '0');
    return '#' + f(r) + f(g) + f(b);
  } catch (e) { return '#ffffff'; }
}
// v3.4：ウィンドウの枠の色（リストごと）。未設定なら 繰り返しのあるリスト＝うすピンク、メモ＝水色、それ以外＝白。「今日」は金色のまま
const FRAMES = [
  { c: '', n: '自動' }, { c: '#ffffff', n: 'しろ' }, { c: '#f6b8d0', n: 'うすピンク' }, { c: '#9ad8f5', n: 'みずいろ' },
  { c: '#a8e6b0', n: 'うすみどり' }, { c: '#c9b6f2', n: 'うすむらさき' }, { c: '#f5c48a', n: 'オレンジ' }, { c: '#8888b8', n: 'グレー' },
];
function frameColor(L) {
  if (L.id === TODAY_ID) return '';
  if (L.frame) return L.frame;
  if (isMemoList(L)) return '#9ad8f5';
  if (S.rules.some(r => r.listId === L.id)) return '#f6b8d0';
  return '';
}
const frameStyle = L => { const c = frameColor(L); return c ? `border-color:${esc(c)}` : ''; };
// 名前が絵文字で始まるときは ◆ ✎ を付けない（二重にならないように）
const mark = (name, m) => (/^\p{Extended_Pictographic}/u.test(String(name)) ? '' : m + ' ');
function isMobile() { return window.matchMedia('(max-width: 700px)').matches; }
let mobileTab = (() => { try { return localStorage.getItem('kyou-task-tab') || TODAY_ID; } catch (e) { return TODAY_ID; } })();
const CAL_TAB = '__cal';   // スマホの「📅 よてい」タブ
function renderTabs() {
  const nav = document.getElementById('tabs');
  if (!isMobile()) { nav.hidden = true; return; }
  if (mobileTab === 'memo' && !listById('memo')) mobileTab = memoLists()[0]?.id || TODAY_ID;
  if (mobileTab !== CAL_TAB && !listById(mobileTab)) mobileTab = TODAY_ID;
  nav.hidden = false;
  nav.innerHTML = S.lists.map(L => {
    const n = isMemoList(L) ? S.memos.filter(m => m.listId === L.id).length
      : L.id === TODAY_ID ? S.tasks.filter(x => isCounted(x)).length
      : isRepeatList(L) ? S.rules.filter(r => r.listId === L.id).length : S.tasks.filter(x => x.listId === L.id && !x.done).length;
    const tab = `<button class="tab ${mobileTab === L.id ? 'on' : ''} ${L.id === TODAY_ID ? 'today' : ''}" data-tab="${L.id}" style="--c:${esc(lightColor(L.color))}">${esc(L.name)}<span class="tn">${n}</span></button>`;
    // v3.7：「今日」のとなりに「📅 よてい」のタブ
    return L.id === TODAY_ID ? tab + `<button class="tab caltab ${mobileTab === CAL_TAB ? 'on' : ''}" data-tab="${CAL_TAB}" style="--c:#9ad8f5">📅 よてい</button>` : tab;
  }).join('');
  const on = nav.querySelector('.tab.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function render() {
  const t = todayKey();
  const board = document.getElementById('board');
  const html = [];
  const mobile = isMobile();
  board.classList.toggle('mobile', mobile);
  for (const L of S.lists) {
    if (isMemoList(L)) {
      const memos = S.memos.filter(m => m.listId === L.id);
      html.push(`<section class="col win memo ${mobile && mobileTab === L.id ? 'active' : ''}" data-memolist="${L.id}" style="${frameStyle(L)}">
        <span class="ttl" ${mobile ? '' : `draggable="true" data-wdrag="${L.id}" title="つかんで ドラッグすると 窓の順番を かえられます"`} style="color:${esc(lightColor(L.color))}">${mark(L.name, '✏️')}${esc(L.name)}<span class="n">${memos.length}</span></span>
        ${memos.map(m => `<div class="memocard" data-memo="${m.id}">${linkify(m.text)}</div>`).join('')}
        <textarea class="memoadd" data-memoadd="${L.id}" rows="1" placeholder="${mobile ? '＋ メモを かきこむ' : '＋ メモを かきこむ（Ctrl+Enterで確定）'}"></textarea>
        ${mobile ? `<button class="btn small primary memosave" data-memosave="${L.id}">メモを かきこむ</button>` : ''}
      </section>`);
      continue;
    }
    const open = S.tasks.filter(x => x.listId === L.id && !x.done).sort(byOrder);
    const parents = S.rules.filter(r => r.listId === L.id), repL = isRepeatList(L);
    const doneToday = S.tasks.filter(x => x.listId === L.id && x.done && x.doneDate === t)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    html.push(`<section class="col win ${L.id === TODAY_ID ? 'today' : ''} ${mobile && mobileTab === L.id ? 'active' : ''}" data-list="${L.id}" style="${frameStyle(L)}">
      <span class="ttl" ${mobile ? '' : `draggable="true" data-wdrag="${L.id}" title="つかんで ドラッグすると 窓の順番を かえられます"`} style="color:${esc(lightColor(L.color))}">${mark(L.name, '◆')}${esc(L.name)}<span class="n">${repL ? parents.length : open.length}</span></span>
      ${parents.map(parentRow).join('')}
      ${open.map(taskRow).join('') || (parents.length ? '' : `<div class="empty">${repL ? 'くりかえしは ない。' : 'タスクは ない。'}</div>`)}
      <div class="addrow">
        <input class="add" data-add="${L.id}" enterkeyhint="done" placeholder="${repL ? (mobile ? '＋ くりかえしを ついか' : '＋ くりかえしを ついか（Enter）') : mobile ? '＋ タスクを ついか' : '＋ タスクを ついか（Enter）'}">
        <button class="more" data-addmore="${L.id}" title="日時やメモを付けて追加">詳しく</button>
      </div>
      ${doneToday.length ? `<details ${openDetails.has(L.id) ? 'open' : ''} data-det="${L.id}"><summary>完了ずみ ${doneToday.length}</summary>${doneToday.map(taskRow).join('')}</details>` : ''}
    </section>`);
  }
  // 入力途中の内容とフォーカスを保持
  const active = document.activeElement;
  const keep = active && active.dataset && active.dataset.add ? { id: active.dataset.add, v: active.value } : null;
  // 書きかけのメモも保持
  const memoKeep = [...board.querySelectorAll('[data-memoadd]')].filter(el => el.value).map(el => ({ id: el.dataset.memoadd, v: el.value, focus: active === el }));
  if (mobile && mobileTab === CAL_TAB) html.unshift('<section class="col win calcol active" data-calcol></section>');
  board.innerHTML = html.join('');
  if (keep) {
    const el = board.querySelector(`[data-add="${keep.id}"]`);
    if (el) { el.value = keep.v; el.focus(); }
  }
  for (const k of memoKeep) {
    const el = board.querySelector(`[data-memoadd="${k.id}"]`);
    if (el) { el.value = k.v; if (k.focus) el.focus(); }
  }
  renderTabs();
  updateBadge();
  if (mobile && mobileTab === CAL_TAB) renderCal();
}
const openDetails = new Set();

/* ---------- タスク操作 ---------- */
function completeTask(id) {
  const x = taskById(id); if (!x) return;
  const wasCounted = isCounted(x);
  x.done = true; x.doneAt = Date.now(); x.doneDate = todayKey();
  // たからばこ：たまに（約5%）宝物が手に入る。どのタスクで手に入れたかを覚えておく（もどしたら減らすため）
  const item = Math.random() < TREASURE_RATE ? pickItem() : null;   // 全部そろっていたら出ない
  if (item) x.loot = item.id;
  save(); render();
  const before = levelOf(EXP);
  addExp(1);
  let pageOpened = false;
  if (item) { addItem(item.id, 1); pageOpened = checkPageOpen(); }
  const left = S.tasks.filter(t => isCounted(t)).length;
  let m = `「${x.title}」を 完了した！ けいけんちを 1 かくとく！`;
  const after = levelOf(EXP);
  if (after > before) m += ` レベルが あがった！ Lv ${after} に なった！` + levelUpText(before, after);
  if (item) m += ` …おや？ たからばこを みつけた！`;
  if (wasCounted) m += left ? ` きょうの のこりは ${left}つ。` : ' きょうの タスクを すべて 完了した！';
  showMsg(m);
  if (item) showGet(item, pageOpened ? `どうぐの ${ITEM_PAGE}ページめが ひらいた！` : '');
}
function undoTask(id) {
  const x = taskById(id); if (!x) return;
  x.done = false; delete x.doneAt; delete x.doneDate;
  const lost = x.loot && itemById(x.loot);
  if (x.loot) { addItem(x.loot, -1); delete x.loot; }  // そのタスクで手に入れた宝物も返す
  if (!listById(x.listId)) x.listId = TODAY_ID;
  autoMoveToToday();
  save(); render();
  addExp(-1);
  showMsg(`「${x.title}」が また あらわれた！` + (lost ? ` ${lost.name} を かえした…` : ''));
}

/* ---------- けいけんち・レベル ---------- */
// クリア1回＝けいけんち1。10たまるごとにレベルが1上がる（Lv1からスタート）
const EXP_PER_LEVEL = 10;
let EXP = (() => { try { return Number(localStorage.getItem('kyou-task-exp')) || 0; } catch (e) { return 0; } })();
const levelOf = e => Math.floor(Math.max(0, e) / EXP_PER_LEVEL) + 1;
function renderLevel() { renderProfile(); }

/* ---------- v3.4 勇者のプロフィール ---------- */
// ステータスはレベルから計算するだけ（上がるだけ。ダメージなどはなし）。しょくぎょうで伸び方が変わる
const JOBS = {
  knight: { n: 'ナイト',       hp: [22, 7], mp: [0, 1], str: [10, 3], agi: [6, 2], def: [10, 3] },
  wizard: { n: 'まほうつかい', hp: [14, 4], mp: [12, 5], str: [4, 1], agi: [7, 2], def: [5, 1] },
  priest: { n: 'そうりょ',     hp: [17, 5], mp: [10, 4], str: [6, 2], agi: [6, 2], def: [7, 2] },
  archer: { n: 'かりゅうど',   hp: [18, 5], mp: [4, 2], str: [8, 2], agi: [11, 4], def: [6, 2] },
};
const STAT_KEYS = [['hp', 'さいだいHP'], ['mp', 'さいだいMP'], ['str', 'ちから'], ['agi', 'すばやさ'], ['def', 'まもり']];
function statsOf(job, lv) {
  const J = JOBS[job] || JOBS.knight, o = {};
  STAT_KEYS.forEach(([k], si) => {
    const [base, gr] = J[k]; let v = base;
    // 1レベルごとの上がり幅を少しばらつかせる（レベルで決まるので、何度計算しても同じ値）
    for (let L = 2; L <= lv; L++) v += Math.max(0, gr + ((L * 7 + si * 3) % 3) - 1);
    o[k] = v;
  });
  return o;
}
function levelUpText(from, to) {
  const a = statsOf(PROFILE.job, from), b = statsOf(PROFILE.job, to);
  return STAT_KEYS.filter(([k]) => b[k] > a[k]).map(([k, n]) => ` ${n}が ${b[k] - a[k]} あがった！`).join('');
}
const PROFILE_KEY = 'kyou-task-profile';
let PROFILE = (() => { try { return { name: 'ゆうしゃ', job: 'knight', ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') }; } catch (e) { return { name: 'ゆうしゃ', job: 'knight' }; } })();
function setProfile(p, fromCloud) {
  PROFILE = { name: String(p.name || 'ゆうしゃ').slice(0, 12), job: JOBS[p.job] ? p.job : 'knight' };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE)); } catch (e) {}
  if (!fromCloud && window.Cloud && window.Cloud.saveProfile) window.Cloud.saveProfile(PROFILE);
  renderProfile();
}
let drawnJob = '';
function renderProfile() {
  const lv = levelOf(EXP), st = statsOf(PROFILE.job, lv), e = Math.max(0, EXP) % EXP_PER_LEVEL;
  const $ = id => document.getElementById(id);
  $('pfName').textContent = PROFILE.name;
  $('pfJob').textContent = JOBS[PROFILE.job].n;
  $('lv').textContent = lv;
  $('pfHP').textContent = st.hp; $('pfMP').textContent = st.mp;
  $('pfStr').textContent = st.str; $('pfAgi').textContent = st.agi; $('pfDef').textContent = st.def;
  $('expFill').style.width = e / EXP_PER_LEVEL * 100 + '%';
  $('pfNext').textContent = `あと ${EXP_PER_LEVEL - e}`;
  $('profile').title = `けいけんち ${EXP}（あと ${EXP_PER_LEVEL - e} で レベルアップ）\nクリックで なまえ・しょくぎょうを かえられます`;
  const u = isMobile() ? 2 : 3, sig = PROFILE.job + u;
  if (drawnJob !== sig && window.Art && Art.drawWalk) { Art.drawWalk($('pfHero'), PROFILE.job, u); drawnJob = sig; }
}

/* ---------- v3.5 たからばこ・どうぐ（1種類1個。20個そろうと次のページが開く。集めるだけ） ---------- */
const TREASURE_RATE = 0.05;   // v4.0：0.1 → 0.05（本人：けっこう出ちゃう）
const RARITY = { c: { n: 'ふつう', w: 60 }, r: { n: 'レア', w: 28 }, s: { n: 'すごくレア', w: 10 }, l: { n: 'でんせつ', w: 2 } };
const ITEMS = [
  // ── 1ページ目 ──
  { id: 't01', p: 1, r: 'c', shape: 'rod', name: 'しめきりのロッド', d: 'ふると しめきりが のびる。のびた ぶんだけ どこかで だれかの しめきりが ちぢむ。' },
  { id: 't02', p: 1, r: 'c', shape: 'boomerang', name: 'さいそくブーメラン', d: 'なげても かえってこない。へんじも かえってこない。' },
  { id: 't03', p: 1, r: 'c', shape: 'lamp', name: 'ていじのランプ', d: '17じ59ふんに ともる。18じ00ふんには もう きえている。' },
  { id: 't04', p: 1, r: 'c', shape: 'scroll', name: 'メモのまきもの', d: 'なにか だいじなことが かいてある。なにを かいたかは かいてない。' },
  { id: 't05', p: 1, r: 'c', shape: 'shieldNote', name: 'ふせんのたて', d: 'ふせんが 48まい はってある。うち 47まいは「あとで」。' },
  { id: 't06', p: 1, r: 'c', shape: 'quill', name: 'ぎじろくのペン', d: 'かいぎの ないようを かきとめる。いつも「いぎなし」で おわっている。' },
  { id: 't07', p: 1, r: 'c', shape: 'fishing', name: 'コピペのつりざお', d: 'さっき つった ぶんしょうが また つれる。' },
  { id: 't08', p: 1, r: 'c', shape: 'bag', name: 'タスクのふくろ', d: 'なんでも はいる。いれたものは にどと でてこない。' },
  { id: 't09', p: 1, r: 'r', shape: 'bell', name: 'リマインドのすず', d: 'ちょうど わすれた しゅんかんに なる。おもいだしたときには なりやんでいる。' },
  { id: 't10', p: 1, r: 'r', shape: 'key', name: 'アクセスけんのかぎ', d: 'どの とびらも ひらく。ひらいた さきに また とびらが ある。' },
  { id: 't11', p: 1, r: 'r', shape: 'boot', name: 'ショートカットのくつ', d: 'はくと 3ぽで つく。どこに つくかは えらべない。' },
  { id: 't12', p: 1, r: 'r', shape: 'pick', name: 'かんすうのつるはし', d: 'ほればほるほど #REF! が でてくる。' },
  { id: 't13', p: 1, r: 'r', shape: 'broom', name: 'せいりのほうき', d: 'デスクトップを はくと「新しいフォルダー (7)」が うまれる。' },
  { id: 't14', p: 1, r: 'r', shape: 'compass', name: 'にっていのコンパス', d: 'つねに つぎの かいぎの ほうを さしている。かいぎしつは ない。' },
  { id: 't15', p: 1, r: 's', shape: 'cape', name: 'ステルスマント', d: 'きると かいぎで あてられなくなる。カメラは オンのまま。' },
  { id: 't16', p: 1, r: 's', shape: 'potion', name: 'ふっかつのくすり', d: 'けしたファイルが もどってくる。ファイルめいの さいごが「_コピー」になっている。' },
  { id: 't17', p: 1, r: 's', shape: 'gear', name: 'じどうかのはぐるま', d: 'かってに まわりつづける。とめかたは だれも しらない。' },
  { id: 't18', p: 1, r: 's', shape: 'helmet', name: 'しゅうちゅうのかぶと', d: 'かぶると なにも きこえない。ちいさく ちゃくしんおんだけ きこえる。' },
  { id: 't19', p: 1, r: 'l', shape: 'crown', name: 'ていじのかんむり', d: 'もちぬしは かならず ていじに かえれる。いえに ついたら ゆうがただった。' },
  { id: 't20', p: 1, r: 'l', shape: 'sword', name: 'しょうにんのつるぎ', d: 'ぬくと どんな しんせいも とおる。さやは かちょうが もっている。' },
  // ── 2ページ目（1ページ目をコンプリートすると開く） ──
  { id: 't21', p: 2, r: 'c', shape: 'flute', name: 'あいづちのふえ', d: 'ふくと「なるほどですね」と なる。なにが なるほどかは ふえも しらない。' },
  { id: 't22', p: 2, r: 'c', shape: 'bow', name: 'てんぷのゆみや', d: 'あてさきに ファイルを とどける。てんぷは わすれる。' },
  { id: 't23', p: 2, r: 'c', shape: 'torch', name: 'しりょうのたいまつ', d: 'しりょうの すみまで てらす。みたくない すうじも てらす。' },
  { id: 't24', p: 2, r: 'c', shape: 'bottle', name: 'ほぞんのびん', d: 'さいごに ほぞんした きおくが はいっている。3じかんまえの もの。' },
  { id: 't25', p: 2, r: 'c', shape: 'potion', name: 'カフェインのポーション', d: 'のむと 30ぷん はかどる。そのあと 30ぷん とおくを みる。', x: 'caffeine' },
  { id: 't26', p: 2, r: 'c', shape: 'chain', name: 'まとめのくさり', d: 'ばらばらの しりょうを つなぐ。ほどけなくなった。' },
  { id: 't27', p: 2, r: 'c', shape: 'tent', name: 'やすみのテント', d: 'ひろげると 5ふん やすめる。たたむのに 10ぷん かかる。' },
  { id: 't28', p: 2, r: 'c', shape: 'map', name: 'てがきのちず', d: 'ほうこくしょへの みちが かいてある。とちゅうから にがおえに なっている。' },
  { id: 't29', p: 2, r: 'r', shape: 'glasses', name: 'ほんやくのめがね', d: 'しようしょが よめるようになる。よんでも わからない。' },
  { id: 't30', p: 2, r: 'r', shape: 'horn', name: 'アラームのつのぶえ', d: 'ならすと みんなが あつまる。だれも ようけんを しらない。' },
  { id: 't31', p: 2, r: 'r', shape: 'stone', name: 'ひらめきのいし', d: 'にぎると いいあんが うかぶ。てを はなすと きえる。' },
  { id: 't32', p: 2, r: 'r', shape: 'glove', name: 'ねまわしのてぶくろ', d: 'はめると だれよりも はやく じゅんびが おわる。かいぎは ちゅうしに なった。' },
  { id: 't33', p: 2, r: 'r', shape: 'feather', name: 'いそぎのはね', d: 'つけると しりょうが いっしゅんで できる。ないようも いっしゅんぶん。' },
  { id: 't34', p: 2, r: 'r', shape: 'shieldBack', name: 'バックアップのたて', d: 'どんな しっぱいも いちどだけ ふせぐ。いちどめは もう つかった。' },
  { id: 't35', p: 2, r: 's', shape: 'flag', name: 'フラグのはた', d: 'たてた フラグは かならず かいしゅうされる。だいたい わるいほうの フラグ。' },
  { id: 't36', p: 2, r: 's', shape: 'pot', name: 'みどくゼロのつぼ', d: 'メールを ぜんぶ すいこむ。つぼの なかは みどく 9999。' },
  { id: 't37', p: 2, r: 's', shape: 'magnifier', name: 'デバッグのむしめがね', d: 'かくれた バグが みえる。みえるだけ。' },
  { id: 't38', p: 2, r: 's', shape: 'hourglass', name: 'まきもどしのすなどけい', d: 'ひっくりかえすと ひとつまえに もどる。もどしすぎて げつようびに なった。' },
  { id: 't39', p: 2, r: 'l', shape: 'book', name: 'ぜんちのほん', d: 'あらゆる しようが かいてある。さいごの ページに「※ただし ばあいによる」。' },
  { id: 't40', p: 2, r: 'l', shape: 'wings', name: 'ゆうきゅうのつばさ', d: 'もちぬしは いつでも ゆうきゅうを とれる。つばさは ずっと しまったまま。' },
];
const MAX_PAGE = Math.max(...ITEMS.map(i => i.p));
const ITEMS_KEY = 'kyou-task-items';
let ITEM_COUNTS = {}, ITEM_PAGE = 1;
try { const o = JSON.parse(localStorage.getItem(ITEMS_KEY) || '{}') || {}; ITEM_COUNTS = o.counts || (o.page ? {} : o); ITEM_PAGE = Number(o.page) || 1; } catch (e) {}
const owned = id => (Number(ITEM_COUNTS[id]) || 0) > 0;
const itemById = id => ITEMS.find(i => i.id === id);
// まだ持っていない道具（開いているページの中から）を、レア度の出やすさで1つ選ぶ。全部持っていたら null
function pickItem() {
  const cand = ITEMS.filter(i => i.p <= ITEM_PAGE && !owned(i.id));
  if (!cand.length) return null;
  const rks = Object.keys(RARITY).filter(k => cand.some(i => i.r === k));
  const tot = rks.reduce((a, k) => a + RARITY[k].w, 0);
  let x = Math.random() * tot, rk = rks[0];
  for (const k of rks) { if ((x -= RARITY[k].w) < 0) { rk = k; break; } }
  const pool = cand.filter(i => i.r === rk);
  return pool[Math.floor(Math.random() * pool.length)];
}
function setItems(counts, page) {
  ITEM_COUNTS = { ...(counts || {}) };
  if (page !== undefined) ITEM_PAGE = Math.min(MAX_PAGE, Math.max(Number(page) || 1, ITEM_PAGE));   // 一度開いたページは閉じない
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify({ counts: ITEM_COUNTS, page: ITEM_PAGE })); } catch (e) {}
  if (document.getElementById('dlgItems').open) renderItems();
}
// 手に入れた（d>0）・返した（d<0）。「持っている／いない」をそのまま書く（足し引きだと ずれることがあるため）
function addItem(id, d) {
  const v = d > 0 ? 1 : 0;
  ITEM_COUNTS = { ...ITEM_COUNTS, [id]: v };
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify({ counts: ITEM_COUNTS, page: ITEM_PAGE })); } catch (e) {}
  if (window.Cloud && window.Cloud.setItem) window.Cloud.setItem(id, v);
}
// v3.5.1：道具を0からやり直す（1回だけ）。v3.4 の宝物から交換した道具は、もどしても返らなかったため
// v3.9：本人の希望で、もう1回だけやり直す（sync.js の reset39）
function resetItems() {
  ITEM_COUNTS = {}; ITEM_PAGE = 1;
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify({ counts: {}, page: 1 })); } catch (e) {}
  let changed = false;
  S.tasks.forEach(x => { if (x.loot) { delete x.loot; changed = true; } });
  if (changed) save();
  if (window.Cloud && window.Cloud.resetItems) window.Cloud.resetItems();
  if (document.getElementById('dlgItems').open) renderItems();
}
// 今のページが全部そろったら、次のページを開く（一度開いたら閉じない）。開いたら true
function checkPageOpen() {
  if (ITEM_PAGE >= MAX_PAGE) return false;
  if (!ITEMS.filter(i => i.p === ITEM_PAGE).every(i => owned(i.id))) return false;
  ITEM_PAGE++;
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify({ counts: ITEM_COUNTS, page: ITEM_PAGE })); } catch (e) {}
  if (window.Cloud && window.Cloud.setItemPage) window.Cloud.setItemPage(ITEM_PAGE);
  return true;
}

/* どうぐ画面：マス目に並べて、カーソルで選ぶと横に名前と説明 */
let invPage = 1, invSel = 0, invMode = 'items';   // v4.0 invMode：items（どうぐ）／ zukan（モンスター図鑑）。v4.0.1 図鑑はコマンドの「モンスター図鑑」から（どうぐ画面と同じ窓を使う）
const ITEMS_HINT = 'タスクを完了すると、たまに たからばこが みつかります。1しゅるい 1こずつ。20こ そろうと つぎの ページが ひらきます。「もどす」と、そのとき手に入れた どうぐは かえします。';
function renderItems() {
  const $ = id => document.getElementById(id);
  document.getElementById('dlgItems').classList.toggle('zk', invMode === 'zukan');   // v4.0.2 図鑑はマスの背景を紫に（黒い髪が見えるように）
  if (invMode === 'zukan') return renderZukan();
  $('invTtl').textContent = 'どうぐ';
  $('invHint').textContent = ITEMS_HINT;
  $('invSeen').hidden = true;
  $('invBig').classList.remove('mon');
  $('invRare').hidden = false;
  invPage = Math.min(invPage, ITEM_PAGE);
  const items = ITEMS.filter(i => i.p === invPage);
  const got = ITEMS.filter(i => owned(i.id)).length;
  $('itemsHead').textContent = `あつめた どうぐ ${got} / ${ITEMS.length}`;
  $('invPages').innerHTML = Array.from({ length: MAX_PAGE }, (_, i) => i + 1).map(p => p <= ITEM_PAGE
    ? `<button type="button" class="pg ${p === invPage ? 'on' : ''}" data-page="${p}">${p}</button>`
    : `<span class="pg lock" title="${p - 1}ページめを ぜんぶ あつめると ひらく">？</span>`).join('');
  $('itemRows').innerHTML = items.map((it, i) => `<button type="button" class="cell ${i === invSel ? 'sel' : ''} ${owned(it.id) ? '' : 'empty'}" data-cell="${i}" aria-label="${owned(it.id) ? esc(it.name) : 'まだ ない'}">${owned(it.id) ? `<canvas data-icon="${it.id}"></canvas>` : ''}</button>`).join('');
  $('itemRows').querySelectorAll('[data-icon]').forEach(cv => { const it = itemById(cv.dataset.icon); try { Art.drawIcon(cv, it.shape, 3, it.x); } catch (e) {} });
  const it = items[invSel];
  if (it && owned(it.id)) {
    $('invName').textContent = it.name;
    $('invRare').textContent = 'レア度：' + RARITY[it.r].n;
    $('invRare').className = 'rk r-' + it.r;
    $('invDesc').textContent = it.d;
    try { Art.drawIcon($('invBig'), it.shape, 5, it.x); } catch (e) {}
    $('invBig').hidden = false;
  } else {
    $('invName').textContent = '？？？';
    $('invRare').textContent = it ? 'レア度：' + RARITY[it.r].n : '';
    $('invRare').className = 'rk' + (it ? ' r-' + it.r : '');
    $('invDesc').textContent = 'まだ みつけていない。';
    $('invBig').hidden = true;
  }
}

/* ---------- v4.0 モンスター図鑑・上司バトル ----------
   ・登録したモンスター（なまえ・かたがき・せつめい・こうげき）は Firebase の meta/zukan にだけ保存する。
     実在の人の名前や文章はコードに入れない（GitHub は公開のため）
   ・meta/battle：lastDate（その日もう戦ったか。PCとスマホで二重にダメージを受けないため）、seen（出会った回数）
   ・期限が過ぎて未完了のタスクがある日に、アプリを開くと1日1回だけ戦う。ダメージ＝やり残しの件数 */
const ZUKAN_KEY = 'kyou-task-zukan', BATTLE_KEY = 'kyou-task-battle';
const LOOKS = [1, 2, 3, 4, 5, 6];
let ZUKAN = [], BATTLE = { lastDate: '', seen: {} };
try { ZUKAN = JSON.parse(localStorage.getItem(ZUKAN_KEY) || '[]') || []; } catch (e) {}
try { BATTLE = { lastDate: '', seen: {}, ...(JSON.parse(localStorage.getItem(BATTLE_KEY) || '{}') || {}) }; } catch (e) {}
// やられたときの ひとこと（「／」で書いていない攻撃に使う。だれのことでもない汎用の文）
const HURT_LINES = [
  'ざんぎょうに なった！', 'しごとで ミスを した！', 'ひるごはんを たべそこねた！', 'あたまが まっしろに なった！',
  'メールを ごそうしん した！', 'かいぎに ちこくした！', 'やるきが どこかへ いった！', 'ためいきが とまらなくなった！',
  'タスクが ひとつ ふえた！', 'きゅうけいが なくなった！',
];
const lookOf = m => LOOKS.includes(Number(m && m.look)) ? Number(m.look) : 1;
const seenOf = id => Number((BATTLE.seen || {})[id]) || 0;
function setZukan(list) {
  ZUKAN = Array.isArray(list) ? list.filter(m => m && m.id) : [];
  try { localStorage.setItem(ZUKAN_KEY, JSON.stringify(ZUKAN)); } catch (e) {}
  if (document.getElementById('dlgItems').open && invMode === 'zukan') renderItems();
}
function setBattle(d) {
  BATTLE = { lastDate: String((d && d.lastDate) || ''), seen: { ...((d && d.seen) || {}) } };
  try { localStorage.setItem(BATTLE_KEY, JSON.stringify(BATTLE)); } catch (e) {}
  if (document.getElementById('dlgItems').open && invMode === 'zukan') renderItems();
}
// 「こうげきの文 ／ ひとこと」の行 ⇔ { t, r }
function parseAttacks(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)\s*[／\/]\s*(.*)$/);
    return m && m[1].trim() ? { t: m[1].trim(), r: m[2].trim() } : { t: l, r: '' };
  });
}
const attacksText = list => (list || []).map(a => a.r ? `${a.t} ／ ${a.r}` : a.t).join('\n');

/* 図鑑：登録した順にマスに並べる。出会ったことがない子は「？」 */
function renderZukan() {
  const $ = id => document.getElementById(id);
  $('invTtl').textContent = 'モンスター図鑑';
  $('invPages').innerHTML = '';
  $('invHint').textContent = 'バトルで であった モンスターが きろくされます。モンスターの とうろくは「セーブ・アカウント」から。';
  const n = ZUKAN.length;
  invSel = Math.min(invSel, Math.max(0, n - 1));
  const met = ZUKAN.filter(m => seenOf(m.id) > 0).length;
  $('itemsHead').textContent = `であった モンスター ${met} / ${n}`;
  if (!n) {
    $('itemRows').innerHTML = '<p class="zkempty">まだ モンスターが とうろく されていない。「セーブ・アカウント」の「モンスターを とうろく」から ふやせます。</p>';
  } else {
    const cells = ZUKAN.map((m, i) => {
      const seen = seenOf(m.id) > 0;
      return `<button type="button" class="cell ${i === invSel ? 'sel' : ''} ${seen ? '' : 'empty'}" data-cell="${i}" aria-label="${seen ? esc(m.name) : 'まだ であっていない'}">${seen ? `<canvas class="mon" data-mon="${i}"></canvas>` : '<span class="q">？</span>'}</button>`;
    });
    while (cells.length % 5) cells.push('<span class="cell blank"></span>');
    $('itemRows').innerHTML = cells.join('');
    $('itemRows').querySelectorAll('[data-mon]').forEach(cv => { try { Art.drawChar(cv, 'boss' + lookOf(ZUKAN[cv.dataset.mon]), 2); } catch (e) {} });
  }
  const m = ZUKAN[invSel], seen = m && seenOf(m.id) > 0;
  $('invRare').className = 'rk';
  $('invBig').classList.add('mon');
  if (seen) {
    $('invName').textContent = m.name;
    $('invRare').textContent = m.title || '';
    $('invRare').hidden = !m.title;
    $('invDesc').textContent = m.desc || '';
    $('invSeen').textContent = `であった かいすう：${seenOf(m.id)}`;
    $('invSeen').hidden = false;
    try { Art.drawChar($('invBig'), 'boss' + lookOf(m), 4); } catch (e) {}
    $('invBig').hidden = false;
  } else {
    $('invName').textContent = '？？？';
    $('invRare').textContent = ''; $('invRare').hidden = true;
    $('invDesc').textContent = n ? 'まだ であっていない。' : '';
    $('invSeen').hidden = true;
    $('invBig').hidden = true;
  }
}

/* モンスターの とうろく・なおす（けすは なし） */
let zkLook = 1;
function openZukanEdit(id) {
  const $ = x => document.getElementById(x);
  $('zkPick').innerHTML = '<option value="">＋ あたらしく とうろく</option>' + ZUKAN.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  $('zkPick').value = id || '';
  fillZukanForm(id);
  $('zkMsg').textContent = '';
  if (!$('dlgZukan').open) $('dlgZukan').showModal();
}
function fillZukanForm(id) {
  const $ = x => document.getElementById(x), m = ZUKAN.find(z => z.id === id);
  $('zkName').value = m ? m.name : '';
  $('zkTitle').value = m ? (m.title || '') : '';
  $('zkDesc').value = m ? (m.desc || '') : '';
  $('zkAtk').value = m ? attacksText(m.attacks) : '';
  zkLook = m ? lookOf(m) : 1;
  $('zkSave').textContent = m ? 'なおす' : 'とうろく';
  renderLooks();
}
function renderLooks() {
  const row = document.getElementById('zkLooks');
  if (!row.children.length) {
    row.innerHTML = LOOKS.map(n => `<button type="button" class="job" data-look="${n}"><canvas data-lookcv="${n}"></canvas><span>みため${n}</span></button>`).join('');
    row.querySelectorAll('[data-lookcv]').forEach(cv => { try { Art.drawChar(cv, 'boss' + cv.dataset.lookcv, 2); } catch (e) {} });
  }
  row.querySelectorAll('[data-look]').forEach(b => b.classList.toggle('on', Number(b.dataset.look) === zkLook));
}
function saveZukanForm() {
  const $ = x => document.getElementById(x);
  const id = $('zkPick').value, name = $('zkName').value.trim();
  if (!name) { $('zkMsg').textContent = 'なまえを いれてね'; return; }
  const data = { name: name.slice(0, 12), look: zkLook, title: $('zkTitle').value.trim(), desc: $('zkDesc').value.trim(), attacks: parseAttacks($('zkAtk').value) };
  let list, newId = id;
  if (id && ZUKAN.some(m => m.id === id)) list = ZUKAN.map(m => m.id === id ? { ...m, ...data } : m);
  else { newId = 'm' + uid(); list = [...ZUKAN, { id: newId, ...data }]; }
  setZukan(list);
  if (window.Cloud && window.Cloud.saveZukan) window.Cloud.saveZukan(ZUKAN);
  openZukanEdit(id ? newId : '');   // あたらしく とうろくしたあとは、続けて次を入れられるよう空にもどす
  $('zkMsg').textContent = id ? `${data.name}を なおした！` : `${data.name}を とうろくした！`;
}

/* 上司バトル */
// 期限（due）が今日より前で、まだ完了していないタスクの数。繰り返しの分身のやり残しも含む
const lateCount = () => { const t = todayKey(); return S.tasks.filter(x => !x.done && x.due && x.due < t).length; };
function greetToday() {
  const n = S.tasks.filter(x => isCounted(x)).length;
  showMsg(n ? `きょうの タスクが ${n}つ あらわれた！` : 'きょうの タスクは まだ ない。 へいわだ…', true);
}
// アプリを開いた日に1回：やり残しがあり、図鑑にモンスターがいて、まだ今日戦っていなければバトル。それ以外はいつもの「あらわれた！」
async function startOfDay() {
  const n = lateCount();
  let mon = null;
  if (n > 0 && window.Cloud && window.Cloud.claimBattle) {
    try { mon = await window.Cloud.claimBattle(todayKey()); } catch (e) { console.warn(e); mon = null; }
  }
  if (mon) startBattle(mon, n); else greetToday();
}
let bSteps = [], bIdx = 0, bTyping = null, bFull = '';
function startBattle(mon, n) {
  const atks = (mon.attacks || []).filter(a => a && a.t);
  const atk = atks.length ? atks[Math.floor(Math.random() * atks.length)] : { t: 'こうげきしてきた！', r: '' };
  const hurt = atk.r || HURT_LINES[Math.floor(Math.random() * HURT_LINES.length)];
  if (mon.exp !== null && mon.exp !== undefined) setExp(mon.exp);   // サーバーの最新のけいけんちから減らす
  const before = levelOf(EXP), dmg = Math.min(n, Math.max(0, EXP));
  if (dmg > 0) addExp(-dmg);
  const after = levelOf(EXP);
  bSteps = [
    { t: `${mon.name}が あらわれた！` },
    { t: `${mon.name}の こうげき！\n${atk.t}`, hit: true },
    { t: `${PROFILE.name}は ${hurt}\n${n}の ダメージを うけた！` },
    { t: dmg > 0 ? `けいけんちが ${dmg} へった…` : 'けいけんちは もう へらなかった…' },
  ];
  if (after < before) bSteps.push({ t: `レベルが ${after}に さがってしまった…` });
  bIdx = 0;
  const el = document.getElementById('battle');
  el.hidden = false;
  const cv = document.getElementById('bCv'), u = isMobile() ? 8 : 12;
  try { Art.drawChar(cv, 'boss' + lookOf(mon), u); } catch (e) {}
  showBattleStep();
}
function showBattleStep() {
  const step = bSteps[bIdx], el = document.getElementById('battle'), txt = document.getElementById('bTxt');
  const last = bIdx === bSteps.length - 1;
  document.getElementById('bOk').hidden = true; document.getElementById('bNext').hidden = true;
  el.classList.remove('hit');
  if (step.hit) { void el.offsetWidth; el.classList.add('hit'); }
  clearInterval(bTyping); bFull = step.t; let i = 0; txt.textContent = '';
  bTyping = setInterval(() => {
    txt.textContent = bFull.slice(0, ++i);
    if (i >= bFull.length) { clearInterval(bTyping); bTyping = null; document.getElementById(last ? 'bOk' : 'bNext').hidden = false; if (last) document.getElementById('bOk').focus(); }
  }, 35);
}
function advanceBattle() {
  if (document.getElementById('battle').hidden) return;
  if (bTyping) {   // 文字送り中に押したら、その文を最後まで出す
    clearInterval(bTyping); bTyping = null;
    document.getElementById('bTxt').textContent = bFull;
    document.getElementById(bIdx === bSteps.length - 1 ? 'bOk' : 'bNext').hidden = false;
    return;
  }
  if (bIdx < bSteps.length - 1) { bIdx++; showBattleStep(); return; }
  endBattle();
}
function endBattle() {
  const el = document.getElementById('battle');
  el.hidden = true; el.classList.remove('hit');
  try { localStorage.setItem('kyou-task-greeted', todayKey()); } catch (e) {}
}

/* 宝箱を開けたときの演出（宝箱が開いて、勇者が道具を頭の上に掲げる） */
let getTimer, getRaf;
function showGet(it, extra) {
  const wrap = document.getElementById('getwrap'), cv = document.getElementById('getCv'), txt = document.getElementById('getTxt');
  clearTimeout(getTimer); cancelAnimationFrame(getRaf);
  wrap.hidden = false; txt.textContent = '';
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DUR = 1600, t0 = performance.now();
  const step = now => {
    const t = still ? 1 : Math.min(1, (now - t0) / DUR);
    try { Art.drawGet(cv, PROFILE.job, it.shape, t, it.x); } catch (e) {}
    if (t >= 0.75 && !txt.textContent) txt.innerHTML = `${esc(it.name)} を てにいれた！<small>【レア度：${RARITY[it.r].n}】${esc(it.d)}</small>${extra ? `<b>${esc(extra)}</b>` : ''}`;
    if (t < 1 || now - t0 < DUR + 1200) getRaf = requestAnimationFrame(step);
  };
  getRaf = requestAnimationFrame(step);
  // v3.5.2：自動では消さない（OKを押すまで出しておく）
  const ok = document.getElementById('getOk'); ok.hidden = false; setTimeout(() => ok.focus(), 50);
}
function hideGet() { clearTimeout(getTimer); cancelAnimationFrame(getRaf); document.getElementById('getwrap').hidden = true; }

function setExp(v) { EXP = Math.max(0, Number(v) || 0); try { localStorage.setItem('kyou-task-exp', EXP); } catch (e) {} renderLevel(); }
function addExp(d) { setExp(EXP + d); if (window.Cloud && window.Cloud.addExp) window.Cloud.addExp(d); }

/* ---------- メッセージ（画面の上に出て、しばらくすると引っ込む） ---------- */
let msgTimer, msgHide;
// sticky=true のときは自動で引っ込まず、「OK」を押すまで出しておく
function showMsg(text, sticky = false) {
  const wrap = document.getElementById('msgwrap'), el = document.getElementById('msg');
  clearInterval(msgTimer); clearTimeout(msgHide);
  wrap.classList.add('show'); el.textContent = '';
  document.getElementById('msgOk').hidden = !sticky;
  let i = 0;
  msgTimer = setInterval(() => {
    el.textContent = text.slice(0, ++i);
    if (i >= text.length) { clearInterval(msgTimer); if (!sticky) msgHide = setTimeout(() => wrap.classList.remove('show'), 3500); }
  }, 40);
}

/* ---------- バージョン確認（新しい版が公開されていたら知らせる） ---------- */
async function checkVersion() {
  if (location.protocol === 'file:') return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = String((await r.json()).version || '');
    const btn = document.getElementById('verNew');
    if (v && v !== APP_VERSION) { btn.textContent = `▲ ver ${v} が あります（おして こうしん）`; btn.hidden = false; }
    else btn.hidden = true;
  } catch (e) { /* オフラインなどは何もしない */ }
}
async function updateApp() {
  const btn = document.getElementById('verNew');
  btn.textContent = 'こうしんちゅう…'; btn.disabled = true;
  try {
    // ① アプリのファイルを、ブラウザの一時保存を使わずに取り直す
    const files = ['./', 'index.html', 'style.css', 'art.js', 'app.js', 'sync.js', 'firebase-sdk.js', 'sw.js', 'manifest.webmanifest'];
    await Promise.all(files.map(f => fetch(f, { cache: 'reload' }).catch(() => {})));
    // ② 古いオフライン用の仕組み（Service Worker）と保存済みファイルを外す（データは消えない）
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) { console.warn(e); }
  location.reload();
}
function quickAdd(listId, title) {
  title = title.trim(); if (!title) return;
  if (isRepeatList(listById(listId))) return openTaskDialog('new', null, listId, title);   // v3.9.1 繰り返しは設定画面で作る
  const x = { id: uid(), title, listId, due: '', time: '', memo: '', done: false, createdAt: Date.now(), order: newOrder() };
  S.tasks.push(x);
  save(); render();
}


/* ---------- タスク編集ダイアログ ---------- */
const dlgTask = document.getElementById('dlgTask');
let editing = null; // {mode:'task'|'new'|'rule', id, listId}
let fDueVal = '', fTimeVal = '';

function fillListSelect(sel, value, repeatOnly) {
  const ls = repeatOnly ? [repeatList()] : taskLists();
  sel.innerHTML = ls.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  sel.value = repeatOnly ? ls[0].id : value;
  if (!sel.value && ls.length) sel.value = TODAY_ID;
  sel.disabled = !!repeatOnly;   // 繰り返しの親は「繰り返し系」から動かさない
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
let customDraft = null;   // カスタム繰り返しの設定（ダイアログで編集中のもの）
let repeatPrev = '';
function setRepeatUI(type, days, dom, rule) {
  customDraft = type === 'custom' && rule ? pickCustom(rule) : null;
  syncCustomOption();
  document.getElementById('fRepeat').value = type || '';
  repeatPrev = type || '';
  document.querySelectorAll('#rowWeekdays input').forEach(c => { c.checked = (days || []).includes(Number(c.value)); });
  document.getElementById('fDom').value = dom || new Date().getDate();
  repeatChanged();
}
const CUSTOM_KEYS = ['interval', 'unit', 'days', 'monthMode', 'dom', 'nth', 'nthDay', 'start', 'endMode', 'count', 'until'];
const pickCustom = r => Object.fromEntries(CUSTOM_KEYS.filter(k => r[k] !== undefined).map(k => [k, Array.isArray(r[k]) ? [...r[k]] : r[k]]));
// 繰り返しの選択肢に「カスタム：◯◯」を出す（設定済みのときだけ）
function syncCustomOption() {
  const sel = document.getElementById('fRepeat');
  const opt = sel.querySelector('option[value="custom"]');
  opt.hidden = !customDraft;
  opt.textContent = customDraft ? 'カスタム：' + customLabel(customDraft) : 'カスタム';
}
function repeatChanged() {
  const sel = document.getElementById('fRepeat');
  if (sel.value === '__custom') { openCustomDialog(); return; }
  repeatPrev = sel.value;
  const v = sel.value;
  // 繰り返しを設定しているときは「期限日」→「開始日」
  document.getElementById('lblDue').textContent = v ? '開始日' : '期限日';
  document.getElementById('rowWeekdays').hidden = v !== 'weekly';
  document.getElementById('rowDom').hidden = v !== 'monthly';
  const hint = document.getElementById('repeatHint');
  if (editing && editing.mode === 'rule') hint.textContent = '「なし」にして保存すると、この繰り返し（親）を削除します。今日に出ている分はそのまま残ります。';
  else if (v) hint.textContent = '親（🔁）は「繰り返し系」に残り、設定した日になると その日の分が「🔥 今日」に出てきます。完了しても繰り返しは続きます。やり残した回は赤字で残ります。';
  else hint.textContent = '';
}
function readRepeat() {
  const type = document.getElementById('fRepeat').value;
  if (!type || type === '__custom') return null;
  if (type === 'custom') return { type, ...pickCustom(customDraft || {}) };
  const days = [...document.querySelectorAll('#rowWeekdays input:checked')].map(c => Number(c.value));
  const dom = Math.min(31, Math.max(1, Number(document.getElementById('fDom').value) || 1));
  return { type, days, dom };
}

function openTaskDialog(mode, id, listId, presetTitle) {
  editing = { mode, id, listId };
  const titleEl = document.getElementById('taskDlgTitle');
  document.getElementById('btnTaskDelete').hidden = mode === 'new';
  // v3.9.1 くりかえしの欄は「繰り返し系」で作るとき・親を直すときだけ出す
  const inRepeat = mode === 'rule' || (mode === 'new' && isRepeatList(listById(listId)));
  document.getElementById('rowRepeat').hidden = !inRepeat;
  document.querySelector('#fRepeat option[value=""]').hidden = mode === 'new';   // 新しく作るときは「なし」を選べない
  document.getElementById('cloneNote').hidden = true;
  if (mode === 'task') {
    const x = taskById(id);
    const r = x.ruleId && ruleById(x.ruleId);
    titleEl.textContent = r ? '今回ぶんを編集' : 'タスクを編集';
    document.getElementById('fTitle').value = x.title;
    fillListSelect(document.getElementById('fList'), x.listId);
    setDue(x.due || ''); setTime(x.time || '');
    setRepeatUI('', [], null);
    document.getElementById('rowRepeat').hidden = true;
    if (r) {
      // 分身：繰り返しの設定は親で変える
      document.getElementById('rowRepeat').hidden = true;
      const L = listById(r.listId);
      document.getElementById('cloneNoteText').textContent = `繰り返し「${r.title}」（${ruleLabel(r)}）の今回ぶんです。完了しても繰り返しは続きます。曜日などの設定は${L ? `「${L.name}」にある` : ''}親（🔁）で変えられます。`;
      document.getElementById('btnOpenParent').dataset.rule = r.id;
      document.getElementById('cloneNote').hidden = false;
    }
    document.getElementById('fMemo').value = x.memo || '';
  } else if (mode === 'rule') {
    const r = ruleById(id);
    titleEl.textContent = '繰り返しの設定（親）を編集';
    document.getElementById('fTitle').value = r.title;
    fillListSelect(document.getElementById('fList'), r.listId, true);
    setDue(r.start || ''); setTime(r.time || '');
    setRepeatUI(r.type, r.days, r.dom, r);
    document.getElementById('fMemo').value = r.memo || '';
  } else {
    titleEl.textContent = inRepeat ? 'くりかえしを追加' : 'タスクを追加';
    document.getElementById('fTitle').value = presetTitle || '';
    fillListSelect(document.getElementById('fList'), listId, inRepeat);
    setDue(''); setTime('');
    if (inRepeat) setRepeatUI('weekly', [new Date().getDay()], null);   // 最初は「毎週（今日の曜日）」
    else setRepeatUI('', [], null);
    document.getElementById('fMemo').value = '';
  }
  repeatChanged();
  dlgTask.showModal();
  document.getElementById('fTitle').focus();
}
// 編集中のものが「繰り返しの親（設定）」になりうるか（分身の編集では繰り返しは触らない）
// v3.9.1：繰り返しを触れるのは「繰り返し系」で新しく作るときと、親を直すときだけ
const editingIsParent = () => editing && (editing.mode === 'rule' || (editing.mode === 'new' && isRepeatList(listById(editing.listId))));

function saveTaskDialog() {
  const title = document.getElementById('fTitle').value.trim();
  if (!title) { document.getElementById('fTitle').focus(); return false; }
  const listId = document.getElementById('fList').value;
  const time = fTimeVal;
  const memo = document.getElementById('fMemo').value;
  const rep = editingIsParent() ? readRepeat() : null;
  if (editingIsParent() && editing.mode === 'new' && !rep) { alert('くりかえしの 設定を えらんでください'); return false; }
  if (rep && rep.type === 'weekly' && rep.days.length === 0) { alert('毎週の曜日を1つ以上選んでください'); return false; }
  const t = todayKey();
  const start = fDueVal || (rep && rep.type === 'custom' ? rep.start : '') || '';

  // 親（繰り返しの設定）を編集
  if (editing.mode === 'rule') {
    const r = ruleById(editing.id);
    if (!rep) {
      if (!confirm('この繰り返し設定を削除します。よろしいですか？\n（すでに今日に出ている分は残ります）')) return false;
      S.rules = S.rules.filter(z => z.id !== r.id);
      S.tasks.forEach(x => { if (x.ruleId === r.id) delete x.ruleId; });
    } else {
      updateRule(r, { title, listId, time, memo, ...rep, start: start || undefined });
      if (!start) delete r.start;
      // まだ完了していない今日以降の分身にも反映
      S.tasks.forEach(x => { if (x.ruleId === r.id && !x.done && x.due >= t) { x.title = title; x.time = time; x.memo = memo; } });
    }
    generateRepeats(); autoMoveToToday();
    save(); render(); return true;
  }

  const x0 = editing.mode === 'task' ? taskById(editing.id) : null;
  // 新しく繰り返しを作る（新規、または普通のタスクに繰り返しを付けた）→ 親を作る。分身は対象の日に🔥今日へ出る
  if (rep) {
    const home = repeatList().id;   // v3.9.1 親はいつも「繰り返し系」
    const r = { id: uid(), title, listId: home, time, memo, ...rep, start: start || t, lastGenerated: addDays(t, -1) };
    S.rules.push(r);
    if (x0) S.tasks = S.tasks.filter(z => z.id !== x0.id);   // 元のタスクは親になる
    generateRepeats(); autoMoveToToday();
    save(); render();
    const nx = nextOfRule(r), todayOne = S.tasks.some(z => z.ruleId === r.id && z.due === t);
    showMsg(`くりかえし「${title}」を せっていした！ ` + (todayOne ? 'きょうの ぶんが あらわれた！' : nx ? `つぎは ${dueLabel(nx)} に あらわれる。` : ''));
    return true;
  }

  let x;
  if (editing.mode === 'new') {
    x = { id: uid(), title, listId, due: '', time: '', memo: '', done: false, createdAt: Date.now(), order: newOrder() };
    S.tasks.push(x);
  } else {
    x = x0;
  }
  const prevList = x.listId, prevDue = x.due;
  x.title = title; x.time = time; x.memo = memo; x.due = fDueVal;
  if (listId !== prevList) { x.listId = listId; delete x.origListId; x.order = newOrder(); }
  if (x.due !== prevDue) delete x.pinnedOut;
  if (listId !== prevList) x.pinnedOut = listId !== TODAY_ID && !!x.due && x.due <= t;
  // 「今日」に自動移動されていたタスクの期限を先に延ばしたら、元のリストへ戻す
  if (x.listId === TODAY_ID && x.origListId && x.due && x.due > t && listById(x.origListId) && !isRepeatList(listById(x.origListId))) {
    x.listId = x.origListId; delete x.origListId; x.order = newOrder();
  }
  generateRepeats();
  autoMoveToToday();
  save(); render();
  return true;
}
// 繰り返し設定を書き換える。出てくる日が変わったら、今日の分をもう一度判定し直す
function updateRule(r, next) {
  const sched = o => JSON.stringify([o.type, o.days, o.dom, ...CUSTOM_KEYS.map(k => o[k])]);
  const before = sched(r);
  Object.assign(r, next);
  const t = todayKey();
  if (sched(r) !== before && r.lastGenerated && r.lastGenerated >= t) r.lastGenerated = addDays(t, -1);
}

/* ---------- v3.4 カスタムの繰り返し（Google Keep のリマインダー風） ---------- */
const dlgCustom = document.getElementById('dlgCustom');
function defaultCustom() {
  const st = fDueVal || todayKey(), d = parseKey(st);
  return { interval: 1, unit: 'week', days: [d.getDay()], monthMode: 'dom', dom: d.getDate(), nth: Math.min(4, Math.ceil(d.getDate() / 7)), nthDay: d.getDay(), start: st, endMode: 'never', count: 10, until: addDays(st, 30) };
}
function openCustomDialog() {
  const c = { ...defaultCustom(), ...(customDraft || {}) };
  const $ = id => document.getElementById(id);
  $('cInterval').value = c.interval; $('cUnit').value = c.unit;
  document.querySelectorAll('#cDays input').forEach(i => { i.checked = (c.days || []).includes(Number(i.value)); });
  document.querySelectorAll('[name=cMonth]').forEach(i => { i.checked = i.value === c.monthMode; });
  $('cDom').value = c.dom; $('cNth').value = c.nth; $('cNthDay').value = c.nthDay;
  $('cStart').value = c.start;
  document.querySelectorAll('[name=cEnd]').forEach(i => { i.checked = i.value === c.endMode; });
  $('cCount').value = c.count; $('cUntil').value = c.until;
  customUI();
  dlgCustom.showModal();
}
function readCustom() {
  const $ = id => document.getElementById(id);
  const start = $('cStart').value || todayKey();
  const c = {
    interval: Math.min(99, Math.max(1, Number($('cInterval').value) || 1)), unit: $('cUnit').value,
    days: [...document.querySelectorAll('#cDays input:checked')].map(i => Number(i.value)),
    monthMode: (document.querySelector('[name=cMonth]:checked') || {}).value || 'dom',
    dom: Math.min(31, Math.max(1, Number($('cDom').value) || 1)), nth: Number($('cNth').value), nthDay: Number($('cNthDay').value),
    start, endMode: (document.querySelector('[name=cEnd]:checked') || {}).value || 'never',
    count: Math.min(999, Math.max(1, Number($('cCount').value) || 1)), until: $('cUntil').value || start,
  };
  if (c.unit === 'week' && !c.days.length) c.days = [parseKey(start).getDay()];
  return c;
}
function customUI() {
  const c = readCustom();
  document.getElementById('cRowWeek').hidden = c.unit !== 'week';
  document.getElementById('cRowMonth').hidden = c.unit !== 'month';
  const nx = nextOccurrence({ type: 'custom', ...c }, c.start);
  const end = c.endMode === 'count' ? `${c.count}回で 終わります` : c.endMode === 'until' ? `${dueLabel(c.until)} まで` : 'ずっと 続きます';
  document.getElementById('cSummary').textContent = `${customLabel({ ...c, endMode: 'never' })} に くりかえします。${dueLabel(c.start)} から、${end}。`
    + (nx ? `（1回目：${dueLabel(nx)}）` : '（この設定だと 1回も 出てきません）');
}

/* ---------- メモ ---------- */
const dlgMemo = document.getElementById('dlgMemo');
let editingMemo = null;
function addMemo(listId, text) {
  if (!text.trim()) return;
  S.memos.push({ id: uid(), listId, text: text.replace(/\s+$/, ''), createdAt: Date.now() });
  save(); render();
}

/* ---------- リスト管理 ---------- */
const dlgLists = document.getElementById('dlgLists');
let deletingList = null;
function renderListRows() {
  const box = document.getElementById('listRows');
  box.innerHTML = S.lists.map((l, i) => {
    const memo = isMemoList(l);
    const cnt = memo ? S.memos.filter(m => m.listId === l.id).length
      : S.tasks.filter(x => x.listId === l.id || x.origListId === l.id).length + S.rules.filter(r => r.listId === l.id).length;
    const others = (memo ? memoLists() : taskLists()).filter(o => o.id !== l.id);
    return `<div class="lrow" data-lid="${l.id}">
      <span class="ltype ${memo ? 'm' : isRepeatList(l) ? 'r' : ''}">${memo ? 'メモ' : isRepeatList(l) ? 'くりかえし' : 'タスク'}</span>
      <input type="text" value="${esc(l.name)}" data-lname="${l.id}">
      <div class="swatches">${PALETTE.map(c => `<button class="sw ${c === l.color ? 'on' : ''}" style="background:${c}" data-lcolor="${l.id}" data-c="${c}" title="${c}"></button>`).join('')}</div>
      ${l.id === TODAY_ID ? '<span class="frames hint">わくの色：金色（固定）</span>' : `<div class="frames"><span class="hint">わくの色</span>${FRAMES.map(f => `<button class="fr ${(l.frame || '') === f.c ? 'on' : ''} ${f.c ? '' : 'auto'}" style="${f.c ? 'border-color:' + f.c : ''}" data-lframe="${l.id}" data-f="${f.c}" title="${f.n}${f.c ? '' : '（繰り返しのあるリスト＝うすピンク、メモ＝みずいろ）'}">${f.c ? '' : '自'}</button>`).join('')}</div>`}
      <button class="btn small" data-lup="${l.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn small" data-ldown="${l.id}" ${i === S.lists.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small danger" data-ldel="${l.id}" ${l.id === TODAY_ID ? 'disabled title="「今日」は削除できません"' : isRepeatList(l) ? 'disabled title="「繰り返し系」は削除できません（繰り返しの設定はここにまとまっています）"' : ''}>削除</button>
      ${deletingList === l.id ? `<div class="delbox">
        ${!cnt ? (memo ? '中にメモはありません。' : '中にタスクはありません。')
          : memo && !others.length ? `中のメモ（${cnt}件）も一緒に削除されます。`
          : `中の${memo ? 'メモ' : 'タスク・繰り返し設定'}（${cnt}件）の移動先：<select data-lmoveto>${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>`}
        <button class="btn small danger" data-ldelok="${l.id}">削除する</button>
        <button class="btn small" data-ldelcancel>やめる</button>
      </div>` : ''}
    </div>`;
  }).join('');
}
function deleteList(id, moveTo) {
  if (isMemoList(listById(id))) {
    S.memos = moveTo ? S.memos.map(m => m.listId === id ? { ...m, listId: moveTo } : m) : S.memos.filter(m => m.listId !== id);
    S.lists = S.lists.filter(l => l.id !== id);
    deletingList = null;
    save(); render(); renderListRows();
    return;
  }
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
    const next = nextOfRule(r);
    return `<div class="hrow">
      <span class="dot" style="background:${L ? esc(L.color) : '#ccc'}"></span>
      <div class="t">${esc(r.title)}<div class="s">🔁 ${ruleLabel(r)}${r.time ? ' ' + r.time + 'まで' : ''}／${L ? esc(L.name) : ''}／${next ? '次回 ' + dueLabel(next) : '（終了）'}</div></div>
      <button class="btn small" data-redit="${r.id}">編集</button>
    </div>`;
  }).join('');
}
const histSel = new Set();
function updateHistSel(total) {
  const n = histSel.size;
  const btn = document.getElementById('btnHistoryDelSel');
  btn.disabled = !n;
  btn.textContent = n ? `選択した${n}件を削除` : '選択したタスクを削除';
  const all = document.getElementById('hSelAll');
  all.checked = total > 0 && n === total;
  all.indeterminate = n > 0 && n < total;
}
function renderHistoryRows() {
  const box = document.getElementById('historyRows');
  const done = S.tasks.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  document.getElementById('btnHistoryClear').disabled = !done.length;
  // 完了タスクがないときは、説明文・選択・削除ボタンを隠す
  for (const id of ['rowSelAll', 'historyHint', 'btnHistoryDelSel', 'btnHistoryClear']) document.getElementById(id).hidden = !done.length;
  // 消えたタスクは選択から外す
  for (const id of [...histSel]) if (!done.some(x => x.id === id)) histSel.delete(id);
  updateHistSel(done.length);
  if (!done.length) { box.innerHTML = '<p class="empty">完了したタスクはまだありません。</p>'; return; }
  let lastDay = '';
  box.innerHTML = done.map(x => {
    const L = listById(x.listId);
    const head = x.doneDate !== lastDay ? `<div class="s" style="margin-top:10px;font-weight:600">${x.doneDate ? dueLabel(x.doneDate) : '日付不明'}</div>` : '';
    lastDay = x.doneDate;
    return `${head}<div class="hrow ${histSel.has(x.id) ? 'sel' : ''}">
      <input type="checkbox" class="hchk" data-hsel="${x.id}" ${histSel.has(x.id) ? 'checked' : ''} title="選択">
      <span class="dot" style="background:${L ? esc(L.color) : '#ccc'}"></span>
      <div class="t">${esc(x.title)}<div class="s">${L ? esc(L.name) : ''}${x.due ? '／期限 ' + dueLabel(x.due) : ''}</div></div>
      <button class="btn small" data-hundo="${x.id}">戻す</button>
      <button class="btn small danger" data-hdel="${x.id}">削除</button>
    </div>`;
  }).join('');
}

/* ---------- バックアップ ---------- */
/* ---------- v3.9 バックアップ（PC：選んだフォルダへ直接保存。1日1回の自動バックアップ・読み込み前の自動バックアップ） ----------
   ・Chrome／Edge の「選んだフォルダに書き込む機能」（File System Access API）を使う。フォルダは最初の1回だけ選ぶ
   ・選んだフォルダの情報は端末内（IndexedDB）に覚えておく。ブラウザの決まりで、開き直したあとは許可を聞かれることがある
   ・使えないとき（iPhone、許可がないとき）は、今までどおりダウンロードとして保存する
*/
const BK_AUTO_KEEP = 7;                              // 自動バックアップは新しいほうから7つだけ残す
const BK_AUTO_PREFIX = 'kyou-task-auto_';            // 自動で作ったファイルの名前（これだけ自動で消す）
const BK_LAST_KEY = 'kyou-task-autobackup-date';
const canPickDir = () => 'showDirectoryPicker' in window && !isMobile();
let bkDir = null;                                    // 選んだフォルダ
function bkDb() {
  return new Promise((ok, ng) => { const r = indexedDB.open('kyou-task-backup', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
}
async function bkLoadDir() {
  try { const db = await bkDb(); bkDir = await new Promise(ok => { const q = db.transaction('h').objectStore('h').get('dir'); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch (e) { bkDir = null; }
  renderBackupInfo();
}
async function bkSaveDir(h) {
  bkDir = h;
  try { const db = await bkDb(); db.transaction('h', 'readwrite').objectStore('h').put(h, 'dir'); } catch (e) {}
  renderBackupInfo();
}
// フォルダへの書き込み許可があるか（ask=true のときは、ボタンを押した直後なので許可を聞ける）
async function bkPermitted(ask) {
  if (!bkDir) return false;
  try {
    let p = await bkDir.queryPermission({ mode: 'readwrite' });
    if (p === 'prompt' && ask) p = await bkDir.requestPermission({ mode: 'readwrite' });
    return p === 'granted';
  } catch (e) { return false; }
}
async function bkPickDir() {
  try { const h = await window.showDirectoryPicker({ id: 'kyou-task-backup', mode: 'readwrite', startIn: 'documents' }); await bkSaveDir(h); return true; }
  catch (e) { return false; }   // キャンセル
}
const stamp = () => { const d = new Date(); return `${keyOf(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}`; };
function downloadJSON(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function writeToDir(name, text) {
  const fh = await bkDir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(new Blob([text], { type: 'application/json' })); await w.close();
}
// 保存の本体。フォルダに書けなければダウンロードにする（auto のときは何もしない）。保存できたら保存先を返す
async function saveBackup(name, { ask = false, auto = false } = {}) {
  const text = JSON.stringify(S, null, 2);
  if (canPickDir()) {
    if (!bkDir && ask) await bkPickDir();
    if (bkDir && await bkPermitted(ask)) {
      try { await writeToDir(name, text); return 'dir'; } catch (e) { console.warn(e); }
    }
  }
  if (auto) return '';
  downloadJSON(name, text); return 'download';
}
// 「JSONで書き出す」（好きなタイミングで。自動では消さない）
async function exportJSON(label) {
  const name = `kyou-task-backup${typeof label === 'string' ? '_' + label : ''}_${stamp()}.json`;
  const where = await saveBackup(name, { ask: typeof label !== 'string' });
  // v3.9 結果は「セーブ・アカウント」の窓の中に出す（上のメッセージだと窓の後ろに隠れてしまうため）。窓を閉じるまで消さない
  if (typeof label !== 'string') {
    const el = document.getElementById('bkDone');
    el.innerHTML = `✔ ${where === 'dir' ? `「${esc(bkDir.name)}」フォルダに` : 'ダウンロードに'} セーブした！<br><span>${esc(name)}</span>`;
    el.hidden = false; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }
  renderBackupInfo();
}
// 1日1回の自動バックアップ（PCでアプリを開いたとき）。許可がいるときは、ステータスの窓にボタンを出す
let bkPending = false;
async function autoBackup(fromButton) {
  if (!canPickDir() || !bkDir || !cloudReady) { bkPending = false; renderBackupInfo(); return; }
  let last = ''; try { last = localStorage.getItem(BK_LAST_KEY) || ''; } catch (e) {}
  if (last === todayKey()) { bkPending = false; renderBackupInfo(); return; }
  if (!(await bkPermitted(!!fromButton))) { bkPending = true; renderBackupInfo(); return; }
  try {
    await writeToDir(`${BK_AUTO_PREFIX}${keyOf(new Date()).replace(/-/g, '')}.json`, JSON.stringify(S, null, 2));
    try { localStorage.setItem(BK_LAST_KEY, todayKey()); } catch (e) {}
    // 古い自動バックアップを消す（自分で書き出した分・読み込み前の分は消さない）
    const autos = [];
    for await (const [n, h] of bkDir.entries()) if (h.kind === 'file' && n.startsWith(BK_AUTO_PREFIX) && n.endsWith('.json')) autos.push(n);
    autos.sort().reverse().slice(BK_AUTO_KEEP).forEach(n => bkDir.removeEntry(n).catch(() => {}));
    bkPending = false;
    if (fromButton) showMsg('きょうの じどうバックアップを とった！');
  } catch (e) { console.warn(e); bkPending = true; }
  renderBackupInfo();
}
function renderBackupInfo() {
  const el = document.getElementById('bkInfo');
  if (el) {
    if (!canPickDir()) el.innerHTML = 'この ブラウザでは、書き出したファイルは ダウンロードに 保存されます。';
    else el.innerHTML = bkDir
      ? `保存先：「${esc(bkDir.name)}」フォルダ <button type="button" class="linkbtn" data-bkpick>かえる</button>`
      : `保存先：まだ えらんでいません <button type="button" class="linkbtn" data-bkpick>フォルダを えらぶ</button>`;
  }
  const st = document.getElementById('bkPending');
  if (st) st.hidden = !bkPending;
}
// v3.9.2「JSONを読み込む」：バックアップ先フォルダを選んであれば、そのフォルダを最初に開いた状態でファイルを選ぶ
//   ・フォルダ未設定／showOpenFilePicker が使えない（iPhone など）ときは、今までどおりの選択画面（input type=file）
//   ・id は渡さない（念のため。id を渡すとブラウザが覚えた前回の場所が使われる可能性があるので）
const canOpenInDir = () => canPickDir() && 'showOpenFilePicker' in window && !!bkDir;
async function pickImportFile() {
  try {
    const [h] = await window.showOpenFilePicker({
      startIn: bkDir, multiple: false, excludeAcceptAllOption: false,
      types: [{ description: 'きょうのタスクのバックアップ（JSON）', accept: { 'application/json': ['.json'] } }],
    });
    if (h) importJSON(await h.getFile());
  } catch (e) {
    if (e && e.name === 'AbortError') return;                 // キャンセル
    console.warn(e);
    document.getElementById('fileImport').click();             // フォルダが消えた等で開けないときは、今までどおりの選択画面
  }
}
function importJSON(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const data = JSON.parse(fr.result);
      if (!Array.isArray(data.lists) || !Array.isArray(data.tasks)) throw new Error('きょうのタスクのバックアップ形式ではありません');
      if (!confirm(`読み込みます。今のデータは置き換わります（クラウドのデータも置き換わります）。\nリスト ${data.lists.length}件／タスク ${data.tasks.length}件／メモ ${(data.memos || []).length}件\n\n置き換える前に、今のデータを「読み込み前」として自動でバックアップします。`)) return;
      await saveBackup(`kyou-task-backup_読み込み前_${stamp()}.json`, { ask: true });   // まちがえたら、このファイルを読み込めば戻せる
      S = migrate(data, fr.result); S.rules ||= []; S.memos ||= []; ensureMemoLists(); ensureRepeatList();
      if (!S.lists.some(l => l.id === TODAY_ID)) S.lists.unshift({ id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] });
      dailyRefresh(); render();
      document.getElementById('dlgBackup').close();
      alert('読み込みました。\n（読み込む前のデータは「読み込み前」のファイルとしてバックアップしてあります）');
    } catch (e) { alert('読み込めませんでした：' + e.message); }
  };
  fr.readAsText(file);
}

/* ---------- イベント ---------- */
let suppressClick = 0;
function bind() {
  const board = document.getElementById('board');

  board.addEventListener('click', e => {
    if (Date.now() - suppressClick < 600) return;   // 長押しで並べ替えた直後のタップは無視
    const el = e.target;
    if (el.closest('a')) return; // リンクはそのまま開く
    if (el.dataset.memosave) {
      const m = board.querySelector(`[data-memoadd="${el.dataset.memosave}"]`);
      if (m && m.value.trim()) { const v = m.value; m.value = ''; addMemo(el.dataset.memosave, v); }
      return;
    }
    if (el.dataset.done) return completeTask(el.dataset.done);
    if (el.dataset.undo) return undoTask(el.dataset.undo);
    if (el.dataset.edit) return openTaskDialog('task', el.dataset.edit);
    const pr = el.closest('[data-rule]'); if (pr) return openTaskDialog('rule', pr.dataset.rule);
    if (el.dataset.addmore) {
      const inp = board.querySelector(`[data-add="${el.dataset.addmore}"]`);
      const v = inp ? inp.value : '';
      if (inp) inp.value = '';
      return openTaskDialog('new', null, el.dataset.addmore, v);
    }
    const mc = el.closest('[data-memo]');
    if (mc) {
      editingMemo = mc.dataset.memo;
      const m = S.memos.find(z => z.id === editingMemo);
      document.getElementById('mText').value = m.text;
      const sel = document.getElementById('mList');
      sel.innerHTML = memoLists().map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
      sel.value = m.listId;
      document.getElementById('rowMemoList').hidden = memoLists().length < 2;
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
    if (el.dataset.memoadd && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); const id = el.dataset.memoadd, v = el.value; el.value = ''; addMemo(id, v);
      const again = board.querySelector(`[data-memoadd="${id}"]`); if (again) again.focus();
    }
  });
  board.addEventListener('input', e => {
    if (e.target.dataset.memoadd) { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
  });
  board.addEventListener('focusout', e => {
    // メモ欄はフォーカスが外れたら確定
    if (e.target.dataset.memoadd && e.target.value.trim()) {
      const v = e.target.value; e.target.value = ''; addMemo(e.target.dataset.memoadd, v);
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
  const clearDrop = () => board.querySelectorAll('.dropline').forEach(n => n.classList.remove('dropline', 'below'));
  board.addEventListener('dragend', () => {
    dragId = null;
    board.querySelectorAll('.dragging,.dragover').forEach(n => n.classList.remove('dragging', 'dragover'));
    clearDrop();
  });
  // v3.6：落とす位置（どのタスクの前か）を、マウスの高さから決める。線で位置を見せる
  const dropTarget = (col, y) => {
    const items = [...col.querySelectorAll(':scope > .item[data-id]')].filter(n => n.dataset.id !== dragId);
    for (const n of items) { const r = n.getBoundingClientRect(); if (y < r.top + r.height / 2) return { before: n.dataset.id, el: n, below: false }; }
    const last = items[items.length - 1];
    return { before: null, el: last, below: true };
  };
  board.addEventListener('dragover', e => {
    const col = e.target.closest('[data-list]');
    if (!col || !dragId) return;
    e.preventDefault();
    board.querySelectorAll('.dragover').forEach(n => n !== col && n.classList.remove('dragover'));
    col.classList.add('dragover');
    clearDrop();
    const d = dropTarget(col, e.clientY);
    if (d.el) { d.el.classList.add('dropline'); if (d.below) d.el.classList.add('below'); }
  });
  board.addEventListener('drop', e => {
    const col = e.target.closest('[data-list]');
    if (!col || !dragId) return;
    e.preventDefault();
    const d = dropTarget(col, e.clientY);
    clearDrop();
    placeTask(dragId, col.dataset.list, d.before);
  });

  // v3.8 PC：窓のタイトルをつかんでドラッグ → 落とした窓の前（右半分なら後ろ）に入れる
  let winDrag = null;
  const clearWin = () => board.querySelectorAll('.wdrop-before,.wdrop-after,.wdragging').forEach(n => n.classList.remove('wdrop-before', 'wdrop-after', 'wdragging'));
  const winTarget = e => {
    const col = e.target.closest && e.target.closest('.col[data-list],.col[data-memolist]');
    if (!col) return null;
    const id = col.dataset.list || col.dataset.memolist, r = col.getBoundingClientRect();
    return { col, id, after: e.clientX > r.left + r.width / 2 };
  };
  board.addEventListener('dragstart', e => {
    const t = e.target.closest && e.target.closest('[data-wdrag]');
    if (!t) return;
    winDrag = t.dataset.wdrag;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'list:' + winDrag);
    t.closest('.col').classList.add('wdragging');
  });
  board.addEventListener('dragover', e => {
    if (!winDrag) return;
    const d = winTarget(e); if (!d) return;
    e.preventDefault();
    board.querySelectorAll('.wdrop-before,.wdrop-after').forEach(n => n.classList.remove('wdrop-before', 'wdrop-after'));
    if (d.id !== winDrag) d.col.classList.add(d.after ? 'wdrop-after' : 'wdrop-before');
  });
  board.addEventListener('drop', e => {
    if (!winDrag) return;
    const d = winTarget(e); e.preventDefault();
    const id = winDrag; winDrag = null; clearWin();
    if (d) moveList(id, d.id, d.after);
  });
  board.addEventListener('dragend', () => { winDrag = null; clearWin(); });

  // v3.6 スマホ：長押しでつかんで上下に動かす（ふつうに触るとスクロール）
  let lp = null;   // { id, el, col, timer, y0, x0, lifted }
  const lpCancel = () => { if (lp) { clearTimeout(lp.timer); if (lp.el) { lp.el.classList.remove('lifting'); lp.el.style.transform = ''; } } clearDrop(); lp = null; };
  board.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const it = e.target.closest('.item[data-id]');
    if (!it || it.classList.contains('done') || e.target.closest('button,a,input,textarea')) return;
    const col = it.closest('[data-list]'); if (!col) return;
    const t = e.touches[0];
    lp = { id: it.dataset.id, el: it, col, x0: t.clientX, y0: t.clientY, lifted: false };
    lp.timer = setTimeout(() => {
      if (!lp) return;
      lp.lifted = true; it.classList.add('lifting');
      try { navigator.vibrate && navigator.vibrate(12); } catch (_) {}
    }, 450);
  }, { passive: true });
  board.addEventListener('touchmove', e => {
    if (!lp) return;
    const t = e.touches[0];
    if (!lp.lifted) {
      if (Math.abs(t.clientY - lp.y0) > 8 || Math.abs(t.clientX - lp.x0) > 8) lpCancel();   // 長押しの前に動いた＝スクロール
      return;
    }
    e.preventDefault();   // つかんでいる間は画面を動かさない
    lp.el.style.transform = `translateY(${t.clientY - lp.y0}px)`;
    dragId = lp.id;
    clearDrop();
    const d = dropTarget(lp.col, t.clientY);
    if (d.el) { d.el.classList.add('dropline'); if (d.below) d.el.classList.add('below'); }
    lp.target = d.before; lp.moved = true;
  }, { passive: false });
  const lpEnd = e => {
    if (!lp) return;
    const done = lp.lifted && lp.moved, id = lp.id, list = lp.col.dataset.list, before = lp.target;
    if (lp.lifted) { e.preventDefault(); suppressClick = Date.now(); }
    lpCancel(); dragId = null;
    if (done) placeTask(id, list, before);
  };
  board.addEventListener('touchend', lpEnd, { passive: false });
  board.addEventListener('touchcancel', () => { lpCancel(); dragId = null; });

  // タスクダイアログ
  // 新しく作るカスタム繰り返しは「開始日」欄とカスタムの開始日をそろえる
  const dueToStart = () => {
    if (customDraft && editingIsParent()) { customDraft.start = fDueVal || todayKey(); syncCustomOption(); }
  };
  document.querySelectorAll('[data-due]').forEach(b => b.onclick = () => {
    const t = todayKey();
    setDue(b.dataset.due === 'none' ? '' : b.dataset.due === 'today' ? t : addDays(t, 1));
    dueToStart();
  });
  document.getElementById('fDue').onchange = e => { setDue(e.target.value); dueToStart(); };
  // カスタム繰り返しダイアログ
  dlgCustom.addEventListener('input', customUI);
  dlgCustom.addEventListener('change', customUI);
  document.getElementById('btnCustomOk').onclick = () => {
    customDraft = readCustom();
    if (customDraft.endMode === 'until' && customDraft.until < customDraft.start) { alert('終了日は開始日より後にしてください'); return; }
    if (editingIsParent()) setDue(customDraft.start);
    syncCustomOption();
    document.getElementById('fRepeat').value = 'custom';
    dlgCustom.close('ok');
    repeatChanged();
  };
  document.getElementById('btnCustomCancel').onclick = () => dlgCustom.close();
  dlgCustom.addEventListener('close', () => {
    const sel = document.getElementById('fRepeat');
    if (sel.value === '__custom') { sel.value = repeatPrev; repeatChanged(); }
  });
  document.querySelectorAll('[data-time]').forEach(b => b.onclick = () => setTime(b.dataset.time));
  document.getElementById('fTime').onchange = e => setTime(e.target.value);
  document.getElementById('fRepeat').onchange = repeatChanged;
  document.getElementById('taskForm').onsubmit = e => { e.preventDefault(); if (saveTaskDialog()) dlgTask.close(); };
  document.getElementById('btnTaskCancel').onclick = () => dlgTask.close();
  document.getElementById('btnOpenParent').onclick = e => { const id = e.target.dataset.rule; dlgTask.close(); if (ruleById(id)) openTaskDialog('rule', id); };
  document.getElementById('btnTaskDelete').onclick = () => {
    if (editing.mode === 'rule') {
      if (!confirm('この繰り返し設定（親）を削除します。よろしいですか？\n（すでに今日に出ている分は残ります）')) return;
      S.rules = S.rules.filter(r => r.id !== editing.id);
      S.tasks.forEach(x => { if (x.ruleId === editing.id) delete x.ruleId; });
      save(); render(); renderRuleRows(); dlgTask.close(); return;
    }
    const x = taskById(editing.id);
    if (!confirm(`「${x.title}」を削除します。よろしいですか？${x.ruleId ? '\n（今回ぶんだけ削除。繰り返しの親は残ります）' : ''}`)) return;
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
    else { m.text = v.replace(/\s+$/, ''); m.listId = document.getElementById('mList').value || m.listId; }
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
  document.getElementById('btnHistory').onclick = () => { histSel.clear(); renderHistoryRows(); document.getElementById('dlgHistory').showModal(); };
  document.getElementById('btnBackup').onclick = () => { document.getElementById('bkDone').hidden = true; document.getElementById('dlgBackup').showModal(); };
  document.getElementById('btnItems').onclick = () => { invMode = 'items'; invSel = 0; invPage = ITEM_PAGE > 1 && ITEMS.filter(i => i.p === 1).every(i => owned(i.id)) ? ITEM_PAGE : 1; renderItems(); document.getElementById('dlgItems').showModal(); };
  document.getElementById('itemRows').addEventListener('click', e => { const c = e.target.closest('[data-cell]'); if (c) { invSel = Number(c.dataset.cell); renderItems(); } });
  document.getElementById('invPages').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b) { invPage = Number(b.dataset.page); invSel = 0; renderItems(); } });
  // 矢印キーでカーソルを動かす（5列×4段）
  document.getElementById('dlgItems').addEventListener('keydown', e => {
    const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -5, ArrowDown: 5 }[e.key]; if (mv === undefined) return;
    e.preventDefault(); const n = invMode === 'zukan' ? ZUKAN.length : ITEMS.filter(i => i.p === invPage).length;
    if (!n) return;
    invSel = (invSel + mv + n) % n; renderItems();
    const c = document.querySelector(`#itemRows [data-cell="${invSel}"]`); if (c) c.focus();
  });
  document.getElementById('getOk').onclick = hideGet;
  // v4.0 モンスター図鑑（v4.0.1：コマンドのボタンから）・モンスターの とうろく・バトル
  document.getElementById('btnZukan').onclick = () => { invMode = 'zukan'; invSel = 0; renderItems(); document.getElementById('dlgItems').showModal(); };
  document.getElementById('btnZukanEdit').onclick = () => openZukanEdit('');
  document.getElementById('zkPick').onchange = e => { fillZukanForm(e.target.value); document.getElementById('zkMsg').textContent = ''; };
  document.getElementById('zkLooks').onclick = e => { const b = e.target.closest('[data-look]'); if (b) { zkLook = Number(b.dataset.look); renderLooks(); } };
  document.getElementById('zukanForm').onsubmit = e => { e.preventDefault(); saveZukanForm(); };
  document.getElementById('battle').onclick = e => { e.preventDefault(); advanceBattle(); };
  document.addEventListener('keydown', e => {
    if (document.getElementById('battle').hidden) return;
    if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); advanceBattle(); }
  });
  // プロフィール（なまえ・しょくぎょう）
  const dlgProfile = document.getElementById('dlgProfile');
  let pickJob = 'knight';
  const renderJobs = () => document.querySelectorAll('[data-job]').forEach(b => b.classList.toggle('on', b.dataset.job === pickJob));
  document.getElementById('jobRow').innerHTML = Object.entries(JOBS).map(([k, j]) => `<button type="button" class="job" data-job="${k}"><canvas data-jobcv="${k}"></canvas><span>${j.n}</span></button>`).join('');
  document.getElementById('jobRow').onclick = e => { const b = e.target.closest('[data-job]'); if (b) { pickJob = b.dataset.job; renderJobs(); } };
  document.getElementById('profile').onclick = () => {
    pickJob = PROFILE.job;
    document.getElementById('pName').value = PROFILE.name;
    document.querySelectorAll('[data-jobcv]').forEach(cv => { try { Art.drawChar(cv, cv.dataset.jobcv, 3); } catch (e) {} });
    renderJobs();
    dlgProfile.showModal();
  };
  document.getElementById('profileForm').onsubmit = e => {
    e.preventDefault();
    const name = document.getElementById('pName').value.trim() || 'ゆうしゃ';
    const changed = name !== PROFILE.name || pickJob !== PROFILE.job;
    setProfile({ name, job: pickJob });
    dlgProfile.close();
    if (changed) showMsg(`${PROFILE.name}は ${JOBS[PROFILE.job].n}に なった！`);
  };
  document.getElementById('btnProfileCancel').onclick = () => dlgProfile.close();
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
    else if (d.lframe !== undefined) { const L = listById(d.lframe); if (d.f) L.frame = d.f; else delete L.frame; save(); render(); renderListRows(); }
    else if (d.lup) { const i = idx(d.lup); [S.lists[i - 1], S.lists[i]] = [S.lists[i], S.lists[i - 1]]; save(); render(); renderListRows(); }
    else if (d.ldown) { const i = idx(d.ldown); [S.lists[i + 1], S.lists[i]] = [S.lists[i], S.lists[i + 1]]; save(); render(); renderListRows(); }
    else if (d.ldel) { deletingList = d.ldel; renderListRows(); }
    else if (d.ldelok) {
      const sel = lr.querySelector('[data-lmoveto]');
      deleteList(d.ldelok, sel ? sel.value : (isMemoList(listById(d.ldelok)) ? null : TODAY_ID));
    }
    else if ('ldelcancel' in d) { deletingList = null; renderListRows(); }
  });
  const addList = memo => {
    const used = S.lists.map(l => l.color);
    const color = memo ? (['#ece3f7', '#e8eaed', '#efe6d8', '#e4f1f0'].find(c => !used.includes(c)) || '#ece3f7') : (PALETTE.find(c => !used.includes(c)) || PALETTE[7]);
    S.lists.push(memo ? { id: uid(), name: '✏️ 新しいメモ', color, type: 'memo' } : { id: uid(), name: '新しいリスト', color });
    save(); render(); renderListRows();
    const inputs = lr.querySelectorAll('[data-lname]');
    const last = inputs[inputs.length - 1]; last.focus(); last.select();
  };
  document.getElementById('btnListAdd').onclick = () => addList(false);
  document.getElementById('btnMemoListAdd').onclick = () => addList(true);

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
  document.getElementById('historyRows').addEventListener('change', e => {
    const id = e.target.dataset.hsel; if (!id) return;
    e.target.checked ? histSel.add(id) : histSel.delete(id);
    e.target.closest('.hrow').classList.toggle('sel', e.target.checked);
    updateHistSel(S.tasks.filter(x => x.done).length);
  });
  document.getElementById('hSelAll').onchange = e => {
    histSel.clear();
    if (e.target.checked) S.tasks.filter(x => x.done).forEach(x => histSel.add(x.id));
    renderHistoryRows();
  };
  document.getElementById('btnHistoryDelSel').onclick = () => {
    const n = histSel.size; if (!n) return;
    if (!confirm(`選択した ${n}件を削除します。\n元に戻せません。よろしいですか？`)) return;
    S.tasks = S.tasks.filter(x => !histSel.has(x.id));
    histSel.clear();
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
  document.getElementById('btnExport').onclick = () => exportJSON();
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-bkpick]')) { if (await bkPickDir()) autoBackup(true); }
    if (e.target.closest('#bkPending')) autoBackup(true);
  });
  // v3.9.2 読み込みボタン（label）を押したとき、フォルダから開けるならそちらで開く
  document.getElementById('fileImport').closest('label').addEventListener('click', e => {
    if (e.target.id === 'fileImport' || !canOpenInDir()) return;   // 今までどおり（input のクリックはそのまま通す）
    e.preventDefault(); pickImportFile();
  });
  document.getElementById('fileImport').onchange = e => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; };

  // 日付の変化・時刻超過のチェック
  const overdueSig = () => S.tasks.filter(isOverdue).map(x => x.id).join(',');
  let lastSig = overdueSig();
  const tick = () => {
    if (!cloudReady) { updateBadge(); return; }
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
  // 画面幅が変わったら（PC⇔スマホ表示）描き直す
  window.matchMedia('(max-width: 700px)').addEventListener('change', () => { render(); renderProfile(); });
  // スマホのタブ切替
  // v3.8 スマホ：タブを長押しして左右に動かすと、リストの並び順が変わる（「📅 よてい」タブは動かさない）
  const tabs = document.getElementById('tabs');
  let tp = null;
  const tpClear = () => { if (tp) { clearTimeout(tp.timer); if (tp.el) { tp.el.classList.remove('lifting'); tp.el.style.transform = ''; } } tabs.querySelectorAll('.tdrop-before,.tdrop-after').forEach(n => n.classList.remove('tdrop-before', 'tdrop-after')); tp = null; };
  const tabTarget = x => {
    const list = [...tabs.querySelectorAll('.tab[data-tab]')].filter(n => n.dataset.tab !== CAL_TAB && n.dataset.tab !== (tp && tp.id));
    for (const n of list) { const r = n.getBoundingClientRect(); if (x < r.left + r.width / 2) return { el: n, id: n.dataset.tab, after: false }; }
    const last = list[list.length - 1];
    return last ? { el: last, id: last.dataset.tab, after: true } : null;
  };
  tabs.addEventListener('touchstart', e => {
    const b = e.target.closest('.tab[data-tab]');
    if (!b || b.dataset.tab === CAL_TAB || e.touches.length !== 1) return;
    const t = e.touches[0];
    tp = { id: b.dataset.tab, el: b, x0: t.clientX, y0: t.clientY, lifted: false };
    tp.timer = setTimeout(() => { if (!tp) return; tp.lifted = true; b.classList.add('lifting'); try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} }, 450);
  }, { passive: true });
  tabs.addEventListener('touchmove', e => {
    if (!tp) return;
    const t = e.touches[0];
    if (!tp.lifted) { if (Math.abs(t.clientX - tp.x0) > 8 || Math.abs(t.clientY - tp.y0) > 8) tpClear(); return; }
    e.preventDefault();
    tp.el.style.transform = `translateX(${t.clientX - tp.x0}px)`;
    tabs.querySelectorAll('.tdrop-before,.tdrop-after').forEach(n => n.classList.remove('tdrop-before', 'tdrop-after'));
    const d = tabTarget(t.clientX);
    if (d) { d.el.classList.add(d.after ? 'tdrop-after' : 'tdrop-before'); tp.target = d; tp.moved = true; }
  }, { passive: false });
  tabs.addEventListener('touchend', e => {
    if (!tp) return;
    const lifted = tp.lifted, d = tp.moved && tp.target, id = tp.id;
    if (lifted) { e.preventDefault(); suppressClick = Date.now(); }
    tpClear();
    if (d) moveList(id, d.id, d.after);
  }, { passive: false });
  tabs.addEventListener('touchcancel', tpClear);
  tabs.addEventListener('click', e => {
    if (Date.now() - suppressClick < 600) return;   // 長押しで並べ替えた直後のタップは無視
    const b = e.target.closest('[data-tab]'); if (!b) return;
    mobileTab = b.dataset.tab;
    try { localStorage.setItem('kyou-task-tab', mobileTab); } catch (_) {}
    render();
    window.scrollTo(0, 0);
  });
  // ログイン
  document.getElementById('btnLogin').onclick = () => window.Cloud && window.Cloud.login(false);
  document.getElementById('btnLoginRedirect').onclick = () => window.Cloud && window.Cloud.login(true);
  document.getElementById('btnLogout').onclick = () => window.Cloud && window.Cloud.logout();
}

/* ---------- v3.7 きょうの よてい（Googleカレンダーを「見るだけ」で読む） ----------
   ・許可は calendar.readonly だけ（Google側で書き込み・削除はできない）
   ・読むのは自分のメインのカレンダー（primary）の今日の予定。断った予定・取り消された予定は出さない
   ・Googleの許可（アクセストークン）は1時間ほどで切れる。切れたら「▶ よみこむ」を1回押してもらう（自動で小窓を開くとブラウザに止められるため）
*/
const CAL_CLIENT_ID = '780302572009-bkd5c194j520srvd1j99qf7rbn2vkbl2.apps.googleusercontent.com';
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const CAL_TOKEN_KEY = 'kyou-task-cal-token';
const CAL_EVERY = 15 * 60 * 1000;   // 開いている間は15分おきに読み直す
const cal = { token: null, exp: 0, events: null, status: 'need', msg: '', at: 0, day: '', open: new Set() };
try { const o = JSON.parse(localStorage.getItem(CAL_TOKEN_KEY) || 'null'); if (o && o.exp > Date.now()) { cal.token = o.t; cal.exp = o.exp; } } catch (e) {}
const calTokenOk = () => cal.token && cal.exp > Date.now();
function calExplain(m) {
  m = String(m || '');
  if (/accessNotConfigured|has not been used|is disabled/i.test(m)) return 'Google Calendar API が有効になっていません';
  if (/origin_mismatch|idpiframe|redirect_uri_mismatch/i.test(m)) return 'このアドレスがGoogle側に登録されていません';
  if (/admin_policy_enforced/i.test(m)) return '会社の管理者の設定で止められています';
  if (/popup_closed|popup_failed|access_denied/i.test(m)) return '許可の画面が閉じられました。もう一度おしてください';
  return '';
}
// 「▶ よみこむ」：許可が残っていればそのまま読む。切れていたら許可をもらい直す（2回目からは確認画面なしで一瞬で終わるはず）
function calLoad(fromButton) {
  if (calTokenOk()) return calFetch();
  if (!fromButton) { cal.status = 'need'; renderCal(); return; }
  if (!window.google || !google.accounts || !google.accounts.oauth2) { cal.status = 'error'; cal.msg = 'Googleの部品を読み込めませんでした（オフラインかも）'; renderCal(); return; }
  cal.status = 'loading'; renderCal();
  const email = document.getElementById('accountEmail').textContent || '';
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CAL_CLIENT_ID, scope: CAL_SCOPE, hint: email || undefined,
    callback: res => {
      if (res.error || !google.accounts.oauth2.hasGrantedAllScopes(res, CAL_SCOPE)) {
        cal.status = 'error'; cal.msg = calExplain(res.error) || '「カレンダーを見る」の許可がもらえませんでした'; renderCal(); return;
      }
      cal.token = res.access_token; cal.exp = Date.now() + (Number(res.expires_in) || 3600) * 1000 - 60 * 1000;
      try { localStorage.setItem(CAL_TOKEN_KEY, JSON.stringify({ t: cal.token, exp: cal.exp })); } catch (e) {}
      calFetch();
    },
    error_callback: err => { cal.status = 'error'; cal.msg = calExplain(err && err.type) || '許可の画面を開けませんでした'; renderCal(); },
  });
  client.requestAccessToken({ prompt: '', hint: email || undefined });
}
async function calFetch() {
  cal.status = cal.events ? cal.status : 'loading'; if (!cal.events) renderCal();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const q = new URLSearchParams({ timeMin: d0.toISOString(), timeMax: d1.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  try {
    const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q, { headers: { Authorization: 'Bearer ' + cal.token } });
    if (r.status === 401) { cal.token = null; cal.exp = 0; try { localStorage.removeItem(CAL_TOKEN_KEY); } catch (e) {} cal.status = 'need'; renderCal(); return; }
    const j = await r.json();
    if (!r.ok) { cal.status = 'error'; cal.msg = calExplain(JSON.stringify(j)) || `読み込めませんでした（${r.status}）`; renderCal(); return; }
    const declined = ev => (ev.attendees || []).some(a => a.self && a.responseStatus === 'declined');
    cal.events = (j.items || []).filter(ev => ev.status !== 'cancelled' && !declined(ev)).map(ev => ({
      id: ev.id, title: ev.summary || '（タイトルなし）', allDay: !(ev.start && ev.start.dateTime),
      start: ev.start && ev.start.dateTime ? new Date(ev.start.dateTime).getTime() : 0,
      end: ev.end && ev.end.dateTime ? new Date(ev.end.dateTime).getTime() : 0,
      loc: ev.location || '',
    }));
    cal.status = 'ok'; cal.at = Date.now(); cal.day = todayKey();
  } catch (e) { cal.status = 'error'; cal.msg = 'つながりませんでした（オフラインかも）'; }
  renderCal();
}
const hmOf = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function calBody() {
  const btn = `<button type="button" class="calbtn ${cal.status === 'need' ? 'blink' : ''}" data-calbtn>${cal.status === 'loading' ? 'よみこみちゅう…' : '▶ よみこむ'}</button>`;
  let list = '';
  if (cal.events && cal.day === todayKey()) {
    const now = Date.now(), timed = cal.events.filter(e => !e.allDay);
    const cur = timed.find(e => e.start <= now && now < e.end) || timed.find(e => e.start > now);
    list = cal.events.length ? cal.events.map(e => {
      const cls = ['cev', e.allDay ? 'allday' : '', !e.allDay && e.end <= now ? 'past' : '', e === cur ? 'now' : '', cal.open.has(e.id) ? 'open' : ''].join(' ');
      return `<div class="${cls}" data-cev="${esc(e.id)}"><span class="ct">${e === cur ? '▶' : ''}${e.allDay ? '終日' : hmOf(e.start)}</span><span class="cn">${esc(e.title)}</span>
        ${cal.open.has(e.id) ? `<div class="cdet">${e.allDay ? '終日' : hmOf(e.start) + '〜' + hmOf(e.end)}${e.loc ? '<br>' + esc(e.loc) : ''}</div>` : ''}</div>`;
    }).join('') : '<p class="calmsg">きょうの よていは ない。</p>';
  }
  const msg = cal.status === 'error' ? `<p class="calmsg err">${esc(cal.msg)}</p>`
    : cal.status === 'need' ? `<p class="calmsg">${cal.events ? 'きょかが きれた。▶ よみこむ を おしてね' : '▶ よみこむ を おすと きょうの よていが でる'}</p>` : '';
  return { btn, inner: msg + list };
}
function renderCal() {
  const b = calBody();
  const win = document.getElementById('calwin');
  if (win) { document.getElementById('calBtnBox').innerHTML = b.btn; document.getElementById('calList').innerHTML = b.inner; }
  const col = document.querySelector('#board [data-calcol]');
  if (col) col.innerHTML = `<span class="ttl">📅 きょうの よてい</span>${b.btn}<div class="callist">${b.inner}</div>`;
}
// 開いている間：15分おき・日付が変わったとき・アプリに戻ってきたときに読み直す（許可が切れていたらボタンを点滅）
function calTick() {
  if (!cal.events && !calTokenOk()) return;
  if (!calTokenOk()) { if (cal.status !== 'need') { cal.status = 'need'; renderCal(); } return; }
  if (cal.day !== todayKey() || Date.now() - cal.at > CAL_EVERY) calFetch(); else renderCal();
}

/* ---------- 起動 ---------- */
// v3.9：ログアウトのあと最初に開いたとき、Firestore の端末内キャッシュ（IndexedDB）を消す（まだ開いていないうちに）
try {
  if (localStorage.getItem('kyou-task-wipe-cache') && window.indexedDB) {
    localStorage.removeItem('kyou-task-wipe-cache');
    indexedDB.deleteDatabase('firestore/[DEFAULT]/kyou-task/main');   // 先に消す（Firestore が開く前に順番待ちに入る）
    if (indexedDB.databases) indexedDB.databases().then(list => list.forEach(d => { if (d.name && d.name.startsWith('firestore/') && d.name !== 'firestore/[DEFAULT]/kyou-task/main') indexedDB.deleteDatabase(d.name); })).catch(() => {});
  }
} catch (e) {}
load();
bind();
render();   // まず端末内の控えで表示（クラウドの読み込みが終わったら最新に入れ替わる）
renderLevel();
let openedMsg = false;
document.getElementById('ver').textContent = APP_VERSION;
document.getElementById('verM').textContent = APP_VERSION;
document.getElementById('btnLogoutM').onclick = () => window.Cloud && window.Cloud.logout();
updateBadge();
document.getElementById('verNew').onclick = updateApp;
document.getElementById('msgwrap').onclick = () => {
  clearTimeout(msgHide); document.getElementById('msgwrap').classList.remove('show');
  if (!document.getElementById('msgOk').hidden) { try { localStorage.setItem('kyou-task-greeted', todayKey()); } catch (e) {} }
};
// v3.9 ヘッダーのキャラ・雲を動かす：小さな絵を重ねて、CSSのアニメーションで動かす（描き直さないので軽い）
// v3.9 下の原っぱも同じしくみ（スライム＝ジャンプ、白いやつ＝モジモジ、コウモリ＝パタパタ）
function renderStageFx(fx, boxId = 'stageFx', field = false) {
  const box = document.getElementById(boxId); if (!box || !fx) return;
  box.innerHTML = '';
  const kindOf = n => n === 'bat' ? 'flap' : n === 'blob' ? 'hop' : (field && n === 'ghost') ? 'wiggle' : 'walk';
  fx.actors.forEach((a, i) => {
    const wrap = document.createElement('div'), cv = document.createElement('canvas'), kind = kindOf(a.name);
    const m = Art.drawSheet(cv, a.name, a.u, kind);
    wrap.className = 'fxa ' + kind;
    wrap.style.cssText = `left:${a.x}px;top:${a.y - a.u}px;width:${m.W}px;height:${m.H}px;--d:${-(i * 0.37).toFixed(2)}s`;
    wrap.appendChild(cv); box.appendChild(wrap);
  });
  fx.clouds.forEach((c, i) => {
    const wrap = document.createElement('div'), cv = document.createElement('canvas');
    const m = Art.drawCloud(cv, c.s), dur = 90 + i * 25;
    // 右から左へゆっくり流れる。今の位置から始まるように、アニメーションの途中から再生する
    const travel = fx.w + m.W + 40, startFrac = (fx.w + 20 - c.x) / travel;
    wrap.className = 'fxc';
    wrap.style.cssText = `top:${c.y}px;width:${m.W}px;height:${m.H}px;transform:translateX(${c.x}px);--from:${fx.w + 20}px;--to:${-m.W - 20}px;--dur:${dur}s;--delay:${-(startFrac * dur).toFixed(1)}s`;
    wrap.appendChild(cv); box.appendChild(wrap);
  });
}
function drawArt() {
  try {
    const cw = document.getElementById('calwin'), st = document.getElementById('stage');
    const reserve = cw && cw.offsetParent ? cw.getBoundingClientRect().right - st.getBoundingClientRect().left : 0;
    renderStageFx(Art.drawStage(st, { reserve, fx: true }));
    renderStageFx(Art.drawField(document.getElementById('field'), { fx: true }), 'fieldFx', true);
    if (!document.getElementById('loginScreen').hidden) Art.drawHero(document.getElementById('loginHero'));
  } catch (e) { console.warn(e); }
}
// v3.7 きょうの よてい
document.addEventListener('click', e => {
  if (e.target.closest('[data-calbtn]')) { calLoad(true); return; }
  const ev = e.target.closest('[data-cev]');
  if (ev) { const id = ev.dataset.cev; cal.open.has(id) ? cal.open.delete(id) : cal.open.add(id); renderCal(); }
});
setInterval(calTick, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) calTick(); });
if (calTokenOk()) calFetch(); else renderCal();
if (canPickDir()) bkLoadDir(); else renderBackupInfo();   // v3.9 バックアップの保存先フォルダ
drawArt();
if (document.fonts) document.fonts.ready.then(drawArt);
let artTimer; window.addEventListener('resize', () => { clearTimeout(artTimer); artTimer = setTimeout(drawArt, 120); });
checkVersion();
setInterval(checkVersion, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

/* ---------- クラウド同期（sync.js）とのつなぎ ---------- */
function cloudStatusText(st) {
  return { linking: '☁ じゅんびちゅう…', synced: '☁ セーブずみ（同期済み）', pending: '⏳ セーブちゅう（送信待ち）', offline: '📴 オフライン（つながったら送ります）', error: '⚠ セーブに しっぱい（同期エラー）' }[st] || '';
}
window.App = {
  get S() { return S; },
  DATA_VERSION,
  genIds,
  render,
  exportJSON,
  applyRemote(col, items) {
    if (col === 'lists') items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (col === 'memos') items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    S[col] = items;
  },
  setExp,
  get EXP() { return EXP; },
  setProfile: p => setProfile(p, true),
  get PROFILE() { return PROFILE; },
  setItems,
  resetItems,
  setZukan,
  setBattle,
  get BATTLE() { return BATTLE; },
  onCloudReady() {
    const first = !cloudReady && !openedMsg;
    cloudReady = true;
    // 「あらわれた！」は1日1回だけ（この端末で今日はじめて開いたとき）。OKを押すまで出しておく
    let greeted = '';
    try { greeted = localStorage.getItem('kyou-task-greeted') || ''; } catch (e) {}
    if (first && greeted !== todayKey()) {
      openedMsg = true;
      setTimeout(startOfDay, 600);   // v4.0 やり残しがあれば上司バトル、なければ いつもの「あらわれた！」
    }
    if (!S.lists.some(l => l.id === TODAY_ID)) S.lists.unshift({ id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] });
    ensureMemoLists();  // 古い形のメモ（列が1つだけ）をメモ用リストに移す
    ensureRepeatList(); // v3.9.1 繰り返しの親は「繰り返し系」にまとめる
    // v3.4：メモのリスト名の先頭「✍」を「✏️」に（分かりやすくするため。1回だけ）
    try {
      if (!localStorage.getItem('kyou-task-pencil')) {
        S.lists.forEach(l => { if (isMemoList(l) && String(l.name).startsWith('✍')) l.name = '✏️' + String(l.name).slice(1).replace(/^\uFE0F/, ''); });
        S.memos.forEach(m => { if (String(m.text).startsWith('✍ ここはメモ欄です')) m.text = '✏️' + m.text.slice(1); });
        localStorage.setItem('kyou-task-pencil', '1');
      }
    } catch (e) {}
    dailyRefresh();  // 日付が変わっていれば繰り返し生成・今日への移動（結果はクラウドへ）
    render();
    setTimeout(() => autoBackup(false), 3000);   // v3.9 1日1回の自動バックアップ（クラウドの最新を読み終えてから）
  },
  cloudStatus(st, err) {
    const el = document.getElementById('syncStatus');
    el.textContent = cloudStatusText(st);
    el.className = 'sync ' + st;
    if (err) { console.error(err); el.title = String(err.message || err); }
    if (st === 'error' && err && err.code === 'permission-denied') {
      alert('このアカウントではデータにアクセスできません。\n登録したGoogleアカウントでログインし直してください。');
    }
  },
  showLogin(show) {
    // v3.9：開いている画面（セーブ・アカウントなど）を閉じてから、ログイン画面を出す（閉じないとログイン画面の上に残っていた）
    if (show) document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.getElementById('loginScreen').hidden = !show;
    document.getElementById('loginScreen').classList.remove('checking');
    if (show) setTimeout(() => { try { Art.drawHero(document.getElementById('loginHero')); } catch (e) {} }, 0);
    if (show) { cloudReady = false; document.getElementById('syncStatus').textContent = ''; }
  },
  // v3.9：ログアウトしたときに、この端末の中の控えを消す（クラウドのデータは消さない）
  wipeLocal() {
    ['kyou-task-data-v1', 'kyou-task-profile', 'kyou-task-items', 'kyou-task-zukan', 'kyou-task-battle', 'kyou-task-exp', 'kyou-task-cal-token', 'kyou-task-linked-uid', 'kyou-task-greeted', 'kyou-task-tab']
      .forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    try { Object.keys(localStorage).filter(k => k.startsWith('kyou-task-data-')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    try { localStorage.setItem('kyou-task-wipe-cache', '1'); } catch (e) {}   // Firestore の端末内キャッシュは、次に開いたときに消す
  },
  setAccount(email) { document.getElementById('accountEmail').textContent = email; },
  loginError(e) {
    console.error(e);
    const el = document.getElementById('loginError');
    el.hidden = false;
    el.textContent = 'ログインできませんでした（' + (e.code || e.message || e) + '）。下の「別の方法でログイン」も試してみてください。';
  },
};
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

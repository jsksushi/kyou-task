/* きょうのタスク（クラウド同期対応・クラシックRPG風デザイン） */
'use strict';

// ▼ 改修してアップするたびに、ここと version.json と sw.js の CACHE を同じ番号にそろえて上げる
const APP_VERSION = '3.4';
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
  ensureMemoLists();
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
const taskLists = () => S.lists.filter(l => !isMemoList(l));
const memoLists = () => S.lists.filter(isMemoList);
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
function generateRepeats() {
  const t = todayKey();
  for (const r of S.rules) {
    // v3.4：「次回分は作成済み」の印が未来の日付のまま残っていると、その日が飛ばされていた（曜日を変えたときなど）。
    //        今日の分は必ず判定し直す（同じ日の分が2つにならないよう上でチェック）
    if (r.lastGenerated && r.lastGenerated > t) {
      // 古い設定（開始日なし）：印の日がルールに合っていれば「初回の日」なので、それより前には出さない。
      // 合っていない＝あとで曜日などを変えた → 今日から判定する
      if (!r.start && ruleMatches(r, r.lastGenerated)) r.start = r.lastGenerated;
      r.lastGenerated = addDays(t, -1);
    }
    let k = r.lastGenerated ? addDays(r.lastGenerated, 1) : t;
    let guard = 0;
    while (k <= t && guard++ < 400) {
      const gid = `${r.id}_${k}`;
      // 同じ日の分がすでにある（最初の1件・別の端末で作った分・完了ずみ含む）なら作らない
      if (ruleMatches(r, k) && !taskById(gid) && !S.tasks.some(x => x.ruleId === r.id && x.due === k)) {
        genIds.add(gid);
        S.tasks.push({
          id: gid, title: r.title, listId: r.listId, due: k, time: r.time || '',
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
  return `<div class="${cls.join(' ')}" data-id="${x.id}" draggable="${!x.done}">
    <div class="body">
      <div class="title" data-edit="${x.id}">${esc(x.title)}</div>
      ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
      ${x.memo ? `<div class="tmemo">${linkify(x.memo)}</div>` : ''}
    </div>${btn}</div>`;
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
function renderTabs() {
  const nav = document.getElementById('tabs');
  if (!isMobile()) { nav.hidden = true; return; }
  if (mobileTab === 'memo' && !listById('memo')) mobileTab = memoLists()[0]?.id || TODAY_ID;
  if (!listById(mobileTab)) mobileTab = TODAY_ID;
  nav.hidden = false;
  nav.innerHTML = S.lists.map(L => {
    const n = isMemoList(L) ? S.memos.filter(m => m.listId === L.id).length
      : L.id === TODAY_ID ? S.tasks.filter(x => isCounted(x)).length : S.tasks.filter(x => x.listId === L.id && !x.done).length;
    return `<button class="tab ${mobileTab === L.id ? 'on' : ''} ${L.id === TODAY_ID ? 'today' : ''}" data-tab="${L.id}" style="--c:${esc(lightColor(L.color))}">${esc(L.name)}<span class="tn">${n}</span></button>`;
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
        <span class="ttl" style="color:${esc(lightColor(L.color))}">${mark(L.name, '✏️')}${esc(L.name)}<span class="n">${memos.length}</span></span>
        ${memos.map(m => `<div class="memocard" data-memo="${m.id}">${linkify(m.text)}</div>`).join('')}
        <textarea class="memoadd" data-memoadd="${L.id}" rows="1" placeholder="${mobile ? '＋ メモを かきこむ' : '＋ メモを かきこむ（Ctrl+Enterで確定）'}"></textarea>
        ${mobile ? `<button class="btn small primary memosave" data-memosave="${L.id}">メモを かきこむ</button>` : ''}
      </section>`);
      continue;
    }
    const open = S.tasks.filter(x => x.listId === L.id && !x.done).sort(sortTasks);
    const doneToday = S.tasks.filter(x => x.listId === L.id && x.done && x.doneDate === t)
      .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    html.push(`<section class="col win ${L.id === TODAY_ID ? 'today' : ''} ${mobile && mobileTab === L.id ? 'active' : ''}" data-list="${L.id}" style="${frameStyle(L)}">
      <span class="ttl" style="color:${esc(lightColor(L.color))}">${mark(L.name, '◆')}${esc(L.name)}<span class="n">${open.length}</span></span>
      ${open.map(taskRow).join('') || '<div class="empty">タスクは ない。</div>'}
      <div class="addrow">
        <input class="add" data-add="${L.id}" enterkeyhint="done" placeholder="${mobile ? '＋ タスクを ついか' : '＋ タスクを ついか（Enter）'}">
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
}
const openDetails = new Set();

/* ---------- タスク操作 ---------- */
function completeTask(id) {
  const x = taskById(id); if (!x) return;
  const wasCounted = isCounted(x);
  x.done = true; x.doneAt = Date.now(); x.doneDate = todayKey();
  // たからばこ：たまに（約10%）宝物が手に入る。どのタスクで手に入れたかを覚えておく（もどしたら減らすため）
  const item = Math.random() < TREASURE_RATE ? pickItem() : null;
  if (item) x.loot = item.id;
  save(); render();
  const before = levelOf(EXP);
  addExp(1);
  if (item) addItem(item.id, 1);
  const left = S.tasks.filter(t => isCounted(t)).length;
  let m = `「${x.title}」を 完了した！ けいけんちを 1 かくとく！`;
  const after = levelOf(EXP);
  if (after > before) m += ` レベルが あがった！ Lv ${after} に なった！` + levelUpText(before, after);
  if (item) m += ` …おや？ たからばこを みつけた！ ${item.icon}${item.name}（${RARITY[item.r].n}）を てにいれた！`;
  if (wasCounted) m += left ? ` きょうの のこりは ${left}つ。` : ' きょうの タスクを すべて 完了した！';
  showMsg(m);
}
function undoTask(id) {
  const x = taskById(id); if (!x) return;
  x.done = false; delete x.doneAt; delete x.doneDate;
  const lost = x.loot && ITEMS.find(i => i.id === x.loot);
  if (x.loot) { addItem(x.loot, -1); delete x.loot; }  // そのタスクで手に入れた宝物も返す
  if (!listById(x.listId)) x.listId = TODAY_ID;
  autoMoveToToday();
  save(); render();
  addExp(-1);
  showMsg(`「${x.title}」が また あらわれた！` + (lost ? ` ${lost.icon}${lost.name} を かえした…` : ''));
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
  if (drawnJob !== sig && window.Art && Art.drawChar) { Art.drawChar($('pfHero'), PROFILE.job, u); drawnJob = sig; }
}

/* ---------- v3.4 たからばこ（集めるだけ。使う機能はなし） ---------- */
const TREASURE_RATE = 0.1;
const RARITY = { c: { n: 'ふつう', w: 60 }, r: { n: 'レア', w: 28 }, s: { n: 'すごくレア', w: 10 }, l: { n: 'でんせつ', w: 2 } };
const ITEMS = [
  { id: 'leaf', r: 'c', icon: '🌿', name: 'にがい はっぱ', d: 'かむと すこし めが さめる。' },
  { id: 'onigiri', r: 'c', icon: '🍙', name: 'おにぎり', d: 'ひるやすみの みかた。' },
  { id: 'stone', r: 'c', icon: '🪨', name: 'まるい いし', d: 'なんとなく ひろってしまった。' },
  { id: 'feather', r: 'c', icon: '🪶', name: 'とりの はね', d: 'かるい。とても かるい。' },
  { id: 'mushroom', r: 'c', icon: '🍄', name: 'ちいさな キノコ', d: 'たべないほうが いい きがする。' },
  { id: 'screw', r: 'c', icon: '🔩', name: 'さびた ネジ', d: 'どこかの きかいの ぶひん。' },
  { id: 'clip', r: 'c', icon: '📎', name: 'まがった クリップ', d: 'しょるいを ひとつに まとめた あかし。' },
  { id: 'candy', r: 'c', icon: '🍬', name: 'あめだま', d: 'ゆうがたの エネルギー。' },
  { id: 'key', r: 'r', icon: '🗝️', name: 'ふしぎな かぎ', d: 'どの とびらの かぎかは わからない。' },
  { id: 'compass', r: 'r', icon: '🧭', name: 'まよわない コンパス', d: 'つぎに やることを ゆびさす。' },
  { id: 'candle', r: 'r', icon: '🕯️', name: 'よるの ろうそく', d: 'ざんぎょうの おともに。' },
  { id: 'coffee', r: 'r', icon: '☕', name: 'さめない コーヒー', d: 'いつまでも あたたかい。' },
  { id: 'map', r: 'r', icon: '🗺️', name: 'ふるい ちず', d: 'てつづきの みちすじが かいてある。' },
  { id: 'coin', r: 'r', icon: '🪙', name: 'きんいろの コイン', d: 'ぴかぴかに みがかれている。' },
  { id: 'gem', r: 's', icon: '💎', name: 'そらいろの いし', d: 'のぞくと きもちが はれる。' },
  { id: 'pen', r: 's', icon: '🖋️', name: 'しめきりの ペン', d: 'これで かくと しめきりに まにあう。' },
  { id: 'hourglass', r: 's', icon: '⏳', name: 'とまる すなどけい', d: 'すこしだけ じかんが ゆっくりになる…きがする。' },
  { id: 'bell', r: 's', icon: '🎐', name: 'かぜの すず', d: 'なると あたまが すっきりする。' },
  { id: 'crown', r: 'l', icon: '👑', name: 'ていじの かんむり', d: 'もちぬしは かならず ていじに かえれるという。' },
  { id: 'stamp', r: 'l', icon: '🌈', name: 'にじいろの ハンコ', d: 'おすと どんな しんせいも とおるという。' },
];
const ITEMS_KEY = 'kyou-task-items';
let ITEM_COUNTS = (() => { try { return JSON.parse(localStorage.getItem(ITEMS_KEY) || '{}') || {}; } catch (e) { return {}; } })();
function pickItem() {
  const tot = Object.values(RARITY).reduce((a, b) => a + b.w, 0);
  let x = Math.random() * tot, rk = 'c';
  for (const [k, v] of Object.entries(RARITY)) { if ((x -= v.w) < 0) { rk = k; break; } }
  const pool = ITEMS.filter(i => i.r === rk);
  return pool[Math.floor(Math.random() * pool.length)];
}
function setItems(counts) {
  ITEM_COUNTS = { ...(counts || {}) };
  try { localStorage.setItem(ITEMS_KEY, JSON.stringify(ITEM_COUNTS)); } catch (e) {}
  if (document.getElementById('dlgItems').open) renderItems();
}
function addItem(id, d) {
  setItems({ ...ITEM_COUNTS, [id]: Math.max(0, (ITEM_COUNTS[id] || 0) + d) });
  if (window.Cloud && window.Cloud.addItem) window.Cloud.addItem(id, d);
}
function renderItems() {
  const n = id => Math.max(0, Number(ITEM_COUNTS[id]) || 0);
  const got = ITEMS.filter(i => n(i.id) > 0).length;
  document.getElementById('itemsHead').textContent = `あつめた しゅるい ${got} / ${ITEMS.length}`;
  document.getElementById('itemRows').innerHTML = ITEMS.map(i => n(i.id) > 0
    ? `<div class="itm r-${i.r}"><span class="ic">${i.icon}</span><div class="t"><b>${esc(i.name)}</b> <span class="cnt">×${n(i.id)}</span><div class="s"><span class="rk">${RARITY[i.r].n}</span> ${esc(i.d)}</div></div></div>`
    : `<div class="itm none"><span class="ic">？</span><div class="t">？？？<div class="s"><span class="rk">${RARITY[i.r].n}</span></div></div></div>`).join('');
}
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
  sel.innerHTML = taskLists().map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
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
  if (editing && editing.mode === 'rule') hint.textContent = '「なし」にして保存すると、この繰り返し設定を削除します（出てきているタスクは残ります）。';
  else if (v) hint.textContent = '設定した日になると自動でタスクが出てきます。やり残した回は赤字で残ります。';
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
    setRepeatUI(r ? r.type : '', r ? r.days : [], r ? r.dom : null, r);
    document.getElementById('fMemo').value = x.memo || '';
  } else if (mode === 'rule') {
    const r = ruleById(id);
    titleEl.textContent = '繰り返し設定を編集';
    document.getElementById('fTitle').value = r.title;
    fillListSelect(document.getElementById('fList'), r.listId);
    setDue(''); setTime(r.time || '');
    setRepeatUI(r.type, r.days, r.dom, r);
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
      updateRule(r, { title, listId, time, memo, ...rep });
      // まだ完了していない今後分（今日以降の未完了）にも反映
      S.tasks.forEach(x => { if (x.ruleId === r.id && !x.done && x.due >= t) { x.title = title; x.time = time; x.memo = memo; } });
    }
    generateRepeats(); autoMoveToToday();
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
    updateRule(cur, { title, listId: x.listId === TODAY_ID && x.origListId ? x.origListId : x.listId, time, memo, ...rep });
  } else if (rep && !cur) {
    const home = x.listId === TODAY_ID && x.origListId && listById(x.origListId) ? x.origListId : x.listId;
    const r = { id: uid(), title, listId: home, time, memo, ...rep };
    // このタスクを初回分にする：期限がルールに合わなければ次の該当日にそろえる
    let base = x.due || t;
    if (r.type === 'custom' && r.start > base) base = r.start;
    x.due = ruleMatches(r, base) ? base : (nextOccurrence(r, base) || base);
    r.start = r.type === 'custom' ? (r.start || x.due) : x.due;   // 開始日（これより前には出さない）
    r.lastGenerated = x.due < t ? t : x.due;
    x.ruleId = r.id;
    S.rules.push(r);
  } else if (!rep && cur) {
    if (!confirm('繰り返しを止めます。このタスクは通常のタスクとして残ります。よろしいですか？')) return false;
    S.rules = S.rules.filter(z => z.id !== cur.id);
    S.tasks.forEach(z => { if (z.ruleId === cur.id) delete z.ruleId; });
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
  const st = (editing && editing.mode !== 'rule' && fDueVal) || todayKey(), d = parseKey(st);
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
      <span class="ltype ${memo ? 'm' : ''}">${memo ? 'メモ' : 'タスク'}</span>
      <input type="text" value="${esc(l.name)}" data-lname="${l.id}">
      <div class="swatches">${PALETTE.map(c => `<button class="sw ${c === l.color ? 'on' : ''}" style="background:${c}" data-lcolor="${l.id}" data-c="${c}" title="${c}"></button>`).join('')}</div>
      ${l.id === TODAY_ID ? '<span class="frames hint">わくの色：金色（固定）</span>' : `<div class="frames"><span class="hint">わくの色</span>${FRAMES.map(f => `<button class="fr ${(l.frame || '') === f.c ? 'on' : ''} ${f.c ? '' : 'auto'}" style="${f.c ? 'border-color:' + f.c : ''}" data-lframe="${l.id}" data-f="${f.c}" title="${f.n}${f.c ? '' : '（繰り返しのあるリスト＝うすピンク、メモ＝みずいろ）'}">${f.c ? '' : '自'}</button>`).join('')}</div>`}
      <button class="btn small" data-lup="${l.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn small" data-ldown="${l.id}" ${i === S.lists.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="btn small danger" data-ldel="${l.id}" ${l.id === TODAY_ID ? 'disabled title="「今日」は削除できません"' : ''}>削除</button>
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
    const next = nextOccurrence(r, addDays(r.lastGenerated && r.lastGenerated < t ? r.lastGenerated : addDays(t, -1), 1));
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
function exportJSON(label) {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `kyou-task-backup${typeof label === 'string' ? '_' + label : ''}_${keyOf(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importJSON(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = JSON.parse(fr.result);
      if (!Array.isArray(data.lists) || !Array.isArray(data.tasks)) throw new Error('きょうのタスクのバックアップ形式ではありません');
      if (!confirm(`読み込みます。今のデータは置き換わります（クラウドのデータも置き換わります）。\nリスト ${data.lists.length}件／タスク ${data.tasks.length}件／メモ ${(data.memos || []).length}件`)) return;
      S = migrate(data, fr.result); S.rules ||= []; S.memos ||= []; ensureMemoLists();
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
    if (el.dataset.memosave) {
      const m = board.querySelector(`[data-memoadd="${el.dataset.memosave}"]`);
      if (m && m.value.trim()) { const v = m.value; m.value = ''; addMemo(el.dataset.memosave, v); }
      return;
    }
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
  // 新しく作るカスタム繰り返しは「開始日」欄とカスタムの開始日をそろえる
  const dueToStart = () => {
    const cur = editing && editing.mode === 'task' && taskById(editing.id);
    if (customDraft && !(cur && cur.ruleId) && editing.mode !== 'rule') { customDraft.start = fDueVal || todayKey(); syncCustomOption(); }
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
    const cur = editing && editing.mode === 'task' && taskById(editing.id);
    if (editing.mode !== 'rule' && !(cur && cur.ruleId)) setDue(customDraft.start);
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
  document.getElementById('btnBackup').onclick = () => document.getElementById('dlgBackup').showModal();
  document.getElementById('btnItems').onclick = () => { renderItems(); document.getElementById('dlgItems').showModal(); };
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
  document.getElementById('btnExport').onclick = exportJSON;
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
  document.getElementById('tabs').addEventListener('click', e => {
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

/* ---------- 起動 ---------- */
load();
bind();
render();   // まず端末内の控えで表示（クラウドの読み込みが終わったら最新に入れ替わる）
renderLevel();
let openedMsg = false;
document.getElementById('ver').textContent = APP_VERSION;
updateBadge();
document.getElementById('verNew').onclick = updateApp;
document.getElementById('msgwrap').onclick = () => {
  clearTimeout(msgHide); document.getElementById('msgwrap').classList.remove('show');
  if (!document.getElementById('msgOk').hidden) { try { localStorage.setItem('kyou-task-greeted', todayKey()); } catch (e) {} }
};
function drawArt() {
  try {
    Art.drawStage(document.getElementById('stage'));
    Art.drawField(document.getElementById('field'));
    if (!document.getElementById('loginScreen').hidden) Art.drawHero(document.getElementById('loginHero'));
  } catch (e) { console.warn(e); }
}
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
  onCloudReady() {
    const first = !cloudReady && !openedMsg;
    cloudReady = true;
    // 「あらわれた！」は1日1回だけ（この端末で今日はじめて開いたとき）。OKを押すまで出しておく
    let greeted = '';
    try { greeted = localStorage.getItem('kyou-task-greeted') || ''; } catch (e) {}
    if (first && greeted !== todayKey()) {
      openedMsg = true;
      setTimeout(() => {
        const n = S.tasks.filter(x => isCounted(x)).length;
        showMsg(n ? `きょうの タスクが ${n}つ あらわれた！` : 'きょうの タスクは まだ ない。 へいわだ…', true);
      }, 600);
    }
    if (!S.lists.some(l => l.id === TODAY_ID)) S.lists.unshift({ id: TODAY_ID, name: '🔥 今日', color: PALETTE[0] });
    ensureMemoLists();  // 古い形のメモ（列が1つだけ）をメモ用リストに移す
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
    document.getElementById('loginScreen').hidden = !show;
    if (show) setTimeout(() => { try { Art.drawHero(document.getElementById('loginHero')); } catch (e) {} }, 0);
    if (show) { cloudReady = false; document.getElementById('syncStatus').textContent = ''; }
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

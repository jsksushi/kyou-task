/* きょうのタスク　クラウド同期（Firebase：Googleログイン＋Firestore）
   ・データは users/{ログインした人のID}/ の下に、lists / tasks / rules / memos の4種類で1件ずつ保存
   ・画面側（app.js）のデータ S と、クラウドの内容の「差分」だけを書き込む
   ・電波がないときは端末内に貯めておき、つながったら自動で送る（Firestore の機能）
*/
import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, getDocFromServer, getDocsFromServer, setDoc, serverTimestamp, increment,
} from './firebase-sdk.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCslY9b-Sb3qwWtnpInmwlB7XTzPzNrAGg',
  authDomain: 'kyou-task.firebaseapp.com',
  projectId: 'kyou-task',
  storageBucket: 'kyou-task.firebasestorage.app',
  messagingSenderId: '780302572009',
  appId: '1:780302572009:web:387d96fab0d5ba6947d378',
};

const COLS = ['lists', 'tasks', 'rules', 'memos'];
const LINK_KEY = 'kyou-task-linked-uid';
const App = window.App;

const fbApp = initializeApp(firebaseConfig);
const auth = initializeAuth(fbApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
let db;
try {
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
} catch (e) {
  // 端末内キャッシュが使えない環境（プライベートブラウズ等）ではキャッシュなしで動かす
  db = initializeFirestore(fbApp, { ignoreUndefinedProperties: true });
}

/* ---------- 差分計算 ---------- */
// キーの順番に左右されない比較用の文字列
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
const strip = o => { const c = { ...o }; delete c.id; for (const k in c) if (c[k] === undefined) delete c[k]; return c; };

let user = null;
let ready = false;
let unsubs = [];
const synced = Object.fromEntries(COLS.map(c => [c, new Map()]));
const colRef = c => collection(db, 'users', user.uid, c);
const metaRef = () => doc(db, 'users', user.uid, 'meta', 'info');
const statsRef = () => doc(db, 'users', user.uid, 'meta', 'stats');   // けいけんち（exp）
const profileRef = () => doc(db, 'users', user.uid, 'meta', 'profile'); // v3.4 なまえ・しょくぎょう
const itemsRef = () => doc(db, 'users', user.uid, 'meta', 'items');     // たからばこの道具 { counts: {アイテムID: 0か1}, page: 開いたページ数 }

async function commitOps(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    for (const op of ops.slice(i, i + 400)) {
      if (op.del) b.delete(op.ref);
      else if (op.merge) b.set(op.ref, op.data, { merge: true });
      else b.set(op.ref, op.data);
    }
    // オフラインでも端末内には即反映される。送信完了を待たない
    b.commit().catch(err => App.cloudStatus('error', err));
  }
}

// app.js の save() から呼ばれる：変わったものだけクラウドへ
function push(S) {
  if (!ready || !user) return;
  S.lists.forEach((l, i) => { l.order = i; });
  const ops = [];
  for (const c of COLS) {
    const seen = new Set();
    for (const item of S[c]) {
      seen.add(item.id);
      const s = canon(item);
      if (synced[c].get(item.id) === s) continue;
      synced[c].set(item.id, s);
      const ref = doc(colRef(c), item.id);
      if (c === 'tasks' && App.genIds.has(item.id)) {
        // 繰り返しで自動生成したタスクは「完了」状態を上書きしないよう merge で書く（別端末で完了済みでも戻らない）
        const data = strip(item); delete data.done;
        ops.push({ ref, data, merge: true });
        App.genIds.delete(item.id);
      } else {
        ops.push({ ref, data: strip(item) });
      }
    }
    for (const id of [...synced[c].keys()]) {
      if (!seen.has(id)) { synced[c].delete(id); ops.push({ ref: doc(colRef(c), id), del: true }); }
    }
  }
  if (ops.length) commitOps(ops);
}

/* ---------- 初回：この端末のデータをクラウドへ移す ---------- */
async function uploadAll(S, opts = {}) {
  const ops = [];
  S.lists.forEach((l, i) => { l.order = (opts.orderBase || 0) + i; });
  for (const c of COLS) {
    for (const item of (opts.only ? opts.only[c] : S[c]) || []) ops.push({ ref: doc(colRef(c), item.id), data: strip(item) });
  }
  // 初回は送信完了まで待つ
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => b.set(op.ref, op.data));
    await b.commit();
  }
}

async function linkDevice() {
  const S = App.S;
  const hasLocal = S.tasks.length > 0 || S.rules.length > 0 || S.memos.some(m => !/^(✍|✏️) ここはメモ欄です/.test(String(m.text)));
  App.cloudStatus('linking');
  const meta = await getDocFromServer(metaRef());
  if (!meta.exists()) {
    // クラウドが空：この端末のデータをそのまま使う
    if (hasLocal) App.exportJSON('クラウド移行前');
    await uploadAll(S);
    await setDoc(metaRef(), { createdAt: serverTimestamp(), dataVersion: App.DATA_VERSION });
  } else if (hasLocal) {
    const n = S.tasks.length;
    if (confirm(`クラウドにはすでにデータがあります。\nこの端末に入っているデータ（タスク${n}件など）もクラウドに追加しますか？\n\nOK：追加する（同じ名前のリストはまとめます）\nキャンセル：追加せず、クラウドのデータを使う`)) {
      App.exportJSON('クラウド追加前');
      const remoteLists = (await getDocsFromServer(colRef('lists'))).docs.map(d => ({ ...d.data(), id: d.id }));
      const map = {};
      const newLists = [];
      for (const l of S.lists) {
        const same = remoteLists.find(r => r.id === l.id || r.name === l.name);
        if (same) map[l.id] = same.id; else { map[l.id] = l.id; newLists.push(l); }
      }
      const remap = id => map[id] || id;
      const tasks = S.tasks.map(t => ({ ...t, listId: remap(t.listId), origListId: t.origListId ? remap(t.origListId) : undefined }));
      const rules = S.rules.map(r => ({ ...r, listId: remap(r.listId) }));
      const memos = S.memos.filter(m => !/^(✍|✏️) ここはメモ欄です/.test(String(m.text)));
      await uploadAll({ lists: newLists }, { orderBase: remoteLists.length, only: { lists: newLists, tasks, rules, memos } });
    }
  }
  localStorage.setItem(LINK_KEY, user.uid);
}

/* ---------- クラウドの変更を受け取る ---------- */
function listen() {
  stopListening();
  const loaded = new Set();
  for (const c of COLS) {
    const un = onSnapshot(colRef(c), { includeMetadataChanges: c === 'tasks' }, snap => {
      if (c === 'tasks') {
        const m = snap.metadata;
        App.cloudStatus(m.hasPendingWrites ? 'pending' : m.fromCache ? 'offline' : 'synced');
      }
      if (loaded.has(c) && snap.docChanges().length === 0) return;
      const items = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      synced[c] = new Map(items.map(it => [it.id, canon(it)]));
      App.applyRemote(c, items);
      loaded.add(c);
      if (!ready && loaded.size === COLS.length) { ready = true; App.onCloudReady(); }
      else if (ready) App.render();
    }, err => App.cloudStatus('error', err));
    unsubs.push(un);
  }
  // けいけんち：PCとスマホで同じ値を使う。まだ無ければ、今までにクリアしたタスクの数から始める
  let statsChecked = false;
  unsubs.push(onSnapshot(statsRef(), snap => {
    if (snap.exists()) { App.setExp(snap.data().exp || 0); return; }
    if (statsChecked || snap.metadata.fromCache) return;
    statsChecked = true;
    const start = Math.max(App.EXP, App.S.tasks.filter(t => t.done).length);
    setDoc(statsRef(), { exp: start }, { merge: true }).catch(err => App.cloudStatus('error', err));
  }, err => App.cloudStatus('error', err)));
  // v3.4 プロフィール：まだクラウドに無ければ、この端末の内容を送る
  let profileChecked = false;
  unsubs.push(onSnapshot(profileRef(), snap => {
    if (snap.exists()) { App.setProfile(snap.data()); return; }
    if (profileChecked || snap.metadata.fromCache) return;
    profileChecked = true;
    saveProfile(App.PROFILE);
  }, err => App.cloudStatus('error', err)));
  // どうぐ（v3.5.1：まだ0からやり直していなければ、サーバーの最新を確認してから1回だけリセット）
  unsubs.push(onSnapshot(itemsRef(), snap => {
    if (!snap.exists()) return;
    const d = snap.data();
    if (!d.reset351) { if (!snap.metadata.fromCache) App.resetItems(); return; }
    App.setItems(d.counts || {}, d.page);
  }, err => App.cloudStatus('error', err)));
}
function saveProfile(p) {
  if (!user) return;
  setDoc(profileRef(), { name: p.name, job: p.job }, { merge: true }).catch(err => App.cloudStatus('error', err));
}
// v3.5 どうぐの何ページめまで開いたか
function setItemPage(n) {
  if (!user) return;
  setDoc(itemsRef(), { page: n, reset351: true }, { merge: true }).catch(err => App.cloudStatus('error', err));
}
// どうぐ：持っている＝1／返した＝0 をそのまま書く
function setItem(id, v) {
  if (!user) return;
  setDoc(itemsRef(), { counts: { [id]: v }, reset351: true }, { merge: true }).catch(err => App.cloudStatus('error', err));
}
// どうぐを0からやり直す（中身ごと置き換える）
function resetItems() {
  if (!user) return;
  setDoc(itemsRef(), { counts: {}, page: 1, reset351: true }).catch(err => App.cloudStatus('error', err));
}
// 完了したとき（+1）・もどしたとき（-1）。2台で同時に押しても数がずれない足し算で送る
function addExp(d) {
  if (!user) return;
  setDoc(statsRef(), { exp: increment(d) }, { merge: true }).catch(err => App.cloudStatus('error', err));
}
function stopListening() { unsubs.forEach(u => u()); unsubs = []; ready = false; }

/* ---------- ログイン ---------- */
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

async function login(useRedirect) {
  try {
    if (useRedirect) await signInWithRedirect(auth, provider);
    else await signInWithPopup(auth, provider);
  } catch (e) {
    if (!useRedirect && ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      return signInWithRedirect(auth, provider);
    }
    if (e.code !== 'auth/popup-closed-by-user') App.loginError(e);
  }
}

getRedirectResult(auth).catch(e => App.loginError(e));

onAuthStateChanged(auth, async u => {
  user = u;
  if (!u) { stopListening(); App.showLogin(true); return; }
  App.showLogin(false);
  App.setAccount(u.email || '');
  try {
    if (localStorage.getItem(LINK_KEY) !== u.uid) await linkDevice();
    listen();
  } catch (e) {
    App.cloudStatus('error', e);
    App.loginError(e);
  }
});

window.Cloud = {
  push,
  addExp,
  saveProfile,
  setItem,
  resetItems,
  setItemPage,
  login,
  logout: () => { if (confirm('ログアウトします。よろしいですか？')) signOut(auth); },
};

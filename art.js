/* きょうのタスク　ドット絵（ヘッダーの風景・下のフィールド帯）
   キャラ・モンスターは定番のRPGの職業をもとにしたオリジナル（素材サイトの画像は使っていない）。
   風景の一部（雲・木・キラキラ・ドット文字）は「組織比較ツール」の描き方を移植 */
'use strict';
window.Art = (() => {
  const blend = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  function prep(cv) { const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1; cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.imageSmoothingEnabled = false; return [g, r.width, r.height]; }
  let g;
  const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  function grad(x, y, w, h, ct, cb, steps = 8, px = 4) {
    for (let i = 0; i < steps; i++) {
      const col = blend(ct, cb, i / (steps - 1)); const y0 = y + Math.floor(h * i / steps), y1 = y + Math.floor(h * (i + 1) / steps); P(x, y0, w, y1 - y0, col);
      if (i > 0) { const prev = blend(ct, cb, (i - 1) / (steps - 1)); for (let dx = x; dx < x + w; dx += px) if (Math.floor(dx / px) % 2 === 0) P(dx, y0, px, px, prev); }
    }
  }
  const K = '#1a1030';

  /* ---- キャラ・モンスター（1文字＝1ドット、パレットで色付け） ---- */
  const SPR = {
    // ▼ v3.1〜 メインのパーティ（v3.7.1：騎士は頭と体の位置をそろえて、斜めに見えないよう描き直し）（2頭身・太い輪郭。ドット絵素材サイトの雰囲気に寄せたオリジナル）
knight:["..k...kkkk......",".kxk.khhhhk.....",".kxkkhhhhhhk....",".kxkkbbbbbbk....",".kxkksessesk....",".kxkkssssssk....","kgggkkkkkkkk....",".kgkkwccccwkkkkk",".kskkwccccwkRSRk","....kwccccwkRSRk","....kswwwwskRRRk","....kcccccck.kkk","....kcckkcck....","....kffkkffk....","....kkkkkkkk...."],
 wizard:[".......kk.......","......kmmk...kok",".....kmmmmk..kok","....kmmmmmmk..n.","kmmmMMMMMMmmmkn.",".kkkkkkkkkkkk.n.","...ksessesk...n.","...kwwwwwwk...n.","..kmwwwwwwmk.ksk",".kmmmwwwwmmmkkn.",".kmmmmwwmmmmk.n.",".kmmmmmmmmmmk.n.","kmmmmmmmmmmmmkn.","kkkkkkkkkkkkkkn.","...kf...kf....n."],
 priest:[".....kkkkkk.....","....khhhhhhk....","...kcccyyccck...","...khsssssshk...","...khsesseshk...","...khsssssshk...","..khhksssskhhk..","..khkwwgwwwkhk..","..khwwwgwwwwhk..","..kswwwgwwwwsk..","..kwwwwgwwwwwk..",".kwwwwwgwwwwwwk.",".kggggggggggggk.",".kkkkkkkkkkkkkk.","....kf....kf...."],
 archer:["......kkkk......",".....khhhhk.....","..k.khhhhhhk....",".knkhhhhhhhhk...",".kntkhsesseHk...","kn.tkhssssshk...","kn.tkkkkkkkkk...","kn.tkcccccccck..","knttscccccccsk..","kn.tkccyyccck...",".knt.kccccck....","..k..kcckcck....",".....kffkffk....",".....kkkkkkk...."],
    // ▼ v3.0 の初代パーティ（いまは未使用。残しておくと色ちがいなどに使える）
    hero: ['...kkkkk......', '..khhhhhk.....', '.khhhhhhhk....', '.kyyyyyyyk....', '.khsseseshk...', '.kcsssssssk...', 'kcckkkkkkk..w.', 'kckttyttttk.w.', 'kckttttttsk.w.', 'kckddddddskgwg', 'kckttttttk..g.', '.kkppppppk....', '..kppkkppk....', '..kppk.kppk...', '..kffk.kffk...', '..kkkk.kkkk...'],
    mage: ['......k.......', '.....kmk......', '.....kmmk.....', '....kmmmk.....', '....kmmmmk.ooo', '...kmmymmmkooo', '.kkkkkkkkkk.n.', '...khsesehkn..', '...kssssssskn.', '...kkmmmmmkkn.', '..kmmmmmmmmsn.', '..kmmyyyymmkn.', '..kmmmmmmmmkn.', '.kmmmmmmmmmmkn', '.kmmmmmmmmmmkn', '.kkkkkkkkkkkkn', '...kf..kf...n.'],
    warrior: ['....rrr.......', '...kaaak......', '..kaaaaak.....', '.kaaaaaaak.x..', '.kAseseAAk.xx.', '.kAsssssAk.xxx', '..kkkkkkk..n..', '.kaaAaaAaakn..', 'kaaaaaaaaaasn.', 'kAaaaaaaaaAkn.', '.kAAAAAAAAkn..', '..kppppppk.n..', '..kppkkppk.n..', '..kppk.kppk...', '..kffk.kffk...', '..kkkk.kkkk...'],
    cleric: ['....kkkkk.....', '...kwwwwwk....', '..kwwgwwwwk...', '..kwhhhhhwk...', '..kwseseswk...', '..kwssssswk...', '...kkwwwkk....', '..kwwwgwwwk...', '.kswwwgwwwsk..', '.kwwwwgwwwwk..', '.kwwwwgwwwwk..', '.kggggggggggk.', '.kwwwwwwwwwwk.', '.kkkkkkkkkkkk.', '...kf...kf....', '...kk...kk....'],
    blob: ['......ll....', '.....kl.....', '...kkkkkk...', '..kggggggk..', '.kgwggggggk.', 'kggeggggeggk', 'kggggggggggk', 'kggggmmggggk', '.kGGGGGGGGk.', '..kkkkkkkk..'],
    bat: ['kk..........kk', 'kpk..kkkk..kpk', 'kppkkppppkkppk', 'kpppeppppepppk', '.kppppwwppppk.', '..kpkppppkpk..', '...k.kkkk.k...'],
    ghost: ['...kkkkkk...', '..kwwwwwwk..', '.kwwwwwwwwk.', 'kwwewwwwewwk', 'kwwwwwwwwwwk', 'kwwwwmmwwwwk', 'kwwwwwwwwwwk', 'kwwwwwwwwwwk', 'kwkwwkkwwkwk', '.k.kk..kk.k.'],
    chest: ['.kkkkkkkkkk.', 'kbbbbbbbbbbk', 'kbyybbbbyybk', 'kkkkkyykkkkk', 'kbbbbyybbbbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk'],
    chestOpen: ['.kkkkkkkkkk.', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk', '.kwyyyyyywk.', 'kkkkkyykkkkk', 'kbbbbyybbbbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk'],
  };
  const PAL = {
    knight: { k: K, x: '#E8EEF8', g: '#C79A00', h: '#8a4a20', b: '#D23B3B', s: '#F6D2B0', e: K, w: '#F4F4F4', c: '#3A6FD8', R: '#C79A00', S: '#3A6FD8', f: '#5a4030' },
    wizard: { k: K, m: '#7B4FC9', M: '#4a2d86', s: '#F6D2B0', e: K, w: '#F4F4F4', n: '#8a5a2a', o: '#7CE0FF', f: '#3a2a20' },
    priest: { k: K, h: '#F6D24A', c: '#C79A00', y: '#D23B3B', s: '#F6D2B0', e: K, w: '#F4F4F4', g: '#F2A6C6', f: '#c8a060' },
    archer: { k: K, h: '#3EA34A', H: '#1F6E2C', s: '#F6D2B0', e: K, c: '#5BD15B', y: '#8a5a2a', n: '#8a5a2a', t: '#ffffff', f: '#5a4030' },
    hero: { k: K, h: '#8a4a20', s: '#F2C9A0', e: K, y: '#FCD000', c: '#D23B3B', t: '#3A6FD8', d: '#24489a', w: '#E8EEF8', g: '#C79A00', p: '#5a4030', f: '#3a2a20' },
    mage: { k: K, m: '#7B4FC9', y: '#FCD000', o: '#7CE0FF', n: '#8a5a2a', h: '#d0d0d8', s: '#F2C9A0', e: K, f: '#3a2a20' },
    warrior: { k: K, r: '#D23B3B', a: '#C8D0E0', A: '#7880A0', s: '#E8B48A', e: K, x: '#E8EEF8', n: '#8a5a2a', p: '#5a4030', f: '#3a2a20' },
    cleric: { k: K, w: '#F4F4F4', g: '#3EA34A', h: '#F6D24A', s: '#F2C9A0', e: K, f: '#3a2a20' },
    blob: { k: K, l: '#7CE38A', g: '#5BD15B', G: '#2f8f3a', w: '#ffffff', e: K, m: '#D23B3B' },
    bat: { k: K, p: '#8a5ad0', e: '#FCD000', w: '#ffffff' },
    ghost: { k: K, w: '#EAF2FF', e: K, m: '#7a7aa0' },
    chest: { k: K, b: '#B5673A', y: '#FCD000' },
    chestOpen: { k: K, b: '#B5673A', y: '#FCD000', w: '#fffbe0' },
  };
  function sprite(name, x, y, u = 3) { const rows = SPR[name], pal = PAL[name]; rows.forEach((row, ry) => [...row].forEach((ch, rx) => { const c = pal[ch]; if (c) P(x + rx * u, y + ry * u, u, u, c); })); }
  const H = n => SPR[n].length;

  /* ---- 背景パーツ ---- */
  function cloud(x, y, s = 1) { const u = Math.max(3, Math.floor(7 * s)); P(x + 2 * u, y, 2 * u, u, '#fff'); P(x + 5 * u, y, 2 * u, u, '#fff'); P(x + u, y + u, 6 * u, u, '#fff'); P(x, y + 2 * u, 8 * u, u, '#fff'); P(x, y + 3 * u, 8 * u, u, '#CBDDF7'); }
  function mountain(x, base, w, h, col, snow) { const steps = Math.floor(h / 6); for (let i = 0; i < steps; i++) { const ww = w * (1 - i / steps); P(x + (w - ww) / 2, base - (i + 1) * 6, ww, 6, i > steps * 0.72 && snow ? '#fff' : col); } }
  function pine(x, y, u = 3) { const c = '#1f6e2c', l = '#2f8f3a'; [[2, 0, 1], [1, 1, 3], [2, 2, 1], [1, 3, 3], [0, 4, 5], [1, 5, 3], [0, 6, 5]].forEach(([a, b, w], i) => P(x + a * u, y + b * u, w * u, u, i % 2 ? l : c)); P(x + 2 * u, y + 7 * u, u, 2 * u, '#6E3C18'); }
  function castle(x, base, u = 4) {
    const W = '#B8B8C8', D = '#7a7a92', R = '#C84C0C';
    P(x, base - 14 * u, 22 * u, 14 * u, W); for (let i = 0; i < 22; i += 2) P(x + i * u, base - 15 * u, u, u, W);
    [[0, 20], [16, 24]].forEach(([tx, th]) => {
      P(x + tx * u, base - th * u, 6 * u, th * u, W); P(x + tx * u, base - th * u, 6 * u, u, D); for (let i = 0; i < 6; i += 2) P(x + (tx + i) * u, base - (th + 1) * u, u, u, W);
      for (let r = 0; r < 4; r++) P(x + (tx + r * 0.75) * u, base - (th + 2 + r) * u, (6 - r * 1.5) * u, u, R); P(x + (tx + 2.5) * u, base - (th + 8) * u, u / 2, 3 * u, K); P(x + (tx + 3) * u, base - (th + 8) * u, 2 * u, u, '#FCD000');
    });
    P(x + 9 * u, base - 6 * u, 4 * u, 6 * u, '#3a2a20'); P(x + 9 * u, base - 7 * u, 4 * u, u, D); P(x + 3 * u, base - 10 * u, u, 2 * u, K); P(x + 18 * u, base - 14 * u, u, 2 * u, K);
  }
  function sparkle(x, y, u = 3, color = '#FCD000') { const t = { 1: color, 2: blend(color, '#ffffff', 0.5), 3: '#ffffff' }; ['00100', '01210', '12321', '01210', '00100'].forEach((r, ry) => [...r].forEach((ch, rx) => { if (t[ch]) P(x + rx * u, y + ry * u, u, u, t[ch]); })); }
  function flower(x, y, u = 3, c = '#FCD000') { P(x + u, y + 2 * u, u, 3 * u, '#1F6E2C'); [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([a, b]) => P(x + (a + 1) * u, y + (b + 1) * u, u, u, c)); P(x + u, y + u, u, u, '#fff'); }

  /* ---- ドット文字（5x7） ---- */
  const F = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'], K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };
  // v3.9.1：空白は半分の幅にする（「MY TASK」の間が全角スペースのように広く見えていたため）
  function word(x, y, text, s) { let gx = x - 6 * s, adv = 6 * s; [...text].forEach(ch => { gx += adv; adv = ch === ' ' ? 3 * s : 6 * s; const gl = F[ch] || F[' ']; gl.forEach((row, ry) => [...row].forEach((b, rx) => { if (b === '1') { const px = gx + rx * s, py = y + ry * s; P(px + s, py + s, s, s, K); P(px, py, s, s, ry < 3 ? '#FFE680' : '#FCD000'); } })); }); }
  function outlined(x, y, text, size) { g.font = `${size}px "DotGothic16","MS Gothic",monospace`; g.textBaseline = 'middle'; g.fillStyle = K; [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2]].forEach(([a, b]) => g.fillText(text, x + a, y + b)); g.fillStyle = '#fff'; g.fillText(text, x, y); }

  /* ---- ヘッダー：フィールド（山・城・森・パーティ） ---- */
  // opt.reserve：左からこの位置（px）までは「きょうの よてい」の窓が乗るので、キャラを置かない（v3.7）
  function drawStage(cv, opt = {}) {
    let w, h; [g, w, h] = prep(cv); const reserve = opt.reserve || 0; const gy = h - 40, wide = w >= 900, u = 3;
    // v3.9：opt.fx のときは、キャラと雲は描かずに位置だけ返す（上に重ねた小さな絵をCSSで動かすため）
    const fx = opt.fx ? { actors: [], clouds: [] } : null;
    const put = (n, x, y) => fx ? fx.actors.push({ name: n, x, y, u }) : sprite(n, x, y, u);
    const cl = (x, y, sc) => fx ? fx.clouds.push({ x, y, s: sc }) : cloud(x, y, sc);
    grad(0, 0, w, gy, '#3f6fd8', '#9cc8ff', 9);
    cl(w * 0.55, 18, 1.1); cl(w * 0.78, 46, 0.8); if (wide) cl(w * 0.36, 60, 0.7);
    sparkle(w * 0.5, 70, 3);
    for (let x = -40; x < w; x += wide ? 170 : 140) mountain(x, gy, wide ? 220 : 180, wide ? 78 : 60, '#5b6fa8', true);
    // v3.7：左に「きょうの よてい」、右上にプロフィールの窓が乗る。パーティ（4人）は必ず出し、
    //       予定の窓のすぐ右から並べる。お城とモンスターは、残りの場所に入るときだけ描く
    const right = w - 250;                                   // ここから右はプロフィールの窓
    const left = reserve ? reserve + 12 : w * 0.40 - 168;     // 僧侶の位置
    const kx = left + 156;                                   // 騎士の位置（4人の右はし）
    let cx = Math.max(w * 0.40 + 200, w - 380);
    if (reserve) cx = Math.max(cx, kx + 48 + 90);            // パーティ＋モンスターの右へ
    const showCastle = wide && cx + 88 <= right + 40;
    if (showCastle) castle(cx, gy, 4);
    for (let x = wide ? Math.max(w * 0.42, reserve + 10) : w * 0.55; x < (wide ? (showCastle ? cx - 14 : right) : w); x += 18) pine(x, gy - 30, 3);
    grad(0, gy, w, h - gy, '#3EA34A', '#1F6E2C', 4); P(0, gy - 4, w, 5, '#5BD15B'); P(0, gy + 16, w, 8, '#c8a060'); P(0, gy + 24, w, 3, '#9a7a40');
    if (wide) {
      [['priest', 0], ['archer', 52], ['wizard', 104], ['knight', 156]].forEach(([n, dx]) => put(n, left + dx, gy + 20 - H(n) * u));
      g.font = '14px "DotGothic16",monospace'; g.fillStyle = '#fff'; g.strokeStyle = K; g.lineWidth = 3; g.strokeText('！', kx + 52, gy - 36); g.fillText('！', kx + 52, gy - 36);
      const mEnd = showCastle ? cx - 4 : right;               // モンスターはお城（またはプロフィールの窓）の手前に入るときだけ
      if (kx + 70 + 36 <= mEnd) put('blob', kx + 70, gy + 20 - H('blob') * u);
      if (kx + 100 + 42 <= mEnd) put('bat', kx + 100, gy - 48);
    } else { put('knight', 40, gy + 20 - H('knight') * u); if (!reserve || reserve < 90) put('blob', 100, gy + 20 - H('blob') * u); }
    [w * 0.08, w * 0.2, w * 0.3].forEach((x, i) => { if (!reserve || x > reserve || x < 30) flower(x, gy - 10, 3, i % 2 ? '#F2A6C6' : '#FCD000'); });
    word(26, 20, 'MY TASK', wide ? 7 : Math.max(2, Math.min(4, Math.floor((w - 220) / 42))));
    return fx ? { ...fx, w, h } : null;
  }
  /* ---- 下のフィールド帯 ---- */
  // v3.9：opt.fx のときは、スライム・白いやつ・コウモリは描かずに位置だけ返す（宝箱・木・花はそのまま描く）
  function drawField(cv, opt = {}) {
    let w, h; [g, w, h] = prep(cv); const gy = h - 30; const actors = [];
    grad(0, 0, w, gy, '#2a3a8a', '#5b7fd8', 5); for (let x = 30; x < w; x += 90) P(x + (x * 7) % 40, (x * 13) % 40, 2, 2, '#fff');
    grad(0, gy, w, h - gy, '#3EA34A', '#1F6E2C', 3); P(0, gy - 3, w, 4, '#5BD15B');
    const cast = ['blob', 'ghost', 'chest', 'bat', 'blob', 'ghost']; let i = 0;
    for (let x = 40; x < w - 40; x += 160) { const n = cast[i++ % cast.length]; const y = n === 'bat' ? gy - 46 : gy - H(n) * 3 + 2; if (opt.fx && n !== 'chest') actors.push({ name: n, x, y, u: 3 }); else sprite(n, x, y, 3); pine(x + 80, gy - 26, 2); flower(x + 120, gy - 8, 2, '#F2A6C6'); }
    return opt.fx ? { actors, clouds: [], w, h } : null;
  }
  /* ---- ログイン画面用：勇者1人 ---- */
  function drawHero(cv) { let w, h; [g, w, h] = prep(cv); sprite('knight', (w - 16 * 4) / 2, (h - 15 * 4) / 2, 4); }
  /* ---- v3.4 プロフィール窓・しょくぎょう選び用：キャラ1人を小さなキャンバスに描く ---- */
  function drawChar(cv, name, u = 3) {
    if (!SPR[name]) name = 'knight';
    const d = window.devicePixelRatio || 1, W = 16 * u, Hh = 15 * u;
    cv.width = W * d; cv.height = Hh * d; cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
    g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, Hh);
    sprite(name, 0, Hh - H(name) * u, u);
  }
  /* ---- プロフィール用：その場で歩く2コマ（ふつうの絵／体を1ドット上げた絵を横に並べて描く。CSSで切り替える） ---- */
  // v3.7.1：片足だけ上げると体が斜めに見えたので、「体を1ドット上げて、足は地面に残す」上下の動きにした（左右対称）
  function bobUp(rows) {
    const n = rows.length;
    return rows.slice(1, n - 2).concat([rows[n - 3], rows[n - 2], rows[n - 1]]);
  }
  function drawWalk(cv, name, u = 3) {
    if (!SPR[name]) name = 'knight';
    const d = window.devicePixelRatio || 1, W = 16 * u, Hh = 15 * u;
    cv.width = W * 2 * d; cv.height = Hh * d; cv.style.width = W * 2 + 'px'; cv.style.height = Hh + 'px';
    g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W * 2, Hh);
    const pal = PAL[name], top = Hh - H(name) * u;
    [SPR[name], bobUp(SPR[name])].forEach((rows, f) =>
      rows.forEach((row, ry) => [...row].forEach((ch, rx) => { const c = pal[ch]; if (c) P(f * W + rx * u, top + ry * u, u, u, c); })));
  }
  /* ---- v3.5 どうぐのアイコン（12x12。冒険の道具っぽい見た目のオリジナル） ---- */
  const IC = {
    rod: ['........kkk.', '.......kyyyk', '.......kywyk', '.......kyyyk', '.......nkkk.', '......nk....', '.....nk.....', '....nk......', '...nk.......', '..nk........', '.nk.........', '.k..........'],
    boomerang: ['..kkkk......', '.kbbbbk.....', '.kbwbbbk....', '..kkbbbbk...', '....kbbbbk..', '.....kbbbk..', '....kbbbbk..', '...kbbbbk...', '..kbbbbk....', '.kbwbbk.....', '.kbbbk......', '..kkk.......'],
    lamp: ['.....kk.....', '....k..k....', '...kkkkkk...', '..kyyyyyyk..', '..kyywwyyk..', '..kywwwwyk..', '..kyywwyyk..', '..kyyyyyyk..', '...kkkkkk...', '..kggggggk..', '.kggggggggk.', '.kkkkkkkkkk.'],
    scroll: ['.kkkkkkkkkk.', 'knkwwwwwwknk', 'knkwwwwwwknk', '.kwkkkkkkwk.', '.kwwwwwwwwk.', '.kwkkkkkwwk.', '.kwwwwwwwwk.', '.kwkkkkkkwk.', '.kwwwwwwwwk.', 'knkwwwwwwknk', 'knkwwwwwwknk', '.kkkkkkkkkk.'],
    shieldNote: ['.kkkkkkkkkk.', 'kbbbbbbbbbbk', 'kbyyybbbbbbk', 'kbyyybbyyybk', 'kbbbbbbyyybk', 'kbbbbbbbbbbk', 'kbbyyybbbbbk', '.kbyyybbbbk.', '.kbbbbbbbbk.', '..kbbbbbbk..', '...kbbbbk...', '....kkkk....'],
    quill: ['.........kkk', '........kwwk', '.......kwwwk', '......kwwwk.', '.....kwwwk..', '....kwwwk...', '...kwwwk....', '...kwwk.....', '..kgkk......', '..kgk.......', '.kgk........', '.kk.........'],
    fishing: ['kk..........', 'knk.........', '.knk.....k..', '..knk....k..', '...knk...k..', '....knk..k..', '.....knk.k..', '......knkk..', '.......kkk..', '........kwk.', '........kwk.', '.........k..'],
    bag: ['....kkkk....', '...kyyyyk...', '....kkkk....', '...knnnnk...', '..knnnnnnk..', '.knnnnnnnnk.', '.knnnyynnnk.', '.knnnyynnnk.', '.knnnnnnnnk.', '.knnnnnnnnk.', '..knnnnnnk..', '...kkkkkk...'],
    bell: ['.....kk.....', '....kyyk....', '...kyyyyk...', '...kywyyk...', '..kyywyyyk..', '..kyywyyyk..', '..kyyyyyyk..', '.kyyyyyyyyk.', '.kkkkkkkkkk.', '.....kk.....', '....kyyk....', '.....kk.....'],
    key: ['............', '............', '.kkk........', 'kyyyk.......', 'kykykkkkkkk.', 'kyyyyyyyyyyk', 'kykykkkkykyk', 'kyyyk...kkk.', '.kkk........', '............', '............', '............'],
    boot: ['............', '...kkkkk....', '...krrrk....', '...krwrk....', '...krrrk....', '...krrrk....', '...krrrrkk..', '...krrrrrrk.', '..krrrrrrrrk', '..kwwwwwwwwk', '..kkkkkkkkkk', '............'],
    pick: ['............', '..kkkkkkkk..', '.kssssssssk.', 'ksskknnkkssk', '.kk.knnk.kk.', '....knnk....', '....knnk....', '....knnk....', '....knnk....', '....knnk....', '....knnk....', '....kkkk....'],
    broom: ['.........kk.', '........knk.', '.......knk..', '......knk...', '.....knk....', '....knk.....', '...kkkk.....', '..kyyyyk....', '.kyyyyyk....', 'kyyyyyk.....', 'kyyyyk......', 'kkkkk.......'],
    compass: ['...kkkkkk...', '..kwwwwwwk..', '.kwwwrwwwwk.', 'kwwwwrrwwwwk', 'kwwwwrrwwwwk', 'kwwwwkkwwwwk', 'kwwwwbbwwwwk', 'kwwwwbbwwwwk', '.kwwwbwwwwk.', '..kwwwwwwk..', '...kkkkkk...', '............'],
    cape: ['...kkkkkk...', '..kmmmmmmk..', '.kmmkkkkmmk.', '.kmmmmmmmmk.', 'kmmmmmmmmmmk', 'kmmmmmmmmmmk', 'kmmmmmmmmmmk', 'kmmmmmmmmmmk', 'kmMmmMmmMmmk', 'kMMkMMkMMkMk', 'kk.kk.kk.kkk', '............'],
    potion: ['....kkkk....', '....knnk....', '.....kk.....', '....kwwk....', '...kwppwk...', '..kwppppwk..', '.kpwppppppk.', '.kppppppppk.', '.kppppppppk.', '..kppppppk..', '...kkkkkk...', '............'],
    gear: ['.....kk.....', '..k.kssk.k..', '.kskssssksk.', '..kssssssk..', '.ksssskssskk', 'kssskwwkssk.', '.ksskwwksssk', 'kksssksssk..', '..kssssssk..', '.kskssssksk.', '..k.kssk.k..', '.....kk.....'],
    helmet: ['.....kk.....', '....krrk....', '..kkkkkkkk..', '.kswssssssk.', 'kswssssssssk', 'kssssssssssk', 'kskkkkkkkksk', 'kskbbkkbbksk', 'kssssssssssk', '.kssskksssk.', '..kkk..kkk..', '............'],
    crown: ['............', 'k....kk....k', 'kk..kyyk..kk', 'kyk.kyyk.kyk', 'kyykyyyykyyk', 'kyyyyryyyyyk', 'kyyyrrryyyyk', 'kyyyyryyyyyk', 'kyyyyyyyyyyk', 'kkkkkkkkkkkk', '............', '............'],
    sword: ['..........kk', '.........kwk', '........kwwk', '.......kwwk.', '......kwwk..', '.....kwwk...', '..k.kwwk....', '..kkkwk.....', '...kyk......', '..kgkkk.....', '.kgk..k.....', '.kk.........'],
    flute: ['............', '............', '............', '............', 'kkkkkkkkkkkk', 'knnknnknnknk', 'knnnnnnnnnnk', 'kkkkkkkkkkkk', '............', '............', '............', '............'],
    bow: ['kkk.........', 'knnk........', '.knnk.......', '.kk.nk......', '.k...nk..kk.', '.kssssssskwk', '.k....nk.kk.', '.k...nk.....', '.kk.nk......', '.knnk.......', 'knnk........', 'kkk.........'],
    torch: ['....k..k....', '...krkkrk...', '...krryrk...', '..kryyyrk...', '..kryyyrk...', '...kryrk....', '....kkkk....', '....knnk....', '....knnk....', '....knnk....', '....knnk....', '....kkkk....'],
    bottle: ['....kkkk....', '....knnk....', '.....kk.....', '....kwwk....', '...kwbbwk...', '..kwbbbbwk..', '.kbwbbbbbbk.', '.kbbbbwbbbk.', '.kbbbbbbbbk.', '..kbbbbbbk..', '...kkkkkk...', '............'],
    chain: ['............', 'kkkk........', 'kssk........', 'kskkkk......', 'kkkssk......', '..ksskkk....', '..kkkssk....', '....kskkkk..', '....kkkssk..', '......kssk..', '......kkkk..', '............'],
    tent: ['............', '.....kk.....', '....kgck....', '...kggcck...', '..kgggccck..', '.kggggcccck.', '.kgggkkccck.', 'kgggk..kccck', 'kggk....kcck', 'kkkk....kkkk', '............', '............'],
    map: ['.kkkkkkkkkk.', 'kttttttttttk', 'ktbbttttkttk', 'ktbbbttkkttk', 'kttbbtttttk.', 'kttttkttttk.', '.ktttkttrtk.', '.kttttktrrtk', '.ktttttkttk.', 'kttttttttttk', 'kttttttttttk', '.kkkkkkkkkk.'],
    glasses: ['............', '............', '............', '.kkkk..kkkk.', 'kbbbbkkbbbbk', 'kbwbbk.kbwbk', 'kbbbbk.kbbbk', '.kkkk...kkk.', '............', '............', '............', '............'],
    horn: ['...........k', '..........kk', '.........kwk', '........kwwk', '......kkwwk.', '....kkyywk..', '..kkyyyyk...', '.kyyyyykk...', 'knyyykk.....', 'knnkk.......', '.kk.........', '............'],
    stone: ['............', '....kkkk....', '...kwbbbk...', '..kwbbbbbk..', '.kwbbbbbbbk.', '.kbbbbbbbbk.', '.kbbbbbbbbk.', '.kbbbbbbbck.', '..kbbbbbck..', '...kbbcck...', '....kkkk....', '............'],
    glove: ['...k.k.k....', '..kskskskk..', '..kskskskk..', '..kssssssk..', '..kssssssk.k', '..ksssssssk.', '..kssssssk..', '..kssssssk..', '..kssssssk..', '..kbbbbbbk..', '..kbbbbbbk..', '..kkkkkkkk..'],
    feather: ['..........kk', '........kkwk', '.......kwwwk', '......kwwwk.', '.....kwwwwk.', '....kwwwwk..', '...kwwwwk...', '..kwwwwk....', '..kwwkk.....', '.kkkk.......', '.k..........', 'k...........'],
    shieldBack: ['.kkkkkkkkkk.', 'kggggggggggk', 'kggggwwggggk', 'kgggwwwwgggk', 'kggggwwggggk', 'kgwwwwwwwwgk', 'kggggwwggggk', '.kgggwwgggk.', '.kggggggggk.', '..kggggggk..', '...kggggk...', '....kkkk....'],
    flag: ['kk..........', 'krkkkkk.....', 'krrrrrrkk...', 'krrrrrrrrk..', 'krrrrrrkk...', 'krkkkkk.....', 'kk..........', 'kk..........', 'kk..........', 'kk..........', 'kk..........', 'kk..........'],
    pot: ['............', '...kkkkkk...', '..kmmmmmmk..', '...kkkkkk...', '..kmmmmmmk..', '.kmmmmmmmmk.', 'kmmwmmmmmmmk', 'kmmmmmmmmmmk', 'kmmmmmmmmmmk', '.kmmmmmmmmk.', '..kkkkkkkk..', '............'],
    magnifier: ['..kkkk......', '.kwbbbk.....', 'kwbbbbbk....', 'kbbbbbbk....', 'kbbbbbbk....', 'kbbbbbbk....', '.kbbbbk.....', '..kkkkkk....', '......knk...', '.......knk..', '........knk.', '.........kk.'],
    hourglass: ['kkkkkkkkkkkk', '.knnnnnnnnk.', '..kyyyyyyk..', '...kyyyyk...', '....kyyk....', '.....kk.....', '.....kk.....', '....kwyk....', '...kwwyyk...', '..kwyyyyyk..', '.knnnnnnnnk.', 'kkkkkkkkkkkk'],
    book: ['.kkkkkkkkkk.', 'krrrrrrrrrwk', 'krryyyyyrrwk', 'krryrrryrrwk', 'krryyyyyrrwk', 'krrrrrrrrrwk', 'krrrrrrrrrwk', 'krrrrrrrrrwk', 'krrrrrrrrrwk', 'krrrrrrrrrwk', 'kkkkkkkkkkkk', '............'],
    wings: ['............', 'kk........kk', 'kwk......kwk', 'kwwk....kwwk', 'kwwwk..kwwwk', 'kwwwwkkwwwwk', '.kwwwkkwwwk.', '.kwwk..kwwk.', '..kwk..kwk..', '...k....k...', '............', '............'],
  };
  // アイコンの形 → 色
  const ICP = {
    rod: { y: '#c05cff', w: '#ffffff', n: '#8a5a2a' }, boomerang: { b: '#3a9be8', w: '#bfe4ff' }, lamp: { y: '#ffd84a', w: '#fffbe0', g: '#9a7a40' },
    scroll: { w: '#f4ecd0', n: '#b5673a' }, shieldNote: { b: '#3a6fd8', y: '#ffe14a' }, quill: { w: '#ffffff', g: '#c79a00' },
    fishing: { n: '#8a5a2a', w: '#ffffff' }, bag: { n: '#b5673a', y: '#ffd84a' }, bell: { y: '#ffd84a', w: '#ffffff' },
    key: { y: '#ffd84a' }, boot: { r: '#c84c0c', w: '#e8d0a0' }, pick: { s: '#c8d0e0', n: '#8a5a2a' }, broom: { n: '#8a5a2a', y: '#e8c050' },
    compass: { w: '#f4f4f4', r: '#e23b3b', b: '#3a6fd8' }, cape: { m: '#7b4fc9', M: '#4a2d86' }, potion: { n: '#8a5a2a', w: '#ffffff', p: '#5bd15b' },
    gear: { s: '#a8b0c0', w: '#e8eef8' }, helmet: { r: '#e23b3b', s: '#c8d0e0', w: '#ffffff', b: '#1a1030' }, crown: { y: '#ffd84a', r: '#e23b3b' },
    sword: { w: '#e8eef8', y: '#ffd84a', g: '#3a6fd8' }, flute: { n: '#c08040' }, bow: { n: '#8a5a2a', s: '#c8d0e0', w: '#ffffff' },
    torch: { r: '#ff7a1a', y: '#ffe14a', n: '#8a5a2a' }, bottle: { n: '#8a5a2a', w: '#ffffff', b: '#8ecbff' }, chain: { s: '#c8d0e0' },
    tent: { g: '#3ea34a', c: '#2f8f3a' }, map: { t: '#e8d0a0', b: '#3a9be8', r: '#e23b3b' }, glasses: { b: '#8ecbff', w: '#ffffff' },
    horn: { y: '#e8c050', w: '#fff4c2', n: '#8a5a2a' }, stone: { b: '#9ad8f5', w: '#ffffff', c: '#5a9ac0' }, glove: { s: '#f6d2b0', b: '#c84c0c' },
    feather: { w: '#ffffff' }, shieldBack: { g: '#2f8f3a', w: '#ffffff' }, flag: { r: '#e23b3b' }, pot: { m: '#c87050', w: '#ffd0b0' },
    magnifier: { w: '#ffffff', b: '#bfe4ff', n: '#8a5a2a' }, hourglass: { n: '#8a5a2a', y: '#ffe14a', w: '#fff4c2' }, book: { r: '#7b2d2d', y: '#ffd84a', w: '#f4ecd0' },
    wings: { w: '#ffffff' },
  };
  // 同じ形でも色ちがいにしたいもの（アイテムIDごとの上書き）
  const ICX = { caffeine: { p: '#8a4a20', w: '#e8c8a0' } };
  function icon(shape, x, y, u, over) {
    const rows = IC[shape]; if (!rows) return;
    const pal = { k: K, ...(ICP[shape] || {}), ...(over || {}) };
    rows.forEach((row, ry) => [...row].forEach((ch, rx) => { const c = pal[ch]; if (c) P(x + rx * u, y + ry * u, u, u, c); }));
  }
  function fit(cv, W, Hh) {
    const d = window.devicePixelRatio || 1;
    cv.width = W * d; cv.height = Hh * d; cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
    g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W, Hh);
  }
  // どうぐ画面のマス用：アイコン1つ
  function drawIcon(cv, shape, u = 3, itemId) { fit(cv, 12 * u, 12 * u); icon(shape, 0, 0, u, ICX[itemId]); }
  // 宝箱を開けて掲げる演出（t：0〜1の進み具合）
  function drawGet(cv, job, shape, t, itemId) {
    const u = 4, W = 200, Hh = 150; fit(cv, W, Hh);
    if (!SPR[job]) job = 'knight';
    const base = Hh - 14;
    P(0, base, W, 14, '#2f8f3a'); P(0, base, W, 3, '#5BD15B');
    const cx = 116, open = t > 0.25;
    sprite(open ? 'chestOpen' : 'chest', cx, base - H(open ? 'chestOpen' : 'chest') * 3, 3);
    const hx = 40, hy = base - H(job) * u;
    sprite(job, hx, hy, u);
    if (t > 0.35) {
      // 宝箱から飛び出して、勇者の頭の上へ
      const p = Math.min(1, (t - 0.35) / 0.35), ease = 1 - (1 - p) * (1 - p);
      const sx = cx + 6, sy = base - 30, ex = hx + 8 * u - 18, ey = hy - 40;
      const ix = sx + (ex - sx) * ease, iy = sy + (ey - sy) * ease - Math.sin(p * Math.PI) * 26;
      if (p >= 1) { // 掲げている：キラキラ
        const tw = Math.floor(t * 12) % 2;
        sparkle(ex - 14, ey - 6 + tw * 2, 2, '#FCD000'); sparkle(ex + 34, ey + 4 - tw * 2, 2, '#ffffff');
        // 両手を上げているように、頭の両わきに手を描く
        P(hx + 3 * u, hy - 2 * u, 2 * u, 2 * u, '#F6D2B0'); P(hx + 11 * u, hy - 2 * u, 2 * u, 2 * u, '#F6D2B0');
      }
      icon(shape, ix, iy, 3, ICX[itemId]);
    }
  }

  /* ---- v3.9 ヘッダーで動かす小さな絵（2コマを横に並べて描き、CSSで切り替える） ---- */
  // コウモリの羽：外側（左右3列）を2ドット下げて、羽を下ろした絵にする
  function flap(rows) {
    const n = rows.length, wd = rows[0].length, out = rows.map(() => Array(wd).fill('.'));
    rows.forEach((r, y) => [...r].forEach((ch, x) => { const wing = x < 3 || x >= wd - 3; const ny = wing ? y + 2 : y; if (ny < n && ch !== '.') out[ny][x] = ch; }));
    return out.map(r => r.join(''));
  }
  function drawSheet(cv, name, u, kind) {
    const rows = SPR[name], pal = PAL[name], W = rows[0].length * u, Hh = rows.length * u + u;
    const frames = kind === 'flap' ? [rows, flap(rows)] : kind === 'walk' ? [rows, bobUp(rows)] : [rows];
    fit(cv, W * frames.length, Hh);
    frames.forEach((fr, f) => fr.forEach((row, ry) => [...row].forEach((ch, rx) => { const c = pal[ch]; if (c) P(f * W + rx * u, u + ry * u, u, u, c); })));
    return { W, H: Hh };
  }
  function drawCloud(cv, sc) { const uu = Math.max(3, Math.floor(7 * sc)); fit(cv, 8 * uu, 4 * uu); cloud(0, 0, sc); return { W: 8 * uu, H: 4 * uu }; }
  return { drawStage, drawField, drawHero, drawChar, drawWalk, drawIcon, drawGet, drawSheet, drawCloud };
})();

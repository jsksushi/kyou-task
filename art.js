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
    // ▼ v3.1〜 メインのパーティ（2頭身・太い輪郭。ドット絵素材サイトの雰囲気に寄せたオリジナル）
knight:["..k....kkkk.....",".kxk..khhhhk....",".kxk.khhhhhhk...",".kxk.kbbbbbbk...",".kxk.ksessesk...",".kxk.kssssssk...","kgggk.kkkkkk....",".kgk.kwccccwkkkk",".kskkwccccwkRSRk","..kwwccccwwkRSRk","..kswwwwwwskRRRk","...kcccccck.kkk.","...kcck.kcck....","...kffk.kffk....","...kkkk.kkkk...."],
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
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'], K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };
  function word(x, y, text, s) { [...text].forEach((ch, i) => { const gl = F[ch] || F[' '], gx = x + i * 6 * s; gl.forEach((row, ry) => [...row].forEach((b, rx) => { if (b === '1') { const px = gx + rx * s, py = y + ry * s; P(px + s, py + s, s, s, K); P(px, py, s, s, ry < 3 ? '#FFE680' : '#FCD000'); } })); }); }
  function outlined(x, y, text, size) { g.font = `${size}px "DotGothic16","MS Gothic",monospace`; g.textBaseline = 'middle'; g.fillStyle = K; [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, 2], [-2, 2], [2, -2]].forEach(([a, b]) => g.fillText(text, x + a, y + b)); g.fillStyle = '#fff'; g.fillText(text, x, y); }

  /* ---- ヘッダー：フィールド（山・城・森・パーティ） ---- */
  function drawStage(cv) {
    let w, h; [g, w, h] = prep(cv); const gy = h - 40, wide = w >= 900, u = 3;
    grad(0, 0, w, gy, '#3f6fd8', '#9cc8ff', 9);
    cloud(w * 0.55, 18, 1.1); cloud(w * 0.78, 46, 0.8); if (wide) cloud(w * 0.36, 60, 0.7);
    sparkle(w * 0.5, 70, 3);
    for (let x = -40; x < w; x += wide ? 170 : 140) mountain(x, gy, wide ? 220 : 180, wide ? 78 : 60, '#5b6fa8', true);
    if (wide) castle(w - 170, gy, 4);
    for (let x = wide ? w * 0.42 : w * 0.55; x < (wide ? w - 190 : w); x += 18) pine(x, gy - 30, 3);
    grad(0, gy, w, h - gy, '#3EA34A', '#1F6E2C', 4); P(0, gy - 4, w, 5, '#5BD15B'); P(0, gy + 16, w, 8, '#c8a060'); P(0, gy + 24, w, 3, '#9a7a40');
    if (wide) {
      const px0 = w * 0.40;
      sprite('knight', px0, gy + 20 - H('knight') * u, u); sprite('wizard', px0 - 56, gy + 20 - H('wizard') * u, u); sprite('archer', px0 - 112, gy + 20 - H('archer') * u, u); sprite('priest', px0 - 168, gy + 20 - H('priest') * u, u);
      sprite('blob', px0 + 110, gy + 20 - H('blob') * u, u); sprite('bat', px0 + 150, gy - 48, u);
      g.font = '14px "DotGothic16",monospace'; g.fillStyle = '#fff'; g.strokeStyle = K; g.lineWidth = 3; g.strokeText('！', px0 + 52, gy - 36); g.fillText('！', px0 + 52, gy - 36);
    } else { sprite('knight', w - 116, gy + 20 - H('knight') * u, u); sprite('blob', w - 56, gy + 20 - H('blob') * u, u); }
    [w * 0.08, w * 0.2, w * 0.3].forEach((x, i) => flower(x, gy - 10, 3, i % 2 ? '#F2A6C6' : '#FCD000'));
    word(26, 20, "TODAY'S TASK", wide ? 6 : Math.max(2, Math.floor((w - 52) / 72)));
    outlined(30, wide ? 108 : 78, '〜 きょうのタスク 〜', wide ? 24 : 17);
  }
  /* ---- 下のフィールド帯 ---- */
  function drawField(cv) {
    let w, h; [g, w, h] = prep(cv); const gy = h - 30;
    grad(0, 0, w, gy, '#2a3a8a', '#5b7fd8', 5); for (let x = 30; x < w; x += 90) P(x + (x * 7) % 40, (x * 13) % 40, 2, 2, '#fff');
    grad(0, gy, w, h - gy, '#3EA34A', '#1F6E2C', 3); P(0, gy - 3, w, 4, '#5BD15B');
    const cast = ['blob', 'ghost', 'chest', 'bat', 'blob', 'ghost']; let i = 0;
    for (let x = 40; x < w - 40; x += 160) { const n = cast[i++ % cast.length]; sprite(n, x, n === 'bat' ? gy - 46 : gy - H(n) * 3 + 2, 3); pine(x + 80, gy - 26, 2); flower(x + 120, gy - 8, 2, '#F2A6C6'); }
  }
  /* ---- ログイン画面用：勇者1人 ---- */
  function drawHero(cv) { let w, h; [g, w, h] = prep(cv); sprite('knight', (w - 16 * 4) / 2, (h - 15 * 4) / 2, 4); }
  return { drawStage, drawField, drawHero };
})();

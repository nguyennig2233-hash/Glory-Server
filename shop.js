// Glory Shop: các món bán bằng Glory Shard (Premium key, thuê title tùy chỉnh, Coin Boost) và gói Shard (mua ngoài app, nhận mã).
// Chủ dự án chỉnh giá ở CATALOG / PACKS bên dưới. Server là nơi duy nhất tính tiền.
'use strict';
const crypto = require('crypto');
const Shards = require('./shards.js');
const DAY = 86_400_000;

// Tỷ giá: 1 Glory Shard = 0,01 USD (100 Shard = 1 USD). Giá Premium khớp bảng giá trên Discord của Glory.
const RATE = 0.01;
const CATALOG = [
  // 1 Glory Shard = 0,01 USD, nên giá Premium bằng đúng bảng giá USD trên Discord. days: 0 = vĩnh viễn.
  { id: 'prem7', kind: 'premium', days: 7, shard: 70 },
  { id: 'prem30', kind: 'premium', days: 30, shard: 299, hot: true },
  { id: 'prem90', kind: 'premium', days: 90, shard: 799 },
  { id: 'prem365', kind: 'premium', days: 365, shard: 3199 },
  { id: 'premlife', kind: 'premium', days: 0, shard: 5999 },
  { id: 'title7', kind: 'title', days: 7, shard: 60 },
  { id: 'title30', kind: 'title', days: 30, shard: 200, hot: true },
  { id: 'boost7', kind: 'boost', days: 7, shard: 50 },
  { id: 'boost30', kind: 'boost', days: 30, shard: 150 },
];
// Gói Shard mua NGOÀI app, kênh #glory-shard trên Discord (nhận mã GSH-... rồi nhập ở trang Nhiệm vụ). usd chỉ để hiển thị.
const PACKS = [
  { id: 'p100', shard: 100, bonus: 0, usd: 1 }, { id: 'p500', shard: 500, bonus: 50, usd: 5 },
  { id: 'p1000', shard: 1000, bonus: 150, usd: 10, hot: true }, { id: 'p3000', shard: 3000, bonus: 600, usd: 30 },
];
const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));
const COLORS = ['#ffd24a', '#4ad8ff', '#ff6ec7', '#9dff4a', '#b07cff', '#ff7a3d', '#7fe6ff', '#ffffff', '#ff5c5c', '#5cff9d', '#ffb3d9', '#c9c9d6'];
const ICONS = ['crown', 'sword', 'skull', 'flame', 'star', 'bolt', 'heart', 'diamond', 'shield', 'ghost', 'moon', 'leaf'];
const FILLS = ['solid', 'gradient', 'rainbow'], ANIMS = ['none', 'shine', 'flow', 'pulse', 'blink'], FRAMES = ['none', 'pill', 'outline', 'neon', 'plate'], FONTS = ['sans', 'serif', 'mono', 'wide'];
const HEX = /^#[0-9a-fA-F]{6}$/, PNG_URL = 'data:image/png;base64,', IMG_MAX = 12000;
const RESERVED = /(owner|admin|mod(erator)?|staff|glory|dev|support|system|hệ thống|quản trị|chủ)/i;
const BAD = /(fuck|shit|bitch|đm|dm\b|địt|lồn|cặc|đụ|cc\b|vcl|vl\b)/i;
const TITLE_RE = /^[\p{L}\p{N} ._'\-★✦♛♞⚔♥♦♠♣☾☠✿❖]{2,16}$/u;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const active = (until, now) => !!until && until > now;
const titleOf = (u, now) => (u.ctitle && active(u.ctitle.until, now) && u.ctitle.text ? { id: 'c:' + u.id, name: u.ctitle.text, color: (u.ctitle.fx && u.ctitle.fx.c1) || u.ctitle.color || '#ffd24a', img: u.ctitle.img || '', fx: u.ctitle.fx || null } : null);
const boostOn = (u, now) => active(u.boost, now);

function view(db, me, now) {
  const keys = (me.pkeys || []).map((k) => ({ code: k.code, days: k.days, at: k.at, used: !!(db.keys[sha(k.code)] && db.keys[sha(k.code)].used) }));
  return { rate: RATE, items: CATALOG, packs: PACKS, colors: COLORS, boost: boostOn(me, now) ? me.boost : null, title: me.ctitle && active(me.ctitle.until, now) ? { until: me.ctitle.until, text: me.ctitle.text || '', color: me.ctitle.color || '', fx: me.ctitle.fx || null, img: me.ctitle.img || '' } : null, icons: ICONS, keys };
}
function buy(db, me, id, now, mkKey) {
  const it = BY_ID.get(id); if (!it) return { ok: false, error: 'no_item' };
  const led = Shards.ledger(me); if (led.bal < it.shard) return { ok: false, error: 'shop_nofunds', need: it.shard - led.bal };
  let out = {};
  if (it.kind === 'premium') {
    const code = mkKey(it.days, 'shop · ' + me.name); (me.pkeys ||= []).unshift({ code, days: it.days, at: now }); me.pkeys = me.pkeys.slice(0, 20); out = { key: code };
  } else if (it.kind === 'title') {
    const c = (me.ctitle ||= {}); c.until = Math.max(active(c.until, now) ? c.until : now, now) + it.days * DAY; out = { until: c.until };
  } else if (it.kind === 'boost') {
    me.boost = Math.max(boostOn(me, now) ? me.boost : now, now) + it.days * DAY; out = { until: me.boost };
  }
  Shards.add(me, -it.shard, 'shop', id, now); return { ok: true, ...out };
}

// Kiểm tra ảnh PNG nhỏ (≤12KB, ≤64x64) do người chơi tải lên: chỉ nhận PNG hợp lệ, chặn mọi thứ khác.
function cleanImg(v) {
  if (typeof v !== 'string' || !v) return '';
  if (!v.startsWith(PNG_URL) || v.length > IMG_MAX * 1.4) return null;
  let b; try { b = Buffer.from(v.slice(PNG_URL.length), 'base64'); } catch { return null; }
  if (b.length < 33 || b.length > IMG_MAX || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20); if (!w || !h || w > 64 || h > 64) return null;
  return v;
}
// Làm sạch kiểu hiển thị: chỉ giữ giá trị hợp lệ trong danh sách cho phép (không tin dữ liệu client).
function cleanFx(x, fallbackColor) {
  x = x && typeof x === 'object' ? x : {};
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const c1 = hex(x.c1, HEX.test(fallbackColor || '') ? fallbackColor : COLORS[0]);
  const ang = Math.max(0, Math.min(360, Math.round(Number(x.ang) || 0)));
  return {
    fill: pick(x.fill, FILLS, 'solid'), c1, c2: hex(x.c2, '#ff6ec7'), c3: x.c3 ? hex(x.c3, '') : '', ang,
    glow: Math.max(0, Math.min(3, Math.round(Number(x.glow) || 0))), anim: pick(x.anim, ANIMS, 'none'), frame: pick(x.frame, FRAMES, 'none'),
    font: pick(x.font, FONTS, 'sans'), bold: x.bold !== false, italic: !!x.italic, icon: ICONS.includes(x.icon) ? x.icon : '',
  };
}
function setTitle(me, text, color, now, fx, img) {
  const c = me.ctitle; if (!c || !active(c.until, now)) return { ok: false, error: 'no_rental' };
  text = String(text || '').trim().replace(/\s+/g, ' ');
  if (!TITLE_RE.test(text)) return { ok: false, error: 'bad_text' };
  if (RESERVED.test(text) || BAD.test(text)) return { ok: false, error: 'text_blocked' };
  const f = cleanFx(fx, color); const im = cleanImg(img); if (im === null) return { ok: false, error: 'bad_image' };
  c.text = text; c.color = f.c1; c.fx = f; c.img = im; return { ok: true };
}
module.exports = { cleanFx, cleanImg, ICONS, RATE, CATALOG, PACKS, COLORS, view, buy, setTitle, titleOf, boostOn };

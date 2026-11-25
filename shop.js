// Glory Shop: các món bán bằng Glory Shard (Premium key, thuê title tùy chỉnh, Coin Boost) và gói Shard (mua ngoài app, nhận mã).
// Chủ dự án chỉnh giá ở CATALOG / PACKS bên dưới. Server là nơi duy nhất tính tiền.
'use strict';
const crypto = require('crypto');
const Shards = require('./shards.js');
const DAY = 86_400_000;

const CATALOG = [
  { id: 'prem7', kind: 'premium', days: 7, shard: 120 },
  { id: 'prem30', kind: 'premium', days: 30, shard: 400, hot: true },
  { id: 'prem90', kind: 'premium', days: 90, shard: 1000 },
  { id: 'title7', kind: 'title', days: 7, shard: 60 },
  { id: 'title30', kind: 'title', days: 30, shard: 200, hot: true },
  { id: 'boost7', kind: 'boost', days: 7, shard: 50 },
  { id: 'boost30', kind: 'boost', days: 30, shard: 150 },
];
// Gói Shard mua NGOÀI app (nhận mã GSH-... rồi nhập ở trang Nhiệm vụ). vnd chỉ để hiển thị, đổi theo bảng giá của bạn.
const PACKS = [
  { id: 'p100', shard: 100, bonus: 0, vnd: 20000 }, { id: 'p500', shard: 500, bonus: 50, vnd: 95000 },
  { id: 'p1200', shard: 1200, bonus: 200, vnd: 200000, hot: true }, { id: 'p3000', shard: 3000, bonus: 700, vnd: 450000 },
];
const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));
const COLORS = ['#ffd24a', '#4ad8ff', '#ff6ec7', '#9dff4a', '#b07cff', '#ff7a3d', '#7fe6ff', '#ffffff', '#ff5c5c', '#5cff9d', '#ffb3d9', '#c9c9d6'];
const RESERVED = /(owner|admin|mod(erator)?|staff|glory|dev|support|system|hệ thống|quản trị|chủ)/i;
const BAD = /(fuck|shit|bitch|đm|dm\b|địt|lồn|cặc|đụ|cc\b|vcl|vl\b)/i;
const TITLE_RE = /^[\p{L}\p{N} ._'\-★✦♛♞⚔]{2,16}$/u;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const active = (until, now) => !!until && until > now;
const titleOf = (u, now) => (u.ctitle && active(u.ctitle.until, now) && u.ctitle.text ? { id: 'c:' + u.id, name: u.ctitle.text, color: u.ctitle.color || '#ffd24a', img: '' } : null);
const boostOn = (u, now) => active(u.boost, now);

function view(db, me, now) {
  const keys = (me.pkeys || []).map((k) => ({ code: k.code, days: k.days, at: k.at, used: !!(db.keys[sha(k.code)] && db.keys[sha(k.code)].used) }));
  return { items: CATALOG, packs: PACKS, colors: COLORS, boost: boostOn(me, now) ? me.boost : null, title: me.ctitle && active(me.ctitle.until, now) ? { until: me.ctitle.until, text: me.ctitle.text || '', color: me.ctitle.color || '' } : null, keys };
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
function setTitle(me, text, color, now) {
  const c = me.ctitle; if (!c || !active(c.until, now)) return { ok: false, error: 'no_rental' };
  text = String(text || '').trim().replace(/\s+/g, ' ');
  if (!TITLE_RE.test(text)) return { ok: false, error: 'bad_text' };
  if (RESERVED.test(text) || BAD.test(text)) return { ok: false, error: 'text_blocked' };
  if (!COLORS.includes(color)) color = COLORS[0];
  c.text = text; c.color = color; return { ok: true };
}
module.exports = { CATALOG, PACKS, COLORS, view, buy, setTitle, titleOf, boostOn };

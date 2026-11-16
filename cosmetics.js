// Chợ cosmetic 3D: người chơi (đã đăng nhập Microsoft/Google) đăng mô hình, đặt giá từ 50 Glory Coin, người khác mua bằng coin.
// Tác giả nhận 70% mỗi lượt bán (phần còn lại biến mất khỏi hệ thống), mô hình phải được nhân viên duyệt trước khi lên chợ.
// Dữ liệu: db.cosm[id]; người dùng: u.kown (đã sở hữu), u.kequip { head, back, armR, armL, legR, legL } (đang đeo).
'use strict';
const crypto = require('crypto'), Coins = require('./coins.js'), CM = require('./cosmodel.js');
const MIN_PRICE = 50, MAX_PRICE = 5000, CUT = 0.7, MAX_UPLOADS = 12, MAX_PENDING = 3, GAP_MS = 30_000, PAGE = 24;
const NAME_RE = /^[\p{L}\p{N} _'’\-.!]{2,30}$/u;

const live = (c) => c && c.status === 'live';
const owns = (u, id) => Array.isArray(u.kown) && u.kown.includes(id);
const meta = (c, me) => ({ id: c.id, name: c.name, desc: c.desc || '', slot: c.slot, price: c.price, by: c.byName, byId: c.by, at: c.at, sales: c.sales || 0, status: c.status, why: c.why || '',
  owned: !!me && (owns(me, c.id) || c.by === me.id), mine: !!me && c.by === me.id, els: c.model.els.length });

function upload(db, me, body, now) {
  const mine = Object.values(db.cosm).filter((c) => c.by === me.id && c.status !== 'removed');
  if (mine.length >= MAX_UPLOADS) return { error: 'cm_limit' };
  if (mine.filter((c) => c.status === 'pending').length >= MAX_PENDING) return { error: 'cm_pending' };
  if (now - (me.kLast || 0) < GAP_MS) return { error: 'cm_fast' };
  const name = String(body.name || '').trim().replace(/\s+/g, ' '); if (!NAME_RE.test(name)) return { error: 'cm_name' };
  const desc = String(body.desc || '').trim().replace(/\s+/g, ' ').slice(0, CM.LIM.desc);
  const slot = String(body.slot || ''); if (!CM.SLOTS.includes(slot)) return { error: 'cm_slot' };
  const price = Math.floor(+body.price); if (!(price >= MIN_PRICE)) return { error: 'cm_price_min' }; if (price > MAX_PRICE) return { error: 'cm_price_max' };
  const m = CM.clean(body.model); if (m.error) return m; const t = CM.cleanTex(body.tex); if (t.error) return t;
  const dup = Object.values(db.cosm).find((c) => c.by === me.id && c.status !== 'removed' && c.name.toLowerCase() === name.toLowerCase()); if (dup) return { error: 'cm_dupname' };
  const c = { id: crypto.randomBytes(5).toString('hex'), name, desc, slot, price, by: me.id, byName: me.name, at: now, status: 'pending', sales: 0, model: { ...m.model, w: t.w, h: t.h }, tex: t.tex };
  db.cosm[c.id] = c; me.kLast = now; return { ok: true, item: meta(c, me) };
}

function list(db, me, q) {
  let all = Object.values(db.cosm).filter(live);
  if (q.slot && CM.SLOTS.includes(q.slot)) all = all.filter((c) => c.slot === q.slot);
  const s = String(q.q || '').trim().toLowerCase(); if (s) all = all.filter((c) => c.name.toLowerCase().includes(s) || c.byName.toLowerCase().includes(s));
  const sort = q.sort === 'top' ? (a, b) => b.sales - a.sales || b.at - a.at : q.sort === 'cheap' ? (a, b) => a.price - b.price || b.at - a.at : (a, b) => b.at - a.at;
  all.sort(sort); const off = Math.max(0, q.offset | 0);
  return { items: all.slice(off, off + PAGE).map((c) => meta(c, me)), more: all.length > off + PAGE, total: all.length };
}
function mine(db, me) {
  const all = Object.values(db.cosm), eq = me.kequip || {};
  return { owned: all.filter((c) => (owns(me, c.id) || c.by === me.id) && c.status !== 'removed' || owns(me, c.id)).map((c) => meta(c, me)), uploads: all.filter((c) => c.by === me.id && c.status !== 'removed').map((c) => meta(c, me)), equip: Object.fromEntries(CM.SLOTS.map((k) => [k, eq[k] || null])) };
}
// Mô hình đầy đủ (nặng): chỉ người tác giả / chủ sở hữu / nhân viên / bất kỳ ai khi đã lên chợ
function item(db, me, id, staff) {
  const c = db.cosm[id]; if (!c) return null;
  if (!live(c) && !(me && (c.by === me.id || owns(me, c.id) || staff))) return null;
  return { ...meta(c, me), model: c.model, tex: c.tex };
}
function buy(db, me, id, now) {
  const c = db.cosm[id]; if (!live(c)) return { error: 'cm_gone' };
  if (c.by === me.id || owns(me, id)) return { error: 'cm_owned' };
  if (Coins.ledger(me).bal < c.price) return { error: 'cm_poor' };
  Coins.add(me, -c.price, 'cbuy', c.name, now); (me.kown ||= []).push(id);
  const cut = Math.floor(c.price * CUT), author = db.users[c.by]; if (author && cut > 0) Coins.add(author, cut, 'csale', c.name, now);
  c.sales = (c.sales || 0) + 1; return { ok: true, cut };
}
function equip(db, me, slot, id) {
  if (!CM.SLOTS.includes(slot)) return { error: 'cm_slot' };
  const eq = (me.kequip ||= {}); if (!id) { delete eq[slot]; return { ok: true }; }
  const c = db.cosm[id]; if (!c || c.slot !== slot || !(owns(me, id) || c.by === me.id) || c.status === 'removed' && !owns(me, id)) return { error: 'cm_notyours' };
  if (c.status === 'pending' && c.by !== me.id) return { error: 'cm_notyours' };
  eq[slot] = id; return { ok: true };
}
// Tác giả gỡ khỏi chợ (người đã mua vẫn dùng được) hoặc nhân viên gỡ vì vi phạm
function remove(db, me, id, isStaff) {
  const c = db.cosm[id]; if (!c) return { error: 'cm_gone' };
  if (c.by !== me.id && !isStaff) return { error: 'forbidden' };
  if (!c.sales) { delete db.cosm[id]; for (const u of Object.values(db.users)) { if (u.kequip) for (const k of Object.keys(u.kequip)) if (u.kequip[k] === id) delete u.kequip[k]; } return { ok: true, gone: true, name: c.name, by: c.byName }; }
  c.status = 'removed'; return { ok: true, name: c.name, by: c.byName };
}
function review(db, id, ok, why) {
  const c = db.cosm[id]; if (!c || c.status !== 'pending') return { error: 'cm_gone' };
  c.status = ok ? 'live' : 'rejected'; c.why = ok ? '' : String(why || '').slice(0, 100); c.reviewedAt = Date.now(); return { ok: true, name: c.name, by: c.byName };
}
const queue = (db) => Object.values(db.cosm).filter((c) => c.status === 'pending').sort((a, b) => a.at - b.at).slice(0, 50).map((c) => ({ ...meta(c, null), model: c.model, tex: c.tex }));
// Cosmetic người khác thấy (gắn vào thẻ bạn bè): chỉ id của món đang đeo và còn hợp lệ
function worn(db, u) {
  const eq = u.kequip; if (!eq) return null; const o = {};
  for (const s of CM.SLOTS) { const c = eq[s] && db.cosm[eq[s]]; if (c && c.slot === s && (c.status === 'live' || owns(u, c.id) || c.by === u.id) && c.status !== 'rejected') o[s] = c.id; }
  return Object.keys(o).length ? o : null;
}
module.exports = { MIN_PRICE, MAX_PRICE, CUT, upload, list, mine, item, buy, equip, remove, review, queue, worn, meta };

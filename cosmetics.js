// Chợ cosmetic 3D: người chơi (đã đăng nhập Microsoft/Google) đăng mô hình, người khác mua bằng Glory Shard.
// Hai cách đăng: (1) MIỄN PHÍ: giá 0, ai cũng lấy được, không tốn phí; (2) THU PHÍ: trả phí đăng 10 Glory Shard, tự đặt giá bằng shard,
// mỗi lượt bán tác giả nhận 70%, 30% còn lại thuộc về hệ thống. Mô hình phải được nhân viên duyệt; bị từ chối / xóa khi còn chờ duyệt thì được hoàn phí đăng.
// Dữ liệu: db.cosm[id]; người dùng: u.kown (đã sở hữu), u.kequip { head, back, armR, armL, legR, legL } (đang đeo).
// Món đăng từ bản cũ (trả bằng Glory Coin, không có c.cur) tự động thành món MIỄN PHÍ.
'use strict';
const Eco = require('./economy.js');
const crypto = require('crypto'), Shards = require('./shards.js'), CM = require('./cosmodel.js');
const MIN_PRICE = 5, MAX_PRICE = 5000, CUT = 0.7, FEE = 10, MAX_UPLOADS = 12, MAX_PENDING = 3, GAP_MS = 30_000, PAGE = 24;
const NAME_RE = /^[\p{L}\p{N} _'’\-.!]{2,30}$/u;

// Hiệu ứng dấu chân (slot 'foot'): không có mô hình 3D, chỉ có ảnh dấu (PNG ≤ 32x32) + thông số `fp`. Dùng chung chợ / mua / duyệt / đeo với cosmetic 3D.
const FOOT = 'foot', ALL = [...CM.SLOTS, FOOT];
const BURSTS = ['none', 'spark', 'smoke', 'flame', 'heart', 'snow', 'bubble', 'note'], FADES = ['none', 'out', 'shrink'], WHENS = ['walk', 'sprint', 'all'], STAMP_MAX = 32;
const LAYER_MAX = 5, LAYER_IMG_MAX = 24000, BLENDS = ['normal', 'add'], MODES = ['flat', 'billboard', 'spin', 'cross'];
function cleanFp(x) {
  x = x && typeof x === 'object' ? x : {};
  const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v * 100) / 100)) : d; };
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '');
  const out = { size: num(x.size, 0.5, 2, 1), gap: num(x.gap, 0.4, 1.6, 0.8), life: num(x.life, 1, 10, 4), op: num(x.op, 0.3, 1, 0.9), fade: pick(x.fade, FADES, 'out'),
    alt: x.alt !== false, tint: hex(x.tint), glow: Math.round(num(x.glow, 0, 3, 0)), burst: pick(x.burst, BURSTS, 'none'), when: pick(x.when, WHENS, 'walk') };
  // Lớp VFX xếp chồng (tối đa 5): mỗi lớp là một ảnh PNG nhỏ + thông số chuyển động; server chỉ nhận số trong giới hạn và PNG hợp lệ ≤ 32x32.
  if (Array.isArray(x.layers) && x.layers.length) {
    if (x.layers.length > LAYER_MAX) return { error: 'cm_fp_layers' };
    out.layers = [];
    for (const l of x.layers) {
      if (!l || typeof l !== 'object') return { error: 'cm_fp_layers' };
      const t = CM.cleanTex(l.img); if (t.error) return t;
      const fr = Math.round(num(l.frames, 1, 8, 1));   // ảnh dạng dải ngang: fr khung, mỗi khung <= 32x32
      if (t.h > STAMP_MAX || t.w > STAMP_MAX * fr || t.w % fr) return { error: 'cm_fp_dim' };
      if (t.tex.length > LAYER_IMG_MAX) return { error: 'cm_tex_big' };
      out.layers.push({ img: t.tex, tint: hex(l.tint), tint2: hex(l.tint2), size0: num(l.size0, 0.1, 3, 1), size1: num(l.size1, 0.1, 3, 1), ox: num(l.ox, -1, 1, 0), oy: num(l.oy, -1, 1, 0),
        rot: num(l.rot, -180, 180, 0), spin: num(l.spin, -720, 720, 0), op0: num(l.op0, 0, 1, 1), op1: num(l.op1, 0, 1, 0), blend: pick(l.blend, BLENDS, 'normal'),
        frames: fr, fps: num(l.fps, 1, 30, 8), loop: l.loop !== false, mode: pick(l.mode, MODES, 'flat'), h0: num(l.h0, -0.5, 3, 0), h1: num(l.h1, -0.5, 3, 0), pulse: num(l.pulse, 0, 0.5, 0), flick: num(l.flick, 0, 1, 0), delay: num(l.delay, 0, 3, 0), mirror: l.mirror !== false, name: String(l.name || '').slice(0, 20).replace(/[^\p{L}\p{N} ._'\-]/gu, '') });
    }
  }
  return out;
}
// Danh sách / thẻ chợ chỉ cần thông số nhẹ: bỏ ảnh của từng lớp (ảnh chỉ trả về khi xem chi tiết một món).
const fpLite = (f) => (f && f.layers ? { ...f, layers: f.layers.map(({ img, ...r }) => r) } : f || null);
const live = (c) => c && c.status === 'live';
const owns = (u, id) => Array.isArray(u.kown) && u.kown.includes(id);
const priceOf = (c) => (c.cur === 'shard' ? Math.max(0, c.price | 0) : 0);
const meta = (c, me) => ({ id: c.id, name: c.name, desc: c.desc || '', slot: c.slot, price: priceOf(c), free: priceOf(c) === 0, by: c.byName, byId: c.by, at: c.at, sales: c.sales || 0, status: c.status, why: c.why || '',
  owned: !!me && (owns(me, c.id) || c.by === me.id), mine: !!me && c.by === me.id, els: c.model.els.length, fp: fpLite(c.fp) });

function upload(db, me, body, now) {
  const mine = Object.values(db.cosm).filter((c) => c.by === me.id && c.status !== 'removed');
  if (mine.length >= MAX_UPLOADS) return { error: 'cm_limit' };
  if (mine.filter((c) => c.status === 'pending').length >= MAX_PENDING) return { error: 'cm_pending' };
  if (now - (me.kLast || 0) < GAP_MS) return { error: 'cm_fast' };
  const name = String(body.name || '').trim().replace(/\s+/g, ' '); if (!NAME_RE.test(name)) return { error: 'cm_name' };
  const desc = String(body.desc || '').trim().replace(/\s+/g, ' ').slice(0, CM.LIM.desc);
  const slot = String(body.slot || ''); if (!ALL.includes(slot)) return { error: 'cm_slot' };
  const paid = body.paid === true;
  let price = 0;
  if (paid) { price = Math.floor(+body.price); if (!(price >= MIN_PRICE)) return { error: 'cm_price_min' }; if (price > MAX_PRICE) return { error: 'cm_price_max' }; }
  let m, t, fp = null;
  if (slot === FOOT) { t = CM.cleanTex(body.tex); if (t.error) return t; if (t.w > STAMP_MAX || t.h > STAMP_MAX) return { error: 'cm_fp_dim' }; fp = cleanFp(body.fp); if (fp.error) return fp; m = { model: { els: [] } }; }
  else { m = CM.clean(body.model); if (m.error) return m; t = CM.cleanTex(body.tex); if (t.error) return t; }
  const dup = Object.values(db.cosm).find((c) => c.by === me.id && c.status !== 'removed' && c.name.toLowerCase() === name.toLowerCase()); if (dup) return { error: 'cm_dupname' };
  if (paid && Shards.ledger(me).bal < FEE) return { error: 'cm_nofee' };
  const c = { id: crypto.randomBytes(5).toString('hex'), name, desc, slot, price, cur: 'shard', fee: paid ? FEE : 0, by: me.id, byName: me.name, at: now, status: 'pending', sales: 0, model: { ...m.model, w: t.w, h: t.h }, tex: t.tex, ...(fp ? { fp } : {}) };
  if (paid) { Shards.add(me, -FEE, 'cfee', name, now); eco(db).fees += FEE; }
  db.cosm[c.id] = c; me.kLast = now; return { ok: true, item: meta(c, me), fee: c.fee };
}
// Hoàn phí đăng nếu món chưa từng được duyệt (bị từ chối, hoặc bị xóa khi còn chờ duyệt)
const eco = (db) => (db.econ ||= { fees: 0, cut: 0, sales: 0, n: 0 });
function refund(db, c, now) {
  if (!c.fee || c.refunded) return 0; const a = db.users[c.by]; if (!a) return 0;
  c.refunded = true; eco(db).fees -= c.fee; return Shards.add(a, c.fee, 'crefund', c.name, now);
}

function list(db, me, q) {
  let all = Object.values(db.cosm).filter(live);
  if (q.slot && ALL.includes(q.slot)) all = all.filter((c) => c.slot === q.slot); else all = all.filter((c) => c.slot !== FOOT);
  if (q.kind === 'free') all = all.filter((c) => priceOf(c) === 0); else if (q.kind === 'paid') all = all.filter((c) => priceOf(c) > 0);
  const s = String(q.q || '').trim().toLowerCase(); if (s) all = all.filter((c) => c.name.toLowerCase().includes(s) || c.byName.toLowerCase().includes(s));
  const sort = q.sort === 'top' ? (a, b) => b.sales - a.sales || b.at - a.at : q.sort === 'cheap' ? (a, b) => priceOf(a) - priceOf(b) || b.at - a.at : (a, b) => b.at - a.at;
  all.sort(sort); const off = Math.max(0, q.offset | 0);
  return { items: all.slice(off, off + PAGE).map((c) => meta(c, me)), more: all.length > off + PAGE, total: all.length };
}
function mine(db, me) {
  const all = Object.values(db.cosm), eq = me.kequip || {};
  const own = (c) => (owns(me, c.id) || c.by === me.id) && c.status !== 'removed' || owns(me, c.id), up = (c) => c.by === me.id && c.status !== 'removed';
  const d3 = all.filter((c) => c.slot !== FOOT), ft = all.filter((c) => c.slot === FOOT);
  return { owned: d3.filter(own).map((c) => meta(c, me)), uploads: d3.filter(up).map((c) => meta(c, me)), equip: Object.fromEntries(CM.SLOTS.map((k) => [k, eq[k] || null])),
    foot: { owned: ft.filter(own).map((c) => meta(c, me)), uploads: ft.filter(up).map((c) => meta(c, me)), equip: eq[FOOT] || null } };
}
// Mô hình đầy đủ (nặng): chỉ người tác giả / chủ sở hữu / nhân viên / bất kỳ ai khi đã lên chợ
function item(db, me, id, staff) {
  const c = db.cosm[id]; if (!c) return null;
  if (!live(c) && !(me && (c.by === me.id || owns(me, c.id) || staff))) return null;
  return { ...meta(c, me), model: c.model, tex: c.tex, fp: c.fp || null };
}
function buy(db, me, id, now) {
  const c = db.cosm[id]; if (!live(c)) return { error: 'cm_gone' };
  if (c.by === me.id || owns(me, id)) return { error: 'cm_owned' };
  const p = priceOf(c);
  if (p > 0 && Shards.ledger(me).bal < p) return { error: 'cm_poor' };
  let cut = 0;
  if (p > 0) { Shards.add(me, -p, 'cbuy', c.name, now); cut = Math.floor(p * CUT); const author = db.users[c.by]; if (author && cut > 0) Shards.add(author, cut, 'csale', c.name, now); }
  if (p > 0) { const e = eco(db); e.sales += p; e.cut += p - (db.users[c.by] ? cut : 0); e.n++; }
  (me.kown ||= []).push(id); c.sales = (c.sales || 0) + 1;
  const bonus = p === 0 ? Eco.creatorBonus(db, c, now) : 0; return { ok: true, cut, price: p, bonus };
}
function equip(db, me, slot, id) {
  if (!ALL.includes(slot)) return { error: 'cm_slot' };
  const eq = (me.kequip ||= {}); if (!id) { delete eq[slot]; return { ok: true }; }
  const c = db.cosm[id]; if (!c || c.slot !== slot || !(owns(me, id) || c.by === me.id) || c.status === 'removed' && !owns(me, id)) return { error: 'cm_notyours' };
  if (c.status === 'pending' && c.by !== me.id) return { error: 'cm_notyours' };
  eq[slot] = id; return { ok: true };
}
// Tác giả gỡ khỏi chợ (người đã mua vẫn dùng được) hoặc nhân viên gỡ vì vi phạm
function remove(db, me, id, isStaff, now) {
  const c = db.cosm[id]; if (!c) return { error: 'cm_gone' };
  if (c.by !== me.id && !isStaff) return { error: 'forbidden' };
  const back = c.status === 'pending' ? refund(db, c, now || Date.now()) : 0;
  if (!c.sales) { delete db.cosm[id]; for (const u of Object.values(db.users)) { if (u.kequip) for (const k of Object.keys(u.kequip)) if (u.kequip[k] === id) delete u.kequip[k]; } return { ok: true, gone: true, name: c.name, by: c.byName, refund: back }; }
  c.status = 'removed'; return { ok: true, name: c.name, by: c.byName, refund: back };
}
function review(db, id, ok, why, now) {
  const c = db.cosm[id]; if (!c || c.status !== 'pending') return { error: 'cm_gone' };
  c.status = ok ? 'live' : 'rejected'; c.why = ok ? '' : String(why || '').slice(0, 100); c.reviewedAt = Date.now();
  const back = ok ? 0 : refund(db, c, now || Date.now());
  return { ok: true, name: c.name, by: c.byName, refund: back };
}
const queue = (db) => Object.values(db.cosm).filter((c) => c.status === 'pending').sort((a, b) => a.at - b.at).slice(0, 50).map((c) => ({ ...meta(c, null), model: c.model, tex: c.tex }));
// Cosmetic người khác thấy (gắn vào thẻ bạn bè): chỉ id của món đang đeo và còn hợp lệ
function worn(db, u) {
  const eq = u.kequip; if (!eq) return null; const o = {};
  for (const s of ALL) { const c = eq[s] && db.cosm[eq[s]]; if (c && c.slot === s && (c.status === 'live' || owns(u, c.id) || c.by === u.id) && c.status !== 'rejected') o[s] = c.id; }
  return Object.keys(o).length ? o : null;
}
module.exports = { cleanFp, MIN_PRICE, MAX_PRICE, CUT, FEE, upload, list, mine, item, buy, equip, remove, review, queue, worn, meta };

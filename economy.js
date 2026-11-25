// Glory Economy: luật chung, nhiệm vụ (Coin), cột mốc, thưởng tác giả món miễn phí, thu nhập của staff (Shard).
// Mọi con số nằm ở RULES. Server là nơi duy nhất quyết định; launcher chỉ hiển thị RULES và gửi yêu cầu nhận thưởng.
'use strict';
const Coins = require('./coins.js'), Shards = require('./shards.js');
const dayOf = Coins.dayOf, weekOf = (t) => Math.floor((dayOf(t) + 3) / 7);     // tuần bắt đầu thứ Hai, giờ Việt Nam

const RULES = {
  coin: { maxBal: 1_000_000, sources: 'Chơi game, đăng nhập mỗi ngày, nhiệm vụ, cột mốc, thưởng tác giả', tradable: false, buyable: false },
  shard: { maxBal: Shards.MAX_BAL, topup: 'Chỉ nạp bằng mã', tradable: false, withdrawable: false },
  cosmetic: { minPrice: 5, maxPrice: 5000, fee: 10, authorPct: 70, systemPct: 30, feeRefund: 'Hoàn khi bị từ chối hoặc xóa lúc đang chờ duyệt' },
  creatorBonus: [{ sales: 10, coin: 20 }, { sales: 50, coin: 60 }, { sales: 100, coin: 150 }],
  staff: { reviewShard: 2, reviewDayCap: 50, stipendMinReviews: 3, stipend: { 1: 50, 2: 100 } },
};
// need: số phút (play*) hoặc số tin nhắn (chat*)
const DAILY = [{ id: 'd_play20', kind: 'play', need: 20, reward: 15 }, { id: 'd_chat3', kind: 'chat', need: 3, reward: 10 }];
const WEEKLY = [{ id: 'w_play300', kind: 'play', need: 300, reward: 100 }, { id: 'w_chat30', kind: 'chat', need: 30, reward: 40 }];
const MILE = [
  { id: 'm_friend1', kind: 'friends', need: 1, reward: 20 }, { id: 'm_friend10', kind: 'friends', need: 10, reward: 60 },
  { id: 'm_play5h', kind: 'playtotal', need: 300, reward: 50 }, { id: 'm_play50h', kind: 'playtotal', need: 3000, reward: 300 },
  { id: 'm_pub1', kind: 'pub', need: 1, reward: 50 }, { id: 'm_sale1', kind: 'sale', need: 1, reward: 50 },
];
const ALL = new Map([...DAILY, ...WEEKLY, ...MILE].map((q) => [q.id, q]));

const Q = (u) => (u.quest ||= {});
function roll(u, now) {
  const q = Q(u), d = dayOf(now), w = weekOf(now);
  if (q.d !== d) { q.d = d; q.dc = {}; q.dchat = 0; }
  if (q.w !== w) { q.w = w; q.wc = {}; q.wchat = 0; }
  q.ms ||= {}; return q;
}
// ghi nhận 1 tin nhắn đã gửi (gọi sau khi gửi thành công)
function onChat(u, now) { const q = roll(u, now); q.dchat = Math.min(9999, q.dchat + 1); q.wchat = Math.min(99999, q.wchat + 1); }

function have(u, db, qd, now) {
  const q = roll(u, now), pm = (u.coin && u.coin.pm) || {};
  const pday = pm.day && pm.d === dayOf(now) ? pm.day : 0, pwk = pm.week && pm.w === weekOf(now) ? pm.week : 0;
  switch (qd.kind) {
    case 'play': return Math.floor((qd.id[0] === 'd' ? pday : pwk) / 60_000);
    case 'chat': return qd.id[0] === 'd' ? q.dchat : q.wchat;
    case 'playtotal': return Math.floor((pm.total || 0) / 60_000);
    case 'friends': return ((db.rel[u.id] || {}).friends || []).length;
    case 'pub': return Object.values(db.cosm).filter((c) => c.by === u.id && c.reviewedAt && c.status !== 'rejected').length;
    case 'sale': return Object.values(db.cosm).filter((c) => c.by === u.id && c.sales > 0).length;
  }
  return 0;
}
const claimedOf = (q, id) => (id[0] === 'd' ? q.dc : id[0] === 'w' ? q.wc : q.ms)[id] === 1;
function state(u, db, now) {
  const q = roll(u, now), row = (qd) => { const h = have(u, db, qd, now); return { id: qd.id, kind: qd.kind, need: qd.need, have: Math.min(h, qd.need), reward: qd.reward, done: h >= qd.need, claimed: claimedOf(q, qd.id) }; };
  return { daily: DAILY.map(row), weekly: WEEKLY.map(row), milestones: MILE.map(row) };
}
function claim(u, db, id, now) {
  const qd = ALL.get(id); if (!qd) return { ok: false, error: 'no_quest' };
  const q = roll(u, now); if (claimedOf(q, id)) return { ok: false, error: 'claimed' };
  if (have(u, db, qd, now) < qd.need) return { ok: false, error: 'not_done' };
  (id[0] === 'd' ? q.dc : id[0] === 'w' ? q.wc : q.ms)[id] = 1;
  return { ok: true, amount: Coins.add(u, qd.reward, id[0] === 'm' ? 'ms' : 'quest', id, now) };
}

// Thưởng tác giả món MIỄN PHÍ khi đạt số lượt lấy (món có phí đã được trả bằng Shard)
function creatorBonus(db, c, now) {
  const a = db.users[c.by]; if (!a) return 0; let got = 0; c.bonus = c.bonus | 0;
  for (const t of RULES.creatorBonus) if (c.sales >= t.sales && c.bonus < t.sales) { c.bonus = t.sales; got += Coins.add(a, t.coin, 'cbonus', c.name, now); }
  return got;
}

// ===== Thu nhập staff (Shard do hệ thống phát; ghi vào db.econ.minted) =====
const W = (u) => (u.wage ||= {});
const eco = (db) => (db.econ ||= { fees: 0, cut: 0, sales: 0, n: 0 });
function wageRoll(u, now) { const w = W(u), d = dayOf(now), k = weekOf(now); if (w.d !== d) { w.d = d; w.today = 0; } if (w.k !== k) { w.k = k; w.reviews = 0; } return w; }
// gọi sau khi staff duyệt/từ chối 1 món; trả số Shard nhận được (0 nếu không đủ điều kiện)
function reviewReward(db, staff, c, now) {
  if (!c || c.by === staff.id || c.rew) return 0;
  const w = wageRoll(staff, now); c.rew = staff.id; w.reviews++;
  const room = RULES.staff.reviewDayCap - w.today; if (room <= 0) return 0;
  const amt = Shards.add(staff, Math.min(RULES.staff.reviewShard, room), 'wage', c.name, now);
  w.today += amt; eco(db).minted = (eco(db).minted || 0) + amt; return amt;
}
function staffView(u, lvl, now) {
  const w = wageRoll(u, now), amt = RULES.staff.stipend[Math.min(2, lvl)] || 0;
  return { reviewShard: RULES.staff.reviewShard, today: w.today, dayCap: RULES.staff.reviewDayCap, reviews: w.reviews, need: RULES.staff.stipendMinReviews, stipend: amt, claimed: w.paid === weekOf(now), ready: !!amt && w.reviews >= RULES.staff.stipendMinReviews && w.paid !== weekOf(now) };
}
function stipend(db, u, lvl, now) {
  const v = staffView(u, lvl, now); if (!v.stipend) return { ok: false, error: 'no_stipend' };
  if (v.claimed) return { ok: false, error: 'claimed' }; if (!v.ready) return { ok: false, error: 'not_enough' };
  W(u).paid = weekOf(now); const amt = Shards.add(u, v.stipend, 'stipend', '', now); eco(db).minted = (eco(db).minted || 0) + amt; return { ok: true, amount: amt };
}
module.exports = { RULES, state, claim, onChat, creatorBonus, reviewReward, staffView, stipend, weekOf };

// Glory Coin: tiền trong client, CHỈ kiếm bằng hoạt động (giai đoạn 1: chưa bán bằng tiền thật, không rút, không chuyển cho nhau).
// Mọi con số do máy chủ tính, client chỉ xin và hiển thị. Dữ liệu nằm trong u.coin (sổ cái) và u.owned / u.equip (cosmetic).
'use strict';

const TZ_MS = 7 * 3600_000;                                          // ngày tính theo giờ Việt Nam (UTC+7)
const dayOf = (t) => Math.floor((t + TZ_MS) / 86_400_000);
const LOG_MAX = 60;
const PLAY_MS_PER_COIN = 10 * 60_000;                                // 10 phút đang chơi = 1 coin
const PLAY_CAP_DAY = 30;                                             // tối đa 30 coin / ngày từ thời gian chơi
const MAX_STEP = 90_000;                                             // mỗi lần đồng bộ chỉ tính tối đa 90 giây (chống gửi trạng thái "playing" giả dài)
const DAILY_BASE = 10, DAILY_STEP = 2, DAILY_MAX_STREAK = 10;        // thưởng ngày: 10 + 2 × chuỗi (tối đa 30)
const MAX_BAL = 1_000_000;

// Danh mục cosmetic (máy chủ giữ giá và loại; tên hiển thị do client dịch). badge = biểu tượng cạnh tên, color = màu tên, frame = viền thẻ hồ sơ.
const ITEMS = [
  { id: 'b_sword', kind: 'badge', price: 60, glyph: '⚔' }, { id: 'b_shield', kind: 'badge', price: 60, glyph: '🛡' }, { id: 'b_fire', kind: 'badge', price: 90, glyph: '🔥' },
  { id: 'b_bolt', kind: 'badge', price: 90, glyph: '⚡' }, { id: 'b_skull', kind: 'badge', price: 120, glyph: '💀' }, { id: 'b_crown', kind: 'badge', price: 250, glyph: '👑' },
  { id: 'c_gold', kind: 'color', price: 100, value: '#ffd24a' }, { id: 'c_cyan', kind: 'color', price: 100, value: '#4ad8ff' }, { id: 'c_pink', kind: 'color', price: 100, value: '#ff6ec7' },
  { id: 'c_lime', kind: 'color', price: 100, value: '#9dff4a' }, { id: 'c_violet', kind: 'color', price: 150, value: '#b07cff' },
  { id: 'f_gold', kind: 'frame', price: 200, value: '#ffd24a' }, { id: 'f_ice', kind: 'frame', price: 200, value: '#7fe6ff' }, { id: 'f_ember', kind: 'frame', price: 300, value: '#ff7a3d' },
];
const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
const SLOT = { badge: 'badge', color: 'color', frame: 'frame' };

function ledger(u) {
  const c = (u.coin ||= {});
  c.bal = Math.max(0, Math.min(MAX_BAL, Math.floor(+c.bal || 0)));
  c.earned = Math.floor(+c.earned || 0); c.spent = Math.floor(+c.spent || 0); c.streak = Math.floor(+c.streak || 0);
  c.log ||= []; return c;
}
function add(u, amount, kind, note, now) {
  const c = ledger(u); amount = Math.floor(amount); if (!amount) return 0;
  if (amount > 0) amount = Math.min(amount, MAX_BAL - c.bal);
  else amount = -Math.min(-amount, c.bal);
  if (!amount) return 0;
  c.bal += amount; if (amount > 0) c.earned += amount; else c.spent -= amount;
  c.log.unshift({ t: now, k: kind, a: amount, n: String(note || '').slice(0, 40) }); if (c.log.length > LOG_MAX) c.log.length = LOG_MAX;
  return amount;
}

// Thưởng giờ chơi: gọi mỗi lần client đồng bộ trạng thái. Chỉ cộng khi trạng thái là "playing", mỗi lần tối đa MAX_STEP, tối đa PLAY_CAP_DAY coin / ngày.
function tickPlay(u, playing, now) {
  const c = ledger(u), last = c.playAt || 0; c.playAt = playing ? now : 0;
  if (!playing || !last) return 0;
  const d = dayOf(now); if (c.playDay !== d) { c.playDay = d; c.playToday = 0; }
  c.playAcc = (c.playAcc || 0) + Math.max(0, Math.min(now - last, MAX_STEP));
  let got = 0;
  while (c.playAcc >= PLAY_MS_PER_COIN && c.playToday < PLAY_CAP_DAY) { c.playAcc -= PLAY_MS_PER_COIN; c.playToday++; got += add(u, 1, 'play', '', now); }
  if (c.playToday >= PLAY_CAP_DAY) c.playAcc = Math.min(c.playAcc, PLAY_MS_PER_COIN - 1);
  return got;
}

function dailyState(u, now) {
  const c = ledger(u), d = dayOf(now), claimed = c.dailyDay === d;
  const streakNow = c.dailyDay === d - 1 || claimed ? c.streak : 0;
  const next = DAILY_BASE + DAILY_STEP * Math.min(claimed ? streakNow : streakNow, DAILY_MAX_STREAK);
  return { claimed, streak: streakNow, next: claimed ? 0 : next };
}
function claimDaily(u, now) {
  const c = ledger(u), d = dayOf(now);
  if (c.dailyDay === d) return { ok: false, error: 'already' };
  c.streak = c.dailyDay === d - 1 ? c.streak + 1 : 1; c.dailyDay = d;
  const amt = DAILY_BASE + DAILY_STEP * Math.min(c.streak - 1, DAILY_MAX_STREAK);
  add(u, amt, 'daily', 'x' + c.streak, now); return { ok: true, amount: amt };
}

const owned = (u) => (Array.isArray(u.owned) ? u.owned.filter((x) => BY_ID.has(x)) : []);
function buy(u, id, now) {
  const it = BY_ID.get(id); if (!it) return { ok: false, error: 'no_item' };
  if (owned(u).includes(id)) return { ok: false, error: 'owned' };
  const c = ledger(u); if (c.bal < it.price) return { ok: false, error: 'poor' };
  add(u, -it.price, 'buy', id, now); (u.owned ||= []).push(id); return { ok: true };
}
function equip(u, slot, id) {
  if (!SLOT[slot]) return { ok: false, error: 'bad_slot' };
  const eq = (u.equip ||= {});
  if (!id) { delete eq[slot]; return { ok: true }; }
  const it = BY_ID.get(id); if (!it || it.kind !== slot || !owned(u).includes(id)) return { ok: false, error: 'not_owned' };
  eq[slot] = id; return { ok: true };
}
// Cosmetic người khác nhìn thấy (đưa vào thẻ bạn bè / hồ sơ)
function look(u) {
  const e = u.equip || {}, o = {};
  for (const s of Object.keys(SLOT)) { const it = e[s] && BY_ID.get(e[s]); if (it && owned(u).includes(it.id)) o[s] = it.glyph || it.value; }
  return Object.keys(o).length ? o : null;
}
function view(u, now) {
  const c = ledger(u);
  return { bal: c.bal, earned: c.earned, spent: c.spent, daily: dailyState(u, now), play: { today: c.playToday && c.playDay === dayOf(now) ? c.playToday : 0, cap: PLAY_CAP_DAY, perCoinMin: PLAY_MS_PER_COIN / 60_000 }, log: c.log.slice(0, 20), owned: owned(u), equip: { ...(u.equip || {}) } };
}
const catalog = () => ITEMS.map((i) => ({ id: i.id, kind: i.kind, price: i.price, glyph: i.glyph || '', value: i.value || '' }));
// Chủ dự án tặng / thu coin (có nhật ký)
function grant(u, amount, now, note) { amount = Math.max(-100000, Math.min(100000, Math.floor(+amount || 0))); return add(u, amount, 'grant', note, now); }

module.exports = { ITEMS, catalog, view, look, tickPlay, claimDaily, buy, equip, grant, ledger, dayOf, PLAY_MS_PER_COIN, PLAY_CAP_DAY, MAX_STEP };

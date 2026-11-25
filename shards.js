// Glory Shard: tiền NẠP (không kiếm được bằng cách chơi), dùng để mua cosmetic 3D và để đăng cosmetic có thu phí.
// Số dư nằm trong u.shard. Không rút ra, không chuyển cho nhau; người bán nhận shard từ mỗi lượt bán (xem cosmetics.js).
'use strict';
const LOG_MAX = 60, MAX_BAL = 10_000_000;

function ledger(u) {
  const s = (u.shard ||= {});
  s.bal = Math.max(0, Math.min(MAX_BAL, Math.floor(+s.bal || 0)));
  s.topped = Math.floor(+s.topped || 0); s.earned = Math.floor(+s.earned || 0); s.spent = Math.floor(+s.spent || 0);
  s.log ||= []; return s;
}
// kind: topup (nạp bằng mã) | grant (chủ dự án tặng) | cfee (phí đăng) | crefund (hoàn phí) | cbuy (mua cosmetic) | csale (bán cosmetic)
function add(u, amount, kind, note, now) {
  const s = ledger(u); amount = Math.floor(amount); if (!amount) return 0;
  if (amount > 0) amount = Math.min(amount, MAX_BAL - s.bal); else amount = -Math.min(-amount, s.bal);
  if (!amount) return 0;
  s.bal += amount;
  if (amount > 0) { if (kind === 'topup' || kind === 'grant') s.topped += amount; else s.earned += amount; } else s.spent -= amount;
  s.log.unshift({ t: now, k: kind, a: amount, n: String(note || '').slice(0, 40) }); if (s.log.length > LOG_MAX) s.log.length = LOG_MAX;
  return amount;
}
const view = (u) => { const s = ledger(u); return { bal: s.bal, topped: s.topped, earned: s.earned, spent: s.spent, log: s.log.slice(0, 20) }; };
module.exports = { ledger, add, view, MAX_BAL };

// Máy chủ "Glory Social" tự host: tài khoản theo tên, bạn bè, trạng thái đang chơi, hồ sơ.
// Không cần thư viện ngoài. Chạy: node glory-server.js   (PORT=8787, GLORY_DATA=./data.json, TRUST_PROXY=1 nếu đứng sau proxy)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8787;
const FILE = process.env.GLORY_DATA || path.join(__dirname, 'data.json');
const ONLINE_MS = 45_000;
const PREMIUM_ONLY = /^(1|true|yes)$/i.test(process.env.PREMIUM_ONLY || '');
const MC_PROFILE = process.env.MC_PROFILE_URL || 'https://api.minecraftservices.com/minecraft/profile';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';          // đặt biến này để được phép phát hành key Premium
const KEY_RE = /^GLR_[A-Za-z0-9]{10}@\d{3}$/;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

let db = { users: {}, rel: {}, keys: {} };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
db.keys ||= {};
let dirty = false;
const touch = () => { dirty = true; };

// Lưu trữ bền vững cho host miễn phí (Render...) nơi ổ đĩa bị xoá mỗi lần khởi động: Upstash Redis qua REST (miễn phí).
// Mỗi người dùng một khóa riêng (giới hạn 1MB / yêu cầu), chỉ ghi phần thay đổi. Không đặt biến thì dùng file JSON như cũ.
const UP_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, ''), UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const remote = !!(UP_URL && UP_TOK);
const savedRemote = new Map();                                   // khóa -> chuỗi đã lưu lần cuối
async function upPipe(cmds) {
  const r = await fetch(UP_URL + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('upstash_' + r.status);
  const j = await r.json(); if (j.some((x) => x && x.error)) throw new Error('upstash_cmd');
  return j.map((x) => x.result);
}
async function loadRemote() {
  const [meta, ids] = await upPipe([['GET', 'glory:meta'], ['SMEMBERS', 'glory:ids']]);
  const m = meta ? JSON.parse(meta) : {};
  db = { users: {}, rel: m.rel || {}, keys: m.keys || {} }; savedRemote.set('glory:meta', meta || '');
  for (let i = 0; i < (ids || []).length; i += 100) {
    const part = ids.slice(i, i + 100), vals = (await upPipe([['MGET', ...part.map((x) => 'glory:u:' + x)]]))[0];
    part.forEach((id, k) => { if (vals[k]) { try { db.users[id] = JSON.parse(vals[k]); savedRemote.set('glory:u:' + id, vals[k]); } catch {} } });
  }
  db.keys ||= {};
}
async function flushRemote() {
  const batches = [[]]; let cur = 0;
  const add = (c) => { const n = JSON.stringify(c).length; if (cur + n > 700_000 && batches[batches.length - 1].length) { batches.push([]); cur = 0; } batches[batches.length - 1].push(c); cur += n; };
  const sets = new Map(), dels = [];                                  // ghi lại đúng bản đã gửi, thay đổi xảy ra giữa chừng sẽ được gửi ở lượt sau
  const meta = JSON.stringify({ rel: db.rel, keys: db.keys });
  if (savedRemote.get('glory:meta') !== meta) { add(['SET', 'glory:meta', meta]); sets.set('glory:meta', meta); }
  const live = new Set();
  for (const [id, u] of Object.entries(db.users)) {
    const k = 'glory:u:' + id, v = JSON.stringify(u); live.add(k);
    if (savedRemote.get(k) !== v) { add(['SET', k, v]); add(['SADD', 'glory:ids', id]); sets.set(k, v); }
  }
  for (const k of savedRemote.keys()) if (k.startsWith('glory:u:') && !live.has(k)) { add(['DEL', k]); add(['SREM', 'glory:ids', k.slice(8)]); dels.push(k); }
  for (const bt of batches) if (bt.length) await upPipe(bt);
  for (const [k, v] of sets) savedRemote.set(k, v);
  for (const k of dels) savedRemote.delete(k);
}
const ready = remote ? loadRemote().catch((e) => { console.error('Không đọc được Upstash:', e.message); throw e; }) : Promise.resolve();
let flushing = false;
setInterval(async () => {
  if (!dirty || flushing) return;
  dirty = false;
  if (!remote) { fs.writeFile(FILE, JSON.stringify(db), () => {}); return; }
  flushing = true;
  try { await flushRemote(); } catch (e) { dirty = true; console.error('Lưu Upstash lỗi, sẽ thử lại:', e.message); } finally { flushing = false; }
}, remote ? 10000 : 2000).unref();
process.on('SIGTERM', () => { if (remote && dirty) flushRemote().finally(() => process.exit(0)); else process.exit(0); });

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pres = {}; // id -> { at, ip, status, version, server, lan }
const rel = (id) => (db.rel[id] ||= { friends: [], in: [], out: [] });
const byToken = (tok) => Object.values(db.users).find((u) => u.tokenHash === sha(tok));
const byName = (n) => Object.values(db.users).find((u) => u.name.toLowerCase() === String(n).toLowerCase());
// ID kết bạn 12 chữ số: mỗi tài khoản một dãy riêng, chỉ chủ tài khoản thấy (không nằm trong brief gửi cho người khác)
const FID = /^\d{12}$/;
const byFid = (f) => (FID.test(String(f)) ? Object.values(db.users).find((u) => u.fid === String(f)) : undefined);
const newFid = () => { let f; do f = String(crypto.randomInt(1, 10)) + String(crypto.randomInt(0, 1e11)).padStart(11, '0'); while (byFid(f)); return f; };
const drop = (arr, id) => { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); };

// Xác minh tài khoản Premium: máy chủ tự hỏi Mojang bằng Minecraft token (token không được lưu lại), nên không ai giả được tên Premium của người khác
let verifyMc = async (token) => {
  const r = await fetch(MC_PROFILE, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j && /^[0-9a-f]{32}$/i.test(j.id || '') && NAME_RE.test(j.name || '') ? { uuid: j.id.toLowerCase(), name: j.name } : null;
};
const num = (v, max) => (Number.isFinite(+v) && +v > 0 ? Math.min(Math.floor(+v), max) : 0);
const cleanStats = (q) => (q && typeof q === 'object' ? { blocksMined: num(q.blocksMined, 1e10), distanceBlocks: num(q.distanceBlocks, 1e9), kills: num(q.kills, 1e9), playerKills: num(q.playerKills, 1e9), deaths: num(q.deaths, 1e9), playMinutes: num(q.playMinutes, 1e8) } : null);
const vipOn = (u) => !!(u.plan && (!u.plan.until || u.plan.until > Date.now()));
const brief = (u) => ({ id: u.id, name: u.name, profile: u.profile || {}, premium: !!u.mcUuid, vip: vipOn(u), since: u.created || 0, stats: u.stats || null });
const newKey = () => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; let b = ''; for (let i = 0; i < 10; i++) b += A[crypto.randomInt(A.length)]; return `GLR_${b}@${String(crypto.randomInt(1000)).padStart(3, '0')}`; };
const tries = new Map();   // userId -> [thời điểm thử sai]
function presenceFor(viewerId, id) {
  const p = pres[id];
  if (!p || Date.now() - p.at > ONLINE_MS || (p.mode === 'invisible' && id !== viewerId)) return { status: 'offline' };   // chế độ Ẩn: bạn bè thấy offline
  const out = { status: p.status, version: p.version, server: p.server || null, mode: p.mode };
  if (p.lan) {
    const same = pres[viewerId] && pres[viewerId].ip === p.ip;
    out.lan = { port: p.lan.port, ips: p.lan.ips || [], address: p.lan.address || '', sameNet: !!same, publicIp: same ? '' : p.ip, relay: !!p.lan.relay };
  }
  return out;
}
// Tin nhắn: mỗi người giữ bản của mình trong u.chat[idBạn] = [{t, m:1 nếu mình gửi, x}] (t tăng dần trong mỗi cuộc trò chuyện, đồng thời là mã tin)
const MSG_MAX = 500, MSG_PER_CHAT = 100, MSG_PER_USER = 1000;
const chatOf = (u, id) => ((u.chat ||= {})[id] ||= []);
const readAt = (u, id) => ((u.readAt || {})[id] || 0);
const unreadOf = (u, id) => (u.chat && u.chat[id] ? u.chat[id].filter((x) => !x.m && x.t > readAt(u, id)).length : 0);
const lastOf = (u, id) => { const c = u.chat && u.chat[id], x = c && c[c.length - 1]; return x ? { t: x.t, m: x.m ? 1 : 0, x: x.x.slice(0, 80) } : null; };
function trimChats(u) {
  let total = Object.values(u.chat || {}).reduce((n, c) => n + c.length, 0);
  while (total > MSG_PER_USER) {                                    // quá nhiều: bỏ tin cũ nhất ở cuộc trò chuyện dài nhất
    const [k, c] = Object.entries(u.chat).sort((a, b) => b[1].length - a[1].length)[0];
    c.shift(); total--; if (!c.length) delete u.chat[k];
  }
}
// Gọi thoại: máy chủ chỉ chuyển "tín hiệu" (lời mời, SDP, ICE) giữa 2 bạn bè; tiếng nói đi thẳng giữa 2 máy (WebRTC). Chỉ nằm trong bộ nhớ, không lưu.
const SIG_TYPES = ['invite', 'accept', 'decline', 'busy', 'offer', 'answer', 'ice', 'end'];
const sig = new Map();        // userId -> { seq, q: [{ s, from, callId, type, data, at }], wait: { done, timer } | null }
const sigOf = (id) => { let x = sig.get(id); if (!x) sig.set(id, (x = { seq: 0, q: [], wait: null })); return x; };
const sigTimes = new Map();
setInterval(() => { const now = Date.now(); for (const [id, x] of sig) { x.q = x.q.filter((m) => now - m.at < 60_000); if (!x.q.length && !x.wait && now - (x.last || 0) > 300_000) sig.delete(id); } }, 30_000).unref();
const ICE_STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
const iceServers = () => {
  const out = [{ urls: ICE_STUN }];
  const turn = (process.env.TURN_URLS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (turn.length) out.push({ urls: turn, username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });   // TURN (tùy chọn) giúp gọi được cả khi mạng chặn kết nối trực tiếp
  return out;
};
const sendTimes = new Map();   // userId -> [thời điểm gửi]
function snapshot(me) {
  if (!me.fid) { me.fid = newFid(); touch(); }
  const r = rel(me.id), U = (id) => db.users[id];
  return {
    me: { ...brief(me), fid: me.fid, plan: vipOn(me) ? { until: me.plan.until || null } : null },
    friends: r.friends.map(U).filter(Boolean).map((u) => ({ ...brief(u), presence: presenceFor(me.id, u.id), unread: unreadOf(me, u.id), last: lastOf(me, u.id) })),
    incoming: r.in.map(U).filter(Boolean).map(brief),
    outgoing: r.out.map(U).filter(Boolean).map(brief),
  };
}

const IMG_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const P_MODES = ['online', 'idle', 'dnd', 'invisible'];
const P_FRAMES = ['none', 'gold', 'diamond', 'emerald', 'flame', 'rainbow', 'pixel'];
const P_FX = ['none', 'gradient', 'glow', 'rainbow', 'pixel'];
const P_PATTERNS = ['none', 'stripes', 'dots', 'grid', 'blocks', 'stars'];
const P_TAGS = ['pvp', 'survival', 'builder', 'redstone', 'speedrun', 'modded', 'creative', 'hardcore', 'skyblock', 'bedwars', 'minigames', 'explorer', 'roleplay', 'trader'];
const P_EMOJIS = ['⚔️', '🛡️', '⛏️', '💎', '🔥', '🎮', '🌙', '⭐', '💀', '🏹', '🧪', '👑', '🌲', '🏠', '❤️', '😎'];
const P_LINKS = ['discord', 'youtube', 'twitch', 'github', 'x', 'tiktok', 'instagram', 'kofi'];
const HANDLE_RE = /^[A-Za-z0-9_.\-#]{1,40}$/;
const PREMIUM_OPT = { frame: ['flame', 'rainbow'], nameFx: ['gradient', 'rainbow', 'pixel'], bannerPattern: ['stars', 'blocks'] };   // tuỳ chỉnh chỉ dành cho Glory Premium
function cleanProfile(p, vip) {
  const o = {}, s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : ''), pick = (v, l, d) => (l.includes(v) ? v : d);
  o.displayName = s(p.displayName, 32); o.pronouns = s(p.pronouns, 20); o.status = s(p.status, 64); o.bio = s(p.bio, 300);
  o.accent = /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#ffbe2e';
  o.bannerColor = /^#[0-9a-f]{6}$/i.test(p.bannerColor) ? p.bannerColor : '#2a1b06';
  o.bannerColor2 = /^#[0-9a-f]{6}$/i.test(p.bannerColor2) ? p.bannerColor2 : '';
  o.banner = typeof p.banner === 'string' && p.banner.length < 160_000 && IMG_RE.test(p.banner) ? p.banner : '';
  o.avatar = typeof p.avatar === 'string' && p.avatar.length < 80_000 && IMG_RE.test(p.avatar) ? p.avatar : '';
  o.mode = pick(p.mode, P_MODES, 'online'); o.frame = pick(p.frame, P_FRAMES, 'none'); o.nameFx = pick(p.nameFx, P_FX, 'none'); o.bannerPattern = pick(p.bannerPattern, P_PATTERNS, 'none');
  if (!vip) for (const [k, list] of Object.entries(PREMIUM_OPT)) if (list.includes(o[k])) o[k] = k === 'frame' || k === 'bannerPattern' ? 'none' : 'none';
  o.statusEmoji = P_EMOJIS.includes(p.statusEmoji) ? p.statusEmoji : '';
  o.tags = (Array.isArray(p.tags) ? p.tags : []).filter((t, i, a) => P_TAGS.includes(t) && a.indexOf(t) === i).slice(0, 5);
  o.links = (Array.isArray(p.links) ? p.links : []).filter((l) => l && P_LINKS.includes(l.t) && typeof l.v === 'string' && HANDLE_RE.test(l.v)).slice(0, 4).map((l) => ({ t: l.t, v: l.v }));
  return o;
}

const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();

// Đăng nhập Google: client gửi id_token (OpenID, chỉ xin scope openid nên không có email); máy chủ nhờ Google xác minh chữ ký rồi chỉ lấy mã `sub`
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_TOKENINFO = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
async function verifyGoogle(idToken) {
  const r = await fetch(GOOGLE_TOKENINFO + '?id_token=' + encodeURIComponent(idToken), { signal: AbortSignal.timeout(8000) });
  if (r.status === 400) return null;                                   // token sai / hết hạn
  if (!r.ok) throw new Error('google_down');
  const j = await r.json();
  const okIss = j.iss === 'https://accounts.google.com' || j.iss === 'accounts.google.com';
  if (!okIss || j.aud !== GOOGLE_CLIENT_ID || !j.sub || !/^\d{5,40}$/.test(String(j.sub)) || (+j.exp * 1000 < Date.now())) return null;
  return { sub: String(j.sub) };
}
const verified = (u) => !!(u && (u.mcUuid || u.gSub));                // chỉ tài khoản Microsoft hoặc Google mới dùng được bạn bè / chat / gọi
const RENAME_MS = 7 * 86_400_000;
const GATED = (p) => p.startsWith('/api/friends/') || p.startsWith('/api/msg/') || p === '/api/call/signal' || p === '/api/call/poll' || p === '/api/search';

function route(req, body, ip) {
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;
  if (p === '/api/health') return [200, { ok: true, premiumOnly: PREMIUM_ONLY }];
  if (p === '/api/register-premium' && m === 'POST') return (async () => {
    if (typeof body.mcToken !== 'string' || body.mcToken.length < 20 || body.mcToken.length > 4000) return [400, { error: 'bad_token' }];
    let prof = null; try { prof = await verifyMc(body.mcToken); } catch { return [502, { error: 'mojang_down' }]; }
    if (!prof) return [401, { error: 'not_premium' }];
    let u = Object.values(db.users).find((x) => x.mcUuid === prof.uuid);
    const clash = byName(prof.name);
    if (clash && clash !== u) {                                  // tên đang bị tài khoản offline giữ: Premium thật được giữ tên, bên kia đổi tên
      if (verified(clash)) return [409, { error: 'name_taken' }];
      clash.name = (clash.name.slice(0, 12) + '_' + crypto.randomBytes(2).toString('hex')).slice(0, 16);
    }
    const token = crypto.randomBytes(24).toString('hex');
    if (!u) { u = { id: crypto.randomUUID(), profile: {}, created: Date.now() }; db.users[u.id] = u; }
    u.mcUuid = prof.uuid; u.name = prof.name; u.tokenHash = sha(token); touch();
    return [201, { id: u.id, token, premium: true }];
  })();
  if (p === '/api/register-google' && m === 'POST') return (async () => {
    if (!GOOGLE_CLIENT_ID) return [503, { error: 'google_off' }];
    if (typeof body.idToken !== 'string' || body.idToken.length < 50 || body.idToken.length > 4000) return [400, { error: 'bad_google' }];
    let g = null; try { g = await verifyGoogle(body.idToken); } catch { return [502, { error: 'google_down' }]; }
    if (!g) return [401, { error: 'bad_google' }];
    let u = Object.values(db.users).find((x) => x.gSub === g.sub);
    if (!u) {
      if (body.name == null) return [200, { needName: true }];          // lần đầu: client phải hỏi người dùng đặt tên
      if (!NAME_RE.test(body.name || '')) return [400, { error: 'bad_name' }];
      const clash = byName(body.name);
      if (clash && verified(clash)) return [409, { error: 'name_taken' }];
      if (clash) clash.name = (clash.name.slice(0, 12) + '_' + crypto.randomBytes(2).toString('hex')).slice(0, 16);   // tên đang do tài khoản offline cũ giữ: nhường lại
      u = { id: crypto.randomUUID(), name: body.name, fid: newFid(), gSub: g.sub, profile: {}, created: Date.now() }; db.users[u.id] = u;
    }
    const token = crypto.randomBytes(24).toString('hex'); u.tokenHash = sha(token); touch();
    return [201, { id: u.id, token, name: u.name, fid: u.fid, google: true }];
  })();
  if (p === '/api/register' && m === 'POST') {
    if (PREMIUM_ONLY) return [403, { error: 'premium_only' }];
    if (!NAME_RE.test(body.name || '')) return [400, { error: 'bad_name' }];
    if (byName(body.name)) return [409, { error: 'name_taken' }];
    if (body.fid != null && !FID.test(String(body.fid))) return [400, { error: 'bad_fid' }];
    if (body.fid != null && byFid(body.fid)) return [409, { error: 'fid_taken' }];
    const token = crypto.randomBytes(24).toString('hex'), id = crypto.randomUUID(), fid = body.fid != null ? String(body.fid) : newFid();
    db.users[id] = { id, name: body.name, fid, tokenHash: sha(token), profile: {}, created: Date.now() };
    touch();
    return [201, { id, token, fid }];
  }
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (p === '/api/admin/keys' && m === 'POST') {            // phát hành key: cần ADMIN_TOKEN, so sánh thời gian cố định
    const a = Buffer.from(sha(tok)), b = Buffer.from(sha(ADMIN_TOKEN));
    if (!ADMIN_TOKEN || !crypto.timingSafeEqual(a, b)) return [401, { error: 'unauthorized' }];
    const count = Math.max(1, Math.min(100, body.count | 0 || 1)), days = Math.max(0, Math.min(3650, body.days | 0));
    const keys = [];
    while (keys.length < count) { const k = newKey(), h = sha(k); if (db.keys[h]) continue; db.keys[h] = { days, created: Date.now(), used: null }; keys.push(k); }
    touch(); return [201, { keys, days }];
  }
  const me = tok && byToken(tok);
  if (!me) return [401, { error: 'unauthorized' }];
  if (GATED(p) && !verified(me)) return [403, { error: 'need_login' }];
  if (p === '/api/google/rename' && m === 'POST') {
    if (!me.gSub) return [403, { error: 'need_login' }];
    if (!NAME_RE.test(body.name || '')) return [400, { error: 'bad_name' }];
    if (me.renamed && Date.now() - me.renamed < RENAME_MS) return [429, { error: 'rename_wait' }];
    const clash = byName(body.name);
    if (clash && clash !== me) { if (verified(clash)) return [409, { error: 'name_taken' }]; clash.name = (clash.name.slice(0, 12) + '_' + crypto.randomBytes(2).toString('hex')).slice(0, 16); }
    me.name = body.name; me.renamed = Date.now(); touch();
    return [200, snapshot(me)];
  }

  if (p === '/api/sync' && m === 'POST') {
    if (!me.fid && FID.test(String(body.fid)) && !byFid(body.fid)) { me.fid = String(body.fid); touch(); }   // tài khoản đăng ký từ trước: nhận ID của client nếu còn trống
    if ('stats' in body) { me.stats = cleanStats(body.stats); touch(); }
    const q = body.presence;
    if (q && typeof q === 'object') {
      const lan = q.lan && Number.isInteger(q.lan.port) ? { port: q.lan.port, ips: (q.lan.ips || []).filter((x) => typeof x === 'string').slice(0, 6), address: String(q.lan.address || '').slice(0, 80), relay: q.lan.relay === true } : null;
      const srv = q.server && typeof q.server.address === 'string' ? { address: q.server.address.slice(0, 80), kind: q.server.kind === 'lan' ? 'lan' : 'public' } : null;
      pres[me.id] = { at: Date.now(), ip, mode: ['online', 'idle', 'dnd', 'invisible'].includes(q.mode) ? q.mode : 'online', status: ['online', 'playing'].includes(q.status) ? q.status : 'online', version: String(q.version || '').slice(0, 16), server: srv, lan };
    } else delete pres[me.id];
    return [200, snapshot(me)];
  }
  if (p === '/api/premium/redeem' && m === 'POST') {
    if (!verified(me)) return [403, { error: 'need_login' }];     // Premium gắn với tài khoản đã xác minh (Microsoft hoặc Google), không gắn với tên offline chưa xác minh
    const now = Date.now(), recent = (tries.get(me.id) || []).filter((t) => now - t < 600_000);
    if (recent.length >= 5) return [429, { error: 'too_many' }];
    const key = String(body.key || '').trim(), rec = KEY_RE.test(key) ? db.keys[sha(key)] : null;
    if (!rec) { recent.push(now); tries.set(me.id, recent); return [404, { error: 'bad_key' }]; }
    if (rec.used) return [409, { error: 'key_used' }];
    const base = vipOn(me) && me.plan.until ? me.plan.until : now;          // gia hạn cộng dồn
    me.plan = { until: rec.days ? base + rec.days * 86_400_000 : null, since: me.plan ? me.plan.since : now };
    rec.used = { by: me.id, at: now }; touch();
    return [200, { ...snapshot(me), plan: me.plan }];
  }
  if (p === '/api/search' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase().slice(0, 16);
    if (q.length < 2) return [200, { users: [] }];
    const r = rel(me.id);
    const users = Object.values(db.users).filter((u) => u.id !== me.id && verified(u) && u.name.toLowerCase().includes(q)).slice(0, 20)
      .map((u) => ({ ...brief(u), rel: r.friends.includes(u.id) ? 'friend' : r.in.includes(u.id) ? 'in' : r.out.includes(u.id) ? 'out' : 'none' }));
    return [200, { users }];
  }
  if (p === '/api/friends/request' && m === 'POST') {
    // Tài khoản offline chỉ tìm được bằng ID 12 số (tên offline ai cũng đặt được); tên chỉ dùng cho tài khoản Premium đã xác minh
    const t = body.fid != null ? byFid(body.fid) : body.id ? db.users[body.id] : (() => { const u = byName(body.name); return u && verified(u) ? u : undefined; })();
    if (!t || t.id === me.id) return [404, { error: 'not_found' }];
    const a = rel(me.id), b = rel(t.id);
    if (a.friends.includes(t.id)) return [200, snapshot(me)];
    if (a.in.includes(t.id)) { drop(a.in, t.id); drop(b.out, me.id); a.friends.push(t.id); b.friends.push(me.id); }
    else if (!a.out.includes(t.id)) { a.out.push(t.id); b.in.push(me.id); }
    touch(); return [200, snapshot(me)];
  }
  if (['/api/friends/accept', '/api/friends/decline', '/api/friends/remove'].includes(p) && m === 'POST') {
    const t = db.users[body.id]; if (!t) return [404, { error: 'not_found' }];
    const a = rel(me.id), b = rel(t.id);
    if (p.endsWith('accept')) { if (a.in.includes(t.id)) { drop(a.in, t.id); drop(b.out, me.id); a.friends.push(t.id); b.friends.push(me.id); } }
    else { for (const k of ['in', 'out', 'friends']) { drop(a[k], t.id); drop(b[k], me.id); } if (p.endsWith('remove')) { if (me.chat) delete me.chat[t.id]; if (t.chat) delete t.chat[me.id]; } } // decline = từ chối / hủy lời mời; remove = hủy kết bạn
    touch(); return [200, snapshot(me)];
  }
  if (p === '/api/call/ice' && m === 'GET') return [200, { iceServers: iceServers() }];
  if (p === '/api/call/signal' && m === 'POST') {
    const t = db.users[body.to];
    if (!t || !rel(me.id).friends.includes(t.id)) return [403, { error: 'not_friends' }];
    if (!SIG_TYPES.includes(body.type) || typeof body.callId !== 'string' || !/^[A-Za-z0-9_-]{6,40}$/.test(body.callId)) return [400, { error: 'bad_signal' }];
    const data = body.data == null ? null : body.data;
    if (data != null && JSON.stringify(data).length > 40_000) return [413, { error: 'too_large' }];
    const now = Date.now(), recent = (sigTimes.get(me.id) || []).filter((x) => now - x < 10_000);
    if (recent.length >= 80) return [429, { error: 'slow_down' }];
    recent.push(now); sigTimes.set(me.id, recent);
    const box = sigOf(t.id); box.last = now;
    box.q.push({ s: ++box.seq, from: me.id, callId: body.callId, type: body.type, data, at: now });
    if (box.q.length > 200) box.q.splice(0, box.q.length - 200);
    if (box.wait) { const w = box.wait; box.wait = null; clearTimeout(w.timer); w.done(); }
    return [200, { ok: true }];
  }
  if (p === '/api/call/poll' && m === 'GET') {       // long-poll: giữ yêu cầu tới 25 giây cho tới khi có tín hiệu. after = mã tín hiệu cuối đã nhận (xác nhận để xoá)
    const after = +url.searchParams.get('after') || 0, box = sigOf(me.id); box.last = Date.now();
    const take = () => { box.q = box.q.filter((x) => x.s > after && Date.now() - x.at < 60_000); return { signals: box.q.map((x) => ({ s: x.s, from: x.from, callId: x.callId, type: x.type, data: x.data })), seq: box.seq }; };
    if (box.q.some((x) => x.s > after)) return [200, take()];
    return new Promise((resolve) => {
      if (box.wait) { clearTimeout(box.wait.timer); box.wait.done(); }       // chỉ giữ một yêu cầu chờ cho mỗi người
      const done = () => resolve([200, take()]);
      box.wait = { done, timer: setTimeout(() => { if (box.wait && box.wait.done === done) box.wait = null; done(); }, 25_000) };
    });
  }
  if (p === '/api/msg/send' && m === 'POST') {
    const t = db.users[body.to], text = typeof body.text === 'string' ? body.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : '';
    if (!t || !rel(me.id).friends.includes(t.id)) return [403, { error: 'not_friends' }];
    if (!text || [...text].length > MSG_MAX) return [400, { error: 'bad_msg' }];
    const now = Date.now(), recent = (sendTimes.get(me.id) || []).filter((x) => now - x < 10_000);
    if (recent.length >= 12) return [429, { error: 'slow_down' }];
    recent.push(now); sendTimes.set(me.id, recent);
    const a = chatOf(me, t.id), b = chatOf(t, me.id);
    const at = Math.max(now, (a.length ? a[a.length - 1].t : 0) + 1, (b.length ? b[b.length - 1].t : 0) + 1);
    a.push({ t: at, m: 1, x: text }); b.push({ t: at, x: text });
    for (const [u, c] of [[me, a], [t, b]]) { if (c.length > MSG_PER_CHAT) c.splice(0, c.length - MSG_PER_CHAT); trimChats(u); }
    (me.readAt ||= {})[t.id] = at;                                   // gửi tin = đã đọc mọi thứ trước đó
    touch(); return [201, { msg: { t: at, m: 1, x: text } }];
  }
  if (p === '/api/msg/list' && m === 'GET') {
    const id = url.searchParams.get('with') || '', after = +url.searchParams.get('after') || 0;
    if (!rel(me.id).friends.includes(id)) return [403, { error: 'not_friends' }];
    const c = (me.chat && me.chat[id]) || [];
    const out = c.filter((x) => x.t > after).map((x) => ({ t: x.t, m: x.m ? 1 : 0, x: x.x }));
    if (url.searchParams.get('read') === '1' && c.length) { const last = c[c.length - 1].t; if (readAt(me, id) < last) { (me.readAt ||= {})[id] = last; touch(); } }
    return [200, { msgs: out }];
  }
  if (p === '/api/profile' && m === 'PUT') { me.profile = cleanProfile(body, vipOn(me)); touch(); return [200, snapshot(me)]; }
  if (p.startsWith('/api/profile/') && m === 'GET') {
    const u = db.users[p.slice(13)]; if (!u) return [404, { error: 'not_found' }];
    return [200, { ...brief(u), isFriend: rel(me.id).friends.includes(u.id) }];
  }
  return [404, { error: 'not_found' }];
}

const server = http.createServer((req, res) => {
  const ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (n > 300) return send(429, { error: 'rate_limited' });
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 400_000) { send(413, { error: 'too_large' }); req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (res.writableEnded) return;
    let body = {};
    if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return send(400, { error: 'bad_json' }); } }
    ready.then(() => route(req, body, ip)).then(([code, obj]) => send(code, obj)).catch(() => send(500, { error: 'server_error' }));
  });
});

// Chuyển tiếp LAN qua máy chủ (không cần VPN, không cần mở cổng router): chủ thế giới LAN giữ một kết nối điều khiển WebSocket tới đây;
// khi một người bạn bấm "Vào chơi", máy chủ báo cho chủ mở thêm một kết nối "accept" rồi nối thẳng hai kết nối đó với nhau (chỉ chuyển byte, không đọc nội dung).
let WebSocketServer = null; try { ({ WebSocketServer } = require('ws')); } catch {}
const hostCtl = new Map(), waiting = new Map(), pipeCount = new Map();   // userId -> ws điều khiển | mã kết nối -> chờ ghép | userId chủ -> số đường đang chạy
const MAX_PIPES = 8, BUF_MAX = 262144;
function relayConn(ws, url, me) {
  const kind = url.pathname;
  if (kind === '/relay/host') {
    const old = hostCtl.get(me.id); if (old && old !== ws) try { old.close(4000, 'replaced'); } catch {}
    hostCtl.set(me.id, ws); ws.alive = true; ws.on('pong', () => { ws.alive = true; });
    ws.on('close', () => { if (hostCtl.get(me.id) === ws) hostCtl.delete(me.id); });
    ws.on('error', () => {}); ws.on('message', () => {});
    return;
  }
  if (kind === '/relay/join') {
    const host = db.users[url.searchParams.get('to')], ctl = host && hostCtl.get(host.id);
    if (!host || !rel(me.id).friends.includes(host.id)) return ws.close(4403, 'not_friends');
    if (!ctl || ctl.readyState !== 1) return ws.close(4404, 'no_host');
    if ((pipeCount.get(host.id) || 0) >= MAX_PIPES) return ws.close(4429, 'busy');
    const id = crypto.randomBytes(8).toString('hex'), w = { joiner: ws, host: host.id, buf: [], size: 0, peer: null };
    waiting.set(id, w); pipeCount.set(host.id, (pipeCount.get(host.id) || 0) + 1);
    const timer = setTimeout(() => { if (!w.peer) ws.close(4408, 'timeout'); }, 10_000);
    ws.on('message', (d) => {
      if (w.peer) { if (w.peer.readyState === 1) w.peer.send(d, { binary: true }); return; }
      w.size += d.length; if (w.size > BUF_MAX) return ws.close(4413, 'too_large'); w.buf.push(d);
    });
    ws.on('close', () => { clearTimeout(timer); waiting.delete(id); pipeCount.set(host.id, Math.max(0, (pipeCount.get(host.id) || 1) - 1)); if (w.peer) try { w.peer.close(); } catch {} });
    ws.on('error', () => {});
    try { ctl.send(JSON.stringify({ t: 'open', id, from: me.id })); } catch { ws.close(4404, 'no_host'); }
    return;
  }
  if (kind === '/relay/accept') {
    const id = url.searchParams.get('id') || '', w = waiting.get(id);
    if (!w || w.host !== me.id || w.peer) return ws.close(4404, 'no_pending');
    waiting.delete(id); w.peer = ws;
    ws.on('message', (d) => { if (w.joiner.readyState === 1) w.joiner.send(d, { binary: true }); });
    ws.on('close', () => { try { w.joiner.close(); } catch {} });
    ws.on('error', () => {});
    for (const d of w.buf.splice(0)) ws.send(d, { binary: true });
    return;
  }
  ws.close(4400, 'bad_path');
}
if (WebSocketServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, perMessageDeflate: false });
  setInterval(() => { for (const ws of hostCtl.values()) { if (ws.alive === false) { try { ws.terminate(); } catch {} continue; } ws.alive = false; try { ws.ping(); } catch {} } }, 25_000).unref();
  server.on('upgrade', (req, socket, head) => {
    const ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    const n = (hits.get(ip) || 0) + 1; hits.set(ip, n);
    const deny = (c) => { try { socket.write(`HTTP/1.1 ${c}\r\nConnection: close\r\n\r\n`); } catch {} socket.destroy(); };
    let url; try { url = new URL(req.url, 'http://x'); } catch { return deny('400 Bad Request'); }
    if (!url.pathname.startsWith('/relay/') || n > 300) return deny(n > 300 ? '429 Too Many Requests' : '404 Not Found');
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
    ready.then(() => {
      const me = tok && byToken(tok); if (!me) return deny('401 Unauthorized');
      wss.handleUpgrade(req, socket, head, (ws) => relayConn(ws, url, me));
    }).catch(() => deny('500 Server Error'));
  });
}
if (require.main === module) ready.then(() => server.listen(PORT, () => console.log(`Glory Social server: http://localhost:${PORT} (${remote ? 'Upstash' : 'file'})`)), () => process.exit(1));
module.exports = server;
module.exports.ready = ready;
module.exports.setVerifier = (f) => { verifyMc = f; };

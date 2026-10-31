// Mô hình cosmetic dùng chung (máy chủ kiểm tra, launcher xem trước, mod trong game đọc): chỉ gồm các khối hộp có UV + 1 ảnh texture PNG.
// Nguồn: file Blockbench (.bbmodel, định dạng java_block). Quy ước toạ độ: khối 16x16x16 của Blockbench, mặt trước nhìn về hướng bắc = -z, y hướng lên.
// Điểm (8,0,8) của mô hình được đặt vào điểm neo của vị trí đeo (giữa đáy của bộ phận đó), rồi áp tf (phóng, xoay, dời) do người đăng chỉnh:
//   head: đáy đầu (cổ), mũ đặt từ y=8 trở lên     back: đáy thân (eo), ba lô/cánh        armR/armL: lòng bàn tay (đáy cánh tay)     legR/legL: bàn chân (đáy chân)
// FILE NÀY CÓ HAI BẢN GIỐNG HỆT: server/cosmodel.js và renderer/cosmodel.js (test-cosmodel.js kiểm tra).
(function (root) {
  'use strict';
  const FACES = ['north', 'east', 'south', 'west', 'up', 'down'];
  const SLOTS = ['head', 'back', 'armR', 'armL', 'legR', 'legL'];
  const LIM = { els: 64, coord: [-48, 64], tex: 98304, texDim: 256, name: 30, desc: 120, reach: 64, move: 32, scale: [0.1, 4] };
const D2R = Math.PI / 180;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const vec = (a, lo, hi) => (Array.isArray(a) && a.length === 3 && a.every(fin) && a.every((x) => x >= lo && x <= hi) ? a.map(r3) : null);

  // Quay quanh o, thứ tự X rồi Y rồi Z (độ), giống Blockbench
  function rot(p, o, r) {
    let x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2], c, s, t;
    if (r[0]) { c = Math.cos(r[0] * D2R); s = Math.sin(r[0] * D2R); t = y * c - z * s; z = y * s + z * c; y = t; }
    if (r[1]) { c = Math.cos(r[1] * D2R); s = Math.sin(r[1] * D2R); t = x * c + z * s; z = -x * s + z * c; x = t; }
    if (r[2]) { c = Math.cos(r[2] * D2R); s = Math.sin(r[2] * D2R); t = x * c - y * s; y = x * s + y * c; x = t; }
    return [x + o[0], y + o[1], z + o[2]];
  }
  // Điểm của mô hình -> toạ độ so với điểm neo, theo trục khối: xoay phần tử, rồi phóng - xoay - dời theo tf
  function xform(p, e, tf) {
    const q = rot(p, e.o, e.r), t = tf || {}, s = t.s || [1, 1, 1], m = t.m || [0, 0, 0];
    const l = rot([(q[0] - 8) * s[0], q[1] * s[1], (q[2] - 8) * s[2]], [0, 0, 0], t.r || [0, 0, 0]);
    return [l[0] + m[0], l[1] + m[1], l[2] + m[2]];
  }
  function pngDims(b64) {
    try {
      const head = typeof Buffer !== 'undefined' ? Buffer.from(b64.slice(0, 64), 'base64') : Uint8Array.from(atob(b64.slice(0, 64)), (c) => c.charCodeAt(0));
      if (head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) return null;
      const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
      return { w: dv.getUint32(16), h: dv.getUint32(20) };
    } catch { return null; }
  }
  // Kiểm tra data-URL PNG: trả về { tex } hoặc { error }
  function cleanTex(s) {
    if (typeof s !== 'string') return { error: 'cm_tex' };
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(s); if (!m) return { error: 'cm_tex' };
    if (m[1].length * 0.75 > LIM.tex) return { error: 'cm_tex_big' };
    const d = pngDims(m[1]); if (!d || !d.w || !d.h || d.w > LIM.texDim || d.h > LIM.texDim) return { error: 'cm_tex_dim' };
    return { tex: s, w: d.w, h: d.h };
  }
  // Làm sạch mô hình (nhận từ launcher hoặc file người dùng): chỉ giữ trường hợp lệ, làm tròn số, chặn kích thước bất thường
  function clean(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.els)) return { error: 'cm_model' };
    if (!raw.els.length) return { error: 'cm_empty' };
    if (raw.els.length > LIM.els) return { error: 'cm_many' };
    const w = Math.max(1, Math.min(LIM.texDim, Math.round(+raw.w || 64))), h = Math.max(1, Math.min(LIM.texDim, Math.round(+raw.h || 64))), [lo, hi] = LIM.coord, els = [];
    for (const e of raw.els) {
      if (!e || typeof e !== 'object') return { error: 'cm_model' };
      const f = vec(e.f, lo, hi), t = vec(e.t, lo, hi); if (!f || !t) return { error: 'cm_range' };
      const o = vec(e.o, lo, hi) || [(f[0] + t[0]) / 2, (f[1] + t[1]) / 2, (f[2] + t[2]) / 2], r = vec(e.r, -180, 180) || [0, 0, 0], fc = {};
      for (const n of FACES) {
        const q = e.fc && e.fc[n]; if (!Array.isArray(q) || q.length < 4 || !q.slice(0, 4).every(fin)) continue;
        const rot = [0, 90, 180, 270].includes(q[4]) ? q[4] : 0; fc[n] = [...q.slice(0, 4).map((v) => r3(Math.max(-1024, Math.min(1024, v)))), rot];
      }
      els.push({ f, t, o, r, fc });
    }
    const tr = raw.tf && typeof raw.tf === 'object' ? raw.tf : {}, tf = { m: vec(tr.m, -LIM.move, LIM.move) || [0, 0, 0], r: vec(tr.r, -180, 180) || [0, 0, 0], s: vec(tr.s, LIM.scale[0], LIM.scale[1]) || [1, 1, 1] };
    for (const e of els) for (const cx of [e.f[0], e.t[0]]) for (const cy of [e.f[1], e.t[1]]) for (const cz of [e.f[2], e.t[2]]) if (xform([cx, cy, cz], e, tf).some((v) => Math.abs(v) > LIM.reach)) return { error: 'cm_far' };   // không cho món vươn quá 4 block khỏi người
    return { model: { v: 1, w, h, els, tf } };
  }
  // Đọc file Blockbench (đã JSON.parse): trả về { model, tex } hoặc { error }
  function fromBB(bb) {
    if (!bb || typeof bb !== 'object' || !Array.isArray(bb.elements)) return { error: 'cm_bb' };
    const tx = Array.isArray(bb.textures) ? bb.textures[0] : null; if (!tx || typeof tx.source !== 'string') return { error: 'cm_notex' };
    const res = bb.resolution || {}, w = +tx.uv_width || +res.width || 64, h = +tx.uv_height || +res.height || 64, els = [];
    for (const e of bb.elements) {
      if (!e || e.type !== 'cube' || e.export === false) continue;
      const fc = {}; for (const n of FACES) { const q = e.faces && e.faces[n]; if (q && Array.isArray(q.uv)) fc[n] = [...q.uv.slice(0, 4), q.rotation || 0]; }
      let r = [0, 0, 0]; if (Array.isArray(e.rotation) && e.rotation.length === 3) r = e.rotation; else if (e.rotation && e.rotation.angle) { const a = e.rotation.angle, ax = e.rotation.axis; r = ax === 'x' ? [a, 0, 0] : ax === 'y' ? [0, a, 0] : [0, 0, a]; }
      els.push({ f: e.from, t: e.to, o: e.origin, r, fc });
    }
    const c = clean({ w, h, els }); if (c.error) return c;
    const t = cleanTex(tx.source); if (t.error) return t;
    return { model: c.model, tex: t.tex };
  }
  const api = { FACES, SLOTS, LIM, clean, cleanTex, fromBB, xform, rot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CosModel = api;
})(typeof self !== 'undefined' ? self : this);

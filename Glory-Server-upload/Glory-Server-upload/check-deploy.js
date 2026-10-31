// Kiểm tra repo máy chủ có ĐỦ file trước khi chạy. Chạy tự động ở bước build của Render (npm install -> postinstall) và có thể chạy tay: node check-deploy.js
// Lý do: glory-server.js nạp các file cùng thư mục (coins.js, cosmetics.js, cosmodel.js). Thiếu một file thì máy chủ sập ngay lúc khởi động
// và MỌI chức năng (bạn bè, chat, cuộc gọi, coin) đều ngừng. Có file này thì deploy thiếu file sẽ bị báo lỗi rõ ràng ngay ở bước build
// (Render giữ nguyên bản đang chạy tốt) thay vì làm sập máy chủ.
// Thông báo dùng tiếng Việt không dấu cho đọc được trong mọi bảng log.
'use strict';
const fs = require('fs');
const path = require('path');

const ENTRY = 'glory-server.js';
const REQ = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

// Tên "gần giống" thường gặp khi tải file về trình duyệt: "coins (1).js", "coins - Copy.js", "coins.js.txt", "coins-1.js"
function nearMiss(dir, wanted) {
  const base = wanted.replace(/\.js$/, '').toLowerCase();
  let names = []; try { names = fs.readdirSync(dir); } catch {}
  return names.filter((n) => {
    const l = n.toLowerCase();
    return l !== wanted.toLowerCase() && l.startsWith(base) && /^(\s*\(\d+\)|\s*-\s*copy(\s*\(\d+\))?|[-_]\d+|\.js)/.test(l.slice(base.length));
  });
}

// Duyệt từ file chính, đi theo mọi require('./...') cục bộ. Trả về { ok, missing: [{ file, by, near }] }
function check(dir) {
  const seen = new Set(), queue = [ENTRY], missing = [];
  while (queue.length) {
    const f = queue.shift(); if (seen.has(f)) continue; seen.add(f);
    let src; try { src = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(REQ)) {
      let rel = path.posix.normalize(m[1]); if (!/\.(js|json|cjs)$/.test(rel)) rel += '.js';
      if (fs.existsSync(path.join(dir, rel))) { if (rel.endsWith('.js') && !rel.includes('/')) queue.push(rel); }
      else if (!missing.some((x) => x.file === rel)) missing.push({ file: rel, by: f, near: nearMiss(dir, rel) });
    }
  }
  if (!fs.existsSync(path.join(dir, ENTRY))) missing.unshift({ file: ENTRY, by: '(file chinh)', near: nearMiss(dir, ENTRY) });
  return { ok: missing.length === 0, missing };
}

function report(r) {
  const out = ['', '[LOI] Thieu file, may chu SE KHONG khoi dong duoc (neu cu chay thi bat ky chuc nang nao: ban be, chat, coin deu ngung):'];
  for (const m of r.missing) {
    out.push(`  - ${m.file}   (${m.by} can file nay)`);
    for (const n of m.near) out.push(`      Thay file ten "${n}": hay DOI TEN thanh "${m.file}" (trinh duyet tu them "(1)" khi tai trung file)`);
  }
  out.push('', 'Cach sua: tren GitHub repo Glory-Server bam Add file > Upload files, keo THANH DU cac file cua thu muc server (xem HOSTING.md, muc "Cac file bat buoc"), dung ten, roi Commit.', '');
  return out.join('\n');
}

if (require.main === module) {
  const r = check(__dirname);
  if (r.ok) console.log('[OK] Du file may chu.'); else { console.error(report(r)); process.exit(1); }
}
module.exports = { check, report, nearMiss };

// dev-features.js — Phase #1 (chẩn đoán) và Phase #2 (mục lục, F12, rê chuột, gợi ý) là TÍNH
// NĂNG ẨN: không có trong bản `.vsix` đóng gói bình thường, chỉ bật khi:
//
//   1. Extension Host đang chạy ở chế độ KHÔNG PHẢI Production — tức F5 từ mã nguồn (chế độ
//      `Development`) hoặc Extension Test Host (`Test`). Đó là máy của người đang PHÁT TRIỂN
//      extension, không phải máy khách, nên không cần giấu gì với chính họ.
//
//   2. Gói `.vsix` được đóng bằng `node tools/package-vsix.mjs --dev` (xem file đó). Khi ấy
//      packager ghi thêm một FILE ĐÁNH DẤU rỗng — `extension/dev-features.flag` — vào gói. Sự
//      CÓ MẶT của file ấy là tín hiệu, không phải nội dung của nó.
//
// Vì sao một file đánh dấu chứ không phải một dòng trong `package.json`: `package.json` bị đọc
// rộng — Cursor/VS Code hiện nó trong panel Extensions, và người dùng tò mò có thể mở gói `.vsix`
// ra xem (nó chỉ là một file ZIP, xem đầu `package-vsix.mjs`). Một khoá `"dev": true` nằm ngay
// đó là mời người ta hỏi "cờ gì vậy". Một file rỗng cạnh `package.json`, không ai để ý, không
// cần giải thích gì trong `package.json` cả — extension đọc nó, người dùng không cần biết.
//
// Vì sao KHÔNG gate license: license nói AI được phép DÙNG các lệnh chạm dữ liệu/máy khách (xem
// `fboDesigner.previewData`, `addColumns`). Cờ này nói khác — nó nói BẢN NÀY có mang tính năng
// ấy vào hay không, trước cả khi tính tới license. Một bản dựng không mang `dev-features.flag`
// thì license hợp lệ tới đâu cũng không có gì để bật.

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

/** `extension/src/` → `extension/dev-features.flag` — cùng cấp với `package.json`. */
const FLAG_FILE = path.join(__dirname, '..', 'dev-features.flag');

/**
 * @param {vscode.ExtensionContext} context
 * @param {{flagFile?: string}} [opts] chỉ dùng trong test — trỏ tới một file đánh dấu khác
 *   thay vì `FLAG_FILE` thật, để không phải tạo/xoá file ngay trong cây mã nguồn.
 * @returns {boolean}
 */
function devFeaturesEnabled(context, { flagFile = FLAG_FILE } = {}) {
  const mode = context?.extensionMode;
  if (mode === vscode.ExtensionMode.Development || mode === vscode.ExtensionMode.Test) return true;
  // Không đọc được (quyền, ổ đĩa mạng rớt…) thì coi như KHÔNG có cờ — mặc định luôn là ẩn,
  // không phải hiện.
  try {
    return fs.existsSync(flagFile);
  } catch {
    return false;
  }
}

module.exports = { devFeaturesEnabled, FLAG_FILE };

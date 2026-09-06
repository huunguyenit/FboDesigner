// text-position.js — offset → `vscode.Position`, trên MỘT chuỗi văn bản cụ thể.
//
// Gỡ ra khỏi `diagnostic-host.js` khi «đi tới định nghĩa» cần đúng phép quy ấy. Cả hai đều đặt
// một dấu vào file bằng offset mà core trả về, và một bản quy thứ hai là một bản sẽ lệch — lệch
// ở đây thì gạch đỏ và cú nhảy F12 chỉ vào hai chỗ khác nhau của cùng một khai báo.
//
// ═══ VÌ SAO KHÔNG DÙNG `document.positionAt` CHO MỌI FILE ═══
//
// Vì offset đến từ đâu thì phải quy trên CHÍNH chuỗi ấy:
//
//   file đang mở    `document.getText()` — bản trong editor, VS Code giải mã, có thể đang dirty
//   file khác       `core.readSource()`  — bản trên đĩa, CORE giải mã (windows-1258 và bạn bè)
//
// Hai bộ giải mã cho cùng một file có thể ra hai chuỗi khác nhau. Gọi
// `workspace.openTextDocument` cho file Include là để VS Code giải mã lại theo cấu hình của NÓ,
// và mọi dòng có ký tự ngoài ASCII đứng trước sẽ lệch cột.

/**
 * Bảng đầu dòng, dựng MỘT LẦN cho mỗi chuỗi.
 *
 * Không có bảng thì mỗi phép quy phải đếm lại số xuống dòng từ đầu file — một controller vài
 * chục KB với vài chục dấu là vài triệu lượt so ký tự cho một việc đáng lẽ tra bảng.
 *
 * Đếm theo LF chứ không theo CRLF: VS Code tính số dòng đúng như vậy, và với file CRLF thì ký
 * tự CR nằm ở CUỐI dòng trước nên không ảnh hưởng chỉ số cột của dòng sau.
 */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** Chuỗi + bảng đầu dòng của nó — thứ mọi hàm dưới đây nhận vào. */
function entryOf(text) {
  return { text, starts: lineStarts(text) };
}

/**
 * Offset → `{line, character}`, tra nhị phân trên bảng đầu dòng.
 *
 * Trả về số trần chứ không phải `vscode.Position`: file này không import `vscode`, nên nó test
 * được bằng node trần. Người gọi tự bọc — đó là một dòng ở chỗ nó, và là cả một bộ giả lập ở đây.
 */
function positionAt(entry, offset) {
  const at = Math.max(0, Math.min(offset, entry.text.length));
  const starts = entry.starts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid; else hi = mid - 1;
  }
  return { line: lo, character: at - starts[lo] };
}

module.exports = { lineStarts, entryOf, positionAt };

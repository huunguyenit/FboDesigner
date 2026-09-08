// sample-store.js — dữ liệu thật đang hiện trên lưới nào, và cách bảo bề mặt ấy vẽ lại.
//
// Vì sao là một kho RIÊNG chứ không phải một trường trên panel: designer có HAI bề mặt —
// `PreviewPanel` (bám theo file đang active) và `FboDesignerProvider` (custom editor gắn cứng
// vào một document). Chúng khác nhau ở vòng đời và ở cách giữ trạng thái, nhưng cùng gọi
// `buildPayload`. Đặt dữ liệu ở một chỗ mà `buildPayload` đọc được thì cả hai cùng thấy, và lệnh
// «xem dữ liệu thật» không phải biết người dùng đang mở bề mặt nào.
//
// Kho khoá theo ĐƯỜNG DẪN FILE, không theo panel: mở cùng một lưới ở cả hai bề mặt thì cả hai
// cùng hiện dữ liệu ấy — đó là điều người dùng chờ đợi, và cũng là điều đơn giản hơn để giải
// thích.
//
// Dữ liệu KHÔNG bao giờ được ghi ra đĩa và không sống qua một phiên VS Code. Đây là dữ liệu
// THẬT của khách; giữ nó lâu hơn mức cần để vẽ một bản xem trước là tự chuốc lấy trách nhiệm
// không ai yêu cầu.

/** fsPath (thường hoá) → { rows, columns, skipped, notes, masked, table, top, at } */
const store = new Map();

/** fsPath (thường hoá) → Set<() => void> — bề mặt nào cần vẽ lại khi dữ liệu đổi. */
const refreshers = new Map();

/**
 * File nào NGƯỜI DÙNG đã tự tắt dữ liệu đi.
 *
 * Cần từ khi có tuỳ chọn tự nạp (`fboDesigner.autoLoadSampleData`): không có nó thì bấm
 * `Ctrl+Alt+D` để tắt xong, nhảy sang file khác rồi quay lại là dữ liệu tự về — người dùng vừa
 * bảo "đừng hiện nữa" và công cụ hiện lại ngay. Một lần TẮT TAY thắng tuỳ chọn tự nạp, cho tới
 * khi họ tự bấm nạp lại.
 */
const dismissed = new Set();

const keyOf = (p) => String(p ?? '').toLowerCase();

/** Đặt dữ liệu cho một file, rồi bảo mọi bề mặt đang vẽ file ấy vẽ lại. */
function setSample(fsPath, data) {
  store.set(keyOf(fsPath), data);
  dismissed.delete(keyOf(fsPath));
  requestRefresh(fsPath);
}

/** Người dùng tự tắt — nhớ lại để lần tự nạp sau không cãi lời họ. */
function dismissSample(fsPath) {
  dismissed.add(keyOf(fsPath));
}

/** @returns {boolean} người dùng đã tự tắt file này trong phiên này chưa */
function isDismissed(fsPath) {
  return dismissed.has(keyOf(fsPath));
}

/** @returns {object|null} */
function getSample(fsPath) {
  return store.get(keyOf(fsPath)) ?? null;
}

/** Bỏ dữ liệu của một file — lưới quay về bản vẽ giữ chỗ. */
function clearSample(fsPath) {
  const had = store.delete(keyOf(fsPath));
  if (had) requestRefresh(fsPath);
  return had;
}

/**
 * Đăng ký một bề mặt. Trả về hàm gỡ đăng ký — bề mặt PHẢI gọi nó lúc dispose, nếu không thì
 * closure `render` của một panel đã đóng còn nằm lại và mỗi lần đổi dữ liệu là một lần gọi vào
 * một webview đã chết.
 */
function onRefresh(fsPath, fn) {
  const k = keyOf(fsPath);
  if (!refreshers.has(k)) refreshers.set(k, new Set());
  const set = refreshers.get(k);
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) refreshers.delete(k);
  };
}

function requestRefresh(fsPath) {
  const set = refreshers.get(keyOf(fsPath));
  if (!set) return;
  // Một bề mặt ném không được kéo theo bề mặt còn lại: chúng độc lập với nhau.
  for (const fn of [...set]) {
    try { fn(); } catch { /* bề mặt tự lo, ở đây không có gì làm được */ }
  }
}

/** Quên hết — gọi khi extension deactivate. */
function clearAll() {
  store.clear();
  refreshers.clear();
  dismissed.clear();
}

module.exports = { setSample, getSample, clearSample, dismissSample, isDismissed, onRefresh, clearAll };

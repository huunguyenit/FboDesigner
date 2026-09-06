// warn.mjs — MỘT hình dạng duy nhất cho mọi cảnh báo chẩn đoán của core.
//
// Vì sao phải tách ra: trước bản này mỗi chỗ tự đẻ một hình dạng riêng. `item-value.mjs` đẩy
// chuỗi tiếng Việt viết thẳng trong code, `render.mjs`/`grid.mjs` bọc `{item, message}`,
// `entities.mjs` đẩy `{severity, message}`. Ba hình dạng ấy đủ để in ra một danh sách trong
// webview — thứ duy nhất từng tiêu thụ chúng — nhưng KHÔNG đủ để đặt một gạch đỏ vào file.
//
// Gạch đỏ cần ba thứ mà không hình dạng nào ở trên có:
//
//   code      khoá `messages.json`. Là thứ ổn định để lọc/tắt từng luật; chuỗi thông điệp thì
//             không — nó đổi mỗi lần ai đó sửa lại câu chữ cho dễ đọc hơn.
//   severity  'error' | 'warning' | 'info'. Phân biệt «form CHẮC CHẮN vẽ sai» với «vẽ được
//             nhưng có chỗ đáng ngờ» — trộn hai thứ vào một mức là Problems panel đầy màu đỏ
//             và người đọc thôi phân biệt.
//   range     dải nguồn `{file, start, end}`. Đây là phần đắt: hàng có thể đến từ một file
//             Include, nên «offset trong văn bản đã bung entity» KHÔNG dùng trực tiếp được.
//
// HAI TẦNG, cố ý:
//
//   local     sinh ra ở nơi chỉ nhìn thấy MỘT chuỗi `value` và không biết gì về file hay
//             offset (`parseWidths`, `parseRow`, `buildCells`). Toạ độ vì thế là `at`/`len`
//             TƯƠNG ĐỐI trong chính chuỗi ấy.
//   anchored  tầng trên (`render.mjs`, `grid.mjs`) cộng offset gốc của chuỗi rồi quy về file
//             thật bằng `sourceRange`, cho ra `range`.
//
// Tầng vỏ chỉ được nhận `anchored`. `range: null` là hợp lệ và có thật — cảnh báo không gắn
// vào một khúc văn bản nào (thiếu CSS nền chẳng hạn); vỏ neo tạm vào đầu file chứ ĐỪNG bịa ra
// một dải, vì một dải bịa trông y hệt một dải thật.
//
// `item` và `message` giữ nguyên tên và ý nghĩa cũ: webview `reportWarnings` đọc đúng hai khoá
// đó, và không có lý do gì bắt nó đổi theo.

import { msg } from './msg.mjs';

/** Mức mặc định. Đa số cảnh báo là «vẽ được nhưng đáng ngờ» — error phải là lựa chọn có ý thức. */
const DEFAULT_SEVERITY = 'warning';

/**
 * Cảnh báo CỤC BỘ trong một chuỗi `value`, chưa biết mình nằm ở file nào.
 *
 * @param {string} code khoá `messages.json`
 * @param {Record<string, unknown>} [params]
 * @param {{severity?: string, at?: number|null, len?: number|null}} [opts]
 *   `at`/`len` là offset TƯƠNG ĐỐI trong chuỗi `value`. `at: null` nghĩa là «không chỉ được vào
 *   khúc nào hẹp hơn cả chuỗi» — tầng trên sẽ neo vào trọn chuỗi, và đó là câu trả lời thành
 *   thật chứ không phải thiếu sót.
 * @returns {{code: string, message: string, severity: string, at: number|null, len: number|null}}
 */
export function local(code, params = {}, { severity = DEFAULT_SEVERITY, at = null, len = null } = {}) {
  return { code, message: msg(code, params), severity, at, len };
}

/**
 * Cảnh báo ĐÃ CÓ NEO — hình dạng cuối cùng, thứ duy nhất tầng vỏ được thấy.
 *
 * @param {string} code
 * @param {Record<string, unknown>} [params]
 * @param {{severity?: string, item?: number|null, range?: {file: string, start: number, end: number}|null}} [opts]
 */
export function anchored(code, params = {}, { severity = DEFAULT_SEVERITY, item = null, range = null } = {}) {
  return { code, message: msg(code, params), severity, item, range };
}

/**
 * `local` → `anchored`: gắn chỉ số hàng và dải nguồn vào một cảnh báo cục bộ.
 *
 * KHÔNG tự tính `range` ở đây, mà nhận sẵn: `sourceRange` sống trong `entities.mjs`, và
 * `entities.mjs` sẽ dùng chính `warn.mjs` này ở bước sau — import ngược lại là một vòng lặp.
 * Người gọi (`render.mjs`, `grid.mjs`) vốn đã import `sourceRange` rồi, nên tính ở đó không
 * tốn thêm gì.
 *
 * `at`/`len` bị bỏ đi sau khi đã dùng để dựng `range`: giữ lại một offset tương đối bên cạnh
 * một dải tuyệt đối là mời người đọc sau này cộng nhầm nó thêm một lần nữa.
 *
 * @param {{code: string, message: string, severity: string, at: number|null, len: number|null}} w
 * @param {{item?: number|null, range?: {file: string, start: number, end: number}|null}} [opts]
 */
export function attach(w, { item = null, range = null } = {}) {
  return { code: w.code, message: w.message, severity: w.severity, item, range };
}

/**
 * Dải TUYỆT ĐỐI (trong văn bản đã bung entity) của một cảnh báo cục bộ, cho trước chỗ bắt đầu
 * của chuỗi `value` chứa nó. Chưa quy về file — đó là việc của `sourceRange` ngay sau đây.
 *
 * Trả `null` khi không có `span` để mà cộng vào: hàng không có `valueSpan` (view của lưới, hoặc
 * value viết bằng entity mà bộ quét không bắt được dải) thì không có toạ độ nào đúng cả.
 *
 * @param {{at: number|null, len: number|null}} w
 * @param {{start: number, end: number}|null} span dải của chuỗi `value` trong văn bản đã bung
 */
export function absoluteSpan(w, span) {
  if (!span) return null;
  // Không chỉ được vào khúc hẹp hơn → neo trọn chuỗi `value`. Thà rộng còn hơn sai chỗ.
  if (w.at === null || !Number.isFinite(w.at)) return { start: span.start, end: span.end };
  const start = span.start + w.at;
  const end = w.len === null || !Number.isFinite(w.len) ? span.end : start + w.len;
  // Kẹp trong dải của chính chuỗi: `at` tính trên chuỗi ĐÃ trim ở vài chỗ, lệch ra ngoài là
  // bôi đen sang thuộc tính bên cạnh — trông như bộ quét đọc nhầm cả thẻ.
  return {
    start: Math.max(span.start, Math.min(start, span.end)),
    end: Math.max(span.start, Math.min(end, span.end)),
  };
}

// columns.mjs — chèn/bỏ MỘT BIÊN trong danh sách cột dùng chung của một vùng form.
//
// Khác hẳn `setSpan`/`setStart` của `item-value.mjs`, và đây là chỗ dễ lẫn nhất:
//
//   setSpan   đổi SỐ CỘT một control đang trải, TRONG danh sách biên có sẵn — một hàng, một
//             `<item>`, danh sách biên không đụng tới.
//   ở đây     đổi CHÍNH danh sách biên (`<item value="100, 60, 90">` của view, hoặc
//             `<category columns="…">` của một tab). Mọi hàng dùng chung danh sách ấy đều phải
//             dồn lại pattern theo — sửa biên mà quên dồn pattern là lệch toạ độ hàng loạt,
//             và lệch kiểu đó không báo lỗi: form vẫn vẽ ra, chỉ mọi ô đứng sai chỗ.
//
// Mọi hàm ở đây THUẦN: nhận chuỗi, trả chuỗi. Không đọc file, không chạm DOM, không biết
// segments là gì — phần quy về toạ độ file nguồn là việc của `edit.mjs`.
import { msg } from './msg.mjs';


/**
 * Cột `col` có đang bị một ô CHIẾM không.
 *
 * `1` mở ô · `0` nối vào ô đang mở · còn lại là trống. Nên phải lần NGƯỢC qua chuỗi `0`: một
 * `0` đứng ngay sau `-` không nối được vào đâu (`buildCells` coi nó là ô trống), còn `0` sau
 * `1` thì đang nằm trong thân một control. Hai ca ấy nhìn chữ giống hệt nhau.
 */
function occupied(chars, col) {
  for (let c = col; c >= 0; c--) {
    if (chars[c] === '1') return true;
    if (chars[c] !== '0') return false;
  }
  return false;
}

/**
 * TÁCH: cột `colIndex` thành hai, tức chèn thêm một ký tự pattern ngay sau nó.
 *
 * Ký tự chèn vào lặp lại đúng tình trạng của cột bị tách — cái gì đang chiếm cột ấy thì chiếm
 * luôn cả hai nửa:
 *
 *   `1` → chèn `0`   control nở thêm một cột, span 1 thành 2 (token không đổi)
 *   `0` → chèn `0`   vẫn là thân của cùng một ô — hoặc vẫn là ô trống, nếu `0` ấy mồ côi
 *   `-` → chèn `-`   ô trống vẫn trống
 *
 * KHÔNG BAO GIỜ chèn `1`. Đó là bất biến quan trọng nhất của cả file: số ký tự `1` không đổi
 * nên danh sách token đi kèm nguyên vẹn, và phép tách không phải đụng tới `[field]` nào.
 *
 * Pattern NGẮN hơn `colIndex` thì trả về nguyên xi: cột ấy vốn đã nằm ngoài pattern, runtime
 * pad `-` cho nó, và pad thêm một cái nữa vẫn ra đúng hình. Ghi lại một pattern đã pad chỉ để
 * nói cùng một chuyện là làm bẩn diff của một hàng không liên quan.
 */
export function splitPatternAt(pattern, colIndex) {
  const chars = Array.from(String(pattern));
  if (colIndex < 0 || chars.length <= colIndex) return String(pattern);
  chars.splice(colIndex + 1, 0, chars[colIndex] === '1' ? '0' : chars[colIndex]);
  return chars.join('');
}

/**
 * GỘP: cột `colIndex` với cột `colIndex + 1`, tức bỏ một ký tự pattern.
 *
 * TỪ CHỐI khi hai cột đang giữ HAI ô khác nhau — gộp lúc ấy là nuốt mất một control mà người
 * dùng không hề yêu cầu. Cùng thái độ với `setSpan`: designer hỏi, không đoán.
 *
 * Ký tự còn lại:
 *
 *   cột trái đang bị chiếm  → giữ ký tự của nó (`1` hay `0`); cột phải chỉ có thể là `0` (ô co
 *                             lại một cột) hoặc `-` (nuốt một ô trống) — cả hai đều không mất gì
 *   cột trái trống, phải `1`→ `1` dời sang cột đã gộp: control cũ giữ nguyên, chỉ bắt đầu sớm hơn
 *   cả hai đều trống        → giữ ký tự cột trái
 *
 * Ở mọi nhánh, ký tự BỊ BỎ không bao giờ là `1` — nên số `1` không đổi và token đi kèm nguyên vẹn.
 *
 * @returns {{ok:true, pattern:string}|{ok:false, reason:string}}
 */
export function mergePatternAt(pattern, colIndex) {
  const text = String(pattern);
  const chars = Array.from(text);
  // Cột phải vốn nằm ngoài pattern (runtime pad `-` cho nó) → không có ký tự nào để bỏ.
  if (colIndex < 0 || chars.length <= colIndex + 1) return { ok: true, pattern: text };

  const a = chars[colIndex];
  const b = chars[colIndex + 1];
  const aOpen = occupied(chars, colIndex);

  if (b === '1' && aOpen) {
    return {
      ok: false,
      reason: msg('columns.merge_two_controls', { p0: colIndex + 1, p1: colIndex + 2 })
        + ' — bỏ một cái trước rồi mới gộp được',
    };
  }

  chars.splice(colIndex, 2, aOpen ? a : (b === '1' ? '1' : a));
  return { ok: true, pattern: chars.join('') };
}

/**
 * Cắt một giá trị list px thành mảnh THÔ, và nói mảnh nào ứng với cột nào.
 *
 * Phải bám đúng luật bỏ mảnh rỗng của `parseWidths` (`"100,,60"` là HAI cột, không phải ba):
 * lệch một nấc ở đây là chèn biên vào nhầm cột, mà nhìn XML thì trông vẫn hợp lý.
 */
function rawPieces(value) {
  const raw = String(value).split(',');
  const cols = [];
  raw.forEach((p, i) => { if (p.trim() !== '') cols.push(i); });
  return { raw, cols };
}

/** Khoảng trắng đầu / cuối một mảnh — giữ lại để list px ghi ra vẫn theo đúng nếp của file. */
function lead(piece) { return /^\s*/.exec(piece)[0]; }
function tail(piece) { return /\s*$/.exec(piece)[0]; }

/**
 * TÁCH một cột trong VĂN BẢN list px: `"100, 60, 90"` tách cột 1 thành 30/30 → `"100, 30, 30, 90"`.
 *
 * Sửa văn bản chứ không dựng lại từ mảng số, vì list px là thứ người ta đọc bằng mắt: giữ
 * nguyên cách ngăn cách và thụt lề thì diff chỉ hiện đúng cột vừa tách.
 *
 * @returns {{ok:true, value:string}|{ok:false, reason:string}}
 */
export function splitWidthsAt(value, colIndex, leftPx, rightPx) {
  const { raw, cols } = rawPieces(value);
  if (colIndex < 0 || colIndex >= cols.length) {
    return { ok: false, reason: msg('columns.col_missing', { p0: colIndex + 1, length: cols.length }) };
  }
  for (const [name, n] of [['nửa trái', leftPx], ['nửa phải', rightPx]]) {
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return { ok: false, reason: msg('columns.px_invalid', { name, n }) };
    }
  }

  /*
   * Khoảng trắng sau dấu phẩy MỚI lấy từ nếp của cả list, không lấy từ mảnh đang tách.
   *
   * Tách cột ĐẦU của `"80, 40, 120"` thì mảnh ấy là `"80"` — không có khoảng trắng đầu, vì nó
   * đứng ngay sau dấu nháy chứ không sau dấu phẩy nào. Chép nếp của nó cho mảnh mới ra
   * `"40,40, 40, 120"`: một dấu phẩy dính, ba dấu phẩy thưa, trông như file bị máy sửa.
   */
  const i = cols[colIndex];
  const piece = raw[i];
  const gap = /,\s/.test(String(value)) ? ' ' : '';
  raw.splice(i, 1, `${lead(piece)}${leftPx}${tail(piece)}`, `${gap}${rightPx}${tail(piece)}`);
  return { ok: true, value: raw.join(',') };
}

/**
 * GỘP hai cột liền kề trong VĂN BẢN list px: `"100, 30, 30, 90"` gộp cột 1+2 → `"100, 60, 90"`.
 *
 * Bề rộng mới là TỔNG hai cột cũ — gộp là bỏ một vạch, không phải bóp form hẹp lại. Tổng khác
 * đi là mọi thứ bên phải vạch ấy dịch chỗ, mà người dùng chỉ yêu cầu bỏ một vạch.
 */
export function mergeWidthsAt(value, colIndex) {
  const { raw, cols } = rawPieces(value);
  if (colIndex < 0 || colIndex + 1 >= cols.length) {
    return { ok: false, reason: msg('columns.merge_no_next', { p0: colIndex + 2, length: cols.length }) };
  }

  const i = cols[colIndex];
  const j = cols[colIndex + 1];
  const sum = Number(raw[i].trim()) + Number(raw[j].trim());
  if (!Number.isFinite(sum)) {
    return { ok: false, reason: msg('columns.px_not_number', { p0: colIndex + 1, p1: colIndex + 2 }) };
  }
  raw.splice(i, j - i + 1, `${lead(raw[i])}${sum}${tail(raw[j])}`);
  return { ok: true, value: raw.join(',') };
}

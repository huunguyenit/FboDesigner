// definition.mjs — con trỏ đang đứng trên thứ gì «đi tới định nghĩa» được (F12).
//
// Chia làm hai nửa, và ranh giới ấy là cả thiết kế:
//
//   NỬA NÀY (thuần)   nhìn VĂN BẢN THÔ tại một offset và trả lời «đây là cái gì». Không đọc
//                     đĩa, không bung entity, không biết file nào tồn tại.
//   NỬA KIA (vỏ)      cầm câu trả lời ấy đi TÌM đích: bung entity, tra bảng khai báo, quy dải
//                     về file nguồn. Xem `extension/src/definition-host.js`.
//
// Vì sao tách: câu hỏi «con trỏ đứng trên cái gì» chỉ cần chuỗi đang mở, nên nó test được
// headless với hàng chục ca biên (giữa token, đúng dấu ngoặc, trong comment). Câu hỏi «cái đó
// khai ở đâu» thì cần cả cây Include — đắt, và đã có sẵn `expandEntities` lo.
//
// BA thứ nhảy được, và không thêm gì nữa cho tới khi có ai đó thật sự cần:
//
//   &Name;                    tham chiếu entity → file/chỗ khai ra nó
//   SYSTEM "..\Include\X.ent" đường dẫn trong chính khai báo → file ấy
//   [ma_kh] / <field name>    tên field → thẻ `<field>` khai nó
//
// Đứng TRÊN CHÍNH thẻ `<field name="x">` trong `<fields>` thì trả `null`: đó đã là định nghĩa
// rồi, và nhảy từ một định nghĩa tới chính nó là một cú nhảy không đi đâu cả.

import { scanViews, scanFields } from './spans.mjs';
import { scanEntityRefs, findInternalSubset } from './entities.mjs';
import { parseRow } from './item-value.mjs';

const inSpan = (span, offset) => !!span && offset >= span.start && offset <= span.end;

/**
 * `SYSTEM "…"` / `PUBLIC "…" "…"` trong một khai báo entity — đường dẫn tới file.
 *
 * Quét trong INTERNAL SUBSET thôi. Ngoài subset thì `SYSTEM "…"` chỉ là văn bản bình thường, và
 * biến một chuỗi bất kỳ thành một cú nhảy tới file là mời người ta bấm F12 vào hư không.
 */
function systemPathAt(text, offset) {
  const subset = findInternalSubset(text);
  if (!subset || subset.subsetStart === -1) return null;
  if (offset < subset.subsetStart || offset > subset.subsetEnd) return null;

  const re = /\bSYSTEM\s+("([^"]*)"|'([^']*)')/gi;
  re.lastIndex = subset.subsetStart;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > subset.subsetEnd) break;
    // Dải của CHÍNH chuỗi trong nháy, không gồm hai dấu nháy: bấm vào dấu nháy cũng tính là
    // bấm vào đường dẫn, nhưng phần trả về thì phải là đường dẫn sạch.
    const quoteStart = m.index + m[0].length - m[1].length;
    const start = quoteStart + 1;
    const end = start + (m[2] ?? m[3] ?? '').length;
    if (offset >= quoteStart && offset <= end + 1) {
      return { kind: 'system', path: m[2] ?? m[3] ?? '', start, end };
    }
  }
  return null;
}

/**
 * Tên field tại một offset nằm trong chuỗi `value` của một `<item>`.
 *
 * Dùng `at`/`len` mà `parseRow` ghi lên từng token — thứ đã có sẵn từ bước gắn toạ độ cho cảnh
 * báo. Không có chúng thì ở đây phải dò lại dấu ngoặc bằng tay, và bản dò thứ hai ấy sẽ đọc
 * `[a].Label, [a]` khác bản thứ nhất ở đúng những ca lắt léo.
 */
function tokenAt(item, offset) {
  const span = item.valueSpan;
  if (!inSpan(span, offset)) return null;
  const rel = offset - span.start;
  for (const t of parseRow(item.value ?? '').tokens) {
    if (!Number.isFinite(t.at) || t.field === null) continue;
    if (rel < t.at || rel > t.at + t.len) continue;
    return { kind: 'field', name: t.field, start: span.start + t.at, end: span.start + t.at + t.len };
  }
  return null;
}

/**
 * @param {string} text   văn bản controller THÔ (chưa bung entity)
 * @param {number} offset vị trí con trỏ
 * @returns {{kind: 'entity'|'system'|'field', name?: string, path?: string, start: number, end: number}|null}
 */
export function definitionTargetAt(text, offset) {
  const src = String(text ?? '');
  const at = Number(offset);
  if (!Number.isFinite(at) || at < 0 || at > src.length) return null;

  // 1. `&Name;` — hỏi trước vì nó rẻ nhất và không lẫn với thứ gì khác.
  for (const ref of scanEntityRefs(src)) {
    if (at >= ref.start && at <= ref.end) {
      return { kind: 'entity', name: ref.name, start: ref.start, end: ref.end };
    }
  }

  // 2. Đường dẫn trong khai báo entity.
  const sys = systemPathAt(src, at);
  if (sys) return sys;

  // 3. Trong một view: token của hàng, hoặc tên cột của lưới.
  for (const view of scanViews(src)) {
    if (at < view.start || at > view.end) continue;

    for (const item of view.items) {
      const hit = tokenAt(item, at);
      if (hit) return hit;
    }

    for (const col of view.columns ?? []) {
      const span = col.attrSpans?.name;
      if (inSpan(span, at)) {
        return { kind: 'field', name: col.name, start: span.start, end: span.end };
      }
    }
  }

  return null;
}

/**
 * Thẻ `<field name="…">` khai ra một tên, tìm trên văn bản ĐÃ BUNG.
 *
 * Trả về dải của THUỘC TÍNH `name` chứ không của cả thẻ: đích của một cú nhảy nên là con trỏ đặt
 * đúng vào cái tên, không phải một khối bôi đen mấy dòng.
 *
 * @returns {{start: number, end: number}|null} offset trong `clearText`
 */
export function fieldDeclarationSpan(clearText, name) {
  const field = scanFields(clearText).find((f) => f.name === name);
  if (!field) return null;
  const span = field.attrSpans?.name;
  return span ? { start: span.start, end: span.end } : { start: field.start, end: field.end };
}

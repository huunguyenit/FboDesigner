// edit-shared.mjs — helper THẬT SỰ dùng chung giữa edit-row.mjs / edit-column.mjs / edit-move.mjs.
//
// Tách từ edit.mjs (Phase 3 audit): sáu hàm này là điểm giao của các cụm — mỗi hàm bị gọi từ
// ÍT NHẤT hai file khác nhau sau khi chia theo cụm (row-edit / column-width / free-move-swap).
// KHÔNG thêm gì vào đây chỉ vì "có vẻ chung chung" — một helper chỉ một file gọi thì ở lại
// đúng file đó, xem `edit.mjs` (barrel) để biết bức tranh tổng.

import { parseRow } from './item-value.mjs';
import { segmentAt } from './entities.mjs';
import { msg } from './msg.mjs';

/** Giữ nguyên khoảng trắng hai bên pattern để diff chỉ hiện phần thật sự đổi. */
export function reindentPattern(patternRaw, pattern) {
  const lead = /^\s*/.exec(patternRaw)[0];
  const tail = /\s*$/.exec(patternRaw)[0];
  return `${lead}${pattern}${tail}`;
}

/**
 * So `before` với `after`, cắt bỏ phần đầu và phần đuôi giống hệt nhau → còn đúng đoạn đã đổi;
 * rồi quy đoạn ấy từ toạ độ clearText về toạ độ FILE NGUỒN qua `segments`. Nhờ vậy đoạn nằm
 * trong `&…;` thì splice rơi thẳng vào khai báo entity, ở đúng file khai nó.
 *
 * MỘT ĐOẠN, MỘT FILE — vắt qua ranh giới hai nguồn thì từ chối: hai splice ở hai file trong
 * cùng một lần hoàn tác là thứ tầng vỏ chưa làm được, và ghi một nửa còn tệ hơn không ghi.
 *
 * @param base   offset (clearText) của ký tự đầu tiên trong `before`
 * @param what   tên thứ đang sửa, chỉ để câu từ chối đọc ra nghĩa
 * @returns {{ok:true, file, splice, expect}|{ok:false, reason:string}}
 */
export function textPatch(segments, base, before, after, what) {
  if (!segments) return { ok: false, reason: msg('edit.source_of_unknown', { what }) };

  // Đầu và đuôi giống nhau thì không phải ghi lại. Chặn hai mốc không cho vượt qua nhau, để
  // đoạn đổi luôn là một dải hợp lệ kể cả khi văn bản dài ra hay ngắn đi.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head
    && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;

  const from = base + head;
  const to = base + before.length - tail;
  const text = after.slice(head, after.length - tail);

  const seg = segmentAt(segments, from);
  if (!seg) return { ok: false, reason: msg('edit.source_of_unknown', { what }) };
  if (to > seg.end) {
    return {
      ok: false,
      reason: msg('edit.cross_entity_boundary', { what }),
    };
  }

  const start = seg.sourceStart + (from - seg.start);
  return {
    ok: true,
    file: seg.file,
    splice: { start, end: start + (to - from), text },
    // Văn bản mà dải đó PHẢI đang mang. Người gọi so nguyên văn trước khi ghi — đây là thứ duy
    // nhất chặn việc ghi nhầm chỗ khi offset lệch.
    expect: before.slice(head, before.length - tail),
  };
}

/**
 * Hàng ĐÚNG NHƯ TRONG FILE — parse lại từ văn bản gốc, không dùng bản đã bung.
 *
 * Đây là chìa của việc «thêm control cạnh một ô viết bằng entity». Model dựng từ `clearText`
 * nên token của nó là `[ma_kh]`; trong file thì đang là `[&k;]`. Ghi bản đã bung đè lên nguồn là
 * xoá tham chiếu — nên bản trước TỪ CHỐI cả phép thêm, dù thêm một control chẳng liên quan gì
 * tới `&k;`.
 *
 * Thao tác trên bản parse của văn bản GỐC thì không còn gì để từ chối: `insertCell` chỉ CHÈN
 * thêm một token, mọi token cũ giữ nguyên `t.raw` — tức vẫn là `[&k;]` — và `serializeRow` ghi
 * lại đúng chuỗi ấy. Với `[&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref]`, thêm control ra
 * đúng chuỗi cũ cộng token mới, không một ký tự nào của entity bị đụng.
 *
 * BA CHỐT, và cả ba đều cần:
 *
 *   1. `range` phải có — không biết hàng nằm đâu thì không đọc lại được.
 *   2. PATTERN không được chứa entity. Phép thêm GHI LẠI pattern (`-` thành `1`), nên một
 *      pattern kiểu `110&Split;-----101-` sẽ bị bung thành chữ. Token có entity thì không sao;
 *      pattern có thì phải từ chối.
 *   3. Bản gốc phải parse ra ĐÚNG pattern và ĐÚNG số token như model. Lệch nghĩa là hoặc offset
 *      đã cũ (người dùng vừa gõ tay), hoặc có entity bung ra nhiều token hơn một — cả hai đều
 *      làm chỉ số ô/token trỏ sai chỗ, và ghi theo chỉ số sai là cắt trúng token khác.
 */
export function sourceRow(row, sourceText, model) {
  if (!row || !row.range) return { ok: false, reason: msg('edit.row_range_unknown') };
  if (typeof sourceText !== 'string') {
    return { ok: false, reason: msg('edit.source_unread') };
  }
  const value = sourceText.slice(row.range.start, row.range.end);
  const parsed = parseRow(value);

  if (/&[A-Za-z_][\w.:-]*;/.test(parsed.patternRaw)) {
    return { ok: false, reason: msg('edit.pattern_is_entity') };
  }
  if (parsed.pattern !== row.row.pattern) {
    return {
      ok: false,
      reason: msg('edit.pattern_mismatch', { pattern: parsed.pattern, pattern2: row.row.pattern }),
    };
  }
  if (parsed.tokens.length !== row.row.tokens.length) {
    return {
      ok: false,
      reason: msg('edit.token_count_mismatch', { length: parsed.tokens.length, length2: row.row.tokens.length })
        + ' — có entity bung ra nhiều token, không map được chỉ số',
    };
  }
  return { ok: true, value, parsed, warning: row.foreign ? row.range.file : null };
}

/** Hàng có ô nhúng lưới Detail — điểm cắt cascade nửa split (`edit-row.mjs`) và nửa dời khối (`edit-move.mjs`). */
export function rowHasEmbeddedGrid(row, model) {
  for (const c of row.cells ?? []) {
    if (c.empty || !c.token?.field) continue;
    const field = model.fieldByName?.get(c.token.field);
    if (String(field?.items?.style ?? '').toLowerCase() === 'grid') return true;
  }
  return false;
}

/**
 * Dải của cả DÒNG chứa `[start,end)` — nuốt thụt lề phía trước và dấu xuống dòng phía sau.
 *
 * Chỉ nuốt thụt lề khi phía trước thật sự CHỈ có khoảng trắng: `<item …/><item …/>` viết chung
 * một dòng thì cắt từ đầu dòng là mất luôn thẻ hàng xóm.
 */
export function lineSpanAround(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const onlyIndent = /^[ \t]*$/.test(text.slice(lineStart, start));
  const after = /^[ \t]*\r?\n/.exec(text.slice(end));
  return {
    start: onlyIndent ? lineStart : start,
    end: onlyIndent && after ? end + after[0].length : end,
  };
}

/**
 * Hàng vừa mất control CUỐI CÙNG → splice bỏ hẳn thẻ `<item>`, không phải ghi lại một value rỗng.
 *
 * Vì sao phải bỏ hẳn: một `<item value="-------: "/>` không còn token nào vẫn CHIẾM một hàng
 * trên form — runtime vẫn dựng `<tr>` cao bằng hàng thường. Người dùng vừa xoá control cuối
 * cùng của hàng và nhìn thấy một khoảng trắng không giải thích được, mà trong XML thì vẫn còn
 * một dòng trông như có nội dung. Xoá hàng là điều họ đang yêu cầu, chỉ chưa nói ra.
 *
 * TỪ CHỐI khi thiếu `itemRange`, hoặc khi thẻ nằm ở file khác dải `value` — hai ca ấy nghĩa là
 * không biết chắc biên của thẻ, và cắt bừa theo phỏng đoán thì mất nhiều hơn một hàng. Khi từ
 * chối, người gọi rơi về lối cũ: ghi lại value rỗng, vẫn đúng, chỉ còn thừa một hàng.
 *
 * @returns {{start:number,end:number,text:string}|null}
 */
export function emptyRowSplice(row, nextRow, sourceText) {
  if (nextRow.tokens.length > 0) return null;
  const at = row.itemRange;
  if (!at || !row.range || at.file !== row.range.file) return null;
  if (at.start > row.range.start || at.end < row.range.end) return null;

  // Đoạn sắp cắt phải THẬT SỰ là một thẻ `<item …/>`; lệch là offset đã cũ.
  const tag = sourceText.slice(at.start, at.end);
  if (!/^<item\b[\s\S]*>$/i.test(tag)) return null;

  const span = lineSpanAround(sourceText, at.start, at.end);
  return { start: span.start, end: span.end, text: '' };
}

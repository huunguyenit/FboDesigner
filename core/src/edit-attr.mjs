// edit-attr.mjs — thuộc tính SỐ trên thẻ mở: chiều cao vùng/tab, và `anchor`/`split` của một
// vùng. Tách từ edit.mjs (Phase 3 audit) — cụm nhỏ nhất, không chia sẻ helper với file nào khác.
//
// Hai con số chiều cao khác nhau, ở hai chỗ khác nhau, và chọn nhầm là kéo một vùng nhưng vùng
// khác co lại:
//
//   `view@height`   chiều cao vùng MAIN (vùng tab) — dùng cho tab KHÔNG chứa lưới
//   `field@rows`    chiều cao của MỘT tab có lưới — khai trên chính field mang `<items style="Grid">`
//
// Luật này lấy từ DWF: «view@height chỉ áp cho tab KHÔNG chứa Grid; tab có Grid dùng field@rows».

import { msg } from './msg.mjs';

/** Chèn hoặc ghi đè một thuộc tính số trên thẻ mở. Dùng chung cho `height` và `rows`. */
function planNumericAttr({ range, tagStart, tagName, attr, current, value, sourceText }) {
  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: msg('edit.attr_must_be_number', { attr }) };

  if (range) {
    if (sourceText.slice(range.start, range.end) !== String(current)) {
      return { ok: false, reason: msg('edit.attr_foreign', { attr }) };
    }
    if (String(n) === String(current)) return { ok: false, reason: msg('common.no_change') };
    return { ok: true, file: range.file, splice: { start: range.start, end: range.end, text: String(n) } };
  }

  // Chưa khai thuộc tính → chèn ngay sau tên thẻ, chỗ chắc chắn nằm trong thẻ mở.
  if (!tagStart) return { ok: false, reason: msg('edit.tag_not_found', { tagName }) };
  const at = tagStart.start + tagName.length + 1;
  if (sourceText.slice(tagStart.start, at) !== `<${tagName}`) {
    return { ok: false, reason: msg('edit.tag_unknown', { tagName }) };
  }
  return { ok: true, file: tagStart.file, splice: { start: at, end: at, text: ` ${attr}="${n}"` } };
}

/** Chiều cao vùng main — `view@height`. */
export function planViewHeight(model, height, sourceText) {
  return planNumericAttr({
    range: model.heightRange,
    tagStart: model.viewTagStart,
    tagName: 'view',
    attr: 'height',
    current: model.mainHeight,
    value: height,
    sourceText,
  });
}

/**
 * `anchor` / `split` của MỘT vùng — chỉ số cột tính từ 1.
 *
 * Ghi vào ĐÚNG thẻ đã khai vùng đó, và đây là chỗ dễ sai nhất: dải header lấy từ `<view>`, còn
 * mỗi tab lấy từ `<category index="n">` của chính nó. Ghi nhầm sang `<view>` khi người dùng kéo
 * marker trong một tab là đổi anchor của cả form — và mọi tab khác lệch theo mà không ai bấm
 * vào chúng. `region.writeback` do `buildRegions` gắn sẵn nên ở đây không phải đoán thẻ nào.
 *
 * `0` là giá trị hợp lệ và có nghĩa «không neo / không chia» — runtime coi `0` như chưa khai
 * (xem `TryValidateViewMetadata` của DWF). Nên không chặn 0; chỉ chặn số âm và số vượt quá số
 * cột của chính vùng đó, vì một marker nằm ngoài bảng thì không vẽ ra được và cũng không sửa lại
 * được bằng chuột.
 */
export function planRegionMetadata(model, regionId, attr, value, sourceText) {
  if (attr !== 'anchor' && attr !== 'split') {
    return { ok: false, reason: msg('edit.attr_readonly', { attr }) };
  }
  const region = (model.regions ?? []).find((r) => r.id === regionId);
  if (!region) return { ok: false, reason: msg('edit.region_missing', { region: regionId }) };
  if (!region.writeback) {
    return { ok: false, reason: msg('edit.region_tag_unknown') };
  }

  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: msg('edit.attr_must_be_number', { attr }) };
  if (n > region.widths.length) {
    return { ok: false, reason: msg('edit.attr_exceeds_cols', { attr, n, length: region.widths.length }) };
  }

  const { tagName, tagStart, anchorRange, splitRange } = region.writeback;
  return planNumericAttr({
    range: attr === 'anchor' ? anchorRange : splitRange,
    tagStart,
    tagName,
    attr,
    current: region[attr],
    value: n,
    sourceText,
  });
}

/** Chiều cao một tab có lưới — `field@rows` trên chính field mang `<items style="Grid">`. */
export function planFieldRows(model, fieldName, rows, sourceText) {
  const field = model.fieldByName.get(fieldName);
  if (!field) return { ok: false, reason: msg('edit.field_missing', { fieldName }) };
  return planNumericAttr({
    range: field.rowsRange ?? null,
    tagStart: field.tagStart ?? null,
    tagName: 'field',
    attr: 'rows',
    current: field.attrs?.rows,
    value: rows,
    sourceText,
  });
}

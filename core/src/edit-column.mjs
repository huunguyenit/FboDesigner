// edit-column.mjs — sửa CỘT: cột lưới (thứ tự, không pattern) và biên cột dùng chung của một
// vùng form (tách/gộp/kéo giãn list px). Tách từ edit.mjs (Phase 3 audit).
//
// Hai cụm này KHÔNG dùng chung hàm nào với nhau — lưới khai layout bằng THỨ TỰ, form bằng
// PATTERN — nhưng cùng gộp một file vì cả hai đều là "sửa độ rộng/thứ tự cột", không đủ lớn để
// tách tiếp mà không vụn.

import {
  splitPatternAt, mergePatternAt, splitWidthsAt, mergeWidthsAt, resizeWidthAt,
} from './columns.mjs';
import { msg } from './msg.mjs';
import { textPatch, reindentPattern } from './edit-shared.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Cột của lưới
//
// Lưới khai layout bằng THỨ TỰ, không bằng pattern — nên phép sửa của nó khác hẳn form, và hai
// bên KHÔNG dùng chung hàm nào. Bốn phép, và chúng đụng vào hai chỗ khác nhau trong file:
//
//   kéo giãn  → `width="N"` trong `<fields><field>`   (khai báo)
//   xoá cột   → `<field name="x"/>` trong `<view>`    (thứ tự hiển thị)
//   chèn cột  → `<field name="x"/>` trong `<view>`
//   dời cột   → cắt/chèn lại `<field name="x"/>` trong `<view>`
//
// Xoá cột mặc định KHÔNG xoá khai báo: cùng một `<field>` có thể được view khác dùng.
// Shift+Delete (`withField`) mới cắt thêm thẻ `<field>` trong `<fields>` (phía host).

/**
 * Đổi bề rộng một cột.
 *
 * Cột chưa khai `width` thì chèn hẳn thuộc tính mới vào thẻ mở — không có `width` nghĩa là
 * runtime tự giãn, và người dùng vừa nói họ muốn một con số cụ thể.
 */
export function planColumnWidth(model, columnName, width, sourceText) {
  const col = model.columns.find((c) => c.name === columnName);
  if (!col) return { ok: false, reason: msg('edit.column_missing', { columnName }) };
  if (!Number.isFinite(width) || width < 0) return { ok: false, reason: msg('edit.width_invalid') };

  const n = Math.round(width);
  if (col.widthRange) {
    if (sourceText.slice(col.widthRange.start, col.widthRange.end) !== String(col.field.attrs.width)) {
      return { ok: false, reason: msg('edit.width_foreign') };
    }
    if (String(n) === String(col.field.attrs.width)) return { ok: false, reason: msg('common.no_change') };
    return {
      ok: true,
      file: col.widthRange.file,
      splice: { start: col.widthRange.start, end: col.widthRange.end, text: String(n) },
    };
  }

  // Chưa có `width=` → chèn vào ngay sau `<field`, chỗ chắc chắn nằm trong thẻ mở.
  if (!col.fieldTagStart) return { ok: false, reason: msg('edit.field_decl_missing', { name: columnName }) };
  const at = col.fieldTagStart.start + '<field'.length;
  if (sourceText.slice(col.fieldTagStart.start, at) !== '<field') {
    return { ok: false, reason: msg('edit.field_tag_unknown') };
  }
  return { ok: true, file: col.fieldTagStart.file, splice: { start: at, end: at, text: ` width="${n}"` } };
}

/**
 * Bỏ một cột khỏi lưới — xoá `<field name="x"/>` trong `<view>`, GIỮ khai báo.
 *
 * Nuốt luôn phần thụt lề và xuống dòng để không để lại một dòng trắng giữa danh sách cột.
 */
export function planRemoveColumn(model, columnName, sourceText) {
  const col = model.columns.find((c) => c.name === columnName);
  if (!col) return { ok: false, reason: msg('edit.column_missing', { columnName }) };
  if (!col.range) return { ok: false, reason: msg('edit.column_range_unknown') };
  if (model.columns.length <= 1) return { ok: false, reason: msg('edit.grid_min_one_col') };

  const raw = sourceText.slice(col.range.start, col.range.end);
  if (!/^<field\b/i.test(raw)) {
    return { ok: false, reason: msg('edit.source_mismatch') };
  }

  const lineStart = sourceText.lastIndexOf('\n', col.range.start - 1) + 1;
  const onlyIndent = /^[ \t]*$/.test(sourceText.slice(lineStart, col.range.start));
  const after = /^\r?\n/.exec(sourceText.slice(col.range.end));
  return {
    ok: true,
    file: col.range.file,
    splice: {
      start: onlyIndent ? lineStart : col.range.start,
      end: onlyIndent && after ? col.range.end + after[0].length : col.range.end,
      text: '',
    },
  };
}

/** Chèn một cột cạnh cột đang chọn. `side` là `left` (trước) hoặc `right` (sau). */
export function planInsertColumn(model, columnName, side, newName, sourceText) {
  const col = model.columns.find((c) => c.name === columnName);
  if (!col) return { ok: false, reason: msg('edit.column_missing', { columnName }) };
  if (!col.range) return { ok: false, reason: msg('edit.column_range_unknown') };
  if (model.columns.some((c) => c.name === newName)) {
    return { ok: false, reason: msg('edit.column_exists', { newName }) };
  }

  const lineStart = sourceText.lastIndexOf('\n', col.range.start - 1) + 1;
  const indent = /^[ \t]*/.exec(sourceText.slice(lineStart, col.range.start))[0];
  const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';
  const tag = `<field name="${String(newName).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"/>`;

  const at = side === 'left' ? lineStart : col.range.end;
  return {
    ok: true,
    file: col.range.file,
    splice: {
      start: at,
      end: at,
      text: side === 'left' ? `${indent}${tag}${eol}` : `${eol}${indent}${tag}`,
    },
  };
}

/**
 * Có luật `arrangement` neo cột `name` không — nếu có thì reorder view sẽ bị ghi đè lúc merge.
 */
function arrangementTargets(arrangement, name) {
  const raw = String(arrangement ?? '').trim();
  if (raw === '') return false;
  for (const rule of raw.split(';')) {
    const cut = rule.indexOf(':');
    if (cut === -1) continue;
    if (rule.slice(0, cut).trim() === name) return true;
  }
  return false;
}

/**
 * Dời một cột trong VIEW — cắt dòng `<field name="x"/>` rồi chèn cạnh cột neo.
 *
 * Chỉ cột controller (`configKind`/`source` null), cùng file, không bị `arrangement` neo.
 * Trả `edits[]` hai splice (xoá + chèn) trên toạ độ gốc — `applySplices` áp từ phải sang trái.
 *
 * @param side {'before'|'after'}
 */
export function planMoveColumn(model, columnName, anchorName, side, sourceText) {
  if (columnName === anchorName) {
    return { ok: false, reason: msg('edit.column_same_target') };
  }
  const from = model.columns.find((c) => c.name === columnName);
  const anchor = model.columns.find((c) => c.name === anchorName);
  if (!from) return { ok: false, reason: msg('edit.column_missing', { columnName }) };
  if (!anchor) return { ok: false, reason: msg('edit.anchor_missing', { anchorName }) };
  if (!from.range) return { ok: false, reason: msg('edit.column_pos_unknown', { columnName }) };
  if (!anchor.range) return { ok: false, reason: msg('edit.anchor_pos_unknown', { anchorName }) };
  if (from.range.file !== anchor.range.file) {
    return { ok: false, reason: msg('edit.column_cross_file') };
  }
  // Cột Config/Initialize mang configKind; cột controller thì null.
  if (from.configKind || from.source) {
    return { ok: false, reason: msg('edit.column_hidden_config', { columnName }) };
  }
  if (anchor.configKind || anchor.source) {
    return { ok: false, reason: msg('edit.anchor_hidden_config', { anchorName }) };
  }
  if (arrangementTargets(model.arrangement, columnName)) {
    return {
      ok: false,
      reason: msg('edit.column_arrangement_pinned', { columnName }),
    };
  }

  const rawFrom = sourceText.slice(from.range.start, from.range.end);
  if (!/^<field\b/i.test(rawFrom)) {
    return { ok: false, reason: msg('edit.source_mismatch') };
  }

  const fromLineStart = sourceText.lastIndexOf('\n', from.range.start - 1) + 1;
  const fromOnlyIndent = /^[ \t]*$/.test(sourceText.slice(fromLineStart, from.range.start));
  const fromAfter = /^\r?\n/.exec(sourceText.slice(from.range.end));
  const removeStart = fromOnlyIndent ? fromLineStart : from.range.start;
  const removeEnd = fromOnlyIndent && fromAfter ? from.range.end + fromAfter[0].length : from.range.end;
  const movedText = sourceText.slice(removeStart, removeEnd);

  const anchorLineStart = sourceText.lastIndexOf('\n', anchor.range.start - 1) + 1;
  const anchorAfter = /^\r?\n/.exec(sourceText.slice(anchor.range.end));
  let insertAt;
  if (side === 'before') {
    insertAt = /^[ \t]*$/.test(sourceText.slice(anchorLineStart, anchor.range.start))
      ? anchorLineStart
      : anchor.range.start;
  } else {
    insertAt = anchorAfter ? anchor.range.end + anchorAfter[0].length : anchor.range.end;
  }

  // Đã đứng đúng chỗ (trước/sau neo liền kề) → không ghi.
  if (side === 'before' && removeEnd === insertAt) {
    return { ok: false, reason: msg('common.no_change') };
  }
  if (side === 'after' && removeStart === insertAt) {
    return { ok: false, reason: msg('common.no_change') };
  }

  // Hai splice không chồng: xoá khối cũ, chèn cùng chữ tại chỗ neo (toạ độ gốc).
  if (removeStart < insertAt && insertAt < removeEnd) {
    return { ok: false, reason: msg('edit.insert_inside_moving') };
  }

  const file = from.range.file;
  return {
    ok: true,
    file,
    edits: [
      { file, start: removeStart, end: removeEnd, text: '' },
      { file, start: insertAt, end: insertAt, text: movedText },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Biên cột của một VÙNG — tách một cột làm hai, gộp hai cột liền kề làm một
//
// Đây là phép sửa NẶNG nhất của form, và nặng vì một lý do cấu trúc: danh sách biên cột là thứ
// DÙNG CHUNG. Một `<item value="100, 60, 90">` ở đầu view là toạ độ của MỌI hàng trong mọi vùng
// không khai `columns` riêng — header, footer, và mọi tab. Sửa danh sách ấy mà quên dồn lại
// pattern của từng hàng phụ thuộc là lệch toạ độ hàng loạt, và lệch kiểu đó KHÔNG báo lỗi:
// form vẫn vẽ ra đủ ô, chỉ mọi ô đứng sai cột.
//
// Nên phép này luôn là MỘT CHÙM splice đi cùng nhau: list px + pattern của mọi hàng dùng chung
// nó + `anchor`/`split` của mọi vùng dùng chung nó. Rơi một mảnh là file ở trạng thái chưa từng
// tồn tại, nên hoặc ghi hết, hoặc từ chối hết.
//
// Đại số thuần (chèn/bỏ một ký tự pattern, cộng/chia một con số px) nằm ở `columns.mjs`; ở đây
// chỉ có phần quy về file nguồn và phần từ chối.

/**
 * Vùng này lấy list px từ ĐÂU — và đó là câu hỏi quyết định phép sửa đụng tới những hàng nào.
 *
 * `<category columns="…">` khai list px RIÊNG cho tab của nó; không khai (hoặc khai rỗng) thì
 * tab rơi về list px của view — cùng luật với `regionWidths` trong `buildViewModel`, và phải
 * cùng luật, vì lệch nhau là sửa một list px nhưng dồn pattern của những hàng đọc list px khác.
 *
 * Khai `<category index="n">` nhiều lần thì bản ĐẦU thắng — `buildRegions` cũng vậy.
 */
function widthsOwnerKey(model, categoryIndex) {
  const cat = (model.categories ?? []).find((c) => c.index === categoryIndex);
  return cat && cat.widths.length > 0 ? `cat:${categoryIndex}` : 'view';
}

/** Chỗ GHI của một list px: dải văn bản (toạ độ clearText) cộng chính văn bản đang nằm ở đó. */
function widthsOwnerOf(model, key) {
  if (key !== 'view') {
    const index = Number(key.slice('cat:'.length));
    const cat = (model.categories ?? []).find((c) => c.index === index);
    const span = cat?.attrSpans?.columns ?? null;
    if (!span) {
      return { ok: false, reason: msg('edit.category_columns_unknown', { index }) };
    }
    return { ok: true, span, value: String(cat.columns), label: `<category index="${index}" columns>` };
  }
  if (model.inferredWidths || !model.widthsItem) {
    return {
      ok: false,
      reason: msg('edit.no_width_list')
        + ' không có biên nào để tách hay gộp',
    };
  }
  if (!model.widthsItem.span) {
    return { ok: false, reason: msg('edit.width_item_unknown') };
  }
  return {
    ok: true,
    span: model.widthsItem.span,
    value: String(model.widthsItem.value),
    label: '<item> list px của view',
  };
}

/**
 * `anchor` / `split` sau khi chèn hoặc bỏ một biên.
 *
 * Cả hai là CHỈ SỐ tính từ 1, nên chèn thêm một cột phía trước chúng là chúng trỏ sai chỗ mà
 * không ai báo — đúng kiểu hỏng vài tuần sau mới lộ. Nhưng hai con số đếm hai thứ KHÁC nhau,
 * và đó là lý do chúng không dùng chung công thức:
 *
 *   `anchor = j`  cột thứ j là cột được neo            → đếm CỘT
 *   `split = k`   bảng chia làm hai SAU cột thứ k      → đếm VẠCH
 *
 * Tách cột `c` (0-based, tức cột `c+1` tính từ 1):
 *   anchor  j > c+1 → j+1 · j = c+1 giữ nguyên (neo bám nửa TRÁI, nửa mới nằm bên phải nó)
 *   split   k ≥ c+1 → k+1 (vạch sau cột bị tách nay là vạch sau nửa phải)
 *
 * Gộp cột `c` với `c+1`:
 *   anchor  j > c+2 → j−1 · j ∈ {c+1, c+2} → c+1 (hai cột cũ nay là một)
 *   split   k > c+1 → k−1 · k = c+1 là VẠCH SẮP BIẾN MẤT → không đoán, TỪ CHỐI
 *
 * Ca cuối là ca duy nhất không có câu trả lời đúng: vạch ấy nằm giữa hai cột đang bị gộp lại,
 * dời sang trái hay sang phải đều là đổi bố cục theo một ý người dùng chưa nói ra.
 *
 * @returns {{ok:true, value:number}|{ok:false, reason:string}}
 */
function shiftMarker(attr, value, kind, col) {
  const v = Math.trunc(Number(value));
  // `0` và số không hợp lệ nghĩa là «chưa khai / không neo / không chia» — không có gì để dời.
  if (!Number.isInteger(v) || v <= 0) return { ok: true, value: v };

  if (kind === 'splitColumn') {
    if (attr === 'anchor') return { ok: true, value: v > col + 1 ? v + 1 : v };
    return { ok: true, value: v >= col + 1 ? v + 1 : v };
  }

  if (attr === 'anchor') {
    if (v > col + 2) return { ok: true, value: v - 1 };
    return { ok: true, value: v === col + 2 ? col + 1 : v };
  }
  if (v === col + 1) {
    return {
      ok: false,
      reason: msg('edit.split_on_merge_edge', { v }),
    };
  }
  return { ok: true, value: v > col + 1 ? v - 1 : v };
}

/**
 * Toàn bộ splice của một phép tách/gộp biên cột — tính được mà KHÔNG cần văn bản nguồn.
 *
 * Tách phần này ra vì tầng vỏ vướng một vòng luẩn quẩn giống hệt `rowEditTargetFile`: muốn đối
 * chiếu văn bản thì phải mở file, mà biết mở file nào thì phải tính xong dải đã. `textPatch`
 * quy được toạ độ mà không cần đọc gì, nên gọi nó trước là gỡ được vòng ấy.
 *
 * @returns {{ok:true, edits:Array, owner:string, regions:string[], rows:number}|{ok:false, reason:string}}
 */
function buildColumnPlan(model, op) {
  const region = (model.regions ?? []).find((r) => r.id === op.region);
  if (!region) return { ok: false, reason: msg('edit.region_missing', { region: op.region }) };
  if (!model.segments) return { ok: false, reason: msg('edit.width_list_source_unknown') };

  const key = widthsOwnerKey(model, region.index);
  const owner = widthsOwnerOf(model, key);
  if (!owner.ok) return owner;

  const count = region.widths.length;
  const col = Math.trunc(Number(op.col));
  if (!Number.isInteger(col) || col < 0 || col >= count) {
    return { ok: false, reason: msg('edit.region_col_missing', { p0: col + 1, count }) };
  }
  if (op.kind === 'mergeColumn' && col + 1 >= count) {
    return { ok: false, reason: msg('edit.merge_last_col', { p0: col + 1 }) };
  }

  // 1 — LIST PX. Tách thì chia đôi bề rộng cũ (người gọi đưa số khác thì theo số đó); gộp thì
  //     cộng lại. Tổng bề rộng của vùng không đổi ở cả hai phép — bỏ một vạch không phải là
  //     bóp form hẹp lại, và mọi thứ bên phải vạch ấy phải đứng yên.
  let next;
  if (op.kind === 'splitColumn') {
    const w = region.widths[col];
    const left = Number.isFinite(Number(op.left)) ? Math.trunc(Number(op.left)) : Math.floor(w / 2);
    const right = Number.isFinite(Number(op.right)) ? Math.trunc(Number(op.right)) : w - left;
    next = splitWidthsAt(owner.value, col, left, right);
  } else if (op.kind === 'mergeColumn') {
    next = mergeWidthsAt(owner.value, col);
  } else {
    return { ok: false, reason: msg('edit.unknown_column_op', { kind: op.kind }) };
  }
  if (!next.ok) return next;

  const patches = [];
  const widthsPatch = textPatch(model.segments, owner.span.start, owner.value, next.value, 'list px');
  if (!widthsPatch.ok) return widthsPatch;
  patches.push(widthsPatch);

  // 2 — PATTERN của mọi hàng đọc CHÍNH list px này. Không phải chỉ hàng của vùng đang bấm:
  //     header, footer và mọi tab không khai `columns` riêng đều dùng chung một list px, nên
  //     chúng cùng lệch nếu bỏ sót.
  let touched = 0;
  for (const row of model.rows ?? []) {
    if (widthsOwnerKey(model, row.categoryIndex) !== key) continue;
    if (!row.item?.valueSpan) {
      return { ok: false, reason: msg('edit.item_pos_unknown', { index: row.index }) };
    }

    let pattern;
    if (op.kind === 'splitColumn') {
      pattern = splitPatternAt(row.row.pattern, col);
    } else {
      const m = mergePatternAt(row.row.pattern, col);
      if (!m.ok) return { ok: false, reason: msg('edit.item_reason', { index: row.index, reason: m.reason }) };
      pattern = m.pattern;
    }

    const before = row.row.patternRaw;
    const after = reindentPattern(before, pattern);
    if (after === before) continue;

    const p = textPatch(model.segments, row.item.valueSpan.start, before, after, `pattern của item ${row.index}`);
    if (!p.ok) return p;
    patches.push(p);
    touched++;
  }

  // 3 — `anchor` / `split` của mọi vùng dùng chung list px này. Chúng đếm cột, nên chèn hay bỏ
  //     một cột là chúng trỏ sang chỗ khác — xem `shiftMarker`.
  const shared = [];
  for (const r of model.regions ?? []) {
    if (widthsOwnerKey(model, r.index) !== key) continue;
    shared.push(r.id);
    for (const attr of ['anchor', 'split']) {
      const from = r[attr];
      if (from === null || from === undefined) continue;
      // Số MƯỢN của một thẻ đếm cột trên list px KHÁC (dải đáy khai `columns` riêng nhưng
      // thừa kế `split` của `<view>`) — dời nó là dời marker của vùng khác. Xem `footerWriteback`.
      if (r.writeback?.inherited?.[attr]) continue;
      const moved = shiftMarker(attr, from, op.kind, col);
      if (!moved.ok) return { ok: false, reason: msg('edit.region_reason', { id: r.id, reason: moved.reason }) };
      if (moved.value === Math.trunc(Number(from))) continue;

      const range = attr === 'anchor' ? r.writeback?.anchorRange : r.writeback?.splitRange;
      if (!range) {
        return {
          ok: false,
          reason: msg('edit.region_attr_pos_unknown', { id: r.id, attr, from }),
        };
      }
      patches.push({
        ok: true,
        file: range.file,
        splice: { start: range.start, end: range.end, text: String(moved.value) },
        expect: String(from),
      });
    }
  }

  const edits = mergePatches(patches);
  if (!edits.ok) return edits;
  return { ok: true, edits: edits.list, owner: owner.label, regions: shared, rows: touched };
}

/**
 * Gộp mọi splice thành MỘT danh sách phẳng, và chặn hai splice giẫm lên nhau.
 *
 * Giẫm nhau là ca có thật chứ không phải phòng xa: hai hàng cùng bung ra từ một `&Split;` sẽ
 * quy về CÙNG một dải trong file khai entity. Trùng khít và cùng nội dung thì gộp làm một —
 * đó chính là điều đúng, vì sửa khai báo entity một lần là cả hai hàng cùng đổi. Trùng mà khác
 * nội dung, hay chồng một phần, thì không có cách ghi nào đúng cho cả hai: từ chối.
 */
function mergePatches(patches) {
  const byFile = new Map();
  for (const p of patches) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push({ file: p.file, ...p.splice, expect: p.expect });
  }

  const list = [];
  for (const [file, group] of byFile) {
    group.sort((a, b) => a.start - b.start || a.end - b.end);
    let prev = null;
    for (const e of group) {
      if (prev && e.start === prev.start && e.end === prev.end) {
        if (e.text !== prev.text) {
          return {
            ok: false,
            reason: msg('edit.conflict_writes', { file })
              + ' — khai báo dùng chung này phải sửa bằng tay',
          };
        }
        continue; // trùng khít, cùng nội dung → một splice là đủ
      }
      if (prev && e.start < prev.end) {
        return {
          ok: false,
          reason: msg('edit.overlap_writes', { file }),
        };
      }
      list.push(e);
      prev = e;
    }
  }
  return { ok: true, list };
}

/**
 * File nào phải đọc để đối chiếu trước khi ghi một phép tách/gộp biên cột.
 *
 * Không suy từ `row.range.file` được: ký tự pattern thật sự đổi có thể nằm gọn trong khai báo
 * của một `&Split;` ở file thứ ba, chẳng phải file chứa `<item>` cũng chẳng phải controller.
 * Tính thẳng kế hoạch rồi lấy danh sách file của nó là cách duy nhất không đoán.
 */
export function regionColumnFiles(model, op) {
  const plan = buildColumnPlan(model, op);
  return plan.ok ? [...new Set(plan.edits.map((e) => e.file))] : [];
}

/**
 * SỬA BỀ RỘNG của một cột trong list px dùng chung của một vùng form — kéo cạnh, không tách/gộp.
 *
 * Khác `buildColumnPlan`: số cột không đổi, nên đây chỉ là MỘT splice trên chính list px, không
 * đụng pattern của hàng nào (mọi hàng vẫn đọc đúng số cột như cũ) và không dời `anchor`/`split`
 * (chúng đếm cột, số cột không đổi thì không có gì để dời). Cùng blast radius với `colWidth` của
 * lưới — một file, một dải.
 *
 * KHÔNG nhận `sourceText`: `owner.span` đo trên clearText (đã bung entity), không phải toạ độ
 * của một file cụ thể — so nguyên văn ở đây (như `planColumnWidth` làm cho lưới) sẽ so nhầm hệ
 * toạ độ bất cứ khi nào owner nằm trong Include hoặc đi qua entity. `textPatch` tự quy đúng file
 * + `expect` qua `model.segments`; người gọi so `expect` với văn bản file THẬT (đọc SAU khi đã
 * biết `plan.file`) trước khi ghi — cùng luật với `planRegionColumns`, chỉ khác một file một dải.
 *
 * @returns {{ok:true, file, splice, expect}|{ok:false, reason:string}}
 */
export function planRegionColumnWidth(model, { region: regionId, col, width }) {
  const region = (model.regions ?? []).find((r) => r.id === regionId);
  if (!region) return { ok: false, reason: msg('edit.region_missing', { region: regionId }) };
  if (!model.segments) return { ok: false, reason: msg('edit.width_list_source_unknown') };

  const key = widthsOwnerKey(model, region.index);
  const owner = widthsOwnerOf(model, key);
  if (!owner.ok) return owner;

  const count = region.widths.length;
  const c = Math.trunc(Number(col));
  if (!Number.isInteger(c) || c < 0 || c >= count) {
    return { ok: false, reason: msg('edit.region_col_missing', { p0: c + 1, count }) };
  }
  const n = Math.round(Number(width));
  if (String(n) === String(region.widths[c])) return { ok: false, reason: msg('common.no_change') };

  const next = resizeWidthAt(owner.value, c, n);
  if (!next.ok) return next;

  return textPatch(model.segments, owner.span.start, owner.value, next.value, 'list px');
}

/**
 * Tách một cột làm hai, hoặc gộp hai cột liền kề — MỘT chùm splice, ghi hết hoặc không ghi gì.
 *
 * @param op          {kind:'splitColumn', region, col, left?, right?}
 *                  | {kind:'mergeColumn', region, col}
 *                    `col` tính từ 0, là cột của CHÍNH vùng `region`.
 * @param readSource  `(file) => string|null` — văn bản hiện tại của một file. Core không chạm
 *                    đĩa; tầng vỏ đã mở sẵn document nên nó đọc rẻ hơn và đúng hơn (document
 *                    đang mở có thể khác file trên đĩa).
 * @returns {{ok:true, edits:Array<{file,start,end,text}>, warning:string[], summary:object}
 *          |{ok:false, reason:string}}
 */
export function planRegionColumns(model, op, readSource) {
  const plan = buildColumnPlan(model, op);
  if (!plan.ok) return plan;

  /*
   * Đối chiếu NGUYÊN VĂN từng dải trước khi ghi — cùng chốt chặn với `planRowEdit`.
   *
   * Ở đây nó còn cần hơn: một phép sửa đụng nhiều file, và chỉ cần một file đã đổi dưới chân
   * (người dùng vừa gõ tay, hay một Include vừa được sửa ở tab khác) là mọi offset còn lại vẫn
   * đúng nhưng offset của file ấy đã lệch. Ghi được nửa chùm còn tệ hơn không ghi gì.
   */
  for (const e of plan.edits) {
    const text = readSource(e.file);
    if (typeof text !== 'string') {
      return { ok: false, reason: msg('edit.file_unread', { file: e.file }) };
    }
    const actual = text.slice(e.start, e.end);
    if (actual !== e.expect) {
      return {
        ok: false,
        reason: msg('edit.patch_expect_mismatch_file', { file: e.file, actual, expect: e.expect }),
      };
    }
  }

  const files = [...new Set(plan.edits.map((e) => e.file))];
  return {
    ok: true,
    edits: plan.edits.map(({ file, start, end, text }) => ({ file, start, end, text })),
    // Mọi file KHÁC file đang mở — sửa chúng là đổi cho mọi controller dùng chung, và một phép
    // tách cột có thể đụng nhiều file cùng lúc, nên đây là DANH SÁCH chứ không phải một cái tên.
    warning: files.filter((f) => f !== model.hostFile),
    summary: { owner: plan.owner, regions: plan.regions, rows: plan.rows, files },
  };
}

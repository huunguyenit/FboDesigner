// edit-row.mjs — biến một thao tác trên MỘT HÀNG form (resize/insert/remove/move/swap cùng hàng,
// thêm/bớt hàng, thêm/bớt field) thành splice lên văn bản nguồn. Tách từ edit.mjs (Phase 3 audit).
//
// Luật an toàn xem `edit.mjs` (barrel) — mọi hàm ở đây vẫn THUẦN, vẫn nhận `model` do
// `buildViewModel` dựng và trả `{ok, splice, file, warning}`.
//
// KHÔNG chứa: dời/đổi chỗ XUYÊN HÀNG (đó là `edit-move.mjs` — vùng ảnh hưởng khác hẳn, xem ghi
// chú ở đầu file đó), cột lưới/biên cột form (`edit-column.mjs`), thuộc tính số (`edit-attr.mjs`).

import {
  isBlankAnchorName, parseToken, serializeRow, setSpan, setStart,
  removeCell, insertCell, moveCell, swapCells, newRow, takeRowHalf, joinRowHalves, buildCells,
} from './item-value.mjs';
import { fieldCategories, rowCategoryIndex } from './render.mjs';
import { msg } from './msg.mjs';
import {
  reindentPattern, textPatch, sourceRow, rowHasEmbeddedGrid, emptyRowSplice,
} from './edit-shared.mjs';

/**
 * Hàng này có sửa tại chỗ được không.
 *
 * Hai lý do từ chối, và cả hai đều là "sửa được về mặt kỹ thuật nhưng sai về mặt ý định":
 *
 *   - `hasEntity`: giá trị trong file là `10100&Split;----: …`, thứ ta đang cầm là bản ĐÃ BUNG.
 *     Ghi bản bung đè lên nguồn là xoá tham chiếu và sao chép nội dung dùng chung vào đây.
 *   - không có `range`: không biết hàng nằm ở đâu trong file nào thì không có chỗ nào để ghi.
 *
 * Hàng `foreign` (thuộc file Include dùng chung) KHÔNG bị chặn ở đây — nó sửa được, nhưng sửa
 * là đụng tới mọi controller cùng include file đó. Trả về `warning` để tầng vỏ HỎI người dùng
 * trước, chứ không tự quyết thay họ.
 */
export function canEditRow(row, sourceText) {
  if (!row) return { ok: false, reason: msg('edit.row_not_found') };
  if (row.row.hasEntity) {
    return { ok: false, reason: msg('edit.row_has_entity') };
  }
  if (!row.range) return { ok: false, reason: msg('edit.row_range_unknown') };

  /*
   * Chốt chặn thật sự: văn bản TRONG FILE ở đúng dải sắp ghi đè phải GIỐNG HỆT thứ ta đang cầm.
   *
   * `hasEntity` một mình không đủ, và chỗ này đã suýt lọt. `hasEntity` xét trên clearText — tức
   * bản ĐÃ BUNG — nên hàng viết là `1100: [&k;].Label, [&k;]` với `<!ENTITY k "ma_kho">` sẽ ra
   * `1100: [ma_kho].Label, [ma_kho]` và `hasEntity` bằng false. Ghi bản đó đè lên nguồn là thay
   * `&k;` bằng `ma_kho`: tham chiếu biến mất, và lần sau đổi khai báo entity thì hàng này không
   * đổi theo nữa. Hỏng im lặng, đúng kiểu vài tuần sau mới lộ.
   *
   * So nguyên văn thì bắt được mọi biến thể của chuyện đó — entity, tham số `%X;`, hay bất kỳ
   * phép biến đổi nào khác chen vào giữa file và model — mà không cần biết trước nó là gì.
   */
  if (typeof sourceText !== 'string') {
    return { ok: false, reason: msg('edit.source_unread') };
  }
  if (sourceText.slice(row.range.start, row.range.end) !== row.item.value) {
    return {
      ok: false,
      reason: msg('edit.source_mismatch_entity')
        + ' — sửa tại file khai nó, không sửa ở đây',
    };
  }
  return { ok: true, warning: row.foreign ? row.range.file : null };
}

/**
 * Gộp/tách: vá ĐÚNG mấy ký tự pattern đã đổi, ngay tại nơi chúng thật sự nằm.
 *
 * Đây là phép sửa duy nhất chạm được vào hàng lai — hàng mà pattern GHÉP từ nhiều nguồn:
 *
 *   <item value="110&ExtraFields.Master.View.Split;-----101-: [ong_ba].Label, …"/>
 *
 * Sau khi bung, pattern là `11010------101-`, trong đó ba ký tự `10-` đến từ khai báo của
 * `&ExtraFields.Master.View.Split;` ở một file khác. Luật cũ («cả hàng phải khớp nguyên văn»,
 * rồi «pattern phải khớp nguyên văn») chặn hết mọi hàng như thế, dù phép sửa chỉ đổi MỘT ký tự.
 *
 * Cách làm ở đây không cần biết hàng có entity hay không:
 *
 *   1. Tính pattern mới bằng chính `setSpan`/`setStart` (trên bản ĐÃ BUNG — đó là bản đúng để
 *      suy luận về cột).
 *   2. So với pattern cũ, cắt bỏ phần đầu và phần đuôi giống hệt nhau → còn lại đúng đoạn đã
 *      đổi. Gộp/tách chỉ sửa `0`/`-` nên đoạn ấy thường dài một, hai ký tự.
 *   3. Quy đoạn ấy từ toạ độ clearText về toạ độ FILE NGUỒN qua `segments`.
 *
 * Nhờ bước 3, đoạn nằm trong `&…;` thì splice rơi thẳng vào khai báo entity, ở đúng file khai
 * nó — «110&Split;» với `Split = "10-"` mà tách một ô thì cái được ghi là `Split = "1--"`, còn
 * ba ký tự `110` trong controller không bị đụng tới. Đúng như runtime đọc lại.
 *
 * MỘT ĐOẠN, MỘT FILE. Nếu đoạn đã đổi vắt qua ranh giới hai nguồn (nửa nằm trong controller,
 * nửa trong entity) thì từ chối: hai splice ở hai file trong cùng một lần hoàn tác là thứ tầng
 * vỏ chưa làm được, và ghi một nửa còn tệ hơn không ghi.
 *
 * @returns {{ok:true, file, splice, expect:string}|{ok:false, reason:string}|null}
 *          `null` = op này không phải gộp/tách, người gọi đi tiếp đường thường.
 */
function patternPlan(model, row, op) {
  if (op.kind !== 'resize' || !row || !row.item?.valueSpan || !model.segments) return null;

  // `allowEntity`: phép tính pattern chạy trên bản đã bung là đúng, vì cột là chuyện của bản
  // đã bung. Cái phải cẩn thận là chỗ GHI, và bước 3 lo đúng chỗ đó.
  const result = op.side === 'left'
    ? setStart(row.row, row.widths, op.cell, op.col, { allowEntity: true })
    : setSpan(row.row, row.widths, op.cell, op.span, { allowEntity: true });
  if (!result.ok) return result;

  const before = row.row.patternRaw;
  const after = reindentPattern(before, result.row.pattern);
  if (after === before) return { ok: false, reason: msg('common.no_change') };
  return textPatch(model.segments, row.item.valueSpan.start, before, after, 'pattern');
}

/**
 * File nào phải đọc để lập kế hoạch cho op này.
 *
 * Tách ra vì có một vòng luẩn quẩn: phép so nguyên văn cần văn bản nguồn, mà biết được nguồn
 * nằm ở file nào thì phải tính xong dải đã. `patternPlan` tính dải mà không cần văn bản, nên
 * gọi nó trước là gỡ được vòng ấy. Tầng vỏ mở đúng file này rồi mới gọi `planRowEdit`.
 */
export function rowEditTargetFile(model, op) {
  const row = model.rows.find((r) => r.index === op.item);
  if (!row) return null;
  const plan = patternPlan(model, row, op);
  if (plan && plan.ok) return plan.file;
  return row.range?.file ?? null;
}

/**
 * Áp một phép sửa lên hàng và trả về splice tương ứng.
 *
 * @param model      model do `buildViewModel` trả
 * @param op         {kind:'resize', item, cell, span}                  kéo cạnh PHẢI
 *             | {kind:'resize', item, cell, col, side:'left'}          kéo cạnh TRÁI
 *             | {kind:'remove', item, cell}
 *             | {kind:'insert', item, cell, side:'left'|'right', token}
 *             | {kind:'move', item, cell, col}                          kéo DỜI sang cột khác
 *             | {kind:'swap', item, cell, other}                        ĐỔI CHỖ hai ô cùng span
 * @param sourceText văn bản file NGUỒN — với `resize` là file mà `rowEditTargetFile` chỉ ra,
 *                   KHÔNG mặc định là file đang mở
 * @returns {{ok:true, file, splice:{start,end,text}, warning:string|null}
 *          |{ok:false, reason:string}}
 */
export function planRowEdit(model, op, sourceText) {
  const row = model.rows.find((r) => r.index === op.item);

  const patch = patternPlan(model, row, op);
  if (patch) {
    if (!patch.ok) return patch;
    const actual = sourceText.slice(patch.splice.start, patch.splice.end);
    if (actual !== patch.expect) {
      return { ok: false, reason: msg('edit.patch_expect_mismatch', { actual, expect: patch.expect }) };
    }
    return {
      ok: true,
      file: patch.file,
      splice: patch.splice,
      // Sửa vào file khác file đang mở là đụng mọi controller dùng chung nó — tầng vỏ phải hỏi.
      warning: patch.file !== model.hostFile ? patch.file : null,
    };
  }

  // Đo bằng list px CỦA VÙNG chứa hàng, không phải của view: tab có `<category columns>` riêng,
  // dùng nhầm list của view là mọi phép tính cột lệch đúng ở những vùng khó phát hiện nhất.
  const widths = row.widths;

  /*
   * THÊM và XOÁ chạy trên bản parse của VĂN BẢN GỐC — xem `sourceRow`.
   *
   * Hai phép này chỉ thêm/bớt MỘT token và sửa pattern; mọi token còn lại đi qua nguyên văn, kể
   * cả khi chúng viết bằng entity. Nên chúng không cần `canEditRow`, và cũng không được dùng nó:
   * chính phép so "văn bản trong file phải giống bản đã bung" là thứ đang chặn nhầm.
   */
  if (op.kind === 'insert' || op.kind === 'remove' || op.kind === 'move' || op.kind === 'swap') {
    const src = sourceRow(row, sourceText, model);
    if (!src.ok) return src;

    let result;
    if (op.kind === 'insert') {
      result = insertCell(src.parsed, widths, op.cell, op.side, op.token, { allowEntity: true });
    } else if (op.kind === 'remove') {
      result = removeCell(src.parsed, widths, op.cell, { allowEntity: true });
    } else if (op.kind === 'move') {
      // Dời control: token đi nguyên xi, nên đây cũng là phép không đụng tới entity.
      result = moveCell(src.parsed, widths, op.cell, op.col, { allowEntity: true });
    } else {
      // Đổi chỗ: hai token hoán vị, pattern không đổi một ký tự — phép ít đụng chạm nhất
      // trong cả nhóm. Token viết bằng entity đi qua nguyên văn như `move`; pattern viết bằng
      // entity thì vẫn do `sourceRow` chặn chung với ba phép kia, không có ngoại lệ nào ở đây.
      result = swapCells(src.parsed, widths, op.cell, op.other, { allowEntity: true });
    }
    if (!result.ok) return result;

    /*
     * Hàng vừa nhận control THẬT thì neo hết việc — gỡ token neo trong CÙNG splice với phép chèn.
     *
     * Cùng một splice chứ không hai lượt sửa: neo còn lại một nhịp là file trên đĩa có một hàng
     * mang token thừa, và Ctrl+Z một nửa để lại đúng trạng thái đó.
     *
     * Gỡ neo là hàng MẤT chỗ khai vùng, nên phải trả lại vùng bằng đường khác: field vừa chèn
     * chính là field tầng vỏ sắp khai, nên nó ghi `categoryIndex` lên đó. Chỉ đòi khi thật sự
     * cần — hàng chèn vào một field đã khai đúng vùng thì không ghi thêm gì.
     */
    let anchorDropped = null;
    let requireCategory = null;
    if (op.kind === 'insert') {
      const found = blankAnchorIn(result.row, widths);
      if (found) {
        const tokens = result.row.tokens.filter((_, i) => i !== found.index);
        anchorDropped = found.field;
        result = { ok: true, row: { ...result.row, tokens } };
        const target = row.categoryIndex;
        if (Number.isInteger(target) && target !== 0 && regionOfTokens(model, tokens) !== target) {
          const first = tokens.find((t) => t.field);
          if (!first) return { ok: false, reason: msg('edit.anchor_drop_unsafe', { p0: target }) };
          requireCategory = { name: first.field, index: target };
        }
      }
    }

    // Bỏ control CUỐI CÙNG của hàng thì bỏ luôn thẻ `<item>` — xem `emptyRowSplice`.
    if (op.kind === 'remove') {
      const drop = emptyRowSplice(row, result.row, sourceText);
      if (drop) return { ok: true, file: row.range.file, splice: drop, warning: src.warning, rowRemoved: true };
    }

    const text = serializeRow(result.row);
    if (text === src.value) return { ok: false, reason: msg('common.no_change') };
    return {
      ok: true,
      file: row.range.file,
      splice: { start: row.range.start, end: row.range.end, text },
      warning: src.warning,
      anchorDropped,
      requireCategory,
    };
  }

  const allowed = canEditRow(row, sourceText);
  if (!allowed.ok) return allowed;

  let result;
  if (op.kind === 'resize') result = setSpan(row.row, widths, op.cell, op.span);
  else return { ok: false, reason: msg('edit.unknown_op', { kind: op.kind }) };

  if (!result.ok) return result;

  const text = serializeRow(result.row);
  if (text === row.item.value) return { ok: false, reason: msg('common.no_change') };

  return {
    ok: true,
    file: row.range.file,
    splice: { start: row.range.start, end: row.range.end, text },
    warning: allowed.warning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Field NEO VÙNG cho hàng trống
//

/*
 * Vùng của một hàng suy từ `<field categoryIndex>` của các token TRONG hàng — và hàng trống thì
 * không có token nào. Nên `<item value="------"/>` LUÔN rơi về header, ở CẢ BA tầng: hàm
 * `rowCategoryIndex` bên `render.mjs`, `ErpViewLayoutBuilder.ResolveRowCategoryIndex` và
 * `FboXmlParser.ResolveRowCategoryIndex` của DWF đều `return 0` ở đúng chỗ ấy. Preview không sai;
 * cái sai là hàng ghi ra không diễn đạt được ý "trống, nhưng thuộc tab 18".
 *
 * Kẽ hở ĐÚNG LUẬT: một token mà không `1` nào nhận.
 *
 *   - Hai vòng dựng ô của DWF (`ParseViewRow`, `BuildRow`) chỉ tăng `control_index` khi gặp `'1'`.
 *     Pattern toàn `-` nên KHÔNG control nào được dựng — hàng vẫn trống thật.
 *   - `ResolveRowCategoryIndex` quét CHUỖI `item_value` thô bằng regex, không đi qua pattern.
 *     Nên nó vẫn thấy token, và vẫn lấy được `categoryIndex` từ đó.
 *
 * Hai đường độc lập, nên `------: [zzblank18].Label` là hàng trống NẰM TRONG tab 18 — đúng ở cả
 * runtime lẫn preview, không phải mẹo riêng của designer.
 *
 * Vì sao kind `.Label` chứ không `[zzblank18]` trần: `rowCategoryIndex` xét token nhãn TRƯỚC, và
 * bỏ hẳn vòng token input khi hàng đã có nhãn. Neo bằng token input thì lúc hàng vừa nhận thêm
 * `[x].Label, [x]` (x chưa khai vùng), FboDesigner đọc ra header còn DWF đọc ra 18 — hai engine
 * lệch nhau ở đúng trạng thái trung gian mà người dùng nhìn thấy. Neo bằng `.Label` thì cả hai
 * luật cùng trả về vùng của neo, ở MỌI trạng thái.
 *
 * Vì sao `external="true"`: neo không phải cột của bảng. Dir.xsd nói thẳng — "the external field
 * does not exist in table. External fields can not be updated". Mẫu có sẵn trong corpus là field
 * `cookie` (`Dir/Account.f:188`): external + hidden + readOnly, không vẽ gì, chỉ giữ chỗ. Thiếu
 * `external` là FBO đi tìm một cột không tồn tại trong bảng.
 */

/** Tên field neo của một vùng. `-1` (footer) không viết được dấu `-` vào tên nên mã hoá thành `m1`. */
export function blankAnchorName(categoryIndex) {
  const n = Number(categoryIndex);
  if (!Number.isInteger(n) || n === 0) return null;
  return n < 0 ? `zzblankm${Math.abs(n)}` : `zzblank${n}`;
}

/** Token neo — luôn kind `.Label`, xem ghi chú ở đầu mục. */
export function blankAnchorToken(categoryIndex) {
  const name = blankAnchorName(categoryIndex);
  return name === null ? null : `[${name}].Label`;
}

/** Khai báo `<field>` của neo. Bám nguyên hình dạng của `cookie` trong corpus, kể cả `<header v="" e="">`. */
export function blankAnchorField(categoryIndex) {
  const name = blankAnchorName(categoryIndex);
  if (name === null) return null;
  return `<field name="${name}" external="true" hidden="true" readOnly="true"`
    + ` defaultValue="''" categoryIndex="${Number(categoryIndex)}">`
    + `<header v="" e=""></header></field>`;
}

/**
 * Token neo THỪA trong một hàng — token mang tên neo mà không `1` nào nhận.
 *
 * Đòi CẢ HAI điều kiện, và không rút xuống một:
 *   thừa   — token được một `1` nhận là control thật của người dùng, dù tên có giống neo.
 *   tên    — token thừa do người dùng gõ nhầm (`còn N token không có "1" nào nhận`) là lỗi của
 *            họ, designer không được lặng lẽ xoá hộ.
 *
 * @returns {{index:number, field:string}|null}
 */
export function blankAnchorIn(row, widths) {
  const { cells } = buildCells(row, widths);
  let taken = 0;
  for (const c of cells) if (!c.empty && c.token) taken++;
  for (let i = taken; i < row.tokens.length; i++) {
    const t = row.tokens[i];
    if (t.field && isBlankAnchorName(t.field)) return { index: i, field: t.field };
  }
  return null;
}

/** Gắn token neo vào một hàng vừa dựng. Pattern KHÔNG đụng tới — neo phải ở lại ngoài mọi `1`. */
function attachBlankAnchor(row, categoryIndex) {
  const raw = blankAnchorToken(categoryIndex);
  if (raw === null) return row;
  return { ...row, tokens: [...row.tokens, parseToken(raw)], hasColon: true, afterColon: ' ' };
}

/** Vùng mà một hàng SẼ rơi vào với danh sách token này — dùng chung luật với `render.mjs`. */
function regionOfTokens(model, tokens) {
  return rowCategoryIndex({ tokens }, fieldCategories([...model.fieldByName.values()]));
}

/**
 * Thêm một hàng mới phía trên / phía dưới hàng đang chọn.
 *
 * Khác hẳn ba phép trên: chúng viết đè lên GIÁ TRỊ của một `<item>` có sẵn, còn phép này chèn
 * hẳn một thẻ `<item>` mới. Nên nó cần vị trí của cả THẺ, không phải của riêng `value` — và
 * cần thụt lề của thẻ cũ để dòng mới không dính vào lề trái.
 *
 * @param op {kind:'addRow', item, side:'above'|'below', token}
 * @param sourceText văn bản file NGUỒN chứa hàng đó (để đọc thụt lề và đặt điểm chèn)
 */
export function planAddRow(model, op, sourceText, itemRange) {
  const row = model.rows.find((r) => r.index === op.item);
  /*
   * KHÔNG gọi `canEditRow`, và đó là chủ ý.
   *
   * Phép này CHÈN một thẻ `<item>` mới; nó không ghi đè một ký tự nào của hàng cũ. Bắt hàng cũ
   * phải khớp nguyên văn bản đã bung thì mọi hàng viết bằng entity vĩnh viễn không thêm được
   * hàng bên dưới — dù hàng mới chẳng liên quan gì tới `&k;`. Cùng lý do với nhánh thêm/xoá
   * control ở `planRowEdit`.
   *
   * Cái vẫn cần: biết hàng cũ nằm ở đâu (để lấy thụt lề và điểm chèn), và cảnh báo khi nó nằm
   * trong một file dùng chung.
   */
  if (!row || !row.range) {
    return { ok: false, reason: msg('edit.row_range_unknown') };
  }
  if (typeof sourceText !== 'string') {
    return { ok: false, reason: msg('edit.source_unread') };
  }
  const allowed = { ok: true, warning: row.foreign ? row.range.file : null };
  if (!itemRange) return { ok: false, reason: msg('edit.item_tag_unknown') };

  const split = Number(op.split);
  const blankSide = op.splitSide === 'left' || op.splitSide === 'right' ? op.splitSide : null;
  const useSplitCascade = op.blank && blankSide
    && Number.isFinite(split) && split > 0 && split < row.widths.length;

  // Thụt lề lấy từ CHÍNH dòng chứa thẻ cũ — hàng mới phải trông như do người viết file đặt ra,
  // không phải như do máy nhét vào.
  const lineStart = sourceText.lastIndexOf('\n', itemRange.start - 1) + 1;
  const indent = /^[ \t]*/.exec(sourceText.slice(lineStart, itemRange.start))[0];
  const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';
  const at = op.side === 'above' ? lineStart : itemRange.end;

  /*
   * Hàng TRỐNG mới phải ở cùng vùng với hàng neo, và tự nó không khai được vùng — xem mục
   * «Field NEO VÙNG cho hàng trống». Chỉ gắn khi hàng dựng ra THẬT SỰ lệch vùng: hàng nửa-trống
   * của nhánh split thường vẫn giữ được một field khai `categoryIndex` ở nửa kia, và gắn thêm
   * neo vào đó chỉ là rác.
   *
   * Nhánh KHÔNG blank không đi qua đây: nó khai luôn một `<field>` mới, nên chỗ đúng để ghi vùng
   * là `categoryIndex` của chính field ấy, không phải một field neo thứ hai.
   */
  const target = row.categoryIndex;
  const anchorIfNeeded = (made) => {
    if (!op.blank || !Number.isInteger(target) || target === 0) return { row: made, anchor: null };
    if (regionOfTokens(model, made.tokens) === target) return { row: made, anchor: null };
    const name = blankAnchorName(target);
    return {
      row: attachBlankAnchor(made, target),
      anchor: {
        name,
        categoryIndex: target,
        xml: blankAnchorField(target),
        declared: model.fieldByName.has(name),
      },
    };
  };

  if (!useSplitCascade) {
    const made = newRow(row.widths, op.token);
    if (!made.ok) return made;
    const anchored = anchorIfNeeded(made.row);
    const tag = `<item value="${escapeAttr(serializeRow(anchored.row))}"/>`;
    const text = op.side === 'above'
      ? `${indent}${tag}${eol}`
      : `${eol}${indent}${tag}`;
    return {
      ok: true,
      file: row.range.file,
      splice: { start: at, end: at, text },
      warning: allowed.warning,
      anchorField: anchored.anchor,
    };
  }

  /*
   * Form có split: chèn slot trống MỘT nửa, nửa kia của các hàng phía dưới DỒN LÊN.
   * Ví dụ + trái dưới ong_ba: hàng mới trái trống + phải lấy từ hàng kế; ngay_lct trên hàng
   * dưới trượt lên — không copy nửa phải của hàng neo, cũng không đẩy trống cả hai nửa.
   */
  const cascade = planSplitHalfCascade(model, {
    anchor: row,
    side: op.side === 'above' ? 'above' : 'below',
    blankSide,
    split,
    sourceText,
  });
  if (!cascade.ok) return cascade;

  const anchoredCascade = anchorIfNeeded(cascade.inserted);
  const tag = `<item value="${escapeAttr(serializeRow(anchoredCascade.row))}"/>`;
  const insertText = op.side === 'above'
    ? `${indent}${tag}${eol}`
    : `${eol}${indent}${tag}`;

  const edits = [
    ...cascade.rewrites.map((r) => ({
      file: r.file,
      start: r.start,
      end: r.end,
      text: r.text,
    })),
    {
      file: row.range.file,
      start: at,
      end: at,
      text: insertText,
    },
  ];

  return {
    ok: true,
    file: row.range.file,
    edits,
    warning: cascade.warning ?? allowed.warning,
    anchorField: anchoredCascade.anchor,
  };
}

/**
 * Dồn nửa split khi chèn hàng trống một bên.
 * blankSide=`left` → giữ trái mỗi hàng, phải lấy từ hàng kế (phải trượt lên vào hàng mới).
 * blankSide=`right` → đối xứng.
 */
function planSplitHalfCascade(model, { anchor, side, blankSide, split, sourceText }) {
  const widths = anchor.widths;
  const columnCount = Math.max(1, widths.length);
  const region = model.regions.find((r) => r.rows.some((x) => x.index === anchor.index));
  if (!region) return { ok: false, reason: msg('edit.region_unknown') };

  const after = region.rows
    .filter((r) => (side === 'above' ? r.index < anchor.index : r.index > anchor.index))
    .sort((a, b) => (side === 'above' ? b.index - a.index : a.index - b.index));

  // `above`: xử lý theo thứ tự tăng index sau khi đảo chiều lọc — cascade luôn theo hàng
  // đứng NGAY sau điểm chèn trên form (cùng hướng "xuống dưới" như side=below).
  const ordered = side === 'above' ? [...after].reverse() : after;

  // Dồn trong cụm form thường; dừng trước hàng nhúng lưới Detail (`1: [d81]`) kẻo kéo
  // nửa phải của lưới/tax vào cụm chứng từ.
  const chain = [];
  for (const r of ordered) {
    if (rowHasEmbeddedGrid(r, model)) break;
    chain.push(r);
  }

  const empty = {
    pattern: '-'.repeat(columnCount),
    tokens: [],
    separator: ', ',
    afterColon: ' ',
    hasColon: false,
    hasEntity: false,
    warnings: [],
  };

  const parsedChain = [];
  let warning = anchor.foreign ? anchor.range.file : null;
  for (const r of chain) {
    if (r.range?.file && r.range.file !== anchor.range.file) {
      return { ok: false, reason: msg('edit.split_cascade_multi_file') };
    }
    const src = sourceRow(r, sourceText, model);
    if (!src.ok) return src;
    if (r.foreign) warning = r.range.file;
    parsedChain.push({ row: r, parsed: src.parsed, value: src.value });
  }

  const rewrites = [];
  for (let i = 0; i < parsedChain.length; i++) {
    let left;
    let right;
    if (blankSide === 'left') {
      left = takeRowHalf(parsedChain[i].parsed, widths, split, 'left');
      right = i + 1 < parsedChain.length
        ? takeRowHalf(parsedChain[i + 1].parsed, widths, split, 'right')
        : takeRowHalf(empty, widths, split, 'right');
    } else {
      left = i + 1 < parsedChain.length
        ? takeRowHalf(parsedChain[i + 1].parsed, widths, split, 'left')
        : takeRowHalf(empty, widths, split, 'left');
      right = takeRowHalf(parsedChain[i].parsed, widths, split, 'right');
    }
    const merged = joinRowHalves(left, right, widths, split, parsedChain[i].parsed);
    const text = serializeRow(merged);
    if (text === parsedChain[i].value) continue;
    rewrites.push({
      file: parsedChain[i].row.range.file,
      start: parsedChain[i].row.range.start,
      end: parsedChain[i].row.range.end,
      text,
      expect: parsedChain[i].value,
      fromIndex: parsedChain[i].row.index,
    });
  }

  // Đối chiếu nguyên văn trước khi ghi — cùng chốt với planRowEdit.
  for (const r of rewrites) {
    const actual = sourceText.slice(r.start, r.end);
    if (actual !== r.expect) {
      return {
        ok: false,
        reason: msg('edit.patch_expect_mismatch', { actual, expect: r.expect }),
      };
    }
  }

  let inserted;
  if (blankSide === 'left') {
    inserted = joinRowHalves(
      takeRowHalf(empty, widths, split, 'left'),
      parsedChain.length
        ? takeRowHalf(parsedChain[0].parsed, widths, split, 'right')
        : takeRowHalf(empty, widths, split, 'right'),
      widths, split, parsedChain[0]?.parsed ?? empty,
    );
  } else {
    inserted = joinRowHalves(
      parsedChain.length
        ? takeRowHalf(parsedChain[0].parsed, widths, split, 'left')
        : takeRowHalf(empty, widths, split, 'left'),
      takeRowHalf(empty, widths, split, 'right'),
      widths, split, parsedChain[0]?.parsed ?? empty,
    );
  }

  return { ok: true, inserted, rewrites, warning };
}

/**
 * Chèn một khai báo `<field>` mới vào cuối `<fields>`.
 *
 * Chèn TRƯỚC `</fields>` chứ không sau `<fields>`: thứ tự khai trong `<fields>` không ảnh hưởng
 * layout (layout do `<item value>` quyết), nên thêm vào cuối là ít gây nhiễu diff nhất và giữ
 * được thói quen đọc file — field mới nằm ở chỗ người ta trông đợi tìm thấy nó.
 *
 * @returns {{ok:true, splice}|{ok:false, reason}}
 */
export function planAddField(sourceText, xml, fieldName) {
  if (fieldName && new RegExp(`<field\\b[^>]*\\bname\\s*=\\s*(["'])${escapeRe(fieldName)}\\1`, 'i').test(sourceText)) {
    return { ok: false, reason: msg('edit.field_exists', { fieldName }) };
  }

  const close = sourceText.search(/<\/fields\s*>/i);
  if (close === -1) return { ok: false, reason: msg('edit.no_fields_section') };

  // Thụt lề và xuống dòng bắt chước khai báo cuối cùng đang có, để field mới trông như do người
  // viết file đặt vào chứ không phải do máy nhét.
  const lineStart = sourceText.lastIndexOf('\n', close - 1) + 1;
  const closeIndent = /^[ \t]*/.exec(sourceText.slice(lineStart, close))[0];
  const last = sourceText.lastIndexOf('<field', close);
  const fieldIndent = last === -1
    ? `${closeIndent}  `
    : /^[ \t]*/.exec(sourceText.slice(sourceText.lastIndexOf('\n', last - 1) + 1, last))[0] || `${closeIndent}  `;
  const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';

  /*
   * Khai báo NHIỀU DÒNG phải được kê lại theo thụt lề của file, không chèn thẳng.
   *
   * `buildField` trả về XML đã xuống dòng khi field có hơn một thẻ con (`<items>`, `<footer>`)
   * — đúng quy ước của corpus. Nhưng nó không biết file này thụt lề bằng mấy dấu cách, nên nó
   * viết mốc 0. Nối thẳng thì dòng đầu ngay ngắn còn `<items…>` và `</field>` dính lề trái, và
   * `<fields>` trông như vừa bị ai đó dán vào.
   *
   * Dòng trống giữ nguyên trần: kê thụt lề cho một dòng rỗng chỉ đẻ ra khoảng trắng thừa cuối dòng.
   */
  const body = String(xml).split(/\r?\n/)
    .map((line, i) => (i === 0 || line === '' ? line : `${fieldIndent}${line}`))
    .join(eol);

  return { ok: true, splice: { start: lineStart, end: lineStart, text: `${fieldIndent}${body}${eol}` } };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Giá trị attribute: chỉ `&` và `"` mới bắt buộc thoát trong dấu nháy kép. */
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Xoá KHAI BÁO `<field name="x">` — nhánh Shift+Delete.
 *
 * Chỉ xoá khi KHÔNG còn ai dùng. Field còn bị một hàng nào đó (ở bất kỳ vùng nào, kể cả tab
 * đang đóng) trỏ tới mà vẫn xoá thì token kia thành token trỏ vào hư không: form vẫn vẽ, chỉ
 * hiện ô đỏ "không có <field> tương ứng" — hỏng ở một chỗ khác hẳn chỗ vừa bấm, và người dùng
 * không nối được hai việc đó với nhau.
 *
 * @returns {{ok:true, splice}|{ok:false, reason, usedBy?:number[]}}
 */
export function planRemoveField(model, fieldName, fieldSpan) {
  const usedBy = model.rows
    .filter((r) => r.row.tokens.some((t) => t.field === fieldName))
    .map((r) => r.index);

  if (usedBy.length > 0) {
    return {
      ok: false,
      reason: msg('edit.field_still_used', { fieldName, length: usedBy.length, p2: usedBy.join(', ') }),
      usedBy,
    };
  }
  if (!fieldSpan) return { ok: false, reason: msg('edit.field_decl_missing', { name: fieldName }) };
  return { ok: true, splice: { start: fieldSpan.start, end: fieldSpan.end, text: '' } };
}

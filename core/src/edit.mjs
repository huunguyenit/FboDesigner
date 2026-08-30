// edit.mjs — biến một thao tác trên form thành MỘT splice lên văn bản nguồn.
//
// Đây là tầng đầu tiên GHI NGƯỢC, nên nó nhận phần lớn số luật an toàn của cả dự án:
//
//   1. Sửa là splice `[start,end)` lên văn bản gốc, không phải "dựng lại file từ model".
//      Phần không đụng tới giữ nguyên từng byte: encoding, CRLF, thụt lề, comment, entity.
//      Đây là lý do `spans.mjs` cố công giữ vị trí ngay từ đầu.
//   2. Không chắc thì TỪ CHỐI. Một designer từ chối sửa làm người dùng khó chịu mười giây;
//      một designer sửa nhầm file dùng chung làm hỏng màn hình của khách khác.
//   3. Mọi hàm ở đây THUẦN. Đọc file, hỏi người dùng, áp WorkspaceEdit là việc của tầng vỏ.
//
// Hàm ở đây nhận `model` do `buildViewModel` dựng (đã có `rows[].range` trỏ về file nguồn) và
// trả `{ok, splice, file, warning}` — tầng vỏ chỉ việc áp.

import { serializeRow, setSpan, setStart, removeCell, insertCell, moveCell, swapCells, placeCell, newRow, takeRowHalf, joinRowHalves, parseRow, buildCells, resolvePattern } from './item-value.mjs';
import { segmentAt } from './entities.mjs';
// Vùng của một hàng suy từ `<field categoryIndex>`, và luật ấy sống ở `render.mjs`. Tầng edit
// phải tính lại vùng SAU một phép dời, nên nó dùng chung hàm chứ không chép luật sang đây.
import { fieldCategories, rowCategoryIndex } from './render.mjs';
import { splitPatternAt, mergePatternAt, splitWidthsAt, mergeWidthsAt } from './columns.mjs';

/** Số cột trống (`-`) liền nhau từ `fromCol` — «span slot đích» khi thả vào chỗ trống. */
function emptyRunFrom(row, widths, fromCol) {
  const chars = Array.from(resolvePattern(row.pattern, widths.length).pattern);
  let n = 0;
  for (let c = fromCol; c < chars.length; c++) {
    if (chars[c] !== '-') break;
    n++;
  }
  return n;
}

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
  if (!row) return { ok: false, reason: 'không tìm thấy hàng' };
  if (row.row.hasEntity) {
    return { ok: false, reason: 'hàng có entity (&…;) — sửa ở file khai entity, không sửa tại controller' };
  }
  if (!row.range) return { ok: false, reason: 'không xác định được hàng này nằm ở đâu trong file nguồn' };

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
    return { ok: false, reason: 'chưa đọc được văn bản nguồn để đối chiếu trước khi ghi' };
  }
  if (sourceText.slice(row.range.start, row.range.end) !== row.item.value) {
    return {
      ok: false,
      reason: 'văn bản trong file khác với bản đã bung (có &entity; hoặc tham số chen vào)'
        + ' — sửa tại file khai nó, không sửa ở đây',
    };
  }
  return { ok: true, warning: row.foreign ? row.range.file : null };
}

/** Giữ nguyên khoảng trắng hai bên pattern để diff chỉ hiện phần thật sự đổi. */
function reindentPattern(patternRaw, pattern) {
  const lead = /^\s*/.exec(patternRaw)[0];
  const tail = /\s*$/.exec(patternRaw)[0];
  return `${lead}${pattern}${tail}`;
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
  if (after === before) return { ok: false, reason: 'không có gì thay đổi' };
  return textPatch(model.segments, row.item.valueSpan.start, before, after, 'pattern');
}

/**
 * Bước 2 + 3 của `patternPlan`, tách ra vì phép sửa list px dùng lại y nguyên.
 *
 * So `before` với `after`, cắt bỏ phần đầu và phần đuôi giống hệt nhau → còn đúng đoạn đã đổi;
 * rồi quy đoạn ấy từ toạ độ clearText về toạ độ FILE NGUỒN qua `segments`. Nhờ vậy đoạn nằm
 * trong `&…;` thì splice rơi thẳng vào khai báo entity, ở đúng file khai nó.
 *
 * MỘT ĐOẠN, MỘT FILE — vắt qua ranh giới hai nguồn thì từ chối, xem chú thích của `patternPlan`.
 *
 * @param base   offset (clearText) của ký tự đầu tiên trong `before`
 * @param what   tên thứ đang sửa, chỉ để câu từ chối đọc ra nghĩa
 * @returns {{ok:true, file, splice, expect}|{ok:false, reason:string}}
 */
function textPatch(segments, base, before, after, what) {
  if (!segments) return { ok: false, reason: `không xác định được nguồn của ${what}` };

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
  if (!seg) return { ok: false, reason: `không xác định được nguồn của ${what}` };
  if (to > seg.end) {
    return {
      ok: false,
      reason: `chỗ cần sửa ${what} vắt qua ranh giới entity — sửa thẳng trong file khai entity`,
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
function sourceRow(row, sourceText, model) {
  if (!row || !row.range) return { ok: false, reason: 'không xác định được hàng này nằm ở đâu trong file nguồn' };
  if (typeof sourceText !== 'string') {
    return { ok: false, reason: 'chưa đọc được văn bản nguồn để đối chiếu trước khi ghi' };
  }
  const value = sourceText.slice(row.range.start, row.range.end);
  const parsed = parseRow(value);

  if (/&[A-Za-z_][\w.:-]*;/.test(parsed.patternRaw)) {
    return { ok: false, reason: 'pattern của hàng viết bằng entity — sửa ở file khai entity' };
  }
  if (parsed.pattern !== row.row.pattern) {
    return {
      ok: false,
      reason: `pattern trong file là "${parsed.pattern}", bản đang vẽ là "${row.row.pattern}" — file nguồn đã đổi?`,
    };
  }
  if (parsed.tokens.length !== row.row.tokens.length) {
    return {
      ok: false,
      reason: `file có ${parsed.tokens.length} token, bản đã bung có ${row.row.tokens.length}`
        + ' — có entity bung ra nhiều token, không map được chỉ số',
    };
  }
  return { ok: true, value, parsed, warning: row.foreign ? row.range.file : null };
}

export function planRowEdit(model, op, sourceText) {
  const row = model.rows.find((r) => r.index === op.item);

  const patch = patternPlan(model, row, op);
  if (patch) {
    if (!patch.ok) return patch;
    const actual = sourceText.slice(patch.splice.start, patch.splice.end);
    if (actual !== patch.expect) {
      return { ok: false, reason: `dải sắp ghi đè mang "${actual}", không phải "${patch.expect}" — file nguồn đã đổi?` };
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

    // Bỏ control CUỐI CÙNG của hàng thì bỏ luôn thẻ `<item>` — xem `emptyRowSplice`.
    if (op.kind === 'remove') {
      const drop = emptyRowSplice(row, result.row, sourceText);
      if (drop) return { ok: true, file: row.range.file, splice: drop, warning: src.warning, rowRemoved: true };
    }

    const text = serializeRow(result.row);
    if (text === src.value) return { ok: false, reason: 'không có gì thay đổi' };
    return {
      ok: true,
      file: row.range.file,
      splice: { start: row.range.start, end: row.range.end, text },
      warning: src.warning,
    };
  }

  const allowed = canEditRow(row, sourceText);
  if (!allowed.ok) return allowed;

  let result;
  if (op.kind === 'resize') result = setSpan(row.row, widths, op.cell, op.span);
  else return { ok: false, reason: `phép sửa không biết: ${op.kind}` };

  if (!result.ok) return result;

  const text = serializeRow(result.row);
  if (text === row.item.value) return { ok: false, reason: 'không có gì thay đổi' };

  return {
    ok: true,
    file: row.range.file,
    splice: { start: row.range.start, end: row.range.end, text },
    warning: allowed.warning,
  };
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
    return { ok: false, reason: 'không xác định được hàng này nằm ở đâu trong file nguồn' };
  }
  if (typeof sourceText !== 'string') {
    return { ok: false, reason: 'chưa đọc được văn bản nguồn để đối chiếu trước khi ghi' };
  }
  const allowed = { ok: true, warning: row.foreign ? row.range.file : null };
  if (!itemRange) return { ok: false, reason: 'không xác định được vị trí thẻ <item> trong file nguồn' };

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

  if (!useSplitCascade) {
    const made = newRow(row.widths, op.token);
    if (!made.ok) return made;
    const tag = `<item value="${escapeAttr(serializeRow(made.row))}"/>`;
    const text = op.side === 'above'
      ? `${indent}${tag}${eol}`
      : `${eol}${indent}${tag}`;
    return {
      ok: true,
      file: row.range.file,
      splice: { start: at, end: at, text },
      warning: allowed.warning,
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

  const tag = `<item value="${escapeAttr(serializeRow(cascade.inserted))}"/>`;
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
  if (!region) return { ok: false, reason: 'không xác định được vùng chứa hàng' };

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
      return { ok: false, reason: 'không dồn nửa split khi các hàng nằm ở file khác nhau' };
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
        reason: `dải sắp ghi đè mang "${actual}", không phải "${r.expect}" — file nguồn đã đổi?`,
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

/** Hàng có ô nhúng lưới Detail — điểm cắt cascade nửa split. */
function rowHasEmbeddedGrid(row, model) {
  for (const c of row.cells ?? []) {
    if (c.empty || !c.token?.field) continue;
    const field = model.fieldByName?.get(c.token.field);
    if (String(field?.items?.style ?? '').toLowerCase() === 'grid') return true;
  }
  return false;
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
    return { ok: false, reason: `field "${fieldName}" đã tồn tại trong file` };
  }

  const close = sourceText.search(/<\/fields\s*>/i);
  if (close === -1) return { ok: false, reason: 'file không có <fields> để thêm khai báo vào' };

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
      reason: `field "${fieldName}" còn được ${usedBy.length} hàng dùng (item ${usedBy.join(', ')}) — bỏ chúng trước`,
      usedBy,
    };
  }
  if (!fieldSpan) return { ok: false, reason: `không tìm thấy khai báo <field name="${fieldName}">` };
  return { ok: true, splice: { start: fieldSpan.start, end: fieldSpan.end, text: '' } };
}

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
  if (!col) return { ok: false, reason: `không có cột "${columnName}"` };
  if (!Number.isFinite(width) || width < 0) return { ok: false, reason: 'bề rộng phải là số ≥ 0' };

  const n = Math.round(width);
  if (col.widthRange) {
    if (sourceText.slice(col.widthRange.start, col.widthRange.end) !== String(col.field.attrs.width)) {
      return { ok: false, reason: 'khai báo width trong file khác bản đã bung — sửa tại file khai nó' };
    }
    if (String(n) === String(col.field.attrs.width)) return { ok: false, reason: 'không có gì thay đổi' };
    return {
      ok: true,
      file: col.widthRange.file,
      splice: { start: col.widthRange.start, end: col.widthRange.end, text: String(n) },
    };
  }

  // Chưa có `width=` → chèn vào ngay sau `<field`, chỗ chắc chắn nằm trong thẻ mở.
  if (!col.fieldTagStart) return { ok: false, reason: `không tìm thấy khai báo <field name="${columnName}">` };
  const at = col.fieldTagStart.start + '<field'.length;
  if (sourceText.slice(col.fieldTagStart.start, at) !== '<field') {
    return { ok: false, reason: 'không xác định được thẻ <field> trong file nguồn' };
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
  if (!col) return { ok: false, reason: `không có cột "${columnName}"` };
  if (!col.range) return { ok: false, reason: 'không xác định được vị trí cột trong file nguồn' };
  if (model.columns.length <= 1) return { ok: false, reason: 'lưới phải còn ít nhất một cột' };

  const raw = sourceText.slice(col.range.start, col.range.end);
  if (!/^<field\b/i.test(raw)) {
    return { ok: false, reason: 'văn bản trong file khác bản đã bung — sửa tại file khai nó' };
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
  if (!col) return { ok: false, reason: `không có cột "${columnName}"` };
  if (!col.range) return { ok: false, reason: 'không xác định được vị trí cột trong file nguồn' };
  if (model.columns.some((c) => c.name === newName)) {
    return { ok: false, reason: `cột "${newName}" đã có trong lưới` };
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
    return { ok: false, reason: 'cột đích trùng cột đang kéo' };
  }
  const from = model.columns.find((c) => c.name === columnName);
  const anchor = model.columns.find((c) => c.name === anchorName);
  if (!from) return { ok: false, reason: `không có cột "${columnName}"` };
  if (!anchor) return { ok: false, reason: `không có cột neo "${anchorName}"` };
  if (!from.range) return { ok: false, reason: `không xác định được vị trí cột "${columnName}" trong file nguồn` };
  if (!anchor.range) return { ok: false, reason: `không xác định được vị trí cột neo "${anchorName}" trong file nguồn` };
  if (from.range.file !== anchor.range.file) {
    return { ok: false, reason: 'hai cột nằm ở hai file khác nhau — không dời qua biên nguồn' };
  }
  // Cột Config/Initialize mang configKind; cột controller thì null.
  if (from.configKind || from.source) {
    return { ok: false, reason: `cột "${columnName}" đến từ cấu hình ẩn — chỉ dời cột khai trong file lưới` };
  }
  if (anchor.configKind || anchor.source) {
    return { ok: false, reason: `cột neo "${anchorName}" đến từ cấu hình ẩn — không chèn cạnh nó bằng reorder view` };
  }
  if (arrangementTargets(model.arrangement, columnName)) {
    return {
      ok: false,
      reason: `cột "${columnName}" bị arrangement neo — sửa Config/Fields trước, nếu không thứ tự view sẽ bị ghi đè`,
    };
  }

  const rawFrom = sourceText.slice(from.range.start, from.range.end);
  if (!/^<field\b/i.test(rawFrom)) {
    return { ok: false, reason: 'văn bản trong file khác bản đã bung — sửa tại file khai nó' };
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
    return { ok: false, reason: 'không có gì thay đổi' };
  }
  if (side === 'after' && removeStart === insertAt) {
    return { ok: false, reason: 'không có gì thay đổi' };
  }

  // Hai splice không chồng: xoá khối cũ, chèn cùng chữ tại chỗ neo (toạ độ gốc).
  if (removeStart < insertAt && insertAt < removeEnd) {
    return { ok: false, reason: 'vị trí chèn nằm trong dòng cột đang kéo' };
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
// Chiều cao
//
// Hai con số khác nhau, ở hai chỗ khác nhau, và chọn nhầm là kéo một vùng nhưng vùng khác co lại:
//
//   `view@height`   chiều cao vùng MAIN (vùng tab) — dùng cho tab KHÔNG chứa lưới
//   `field@rows`    chiều cao của MỘT tab có lưới — khai trên chính field mang `<items style="Grid">`
//
// Luật này lấy từ DWF: «view@height chỉ áp cho tab KHÔNG chứa Grid; tab có Grid dùng field@rows».

/** Chèn hoặc ghi đè một thuộc tính số trên thẻ mở. Dùng chung cho `height` và `rows`. */
function planNumericAttr({ range, tagStart, tagName, attr, current, value, sourceText }) {
  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: `${attr} phải là số ≥ 0` };

  if (range) {
    if (sourceText.slice(range.start, range.end) !== String(current)) {
      return { ok: false, reason: `khai báo ${attr} trong file khác bản đã bung — sửa tại file khai nó` };
    }
    if (String(n) === String(current)) return { ok: false, reason: 'không có gì thay đổi' };
    return { ok: true, file: range.file, splice: { start: range.start, end: range.end, text: String(n) } };
  }

  // Chưa khai thuộc tính → chèn ngay sau tên thẻ, chỗ chắc chắn nằm trong thẻ mở.
  if (!tagStart) return { ok: false, reason: `không tìm thấy thẻ <${tagName}> trong file nguồn` };
  const at = tagStart.start + tagName.length + 1;
  if (sourceText.slice(tagStart.start, at) !== `<${tagName}`) {
    return { ok: false, reason: `không xác định được thẻ <${tagName}> trong file nguồn` };
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
    return { ok: false, reason: `thuộc tính không sửa được: ${attr}` };
  }
  const region = (model.regions ?? []).find((r) => r.id === regionId);
  if (!region) return { ok: false, reason: `không có vùng "${regionId}"` };
  if (!region.writeback) {
    return { ok: false, reason: 'không xác định được thẻ khai vùng này trong file nguồn' };
  }

  const n = Math.round(value);
  if (!Number.isFinite(n) || n < 0) return { ok: false, reason: `${attr} phải là số ≥ 0` };
  if (n > region.widths.length) {
    return { ok: false, reason: `${attr}=${n} vượt quá ${region.widths.length} cột của vùng này` };
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
      return { ok: false, reason: `không xác định được <category index="${index}" columns> trong file nguồn` };
    }
    return { ok: true, span, value: String(cat.columns), label: `<category index="${index}" columns>` };
  }
  if (model.inferredWidths || !model.widthsItem) {
    return {
      ok: false,
      reason: 'view không khai list px (<item> đầu tiên) — số cột đang suy từ pattern,'
        + ' không có biên nào để tách hay gộp',
    };
  }
  if (!model.widthsItem.span) {
    return { ok: false, reason: 'không xác định được <item> list px trong file nguồn' };
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
      reason: `split=${v} trỏ đúng vào vạch sắp bị bỏ — đổi hoặc xoá nó trước rồi mới gộp được`,
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
  if (!region) return { ok: false, reason: `không có vùng "${op.region}"` };
  if (!model.segments) return { ok: false, reason: 'không xác định được nguồn của list px' };

  const key = widthsOwnerKey(model, region.index);
  const owner = widthsOwnerOf(model, key);
  if (!owner.ok) return owner;

  const count = region.widths.length;
  const col = Math.trunc(Number(op.col));
  if (!Number.isInteger(col) || col < 0 || col >= count) {
    return { ok: false, reason: `không có cột ${col + 1} trong vùng này (${count} cột)` };
  }
  if (op.kind === 'mergeColumn' && col + 1 >= count) {
    return { ok: false, reason: `cột ${col + 1} là cột cuối — bên phải không còn cột nào để gộp vào` };
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
    return { ok: false, reason: `phép sửa cột không biết: ${op.kind}` };
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
      return { ok: false, reason: `item ${row.index}: không xác định được vị trí trong file nguồn` };
    }

    let pattern;
    if (op.kind === 'splitColumn') {
      pattern = splitPatternAt(row.row.pattern, col);
    } else {
      const m = mergePatternAt(row.row.pattern, col);
      if (!m.ok) return { ok: false, reason: `item ${row.index}: ${m.reason}` };
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
      const moved = shiftMarker(attr, from, op.kind, col);
      if (!moved.ok) return { ok: false, reason: `vùng ${r.id}: ${moved.reason}` };
      if (moved.value === Math.trunc(Number(from))) continue;

      const range = attr === 'anchor' ? r.writeback?.anchorRange : r.writeback?.splitRange;
      if (!range) {
        return {
          ok: false,
          reason: `vùng ${r.id}: không xác định được vị trí ${attr}="${from}" trong file nguồn`,
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
            reason: `hai chỗ đòi ghi hai thứ khác nhau vào cùng một dải của ${file}`
              + ' — khai báo dùng chung này phải sửa bằng tay',
          };
        }
        continue; // trùng khít, cùng nội dung → một splice là đủ
      }
      if (prev && e.start < prev.end) {
        return {
          ok: false,
          reason: `hai chỗ cần sửa chồng lên nhau trong ${file} — khai báo dùng chung này phải sửa bằng tay`,
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
      return { ok: false, reason: `chưa đọc được ${e.file} để đối chiếu trước khi ghi` };
    }
    const actual = text.slice(e.start, e.end);
    if (actual !== e.expect) {
      return {
        ok: false,
        reason: `dải sắp ghi đè trong ${e.file} mang "${actual}", không phải "${e.expect}" — file nguồn đã đổi?`,
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

/** Chiều cao một tab có lưới — `field@rows` trên chính field mang `<items style="Grid">`. */
export function planFieldRows(model, fieldName, rows, sourceText) {
  const field = model.fieldByName.get(fieldName);
  if (!field) return { ok: false, reason: `không có field "${fieldName}"` };
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

// ─────────────────────────────────────────────────────────────────────────────
// Hàng rỗng, xoá cả cụm control, và phân giải entity vào file thiết kế
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dải của cả DÒNG chứa `[start,end)` — nuốt thụt lề phía trước và dấu xuống dòng phía sau.
 *
 * Chỉ nuốt thụt lề khi phía trước thật sự CHỈ có khoảng trắng: `<item …/><item …/>` viết chung
 * một dòng thì cắt từ đầu dòng là mất luôn thẻ hàng xóm.
 */
function lineSpanAround(text, start, end) {
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
function emptyRowSplice(row, nextRow, sourceText) {
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

/** Ba kind đi kèm một control: chúng chỉ tô điểm cho ô Input, không sống độc lập. */
const COMPANION_KINDS = new Set(['label', 'footer', 'description']);

// ═════════════════════════════════════════════════════════════════════════════
// DỜI / ĐỔI CHỖ TỰ DO — qua hàng khác, qua vùng khác, qua tab khác
// ═════════════════════════════════════════════════════════════════════════════
//
// Ba việc tách bạch nhau, và trộn chúng là chỗ mọi lỗi ở đây sinh ra:
//
//   1. GHI     `valuePatch` — ghi lại `<item value>` bằng `textPatch`, tức chỉ vá đúng mấy ký
//              tự đã đổi, ở đúng file sở hữu chúng. Đây là thứ THAY THẾ `sourceRow`: không còn
//              luật "hàng có entity thì từ chối", chỉ còn "chỗ SẮP ĐỔI vắt qua ranh giới entity
//              thì từ chối". Chỉ số ô và chỉ số token vẫn tính trên bản ĐÃ BUNG — đó luôn là
//              bản đúng để suy luận về cột — còn việc quy ngược về file thật là của `segments`.
//   2. BỐ CỤC  `removeCell` / `placeCell` trên hàng nguồn và hàng đích. Thuần, không biết file.
//   3. VÙNG    `reconcileRegions` — vùng của một hàng KHÔNG khai trên `<item>` mà suy ra từ
//              `<field categoryIndex>`, nên dời một token qua hàng khác có thể lặng lẽ hất cả
//              một hàng sang vùng khác. Phần nguy hiểm nhất, và nó được xử bằng cách MÔ PHỎNG
//              rồi so, chứ không bằng cách đoán.

/**
 * Ghi lại `<item value>` của một hàng — bản thay thế cho `sourceRow`.
 *
 * `sourceRow` đọc lại văn bản gốc rồi đòi nó khớp NGUYÊN VĂN với bản đã bung, nên nó chặn sạch
 * mọi hàng có entity: pattern viết bằng entity, hay một `&Grp;` bung ra ba token, đều làm phép
 * so thất bại và phép sửa bị từ chối — dù chỗ thật sự đổi chẳng liên quan gì tới entity. Đó là
 * cái khoá sai chỗ: nó xét HÀNG, trong khi thứ đáng xét là ĐOẠN SẮP GHI.
 *
 * Ở đây làm theo lối `patternPlan` đã làm đúng từ trước cho gộp/tách: tính giá trị MỚI trên bản
 * đã bung, đưa cả `before`/`after` cho `textPatch` để nó tự cắt ra đúng đoạn đã đổi rồi quy đoạn
 * ấy về file sở hữu. Hệ quả:
 *
 *   - Hàng đến từ Include → splice rơi vào Include, `warning` bật để tầng vỏ hỏi.
 *   - Đoạn đổi nằm trong `&Split;` → splice rơi thẳng vào file khai `Split`.
 *   - Đoạn đổi nằm ngoài mọi entity, dù hàng có cả tá entity chỗ khác → ghi bình thường.
 *   - Đoạn đổi VẮT QUA ranh giới hai nguồn → từ chối, vì một splice không cắt hai file được.
 *
 * Thụt lề của pattern giữ nguyên (`reindentPattern`): không giữ thì hàng viết `value=" 1101 : …"`
 * bị nắn lại lề, và diff hiện một thay đổi người dùng không hề yêu cầu.
 */
function valuePatch(model, row, nextRow, what) {
  if (!row.item?.valueSpan || !model.segments) {
    return { ok: false, reason: `${what}: không xác định được vị trí trong file nguồn` };
  }
  const tokens = nextRow.tokens.map((t) => t.raw).join(nextRow.separator ?? ', ');
  const pattern = reindentPattern(row.row.patternRaw, nextRow.pattern);
  const after = !nextRow.hasColon && tokens === ''
    ? pattern
    : `${pattern}:${nextRow.afterColon ?? ' '}${tokens}`;
  if (after === row.item.value) return { ok: false, reason: 'không có gì thay đổi' };
  return textPatch(model.segments, row.item.valueSpan.start, row.item.value, after, what);
}

/** Chỉ số token mà một ô đang giữ = số ô KHÔNG TRỐNG đứng trước nó. */
function tokenIndexOfCell(cells, cell) {
  let n = 0;
  for (const c of cells) {
    if (c === cell) return n;
    if (!c.empty) n++;
  }
  return -1;
}

/** Ô nào của hàng đang giữ token `.Label` / `.Footer` / `.Description` của field `name`. */
function companionCells(row, name) {
  return (row.cells ?? []).filter((c) => !c.empty
    && c.token
    && c.token.field === name
    && COMPANION_KINDS.has(c.token.kind));
}

/**
 * Dải [start, start+span) trên pattern đích có toàn `-` không.
 * Cùng luật với `placeCell` — dùng để thử neo trước khi ghi.
 */
function rangeFree(pattern, columnCount, start, span) {
  if (start < 0 || start + span > columnCount) return false;
  const chars = Array.from(resolvePattern(pattern, columnCount).pattern);
  for (let c = start; c < start + span; c++) {
    if (chars[c] !== '-') return false;
  }
  return true;
}

/**
 * Neo cột cho ô ĐƯỢC KÉO (`src`) khi đặt cả cụm lên hàng đích.
 *
 * Ưu tiên đúng `preferredCol` (chỗ thả). Nếu cụm lệch tương đối (vd `.Label` ở cột trước)
 * đụng control sẵn có trong khi bên phải còn slot trống — trượt neo tới chỗ gần nhất mà CẢ
 * cụm nằm gọn trên `-`. Không đổi khoảng cách tương đối trong cụm.
 *
 * @returns {{ok:true, anchor:number} | {ok:false, reason:string}}
 */
function clusterDropAnchor(dstRow, widths, members, src, preferredCol) {
  const columnCount = widths.length;
  const pattern = dstRow.pattern;
  const fits = (anchor) => members.every((c) =>
    rangeFree(pattern, columnCount, anchor + (c.col - src.col), c.span));

  if (fits(preferredCol)) return { ok: true, anchor: preferredCol };

  let best = null;
  for (let a = 0; a < columnCount; a++) {
    if (a === preferredCol || !fits(a)) continue;
    const dist = Math.abs(a - preferredCol);
    if (!best || dist < best.dist) best = { a, dist };
  }
  if (best) return { ok: true, anchor: best.a };

  const blockers = [];
  for (const c of members) {
    const at = preferredCol + (c.col - src.col);
    if (rangeFree(pattern, columnCount, at, c.span)) continue;
    const kind = c === src ? (c.token?.kind || 'input') : (c.token?.kind || '?');
    blockers.push(`.${kind}@cột ${at + 1}`);
  }
  return {
    ok: false,
    reason: `cụm [${src.token?.field}] không đặt vừa hàng đích khi thả ở cột ${preferredCol + 1}`
      + (blockers.length ? ` — ${blockers.join(', ')} đang bị chiếm hoặc vượt hàng` : '')
      + '; kéo tới dải trống đủ rộng cho cả nhãn và ô nhập',
  };
}

/**
 * Vùng của MỌI hàng, tính lại trên một thế giới GIẢ ĐỊNH.
 *
 * `tokensByRow` — hàng nào đã có danh sách token mới (sau khi dời).
 * `catOverride`  — field nào đã được ghi lại `categoryIndex`.
 *
 * Dùng CHUNG `fieldCategories`/`rowCategoryIndex` với `render.mjs` chứ không chép luật lại: đây
 * là phép so giữa "form sẽ trông thế nào" và "form đang trông thế nào", nên hai vế bắt buộc phải
 * do cùng một hàm tính ra. Chép lại là mở đường cho hai bản đọc lệch nhau, và lệch ở đây nghĩa
 * là designer hứa một đằng còn runtime vẽ một nẻo.
 */
function regionsAfter(model, tokensByRow, catOverride) {
  const cat = fieldCategories([...model.fieldByName.values()]);
  for (const [name, n] of catOverride) cat.set(name, n);

  const out = new Map();
  for (const r of model.rows) {
    const tokens = tokensByRow.has(r.index) ? tokensByRow.get(r.index) : r.row.tokens;
    // Hàng không còn token nào sẽ bị bỏ hẳn thẻ `<item>` — nó không còn vùng để mà lệch.
    if (tokens.length === 0) continue;
    out.set(r.index, rowCategoryIndex({ tokens }, cat));
  }
  return out;
}

/**
 * Sau phép dời, có hàng nào bị hất sang vùng khác không — và ghi cái gì để nó ở nguyên chỗ cũ.
 *
 * Đây là phần dễ hỏng im lặng nhất của cả tính năng, nên nó làm bằng MÔ PHỎNG chứ không bằng suy
 * đoán: dựng thế giới sau phép dời, tính lại vùng của mọi hàng, so với vùng hiện tại. Mọi hàng
 * đều phải giữ nguyên vùng — kể cả hàng đích, kể cả hàng chẳng liên quan gì.
 *
 * GHI TỐI THIỂU. Không phải cứ dời qua vùng khác là ghi `categoryIndex`, và rất nhiều ca không
 * cần ghi gì cả: field không khai `categoryIndex` thì nó chẳng cầm lái vùng của hàng nào, dời
 * đi đâu cũng không hất ai — control cứ thế hiện ở vùng của hàng đích. Chỉ khi mô phỏng CHỈ RA
 * một hàng sắp lệch thì mới ghi, và ghi đúng cái tối thiểu để kéo nó về:
 *
 *   hàng ĐÍCH lệch  → field vừa dời tới đang cầm lái sai; ghi `categoryIndex` của nó = vùng đích
 *   hàng NGUỒN lệch → nó vừa mất field duy nhất khai vùng; GHIM bằng cách ghi `categoryIndex`
 *                     lên một field còn lại trong hàng
 *   không ghim được → TỪ CHỐI. Ghi thêm nữa để chữa là bắt đầu sửa những chỗ người dùng không
 *                     nhìn vào, và mỗi lần ghi lại có thể kéo theo một hàng khác nữa.
 *
 * Mỗi lần ghim đều mô phỏng LẠI toàn bộ trước khi nhận: một `categoryIndex` ghi lên field dùng
 * chung có thể hất một hàng thứ ba, và ghim mù thì đúng là cách tạo ra chuyện đó.
 *
 * @returns {{ok:true, overrides:Map<string,number>, pinned:string[]}|{ok:false, reason:string}}
 */
function reconcileRegions(model, tokensByRow) {
  const before = new Map(model.rows.map((r) => [r.index, r.categoryIndex]));
  const rowAt = new Map(model.rows.map((r) => [r.index, r]));
  const overrides = new Map();
  const pinned = [];

  const offenders = (over) => [...regionsAfter(model, tokensByRow, over).entries()]
    .filter(([index, region]) => region !== before.get(index));

  let bad = offenders(overrides);

  // Chặn cứng: mỗi vòng ghi đúng MỘT field, và không bao giờ ghi lại field đã ghi — nên số vòng
  // không thể vượt số field.
  for (let guard = 0; bad.length > 0 && guard <= model.fieldByName.size; guard++) {
    const [index, got] = bad[0];
    const target = before.get(index);
    const tokens = tokensByRow.has(index) ? tokensByRow.get(index) : rowAt.get(index)?.row.tokens ?? [];

    /*
     * THỨ TỰ THỬ có chủ ý, và bản trước sai đúng ở đây.
     *
     * Field ĐANG KHAI `categoryIndex` được thử TRƯỚC, vì nó chính là thứ cầm lái vùng của hàng —
     * dời `ma_nvbh` (khai 1) vào một hàng header thì thủ phạm là nó, và cái đúng để ghi là
     * `ma_nvbh` = 0. Duyệt token theo thứ tự cột như bản trước thì `ma_kh` (chẳng khai gì, chẳng
     * liên quan) được ghi trước chỉ vì nó đứng đầu: hàng vẫn về đúng vùng, nhưng designer vừa
     * thêm một thuộc tính lên một field vô can, còn `ma_nvbh` thì ở lại header mà vẫn khai là
     * thuộc tab 1 — đọc file sau này không hiểu nổi.
     *
     * Field CHƯA khai chỉ tới lượt khi không còn ai khai: đó đúng là ca GHIM hàng nguồn, nơi
     * hàng vừa mất field duy nhất khai vùng và phải nhờ một field còn lại đứng ra giữ chỗ.
     */
    const declared = new Set(fieldCategories([...model.fieldByName.values()]).keys());
    const candidates = [
      ...tokens.filter((t) => t.field && declared.has(t.field)),
      ...tokens.filter((t) => t.field && !declared.has(t.field)),
    ];

    let fixed = false;
    for (const t of candidates) {
      if (!t.field || overrides.has(t.field)) continue;
      const trial = new Map(overrides);
      trial.set(t.field, target);
      const still = offenders(trial);
      // Chỉ nhận khi bản mô phỏng THẬT SỰ tốt lên. Không thì thử field khác — ghi một thuộc tính
      // mà tình hình không khá hơn là ghi vô ích lên file của khách.
      if (still.length < bad.length) {
        overrides.set(t.field, target);
        pinned.push(t.field);
        bad = still;
        fixed = true;
        break;
      }
    }

    if (!fixed) {
      return {
        ok: false,
        reason: `phép này sẽ hất hàng ${index + 1} từ vùng ${before.get(index)} sang vùng ${got},`
          + ' và không field nào trong hàng ghim lại được —'
          + ' sửa categoryIndex bằng tay trước, hoặc chọn chỗ thả khác',
      };
    }
  }

  if (bad.length > 0) {
    return { ok: false, reason: `phép này làm ${bad.length} hàng đổi vùng ngoài ý muốn — từ chối để không hỏng im lặng` };
  }
  return { ok: true, overrides, pinned };
}

/**
 * Splice ghi `categoryIndex="n"` lên một `<field>` — sửa tại chỗ, hoặc chèn mới sau tên thẻ.
 *
 * Không dùng lại `planNumericAttr` vì nó chặn số âm, mà `-1` là giá trị THẬT của vùng footer.
 */
function categoryPatch(model, name, value) {
  const field = model.fieldByName.get(name);
  if (!field) return { ok: false, reason: `không có khai báo <field name="${name}"> để ghi categoryIndex` };
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return { ok: false, reason: `categoryIndex ${value} không hợp lệ` };

  if (field.categoryRange) {
    return {
      ok: true,
      file: field.categoryRange.file,
      splice: { start: field.categoryRange.start, end: field.categoryRange.end, text: String(n) },
      expect: String(field.attrs?.categoryIndex ?? ''),
      wrote: `${name}.categoryIndex = ${n}`,
    };
  }
  // Chưa khai → chèn ngay sau tên thẻ, chỗ chắc chắn nằm trong thẻ mở.
  if (!field.tagStart) return { ok: false, reason: `không tìm thấy thẻ <field name="${name}"> trong file nguồn` };
  const at = field.tagStart.start + '<field'.length;
  return {
    ok: true,
    file: field.tagStart.file,
    splice: { start: field.tagStart.start, end: at, text: `<field categoryIndex="${n}"` },
    expect: '<field',
    wrote: `${name}.categoryIndex = ${n} (thêm mới)`,
  };
}

/**
 * Ghi lại hàng NGUỒN — hoặc bỏ hẳn thẻ `<item>` nếu nó vừa mất control cuối cùng.
 *
 * Cùng lý do với `emptyRowSplice`: một `<item value="----: "/>` không token nào vẫn CHIẾM một
 * hàng trên form. Ở tầng này chưa có văn bản nguồn để soi thẻ, nên chỗ đó chỉ đánh dấu `dropRow`
 * và để `verifyPatches` kiểm nốt.
 */
function rowWritePatch(model, row, nextRow, what) {
  const at = row.itemRange;
  const canDrop = nextRow.tokens.length === 0
    && at && row.range
    && at.file === row.range.file
    && at.start <= row.range.start && at.end >= row.range.end;
  if (!canDrop) return valuePatch(model, row, nextRow, what);
  return {
    ok: true,
    file: at.file,
    splice: { start: at.start, end: at.end, text: '' },
    expect: null,
    dropRow: true,
  };
}

/**
 * Phần THUẦN, KHÔNG CẦN VĂN BẢN của phép dời — trả danh sách patch kèm `expect`.
 *
 * Mỗi token giữ span gốc, thu về `min(span, số cột trống liền từ cột thả)`. Multi-select gửi
 * `targets` (Shift+click); mỗi ô đặt lần lượt, cột kế tiếp sau span đã giữ của ô trước.
 *
 * Tách khỏi phần đối chiếu vì có đúng cái vòng luẩn quẩn mà `rowEditTargetFile` đã gỡ một lần:
 * muốn so nguyên văn thì phải đọc file, mà biết đọc file nào thì phải tính xong patch. Tính
 * trước, rồi tầng vỏ mở đúng bấy nhiêu file — xem `moveControlFiles`.
 */
function buildMovePatches(model, op) {
  const { item, cell, toItem, toCol, targets } = op;
  const list = Array.isArray(targets) && targets.length > 0
    ? targets
    : [{ item, cell }];
  return buildMoveManyPatches(model, list, toItem ?? item, toCol);
}

/**
 * Dời một hoặc nhiều ô tới hàng đích.
 * `targets`: [{ item, cell }] — thứ tự giữ nguyên; mỗi ô giữ span gốc (thu về chỗ trống còn lại).
 */
function buildMoveManyPatches(model, targets, toItem, baseCol) {
  const to = model.rows.find((r) => r.index === toItem);
  if (!to) return { ok: false, reason: `không tìm thấy hàng đích ${toItem}` };

  const base = Math.trunc(Number(baseCol));
  if (!Number.isFinite(base) || base < 0) return { ok: false, reason: `cột đích ${baseCol} không hợp lệ` };

  const picks = [];
  for (const t of targets) {
    const row = model.rows.find((r) => r.index === t.item);
    if (!row) return { ok: false, reason: `không tìm thấy hàng ${t.item}` };
    const src = row.cells?.[t.cell];
    if (!src || src.empty || !src.token) return { ok: false, reason: 'ô trống, không có gì để dời' };
    picks.push({ row, src, token: src.token });
  }

  // Gỡ nguồn: mỗi hàng theo cột GIẢM DẦN để cột bên trái không bị lệch chỉ số.
  const rowState = new Map();
  for (const p of picks) rowState.set(p.row.index, p.row.row);

  const removeOrder = [...picks].sort((a, b) => {
    if (a.row.index !== b.row.index) return a.row.index - b.row.index;
    return b.src.col - a.src.col;
  });
  const rowIndexes = [...new Set(removeOrder.map((p) => p.row.index))];
  for (const ri of rowIndexes) {
    const group = removeOrder.filter((p) => p.row.index === ri).sort((a, b) => b.src.col - a.src.col);
    let cur = rowState.get(ri);
    const widths = group[0].row.widths;
    for (const p of group) {
      const { cells } = buildCells(cur, widths);
      const idx = cells.findIndex((x) => x.col === p.src.col && !x.empty);
      if (idx === -1) return { ok: false, reason: `không tìm lại được ô ở cột ${p.src.col + 1}` };
      const done = removeCell(cur, widths, idx, { allowEntity: true });
      if (!done.ok) return done;
      cur = done.row;
    }
    rowState.set(ri, cur);
  }

  // Đặt lên đích: mỗi token giữ span gốc, thu về min(span, số slot trống liền từ cột thả).
  let dst = rowState.has(to.index) ? rowState.get(to.index) : to.row;
  let at = base;
  for (const p of picks) {
    if (at >= to.widths.length) {
      return {
        ok: false,
        reason: `đặt tại cột ${at + 1} thì control trải 1 cột vượt khỏi hàng (${to.widths.length} cột)`,
      };
    }
    const avail = emptyRunFrom(dst, to.widths, at);
    const keep = Math.min(p.src.span, avail);
    if (keep < 1) {
      // Probe span 1 để lấy lý do chi tiết của placeCell (ô đang có người / vượt hàng…).
      const probe = placeCell(dst, to.widths, at, 1, p.token, { allowEntity: true });
      return probe.ok
        ? { ok: false, reason: `cột ${at + 1} không còn slot trống để đặt [${p.token?.field ?? '?'}]` }
        : probe;
    }
    const done = placeCell(dst, to.widths, at, keep, p.token, { allowEntity: true });
    if (!done.ok) return done;
    dst = done.row;
    at += keep;
  }
  rowState.set(to.index, dst);

  const tokenMap = new Map();
  for (const [ri, parsed] of rowState) tokenMap.set(ri, parsed.tokens);
  const fixed = reconcileRegions(model, tokenMap);
  if (!fixed.ok) return fixed;

  const patches = [];
  for (const [ri, parsed] of rowState) {
    const row = model.rows.find((r) => r.index === ri);
    if (!row) continue;
    // Hàng đích luôn valuePatch; hàng nguồn khác có thể bỏ luôn thẻ <item> nếu hết token.
    const patch = ri === to.index
      ? valuePatch(model, row, parsed, `hàng ${ri + 1}`)
      : rowWritePatch(model, row, parsed, `hàng ${ri + 1}`);
    if (!patch.ok) {
      if (patch.reason === 'không có gì thay đổi') continue;
      return patch;
    }
    if (!patches.some((x) => x.file === patch.file && x.splice?.start === patch.splice?.start)) {
      patches.push(patch);
    }
  }

  for (const [field, n] of fixed.overrides) {
    const cp = categoryPatch(model, field, n);
    if (!cp.ok) return cp;
    patches.push(cp);
  }

  if (patches.length === 0) return { ok: false, reason: 'không có gì thay đổi' };

  const touched = [...rowState.keys()].map((i) => model.rows.find((r) => r.index === i)).filter(Boolean);
  return {
    ok: true,
    patches,
    warning: touched.find((r) => r.foreign)?.range?.file ?? null,
    pinned: fixed.pinned,
    moved: picks.length,
    dropAnchor: base,
    dropPreferred: base,
  };
}

/**
 * Phần THUẦN của phép ĐỔI CHỖ — hai token hoán vị, có thể ở HAI HÀNG khác nhau.
 *
 * Mỗi token giữ span gốc, chỉ thu về `min(span mình, span slot đích)` khi chỗ mới hẹp hơn.
 */
function buildSwapPatches(model, { item, cell, toItem, other }) {
  const ra = model.rows.find((r) => r.index === item);
  if (!ra) return { ok: false, reason: `không tìm thấy hàng ${item}` };
  const rb = model.rows.find((r) => r.index === (toItem ?? item));
  if (!rb) return { ok: false, reason: `không tìm thấy hàng ${toItem}` };

  const a = ra.cells?.[cell];
  const b = rb.cells?.[other];
  if (!a || a.empty || !a.token) return { ok: false, reason: 'ô trống, không có control để đổi chỗ' };
  if (!b || b.empty || !b.token) return { ok: false, reason: 'ô trống, không có control để đổi chỗ' };
  if (ra.index === rb.index && cell === other) return { ok: false, reason: 'không có gì thay đổi' };

  // CÙNG HÀNG → `swapCells` lo trọn (hoán token + thu span về min khi khác bề rộng).
  if (ra.index === rb.index) {
    const done = swapCells(ra.row, ra.widths, cell, other, { allowEntity: true });
    if (!done.ok) return done;
    const patch = valuePatch(model, ra, done.row, `hàng ${ra.index + 1}`);
    if (!patch.ok) return patch;
    return { ok: true, patches: [patch], warning: ra.foreign ? ra.range?.file : null, pinned: [] };
  }

  /*
   * HAI HÀNG: thay token TẠI CHỖ ở cả hai bên, rồi thu span về `min` nếu slot đích hẹp hơn
   * span gốc của token tới (cùng luật với `swapCells` cùng hàng).
   */
  const swapIn = (row, cells, at, token) => {
    const ti = tokenIndexOfCell(cells, at);
    if (ti === -1 || !row.tokens[ti]) return null;
    const tokens = [...row.tokens];
    tokens[ti] = token;
    return { ...row, tokens };
  };
  let nextA = swapIn(ra.row, ra.cells, a, b.token);
  let nextB = swapIn(rb.row, rb.cells, b, a.token);
  if (!nextA || !nextB) return { ok: false, reason: 'không map được token của một trong hai ô' };

  const keep = Math.min(a.span, b.span);
  if (keep < a.span) {
    const shrunk = setSpan(nextA, ra.widths, cell, keep, { allowEntity: true });
    if (!shrunk.ok) return shrunk;
    nextA = shrunk.row;
  }
  if (keep < b.span) {
    const shrunk = setSpan(nextB, rb.widths, other, keep, { allowEntity: true });
    if (!shrunk.ok) return shrunk;
    nextB = shrunk.row;
  }

  /*
   * Qua VÙNG khác thì cụm phải đi cùng — mà ĐỔI CHỖ không chở cụm đi được: chỗ bên kia đã có
   * người, không còn slot nào cho `.Label` đáp xuống. Nói thẳng thay vì đổi nửa vời rồi để lại
   * hai cái nhãn lạc ở hai vùng.
   */
  if (ra.categoryIndex !== rb.categoryIndex) {
    for (const tok of [a.token, b.token]) {
      if (!tok.field || tok.kind !== 'input') continue;
      for (const r of model.rows) {
        if (companionCells(r, tok.field).length === 0) continue;
        return {
          ok: false,
          reason: `[${tok.field}] có ô .Label/.Footer/.Description ở hàng ${r.index + 1} —`
            + ' đổi chỗ qua vùng khác không chở cụm đi cùng được (chỗ bên kia đã có người);'
            + ' dùng phép DỜI cho từng ô, hoặc đổi chỗ trong cùng một vùng',
        };
      }
    }
  }

  const fixed = reconcileRegions(model, new Map([[ra.index, nextA.tokens], [rb.index, nextB.tokens]]));
  if (!fixed.ok) return fixed;

  const patches = [];
  for (const [row, next] of [[ra, nextA], [rb, nextB]]) {
    const patch = valuePatch(model, row, next, `hàng ${row.index + 1}`);
    if (!patch.ok) return patch;
    patches.push(patch);
  }
  for (const [field, n] of fixed.overrides) {
    const cp = categoryPatch(model, field, n);
    if (!cp.ok) return cp;
    patches.push(cp);
  }

  return {
    ok: true,
    patches,
    warning: [ra, rb].find((r) => r.foreign)?.range?.file ?? null,
    pinned: fixed.pinned,
  };
}

/**
 * Đối chiếu từng patch với văn bản THẬT rồi trả danh sách splice cho tầng vỏ.
 *
 * Phép so nguyên văn này là thứ DUY NHẤT chặn việc ghi nhầm chỗ khi offset đã cũ (người dùng vừa
 * gõ tay vào XML, hay một Include vừa đổi). Không bao giờ được bỏ.
 */
function verifyPatches(built, getText) {
  if (!built.ok) return built;

  const edits = [];
  for (const p of built.patches) {
    const text = getText(p.file);
    if (typeof text !== 'string') {
      return { ok: false, reason: `không đọc được ${p.file} để đối chiếu trước khi ghi` };
    }
    const actual = text.slice(p.splice.start, p.splice.end);

    if (p.dropRow) {
      // Bỏ hẳn thẻ `<item>`: dải phải THẬT SỰ là một thẻ item, lệch là offset đã cũ.
      if (!/^<item\b[^>]*>$/i.test(actual.trim())) {
        return {
          ok: false,
          reason: `dải sắp bỏ mang "${actual.slice(0, 40)}", không phải một thẻ <item> — file nguồn đã đổi?`,
        };
      }
      const line = lineSpanAround(text, p.splice.start, p.splice.end);
      edits.push({ file: p.file, start: line.start, end: line.end, text: '' });
      continue;
    }

    if (actual !== p.expect) {
      return {
        ok: false,
        reason: `dải sắp ghi đè mang "${actual}", không phải "${p.expect}" — file nguồn đã đổi?`,
      };
    }
    edits.push({ file: p.file, ...p.splice });
  }

  if (edits.length === 0) return { ok: false, reason: 'không có gì thay đổi' };
  return {
    ok: true,
    edits,
    warning: built.warning ?? null,
    pinned: built.pinned ?? [],
    wrote: built.patches.filter((p) => p.wrote).map((p) => p.wrote),
    dropAnchor: built.dropAnchor,
    dropPreferred: built.dropPreferred,
    moved: built.moved,
  };
}

/**
 * DỜI một control sang hàng khác / vùng khác / tab khác — hoặc sang cột khác trong cùng hàng.
 *
 * @param op       {item, cell, toItem, toCol}
 * @param getText  (file) => string|null — tầng vỏ đọc sẵn, core không chạm đĩa
 */
export function planMoveControl(model, op, getText) {
  return verifyPatches(buildMovePatches(model, op), getText);
}

/**
 * Dời một KHỐI hàng `<item>` liền kề (Shift+click nhiều hàng) tới trước/sau hàng đích.
 *
 * Khác `planMoveControl`: không gỡ token khỏi pattern rồi nhét sang hàng khác — cả thẻ `<item>`
 * đi nguyên, các hàng còn lại dịch theo trong file. Chỉ nhận hàng liền kề trên file nguồn.
 *
 * @param op {items:number[], toItem:number, side?:'before'|'after'}
 */
export function planMoveRowBlock(model, { items, toItem, side = 'before' }, getText) {
  const uniq = [...new Set((items ?? []).map(Number))]
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (uniq.length < 2) return { ok: false, reason: 'block cần ít nhất 2 hàng' };

  const blockRows = uniq.map((i) => model.rows.find((r) => r.index === i));
  if (blockRows.some((r) => !r)) return { ok: false, reason: 'không tìm thấy hàng trong block' };
  if (blockRows.some((r) => !r.itemRange)) {
    return { ok: false, reason: 'không xác định được thẻ <item> của một hàng trong block' };
  }

  const file = blockRows[0].itemRange.file;
  if (blockRows.some((r) => r.itemRange.file !== file)) {
    return { ok: false, reason: 'các hàng block nằm ở nhiều file — không dời chung được' };
  }

  const dest = model.rows.find((r) => r.index === toItem);
  if (!dest?.itemRange) return { ok: false, reason: `không tìm thấy hàng đích ${toItem}` };
  if (dest.itemRange.file !== file) {
    return { ok: false, reason: 'hàng đích khác file với block' };
  }
  if (uniq.includes(toItem)) return { ok: false, reason: 'không có gì thay đổi' };

  const text = typeof getText === 'function' ? getText(file) : null;
  if (typeof text !== 'string') {
    return { ok: false, reason: 'chưa đọc được văn bản nguồn để đối chiếu trước khi ghi' };
  }

  const spans = blockRows
    .map((r) => lineSpanOfItem(text, r.itemRange))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const gap = text.slice(spans[i - 1].end, spans[i].start);
    if (!/^[\r\n \t]*$/.test(gap)) {
      return { ok: false, reason: 'các hàng không liền kề trong file nguồn — chỉ dời được vùng liền kề' };
    }
  }

  const blockStart = spans[0].start;
  const blockEnd = spans[spans.length - 1].end;
  const blockText = text.slice(blockStart, blockEnd);
  if (blockText.trim() === '') return { ok: false, reason: 'block rỗng' };

  const destSpan = lineSpanOfItem(text, dest.itemRange);
  const insertAt = side === 'after' ? destSpan.end : destSpan.start;
  if (insertAt > blockStart && insertAt < blockEnd) {
    return { ok: false, reason: 'vị trí thả nằm trong chính block đang kéo' };
  }

  let splice;
  if (insertAt <= blockStart) {
    splice = {
      start: insertAt,
      end: blockEnd,
      text: blockText + text.slice(insertAt, blockStart),
    };
  } else {
    splice = {
      start: blockStart,
      end: insertAt,
      text: text.slice(blockEnd, insertAt) + blockText,
    };
  }

  if (splice.text === text.slice(splice.start, splice.end)) {
    return { ok: false, reason: 'không có gì thay đổi' };
  }

  return {
    ok: true,
    edits: [{ file, start: splice.start, end: splice.end, text: splice.text }],
    warning: blockRows.find((r) => r.foreign)?.range?.file
      ?? (blockRows.find((r) => r.foreign) ? file : null),
    pinned: [],
    moved: uniq.length,
  };
}

/** Thẻ `<item>` + thụt lề dòng + xuống dòng sau thẻ — đơn vị dịch chuyển cả hàng. */
function lineSpanOfItem(text, itemRange) {
  const lineStart = text.lastIndexOf('\n', itemRange.start - 1) + 1;
  let end = itemRange.end;
  if (text.slice(end, end + 2) === '\r\n') end += 2;
  else if (text[end] === '\n') end += 1;
  return { start: lineStart, end };
}

/** ĐỔI CHỖ hai control, cùng hàng hoặc khác hàng. @param op {item, cell, toItem, other} */
export function planSwapControl(model, op, getText) {
  return verifyPatches(buildSwapPatches(model, op), getText);
}

/**
 * File nào tầng vỏ phải mở trước khi gọi `planMoveControl` / `planSwapControl`.
 *
 * Chạy đúng phần THUẦN rồi gom `file` của từng patch — không đoán, không mở thừa. Kế hoạch hỏng
 * thì trả mảng rỗng và để hàm plan nói lý do, chứ không nói hộ ở đây.
 */
export function moveControlFiles(model, op) {
  if (op.kind === 'moveBlock') {
    const rows = (op.items ?? []).map((i) => model.rows.find((r) => r.index === i)).filter(Boolean);
    const dest = model.rows.find((r) => r.index === op.toItem);
    const files = [...rows, dest].map((r) => r?.itemRange?.file ?? r?.range?.file).filter(Boolean);
    return [...new Set(files)];
  }
  const built = op.kind === 'swap' ? buildSwapPatches(model, op) : buildMovePatches(model, op);
  return built.ok ? [...new Set(built.patches.map((p) => p.file))] : [];
}

/**
 * Xoá một control CÙNG với Label / Footer / Description của nó — lối Shift+Delete.
 *
 * Khác `planRowEdit({kind:'remove'})` ở hai chỗ, và cả hai là lý do nó phải là hàm riêng:
 *
 *   1. Nó đụng NHIỀU HÀNG. `[x].Description` hay nằm ở hàng dưới, `[x].Footer` ở hàng cuối vùng
 *      — cùng một control nhưng ba thẻ `<item>` khác nhau. Một splice không nói hết được.
 *   2. Mỗi hàng nằm ở một FILE khác nhau được: hàng chính ở controller, hàng phụ ở Include.
 *      Nên nó nhận `getText(file)` chứ không nhận một `sourceText`.
 *
 * Chỉ ô INPUT mới kéo theo cả cụm. Bấm Shift+Delete trên chính ô `.Label` thì chỉ ô đó đi —
 * xoá cả control vì người dùng nhắm vào cái nhãn là làm nhiều hơn họ yêu cầu.
 *
 * Mốc để tìm lại ô sau mỗi lần cắt là CỘT (`cell.col`), không phải chỉ số ô: bỏ một ô trải 2
 * cột biến nó thành HAI ô trống, nên mọi chỉ số phía sau chạy đi một nấc. Cột thì đứng yên.
 *
 * @param getText  (file) => string|null — văn bản nguồn của từng file có hàng bị đụng
 * @returns {{ok:true, edits:Array<{file,start,end,text}>, warning:string|null, fieldName:string|null}
 *          |{ok:false, reason:string}}
 */
export function planRemoveControl(model, { item, cell, companions = false }, getText) {
  const row = model.rows.find((r) => r.index === item);
  if (!row) return { ok: false, reason: 'không tìm thấy hàng' };
  const target = row.cells?.[cell];
  if (!target || target.empty || !target.token) return { ok: false, reason: 'ô trống, không có gì để xoá' };

  const name = target.token.field;
  const takeAll = companions === true && target.token.kind === 'input' && !!name;

  // (hàng → cột cần bỏ). Ô đang chọn luôn có mặt; cụm đi kèm chỉ khi Shift.
  const byRow = new Map();
  const mark = (r, col) => {
    if (!byRow.has(r.index)) byRow.set(r.index, { row: r, cols: new Set() });
    byRow.get(r.index).cols.add(col);
  };
  mark(row, target.col);

  if (takeAll) {
    for (const r of model.rows) {
      for (const c of r.cells ?? []) {
        if (!c.token || c.empty) continue;
        if (c.token.field !== name) continue;
        if (!COMPANION_KINDS.has(c.token.kind)) continue;
        mark(r, c.col);
      }
    }
  }

  const edits = [];
  let warning = null;
  for (const { row: r, cols } of byRow.values()) {
    if (!r.range) return { ok: false, reason: `hàng ${r.index}: không xác định được vị trí trong file nguồn` };
    const text = getText(r.range.file);
    if (typeof text !== 'string') {
      return { ok: false, reason: `không đọc được ${r.range.file} để đối chiếu trước khi ghi` };
    }
    const src = sourceRow(r, text, model);
    if (!src.ok) return { ok: false, reason: `hàng ${r.index}: ${src.reason}` };

    let current = src.parsed;
    // Giảm dần theo cột: hai ô cùng hàng thì bỏ ô phải trước, ô trái sau — cột của ô trái không
    // bị lay chuyển bởi việc ô phải biến thành `-`.
    for (const col of [...cols].sort((a, b) => b - a)) {
      const { cells } = buildCells(current, r.widths);
      const idx = cells.findIndex((c) => c.col === col && !c.empty);
      if (idx === -1) continue; // đã đi cùng một ô trải nhiều cột ở vòng trước
      const done = removeCell(current, r.widths, idx, { allowEntity: true });
      if (!done.ok) return { ok: false, reason: `hàng ${r.index}: ${done.reason}` };
      current = done.row;
    }

    const drop = emptyRowSplice(r, current, text);
    const next = drop ?? { start: r.range.start, end: r.range.end, text: serializeRow(current) };
    if (!drop && next.text === src.value) continue; // hàng này rốt cuộc không đổi gì

    edits.push({ file: r.range.file, ...next });
    if (src.warning) warning = warning ?? src.warning;
  }

  if (edits.length === 0) return { ok: false, reason: 'không có gì thay đổi' };
  return { ok: true, edits, warning, fieldName: name ?? null };
}

/**
 * PHÂN GIẢI một `&Name;` vào chính file thiết kế: comment dòng tham chiếu, chèn bản đã bung
 * ngay dưới.
 *
 * Đây là lối thoát cho ca «tôi muốn sửa hàng này, nhưng nó khai ở Include dùng chung». Hai
 * đường đi được, và chúng dẫn tới hai kết quả khác hẳn nhau:
 *
 *   sửa vào file gốc  → mọi controller include file đó cùng đổi theo
 *   phân giải vào đây → chỉ controller NÀY đổi; Include giữ nguyên cho người khác
 *
 * Dấu vết để lại phải đọc được bằng mắt, nên tham chiếu cũ được COMMENT chứ không xoá: người
 * đọc file sau này thấy ngay «chỗ này từng là `&Name;`, đã bung ra tại chỗ» và biết đường quay
 * lại. Xoá đi là biến một quyết định thành một sự trùng hợp.
 *
 * TỪ CHỐI khi dòng chứa `&Name;` còn thứ khác ngoài chính nó. Comment cả dòng khi ấy là tắt
 * luôn phần nội dung kia — hỏng im lặng, đúng thứ luật «không chắc thì từ chối» sinh ra để
 * chặn. Ca đó hiếm, và người dùng sửa tay được.
 *
 * @param hostText  văn bản file thiết kế (controller đang mở)
 * @param ref       {start,end} dải `&Name;` trong `hostText`
 * @param resolved  văn bản ĐÃ BUNG mà tham chiếu ấy sinh ra
 */
export function planInlineEntity(hostText, ref, resolved) {
  if (!ref || !(ref.end > ref.start) || ref.end > hostText.length) {
    return { ok: false, reason: 'không xác định được chỗ khai &Name; trong file đang mở' };
  }
  const refText = hostText.slice(ref.start, ref.end);
  if (!/^&[A-Za-z_][\w.:-]*;$/.test(refText)) {
    return { ok: false, reason: `dải sắp thay mang "${refText}", không phải một tham chiếu entity — file đã đổi?` };
  }

  const lineStart = hostText.lastIndexOf('\n', ref.start - 1) + 1;
  let lineEnd = hostText.indexOf('\n', ref.end);
  if (lineEnd === -1) lineEnd = hostText.length;
  else if (hostText[lineEnd - 1] === '\r') lineEnd -= 1;

  const line = hostText.slice(lineStart, lineEnd);
  if (line.trim() !== refText) {
    return {
      ok: false,
      reason: `dòng khai &…; còn nội dung khác (${line.trim()}) — phân giải tại chỗ sẽ comment mất nó.`
        + ' Tách nó ra dòng riêng rồi thử lại.',
    };
  }

  const body = String(resolved ?? '').replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  if (body === '') return { ok: false, reason: `${refText} bung ra rỗng — không có gì để chèn` };

  const indent = /^[ \t]*/.exec(line)[0];
  const eol = hostText.includes('\r\n') ? '\r\n' : '\n';
  // Bản bung mang thụt lề của FILE GỐC. Chỉ kê lại dòng đầu nếu nó trần trụi — kê hết mọi dòng
  // là phá thụt lề tương đối bên trong khối, thứ nói ra cấu trúc của nó.
  const first = /^[ \t]/.test(body) ? '' : indent;
  const text = `${indent}<!-- ${refText} -->${eol}${first}${body.split(/\r?\n/).join(eol)}`;

  return { ok: true, splice: { start: lineStart, end: lineEnd, text } };
}

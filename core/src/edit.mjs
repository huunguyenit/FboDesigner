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

import { serializeRow, setSpan, setStart, removeCell, insertCell, newRow } from './item-value.mjs';
import { segmentAt } from './entities.mjs';

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

  // Đầu và đuôi giống nhau thì không phải ghi lại. Chặn hai mốc không cho vượt qua nhau, để
  // đoạn đổi luôn là một dải hợp lệ kể cả khi pattern bị pad dài ra hay cắt ngắn đi.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head
    && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;

  const from = row.item.valueSpan.start + head;
  const to = row.item.valueSpan.start + before.length - tail;
  const text = after.slice(head, after.length - tail);

  const seg = segmentAt(model.segments, from);
  if (!seg) return { ok: false, reason: 'không xác định được nguồn của pattern' };
  if (to > seg.end) {
    return {
      ok: false,
      reason: 'chỗ cần sửa vắt qua ranh giới entity — sửa thẳng trong file khai entity',
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

  const allowed = canEditRow(row, sourceText);
  if (!allowed.ok) return allowed;

  // Đo bằng list px CỦA VÙNG chứa hàng, không phải của view: tab có `<category columns>` riêng,
  // dùng nhầm list của view là mọi phép tính cột lệch đúng ở những vùng khó phát hiện nhất.
  const widths = row.widths;

  let result;
  if (op.kind === 'resize') result = setSpan(row.row, widths, op.cell, op.span);
  else if (op.kind === 'remove') result = removeCell(row.row, widths, op.cell);
  else if (op.kind === 'insert') result = insertCell(row.row, widths, op.cell, op.side, op.token);
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
  const allowed = canEditRow(row, sourceText);
  if (!allowed.ok) return allowed;
  if (!itemRange) return { ok: false, reason: 'không xác định được vị trí thẻ <item> trong file nguồn' };

  const made = newRow(row.widths, op.token);
  if (!made.ok) return made;

  // Thụt lề lấy từ CHÍNH dòng chứa thẻ cũ — hàng mới phải trông như do người viết file đặt ra,
  // không phải như do máy nhét vào.
  const lineStart = sourceText.lastIndexOf('\n', itemRange.start - 1) + 1;
  const indent = /^[ \t]*/.exec(sourceText.slice(lineStart, itemRange.start))[0];
  const eol = sourceText.includes('\r\n') ? '\r\n' : '\n';
  const tag = `<item value="${escapeAttr(serializeRow(made.row))}"/>`;

  const at = op.side === 'above' ? lineStart : itemRange.end;
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

  return { ok: true, splice: { start: lineStart, end: lineStart, text: `${fieldIndent}${xml}${eol}` } };
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
// bên KHÔNG dùng chung hàm nào. Ba phép, và chúng đụng vào hai chỗ khác nhau trong file:
//
//   kéo giãn  → `width="N"` trong `<fields><field>`   (khai báo)
//   xoá cột   → `<field name="x"/>` trong `<view>`    (thứ tự hiển thị)
//   chèn cột  → `<field name="x"/>` trong `<view>`
//
// Xoá cột KHÔNG xoá khai báo: cùng một `<field>` có thể được view khác dùng, và bỏ cột khỏi
// lưới là chuyện hiển thị chứ không phải bỏ dữ liệu.

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

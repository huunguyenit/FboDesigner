// item-value.mjs — đại số layout của form FBO.
//
// Đặc tả nguồn: hub 4AI, `assets/skills/erp/erp-view-design/references/reference-item-value.md`.
// File này là bản CÀI ĐẶT. Lệch nhau thì sửa file này, trừ khi đặc tả sai so với corpus —
// khi đó sửa đặc tả trước (ADR-0002).
//
// Ý chính: form FBO không có toạ độ. Một hàng là chuỗi `pattern: token, token` trên nền một
// list px khai ở item đầu tiên của view. Kéo thả một ô nghĩa là viết lại chuỗi đó cho đúng
// bất biến — KHÔNG phải đổi một con số px của riêng ô.
//
// Mọi hàm ở đây THUẦN: nhận dữ liệu, trả dữ liệu. Không đọc file, không chạm DOM.

const RE_ENTITY_REF = /&[A-Za-z_][\w.:-]*;/;

/** Ba kind hợp lệ. Mọi thứ khác sau dấu chấm là TYPO, không phải biến thể. */
const KINDS = new Map([['label', 'label'], ['description', 'description'], ['footer', 'footer']]);

/** Item ĐẦU TIÊN của view và không có `:` thì mới là list px. Item đầu đã có `:` → view không có list cột. */
export function classifyItem(value, indexInView) {
  if (value === null || value === undefined) return 'other';
  return indexInView === 0 && !value.includes(':') ? 'widths' : 'row';
}

/** `"120, 30, 45"` → `[120, 30, 45]`. Width 0 là hợp lệ và có thật (cột neo/đệm). */
export function parseWidths(value) {
  const parts = String(value).split(',');
  const widths = [];
  const warnings = [];
  for (const [i, p] of parts.entries()) {
    const t = p.trim();
    if (t === '') continue;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      warnings.push(`cột ${i + 1}: "${t}" không phải số px hợp lệ — coi như 0`);
      widths.push(0);
    } else {
      widths.push(n);
    }
  }
  return { widths, warnings, hasEntity: RE_ENTITY_REF.test(String(value)) };
}

/** `"[ten_tk%l].Label"` → token. Tên trong `[]` giữ NGUYÊN VĂN: `%l` là một phần của tên, `&k;` cũng vậy. */
export function parseToken(raw) {
  const text = raw.trim();
  const m = /^\[([^\]]*)\](.*)$/.exec(text);
  if (!m) return { raw: text, field: null, kind: 'unknown', kindRaw: null, valid: false };

  const field = m[1];
  const rest = m[2].trim();
  if (rest === '') return { raw: text, field, kind: 'input', kindRaw: null, valid: true };
  if (!rest.startsWith('.')) return { raw: text, field, kind: 'unknown', kindRaw: rest, valid: false };

  const kindRaw = rest.slice(1);
  // `[field].` chấm rỗng KHÔNG phải biến thể footer — đọc như ô Input.
  if (kindRaw === '') return { raw: text, field, kind: 'input', kindRaw: '', valid: true };

  const kind = KINDS.get(kindRaw.toLowerCase());
  if (!kind) return { raw: text, field, kind: 'unknown', kindRaw, valid: false };
  return { raw: text, field, kind, kindRaw, valid: true };
}

/** `"1100: [a].Label, [a]"` → pattern + tokens, giữ lại cách ngăn cách để ghi lại ít nhiễu diff. */
export function parseRow(value) {
  const text = String(value);
  const colon = text.indexOf(':');
  const patternRaw = colon === -1 ? text : text.slice(0, colon);
  const tokensRaw = colon === -1 ? '' : text.slice(colon + 1);

  const tokens = tokensRaw.split(',').map((t) => t.trim()).filter((t) => t !== '').map(parseToken);
  const pattern = patternRaw.trim();
  const ones = countOnes(pattern);

  const warnings = [];
  if (ones !== tokens.length) {
    warnings.push(`bất biến hỏng: ${ones} ký tự "1" nhưng ${tokens.length} token`);
  }
  for (const t of tokens) {
    if (!t.valid && t.kindRaw) warnings.push(`token "${t.raw}": ".${t.kindRaw}" không phải kind hợp lệ (typo?)`);
    else if (!t.valid) warnings.push(`token "${t.raw}": không đọc được`);
  }

  return {
    pattern,
    patternRaw,
    tokens,
    tokensRaw,
    separator: /,\s/.test(tokensRaw) ? ', ' : ',',
    afterColon: colon !== -1 && /^\s/.test(tokensRaw) ? ' ' : '',
    hasColon: colon !== -1,
    hasEntity: RE_ENTITY_REF.test(text),
    warnings,
  };
}

function countOnes(pattern) {
  let n = 0;
  for (const c of pattern) if (c === '1') n++;
  return n;
}

/**
 * Pattern ngắn hơn số cột → pad `-`. Dài hơn → CẮT CỤT.
 * Cắt trúng một `1` là mất control mà runtime không báo gì — đó là cả lý do hàm này trả `lostOnes`.
 */
export function resolvePattern(pattern, columnCount) {
  const chars = Array.from(pattern);
  if (chars.length < columnCount) {
    return {
      pattern: pattern + '-'.repeat(columnCount - chars.length),
      padded: columnCount - chars.length,
      truncated: 0,
      lostOnes: 0,
    };
  }
  if (chars.length > columnCount) {
    const cut = chars.slice(columnCount);
    return {
      pattern: chars.slice(0, columnCount).join(''),
      padded: 0,
      truncated: cut.length,
      lostOnes: cut.filter((c) => c === '1').length,
    };
  }
  return { pattern, padded: 0, truncated: 0, lostOnes: 0 };
}

/**
 * Dựng danh sách ô của một hàng.
 * `1` mở ô mới và ăn token kế tiếp · `0` nối vào ô đang mở (tăng span) · `-` ô trống ·
 * ký tự lạ xử như `-` · `0` đứng đầu hoặc ngay sau `-` không nối được vào đâu → ô trống.
 *
 * @returns {{cells: Array<{col:number,span:number,width:number,token:object|null,empty:boolean}>, warnings: string[]}}
 */
export function buildCells({ pattern, tokens }, widths) {
  const columnCount = widths.length;
  const resolved = resolvePattern(pattern, columnCount);
  const warnings = [];
  if (resolved.lostOnes > 0) warnings.push(`pattern dài hơn ${columnCount} cột: cắt mất ${resolved.lostOnes} control`);

  const cells = [];
  let open = null; // ô đang mở — chỉ ô mở bằng `1` mới nhận `0`
  let nextToken = 0;
  let col = 0;

  for (const ch of Array.from(resolved.pattern)) {
    if (ch === '1') {
      const token = nextToken < tokens.length ? tokens[nextToken++] : null;
      if (!token) warnings.push(`cột ${col + 1}: "1" nhưng đã hết token`);
      open = { col, span: 1, width: widths[col] ?? 0, token, empty: false };
      cells.push(open);
    } else if (ch === '0' && open) {
      open.span += 1;
      open.width += widths[col] ?? 0;
    } else {
      open = null;
      cells.push({ col, span: 1, width: widths[col] ?? 0, token: null, empty: true });
    }
    col++;
  }

  if (nextToken < tokens.length) warnings.push(`còn ${tokens.length - nextToken} token không có "1" nào nhận`);
  return { cells, warnings, resolved };
}

/** Ghi lại thành `value` của `<item>`. Giữ separator gốc để diff chỉ hiện phần thật sự đổi. */
export function serializeRow(row) {
  const tokens = row.tokens.map((t) => t.raw).join(row.separator ?? ', ');
  if (!row.hasColon && tokens === '') return row.pattern;
  return `${row.pattern}:${row.afterColon ?? ' '}${tokens}`;
}

/**
 * Chỉ số token mà ô thứ `cellIndex` đang giữ = số ký tự `1` đứng TRƯỚC cột của nó.
 *
 * Không đếm được bằng `cells.filter(c => !c.empty)` vì ô mở bằng `1` mà hết token vẫn là ô
 * "không rỗng" — đếm kiểu đó lệch đúng một nấc ở hàng có bất biến hỏng, và edit ghi nhầm token.
 */
function tokenIndexOf(pattern, col) {
  let n = 0;
  const chars = Array.from(pattern);
  for (let i = 0; i < col && i < chars.length; i++) if (chars[i] === '1') n++;
  return n;
}

/** Guard chung cho mọi phép sửa hàng. Trả `null` nếu sửa được. */
function refuseEdit(row) {
  // Hàng có `&Name;` thì văn bản đã BUNG khác hẳn văn bản trong file. Ghi bản bung đè lên
  // nguồn là xoá sạch tham chiếu entity và nhân bản nội dung dùng chung vào một controller.
  if (row.hasEntity) return 'hàng có entity (&…;) — sửa ở file entity, không sửa tại controller';
  return null;
}

/**
 * Bỏ control khỏi một ô: cột của nó thành `-`, token của nó bị gỡ.
 *
 * Chỉ đụng CHÍNH ô đó. Ô bên cạnh không tự nở ra chiếm chỗ trống — nở hay không là quyết định
 * của người dùng, và designer không quyết hộ.
 *
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function removeCell(row, widths, cellIndex) {
  const refuse = refuseEdit(row);
  if (refuse) return { ok: false, reason: refuse };

  const { cells } = buildCells(row, widths);
  const cell = cells[cellIndex];
  if (!cell) return { ok: false, reason: `không có ô thứ ${cellIndex}` };
  if (cell.empty) return { ok: false, reason: 'ô trống, không có gì để xoá' };

  const columnCount = widths.length;
  const chars = Array.from(resolvePattern(row.pattern, columnCount).pattern);
  const ti = tokenIndexOf(chars.join(''), cell.col);

  for (let c = cell.col; c < cell.col + cell.span; c++) chars[c] = '-';
  const tokens = row.tokens.filter((_, i) => i !== ti);
  return { ok: true, row: { ...row, pattern: chars.join(''), tokens } };
}

/**
 * Thêm một control vào ô TRỐNG kề bên ô đang chọn.
 *
 * Chỉ ăn ô trống — đụng ô đang giữ control thì TỪ CHỐI, cùng thái độ với `setSpan`. Đè lên
 * control có sẵn là làm mất một khai báo mà người dùng không hề yêu cầu.
 *
 * @param side 'left' | 'right'
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function insertCell(row, widths, cellIndex, side, tokenRaw) {
  const list = Array.isArray(tokenRaw) ? tokenRaw : [tokenRaw];
  const refuse = refuseEdit(row);
  if (refuse) return { ok: false, reason: refuse };

  const parsed = list.map((t) => parseToken(String(t ?? '').trim()));
  const bad = parsed.find((t) => !t.valid);
  if (bad) return { ok: false, reason: `token "${bad.raw}" không đọc được` };

  const columnCount = widths.length;
  const { cells } = buildCells(row, widths);
  const cell = cells[cellIndex];
  if (!cell) return { ok: false, reason: `không có ô thứ ${cellIndex}` };

  // Một control có thể cần NHIỀU cột (textbox = nhãn + ô nhập). Cả dải phải trống, và phải nằm
  // gọn trong hàng — thiếu một cột cũng từ chối, chứ không đặt được bao nhiêu hay bấy nhiêu.
  const n = parsed.length;
  const from = side === 'left' ? cell.col - n : cell.col + cell.span;
  if (from < 0) return { ok: false, reason: `bên trái chỉ còn ${cell.col} cột trống, cần ${n}` };
  if (from + n > columnCount) {
    return { ok: false, reason: `bên phải chỉ còn ${columnCount - (cell.col + cell.span)} cột trống, cần ${n}` };
  }

  const chars = Array.from(resolvePattern(row.pattern, columnCount).pattern);
  for (let c = from; c < from + n; c++) {
    if (chars[c] !== '-') return { ok: false, reason: `cột ${c + 1} đang có control — bỏ nó trước rồi mới thêm được` };
  }

  // Đặt cột trước, tính chỉ số token sau: `tokenIndexOf` đếm số `1` đứng trước, nên phải đếm
  // trên pattern ĐÃ đặt xong thì thứ tự token mới khớp thứ tự cột.
  for (let c = from; c < from + n; c++) chars[c] = '1';
  const ti = tokenIndexOf(chars.join(''), from);
  const tokens = [...row.tokens];
  tokens.splice(ti, 0, ...parsed);
  return { ok: true, row: { ...row, pattern: chars.join(''), tokens } };
}

/**
 * Hàng mới toanh mang đúng một control ở cột 0 — dùng cho `+ phía trên` / `+ phía dưới`.
 * Các cột còn lại để trống, không đoán hộ người dùng muốn gì ở đó.
 */
export function newRow(widths, tokenRaw) {
  const list = Array.isArray(tokenRaw) ? tokenRaw : [tokenRaw];
  const parsed = list.map((t) => parseToken(String(t ?? '').trim()));
  const bad = parsed.find((t) => !t.valid);
  if (bad) return { ok: false, reason: `token "${bad.raw}" không đọc được` };

  const columnCount = Math.max(widths.length, parsed.length);
  if (parsed.length > widths.length && widths.length > 0) {
    return { ok: false, reason: `control cần ${parsed.length} cột nhưng view chỉ có ${widths.length}` };
  }
  return {
    ok: true,
    row: {
      pattern: `${'1'.repeat(parsed.length)}${'-'.repeat(columnCount - parsed.length)}`,
      tokens: parsed,
      separator: ', ',
      afterColon: ' ',
      hasColon: true,
      hasEntity: false,
      warnings: [],
    },
  };
}

/**
 * Đổi span của một ô — phép kéo cạnh phải, nguyên thuỷ của merge/split.
 *
 * Nở ra chỉ được ăn cột TRỐNG phía sau; đụng ô đang giữ token thì TỪ CHỐI, không nuốt hộ.
 * Người dùng phải quyết bỏ ô kia hay không — designer hỏi, không đoán.
 *
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function setSpan(row, widths, cellIndex, newSpan, { allowEntity = false } = {}) {
  const refuse = allowEntity ? null : refuseEdit(row);
  if (refuse) return { ok: false, reason: refuse };
  if (newSpan < 1) return { ok: false, reason: 'span tối thiểu là 1' };

  const { cells } = buildCells(row, widths);
  const cell = cells[cellIndex];
  if (!cell) return { ok: false, reason: `không có ô thứ ${cellIndex}` };
  if (cell.empty) return { ok: false, reason: 'ô trống không có span để đổi' };

  const columnCount = widths.length;
  if (cell.col + newSpan > columnCount) {
    return { ok: false, reason: `nở tới cột ${cell.col + newSpan} nhưng view chỉ có ${columnCount} cột` };
  }

  const chars = Array.from(resolvePattern(row.pattern, columnCount).pattern);
  if (newSpan > cell.span) {
    for (let c = cell.col + cell.span; c < cell.col + newSpan; c++) {
      if (chars[c] !== '-' && chars[c] !== '0') {
        return { ok: false, reason: `cột ${c + 1} đang có control — bỏ nó trước rồi mới nở được` };
      }
    }
  }
  for (let c = cell.col + 1; c < cell.col + Math.max(newSpan, cell.span); c++) {
    chars[c] = c < cell.col + newSpan ? '0' : '-';
  }

  return { ok: true, row: { ...row, pattern: chars.join('') } };
}

/**
 * Đổi CỘT BẮT ĐẦU của một ô — phép kéo cạnh TRÁI.
 *
 * Đối xứng với `setSpan` nhưng không quy về nó được, và chỗ khác nhau đáng nói: `setSpan` giữ
 * nguyên `1` rồi sửa mấy ký tự phía sau, còn ở đây chính cái `1` phải DỜI CHỖ. Cột kết thúc
 * đứng yên; ô nở sang trái hay co từ trái.
 *
 * Vì sao không làm bằng cách "kéo cạnh phải của ô liền trước": ô liền trước thường là ô TRỐNG,
 * và ô trống không có span để mà đổi. Nở sang trái vào chỗ trống lại đúng là việc người ta muốn
 * làm nhất khi túm cạnh trái — nên quy về `setSpan` là hỏng đúng ca thường gặp nhất.
 *
 * Số `1` trong pattern không đổi, thứ tự cũng không, nên danh sách token đi kèm nguyên vẹn.
 *
 * Nở ra chỉ được ăn cột TRỐNG phía trước; đụng ô đang giữ token thì TỪ CHỐI, không nuốt hộ —
 * cùng một luật với `setSpan`.
 *
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function setStart(row, widths, cellIndex, newCol, { allowEntity = false } = {}) {
  const refuse = allowEntity ? null : refuseEdit(row);
  if (refuse) return { ok: false, reason: refuse };

  const { cells } = buildCells(row, widths);
  const cell = cells[cellIndex];
  if (!cell) return { ok: false, reason: `không có ô thứ ${cellIndex}` };
  if (cell.empty) return { ok: false, reason: 'ô trống không có cạnh trái để kéo' };

  if (newCol < 0) return { ok: false, reason: 'cột bắt đầu không thể âm' };
  const end = cell.col + cell.span; // cột kết thúc (không bao gồm) — đứng yên
  if (newCol >= end) return { ok: false, reason: 'cạnh trái không vượt qua được cạnh phải' };

  const chars = Array.from(resolvePattern(row.pattern, widths.length).pattern);
  if (newCol < cell.col) {
    for (let c = newCol; c < cell.col; c++) {
      if (chars[c] !== '-') {
        return { ok: false, reason: `cột ${c + 1} đang có control — bỏ nó trước rồi mới nở được` };
      }
    }
  }

  // Trả phần bị bỏ lại về ô trống, rồi vẽ lại ô ở vị trí mới. Làm theo thứ tự này để đoạn
  // giao nhau (khi co từ trái) không bị xoá sau khi đã ghi.
  for (let c = Math.min(newCol, cell.col); c < end; c++) chars[c] = '-';
  chars[newCol] = '1';
  for (let c = newCol + 1; c < end; c++) chars[c] = '0';

  return { ok: true, row: { ...row, pattern: chars.join('') } };
}

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
    // Suy separator chỉ ĐÚNG khi có dấu phẩy để mà suy. Hàng một token không có cái nào, và
    // bản trước rơi về `','` — nên hễ dời/thêm một control vào một hàng đơn lẻ là ra
    // `[dia_chi],[ma_kh]` dính liền, khác hẳn mọi hàng còn lại của file. Không quan sát được
    // thì dùng quy ước của corpus (`', '`), chỉ chốt `','` khi thấy TẬN MẮT một dấu phẩy không
    // có khoảng trắng theo sau.
    separator: /,(?!\s)/.test(tokensRaw) ? ',' : ', ',
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

/**
 * Guard chung cho mọi phép sửa hàng. Trả `null` nếu sửa được.
 *
 * `allowEntity` KHÔNG phải cái công tắc "kệ, cứ ghi". Nó nói: người gọi đang thao tác trên bản
 * parse của VĂN BẢN GỐC, chứ không phải bản đã bung — nên `t.raw` của mọi token không đụng tới
 * vẫn đang là `[&k;]`, và `serializeRow` ghi lại đúng chuỗi ấy. Tham chiếu entity sống sót
 * nguyên vẹn vì nó chưa từng bị thay.
 *
 * Ghi bản ĐÃ BUNG đè lên nguồn thì vẫn cấm, và đó mới là thứ guard này sinh ra để chặn: nó xoá
 * sạch tham chiếu và nhân bản nội dung dùng chung vào một controller.
 */
function refuseEdit(row, allowEntity = false) {
  if (row.hasEntity && !allowEntity) {
    return 'hàng có entity (&…;) — sửa ở file entity, không sửa tại controller';
  }
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
export function removeCell(row, widths, cellIndex, { allowEntity = false } = {}) {
  const refuse = refuseEdit(row, allowEntity);
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
 * Thêm một control vào ô TRỐNG kề bên ô đang chọn, hoặc VÀO CHÍNH ô trống (`side: 'in'`).
 *
 * Chỉ ăn ô trống — đụng ô đang giữ control thì TỪ CHỐI, cùng thái độ với `setSpan`. Đè lên
 * control có sẵn là làm mất một khai báo mà người dùng không hề yêu cầu.
 *
 * @param side 'left' | 'right' | 'in'
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function insertCell(row, widths, cellIndex, side, tokenRaw, { allowEntity = false } = {}) {
  const list = Array.isArray(tokenRaw) ? tokenRaw : [tokenRaw];
  const refuse = refuseEdit(row, allowEntity);
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
  if (side === 'in') {
    if (!cell.empty) return { ok: false, reason: 'ô đang có control — chọn ô trống để thêm field vào' };
  }
  const from = side === 'in' ? cell.col
    : side === 'left' ? cell.col - n
    : cell.col + cell.span;
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
 * DỜI một ô sang cột khác trong CÙNG hàng — kéo thả control.
 *
 * Khác hẳn `insertCell`: không dựng token mới nào. Token của ô cũ đi NGUYÊN XI sang chỗ mới, kể
 * cả khi nó viết bằng entity — `t.raw` không bị đụng vào, nên `[&k;]` vẫn là `[&k;]`. Đó cũng là
 * lý do phép này chạy được trên hàng có entity, cùng luật với `insertCell`.
 *
 * SPAN ĐI THEO. Ô trải 3 cột dời sang chỗ mới vẫn trải 3 — người dùng kéo một control, họ không
 * ngầm yêu cầu bóp nó lại. Chỗ mới không đủ 3 cột trống thì TỪ CHỐI, không tự co.
 *
 * Vùng đích được phép CHỒNG LÊN vùng nguồn — dời sang trái/phải một nấc là ca thường nhất. Nên
 * phép kiểm "cột đích có trống không" phải chạy trên pattern ĐÃ XOÁ vùng nguồn; kiểm trên
 * pattern gốc thì mọi cú dời một nấc đều tự đụng vào chính mình rồi bị từ chối.
 *
 * @param toCol cột đích, tính từ 0
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function moveCell(row, widths, cellIndex, toCol, { allowEntity = false } = {}) {
  const refuse = refuseEdit(row, allowEntity);
  if (refuse) return { ok: false, reason: refuse };

  const columnCount = widths.length;
  const { cells } = buildCells(row, widths);
  const cell = cells[cellIndex];
  if (!cell) return { ok: false, reason: `không có ô thứ ${cellIndex}` };
  if (cell.empty) return { ok: false, reason: 'ô trống, không có gì để dời' };

  const span = cell.span;
  const to = Math.trunc(Number(toCol));
  if (!Number.isFinite(to) || to < 0) return { ok: false, reason: `cột đích ${toCol} không hợp lệ` };
  if (to + span > columnCount) {
    return { ok: false, reason: `dời tới cột ${to + 1} thì control trải ${span} cột vượt khỏi hàng` };
  }
  if (to === cell.col) return { ok: false, reason: 'không có gì thay đổi' };

  // Gỡ token TRƯỚC khi đổi pattern: `tokenIndexOf` đếm số `1` đứng trước, nên chỉ số cũ chỉ đọc
  // đúng trên pattern CŨ.
  const chars = Array.from(resolvePattern(row.pattern, columnCount).pattern);
  const fromTi = tokenIndexOf(chars.join(''), cell.col);
  const token = row.tokens[fromTi];
  if (!token) return { ok: false, reason: `ô thứ ${cellIndex} không có token nào để dời` };

  for (let c = cell.col; c < cell.col + span; c++) chars[c] = '-';
  for (let c = to; c < to + span; c++) {
    if (chars[c] !== '-') return { ok: false, reason: `cột ${c + 1} đang có control — bỏ nó trước rồi mới dời được` };
  }
  chars[to] = '1';
  for (let c = to + 1; c < to + span; c++) chars[c] = '0';

  const rest = row.tokens.filter((_, i) => i !== fromTi);
  const toTi = tokenIndexOf(chars.join(''), to);
  rest.splice(toTi, 0, token);
  return { ok: true, row: { ...row, pattern: chars.join(''), tokens: rest } };
}

/**
 * ĐỔI CHỖ hai control trong CÙNG một hàng — hoán token, pattern đứng yên (slot giữ kích thước).
 *
 * `moveCell` TỪ CHỐI khi cột đích đang có control, và đó là thái độ đúng của nó: dời một ô lên
 * chỗ đang có người là làm mất một khai báo mà không ai yêu cầu. Nhưng «đổi thứ tự hai field»
 * thì chẳng mất gì cả — nên nó cần phép RIÊNG, chứ không phải một cái công tắc nới lỏng
 * `moveCell`.
 *
 * Pattern không đổi một ký tự: cột bắt đầu và số cột chiếm của cả hai slot giữ nguyên, chỉ hai
 * token đổi chỗ. Nhờ vậy an toàn với hàng viết bằng entity ở CẢ HAI chỗ — pattern đi qua nguyên
 * văn, token đi qua bằng `t.raw` nên `[&k;]` vẫn là `[&k;]`.
 *
 * Khác span VẪN ĐƯỢC: ô trải 2 nhận token của ô trải 9 và ngược lại — đúng «giữ kích thước slot,
 * chỉ đổi vị trí input». Không đè lên ô thứ ba vì pattern không bị viết lại.
 *
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function swapCells(row, widths, cellIndex, otherIndex, { allowEntity = false } = {}) {
  const refuse = refuseEdit(row, allowEntity);
  if (refuse) return { ok: false, reason: refuse };

  const { cells } = buildCells(row, widths);
  const a = cells[cellIndex];
  const b = cells[otherIndex];
  if (!a) return { ok: false, reason: `không có ô thứ ${cellIndex}` };
  if (!b) return { ok: false, reason: `không có ô thứ ${otherIndex}` };
  if (cellIndex === otherIndex) return { ok: false, reason: 'không có gì thay đổi' };
  if (a.empty || b.empty) return { ok: false, reason: 'ô trống, không có control để đổi chỗ' };

  // Chỉ số token = số ký tự `1` đứng trước, đọc trên pattern ĐÃ bung cho đủ cột — cùng không
  // gian với `cell.col` mà `buildCells` vừa trả. Pattern không đổi nên chỉ số trước và sau như
  // nhau; hoán hai phần tử là xong.
  const { pattern } = resolvePattern(row.pattern, widths.length);
  const ai = tokenIndexOf(pattern, a.col);
  const bi = tokenIndexOf(pattern, b.col);
  const tokens = [...row.tokens];
  if (!tokens[ai] || !tokens[bi]) return { ok: false, reason: 'một trong hai ô không có token để đổi chỗ' };
  [tokens[ai], tokens[bi]] = [tokens[bi], tokens[ai]];

  // `row.pattern` đi qua NGUYÊN VĂN, không phải bản đã bung: phép này không sửa pattern, nên
  // splice chỉ được chạm vào phần token. Ghi bản đã bung đè lên là đổi byte mà không đổi nghĩa.
  return { ok: true, row: { ...row, tokens } };
}

/**
 * ĐẶT một token vào ĐÚNG cột và ĐÚNG span đã cho — nguyên thuỷ của phép dời SANG HÀNG KHÁC.
 *
 * `insertCell` không dùng lại được cho việc này: nó đặt token *kề bên một ô đang có*, tức nó cần
 * một ô mốc trong CHÍNH hàng ấy và tự suy ra cột. Dời từ hàng khác sang thì không có mốc nào —
 * cái ta cầm là một cột tuyệt đối do người dùng thả chuột xuống, và một span phải giữ nguyên từ
 * hàng cũ.
 *
 * Cũng khác `moveCell` ở chỗ nó KHÔNG gỡ gì đi: token đến từ một hàng khác, và việc gỡ nó khỏi
 * hàng cũ là một splice riêng vào một `<item>` riêng — có khi ở một file riêng.
 *
 * Mọi cột trong dải phải TRỐNG. Đè lên control có sẵn là làm mất một khai báo không ai yêu cầu,
 * cùng thái độ với `insertCell` và `moveCell`.
 *
 * @param col   cột bắt đầu, tính từ 0
 * @param span  số cột chiếm — giữ nguyên từ hàng cũ, không tự co
 * @param token token ĐÃ PARSE, đi nguyên xi (kể cả `t.raw` viết bằng entity)
 * @returns {{ok: true, row: object} | {ok: false, reason: string}}
 */
export function placeCell(row, widths, col, span, token, { allowEntity = false } = {}) {
  const refuse = refuseEdit(row, allowEntity);
  if (refuse) return { ok: false, reason: refuse };
  if (!token) return { ok: false, reason: 'không có token nào để đặt' };

  const columnCount = widths.length;
  const to = Math.trunc(Number(col));
  const n = Math.trunc(Number(span));
  if (!Number.isFinite(to) || to < 0) return { ok: false, reason: `cột đích ${col} không hợp lệ` };
  if (!Number.isFinite(n) || n < 1) return { ok: false, reason: `span ${span} không hợp lệ` };
  if (to + n > columnCount) {
    return { ok: false, reason: `đặt tại cột ${to + 1} thì control trải ${n} cột vượt khỏi hàng (${columnCount} cột)` };
  }

  const chars = Array.from(resolvePattern(row.pattern, columnCount).pattern);
  for (let c = to; c < to + n; c++) {
    if (chars[c] !== '-') return { ok: false, reason: `cột ${c + 1} đang có control — bỏ nó trước rồi mới đặt được` };
  }

  // Đặt cột TRƯỚC, tính chỉ số token SAU — `tokenIndexOf` đếm số `1` đứng trước, nên phải đếm
  // trên pattern đã đặt xong thì thứ tự token mới khớp thứ tự cột. Cùng luật với `insertCell`.
  chars[to] = '1';
  for (let c = to + 1; c < to + n; c++) chars[c] = '0';
  const pattern = chars.join('');
  const tokens = [...row.tokens];
  tokens.splice(tokenIndexOf(pattern, to), 0, token);
  return { ok: true, row: { ...row, pattern, tokens } };
}

/**
 * Hàng mới — dùng cho `+` thêm dòng / thêm control vào dòng mới.
 *
 * `tokenRaw` rỗng / `null` / `[]` → hàng trống toàn `-` (`---------`), không dấu `:`, không
 * token. Đó là «ô chờ» để sau này bấm slot blank mà thêm field vào.
 * Còn không thì mang đúng các token đã cho ở cột 0…n−1, các cột còn lại để trống.
 */
export function newRow(widths, tokenRaw) {
  const columnCount = Math.max(1, widths.length);
  const empty = tokenRaw == null
    || (Array.isArray(tokenRaw) && tokenRaw.length === 0)
    || (typeof tokenRaw === 'string' && String(tokenRaw).trim() === '');
  if (empty) {
    return {
      ok: true,
      row: {
        pattern: '-'.repeat(columnCount),
        tokens: [],
        separator: ', ',
        afterColon: ' ',
        hasColon: false,
        hasEntity: false,
        warnings: [],
      },
    };
  }

  const list = Array.isArray(tokenRaw) ? tokenRaw : [tokenRaw];
  const parsed = list.map((t) => parseToken(String(t ?? '').trim()));
  const bad = parsed.find((t) => !t.valid);
  if (bad) return { ok: false, reason: `token "${bad.raw}" không đọc được` };

  if (parsed.length > widths.length && widths.length > 0) {
    return { ok: false, reason: `control cần ${parsed.length} cột nhưng view chỉ có ${widths.length}` };
  }
  const cols = Math.max(widths.length, parsed.length);
  return {
    ok: true,
    row: {
      pattern: `${'1'.repeat(parsed.length)}${'-'.repeat(cols - parsed.length)}`,
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
 * Lấy một nửa (trái/phải theo `split`) — pattern + token; cắt sạch span vượt vạch.
 * @param {'left'|'right'} side
 */
export function takeRowHalf(row, widths, split, side) {
  const columnCount = Math.max(1, widths.length);
  const empty = {
    pattern: '-'.repeat(columnCount),
    tokens: [],
    separator: row?.separator ?? ', ',
    afterColon: row?.afterColon ?? ' ',
    hasColon: false,
    hasEntity: false,
    warnings: [],
  };
  if (!row || typeof row.pattern !== 'string'
    || !Number.isFinite(split) || split <= 0 || split >= columnCount
    || (side !== 'left' && side !== 'right')) {
    return empty;
  }

  const chars = Array.from(resolvePattern(row.pattern, columnCount).pattern);
  const { cells } = buildCells(row, widths);
  const keepStart = side === 'left' ? 0 : split;
  const keepEnd = side === 'left' ? split : columnCount;
  const clearStart = side === 'left' ? split : 0;
  const clearEnd = side === 'left' ? columnCount : split;

  for (let c = clearStart; c < clearEnd; c++) chars[c] = '-';

  for (const cell of cells) {
    if (cell.empty) continue;
    const end = cell.col + cell.span;
    if (cell.col >= clearStart && cell.col < clearEnd) {
      for (let c = Math.max(cell.col, keepStart); c < Math.min(end, keepEnd); c++) {
        chars[c] = '-';
      }
    }
  }

  const tokens = [];
  for (const cell of cells) {
    if (cell.empty || !cell.token) continue;
    if (cell.col >= keepStart && cell.col < keepEnd) tokens.push(cell.token);
  }

  const hasToken = tokens.length > 0;
  return {
    pattern: chars.join(''),
    tokens,
    separator: row.separator ?? ', ',
    afterColon: row.afterColon ?? ' ',
    hasColon: hasToken,
    hasEntity: tokens.some((t) => RE_ENTITY_REF.test(t.raw)) || false,
    warnings: [],
  };
}

/**
 * Ghép nửa trái + nửa phải (đã qua `takeRowHalf`) thành một hàng đủ cột.
 */
export function joinRowHalves(leftHalf, rightHalf, widths, split, templateRow) {
  const columnCount = Math.max(1, widths.length);
  if (!Number.isFinite(split) || split <= 0 || split >= columnCount) {
    return newRow(widths, []).row;
  }
  const leftChars = Array.from(resolvePattern(leftHalf.pattern, columnCount).pattern);
  const rightChars = Array.from(resolvePattern(rightHalf.pattern, columnCount).pattern);
  const pattern = leftChars.slice(0, split).join('') + rightChars.slice(split).join('');
  const tokens = [...(leftHalf.tokens ?? []), ...(rightHalf.tokens ?? [])];
  const hasToken = tokens.length > 0;
  const tmpl = templateRow ?? leftHalf;
  return {
    pattern,
    tokens,
    separator: tmpl.separator ?? ', ',
    afterColon: tmpl.afterColon ?? ' ',
    hasColon: hasToken,
    hasEntity: tokens.some((t) => RE_ENTITY_REF.test(t.raw)) || false,
    warnings: [],
  };
}

/**
 * Hàng mới trống một nửa; nửa kia lấy từ `refRow` (không dồn cascade — dùng nội bộ / test).
 * Cascade khi thêm hàng split nằm ở `planAddRow`.
 */
export function newSplitBlankRow(widths, refRow, split, blankSide) {
  const columnCount = Math.max(1, widths.length);
  if (!Number.isFinite(split) || split <= 0 || split >= columnCount
    || (blankSide !== 'left' && blankSide !== 'right')) {
    return newRow(widths, []);
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
  const keepSide = blankSide === 'left' ? 'right' : 'left';
  const blank = takeRowHalf(empty, widths, split, blankSide);
  const keep = takeRowHalf(refRow, widths, split, keepSide);
  const left = blankSide === 'left' ? blank : keep;
  const right = blankSide === 'left' ? keep : blank;
  return { ok: true, row: joinRowHalves(left, right, widths, split, refRow ?? empty) };
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

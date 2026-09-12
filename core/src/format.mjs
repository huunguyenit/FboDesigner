// format.mjs — `field@dataFormatString` → giá trị hiện ra trên lưới.
//
// Vì sao cần: dữ liệu thật về từ `sqlcmd` là văn bản THÔ của SQL Server —
// `2026-09-07 00:00:00.000` và `1234567.8900`. Runtime thì hiện `07/09/2026` và
// `1 234 567.89`. Một bản xem trước để ĐO BỀ RỘNG CỘT mà hiện con số thô là đo sai: chuỗi thô
// dài hơn chuỗi hiện thật (`.000` thừa ở mọi ô ngày), nên cột nào cũng có vẻ chật hơn thực tế.
//
// ═══ HAI LOẠI `dataFormatString`, VÀ CHÚNG KHÔNG CÙNG MỘT NGÔN NGỮ ═══
//
//   `@tên`           TRỎ tới một biến trong `Options/Options.xml` của program:
//                    `@datetimeFormat` → `dd/MM/yyyy`,
//                    `@foreignCurrencyAmountViewFormat` → `# ### ### ### ###.00`.
//                    Không đọc được file ấy thì KHÔNG đoán — trả nguyên giá trị thô.
//   viết thẳng       chính là mặt nạ: `dd/MM/yyyy HH:mm:ss`, `X`, `1, 2`.
//
// ═══ MẶT NẠ SỐ CỦA FBO ĐỌC THEO NGHĨA ĐEN ═══
//
// `# ### ### ### ###.00` — dấu ngăn nhóm là KHOẢNG TRẮNG (đúng ký tự viết trong mặt nạ), dấu
// thập phân là `.`, và số chữ số lẻ đúng bằng số ký tự sau dấu `.`.
//
// Cặp `Input`/`View` của cùng một biến khác nhau đúng một chỗ, và chỗ ấy có nghĩa:
//
//     foreignCurrencyAmountInputFormat   # ### ### ### ##0.00
//     foreignCurrencyAmountViewFormat    # ### ### ### ###.00
//
// Mặt nạ `View` kết thúc bằng `###` chứ không phải `##0`: hàng đơn vị là `#`, tức KHÔNG buộc in
// chữ số. Đó là quy ước «số 0 thì để trống ô» của bản xem — và nó đúng là thứ làm lưới FBO nhìn
// thưa chứ không dày đặc số 0. Mặt nạ `Input` có `0` ở hàng đơn vị nên 0 vẫn hiện ra `0`.
//
// LUẬT CỦA FILE NÀY: thuần, không chạm đĩa, không biết `Options.xml` nằm ở đâu. Tầng vỏ đọc file
// ấy rồi truyền vào một bản đồ `{tên: mặt nạ}` — cùng giao kèo với `loadDetail`/`gridConfig`.

/**
 * `<var name="…" type="String" value="…"/>` của `Options/Options.xml` → `{tên: giá trị}`.
 *
 * Chỉ nhặt `<var>`; file ấy còn nhiều thẻ khác và chúng không phải mặt nạ định dạng.
 */
export function scanOptionVars(text) {
  const out = {};
  const re = /<var\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) {
    const name = /\bname="([^"]*)"/i.exec(m[1]);
    const value = /\bvalue="([^"]*)"/i.exec(m[1]);
    if (name && value) out[name[1]] = value[1];
  }
  return out;
}

/** `@tên` → mặt nạ thật; không phải `@` thì chính nó là mặt nạ. */
export function resolveMask(raw, formats) {
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  if (!s.startsWith('@')) return s;
  const key = s.slice(1);
  // Không tra được thì trả RỖNG, không trả `@datetimeFormat`: một mặt nạ không tồn tại đem đi
  // định dạng là ra một chuỗi vô nghĩa, còn rỗng thì rơi về giá trị thô — đọc được.
  return Object.prototype.hasOwnProperty.call(formats ?? {}, key) ? String(formats[key]) : '';
}

const NUMERIC_TYPES = new Set(['decimal', 'numeric', 'money', 'float', 'double', 'int', 'integer', 'real']);
const typeOf = (field) => String(field?.attrs?.type ?? '').trim().toLowerCase();
const itemsStyle = (field) => String(field?.items?.style ?? '').trim().toLowerCase();

/** Cột SỐ — theo `field@type` hoặc `<items style="Numeric">`. */
export function isNumericField(field) {
  return NUMERIC_TYPES.has(typeOf(field)) || itemsStyle(field) === 'numeric';
}

/** Cột NGÀY — `type="DateTime"` (FBO không có `Date` riêng). */
export function isDateField(field) {
  const t = typeOf(field);
  return t === 'datetime' || t === 'date' || t === 'smalldatetime';
}

/**
 * Văn bản ngày của SQL Server → các phần. `null` nếu không đọc được.
 *
 * `sqlcmd` in `datetime` ra `2026-09-07 14:30:00.000` và `smalldatetime` ra
 * `2026-09-07 14:30:00`. Đọc bằng regex chứ không bằng `new Date()`: `Date` diễn giải theo múi
 * giờ của máy, và một ô ngày bị lệch một ngày vì múi giờ là lỗi không ai ngờ tới ở một công cụ
 * xem trước.
 */
function parseSqlDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value ?? '').trim());
  if (!m) return null;
  return {
    yyyy: m[1], MM: m[2], dd: m[3], HH: m[4] ?? '00', mm: m[5] ?? '00', ss: m[6] ?? '00',
  };
}

/**
 * Áp mặt nạ .NET cho ngày. Chỉ những token FBO thật sự dùng — `dd`, `MM`, `yyyy`, `yy`, `HH`,
 * `mm`, `ss` — và thay trong MỘT lượt, vì `mm` (phút) là con của `MM` (tháng) khi đổi lần lượt.
 *
 * Export ra ngoài `formatSampleValue` vì hộp thoại tham số (`askScriptParams` của extension)
 * cũng cần đúng phép này để HIỆN mặc định theo mặt nạ của field — xem `parseDisplayDate` cho
 * chiều ngược lại.
 */
export function formatDate(value, mask) {
  const p = parseSqlDate(value);
  if (!p) return null;
  return mask.replace(/dd|MM|yyyy|yy|HH|mm|ss/g, (t) => {
    if (t === 'yy') return p.yyyy.slice(-2);
    return p[t] ?? t;
  });
}

const RE_DATE_TOKEN = /dd|MM|yyyy|yy|HH|mm|ss/g;
const DATE_TOKEN_LEN = { dd: 2, MM: 2, yyyy: 4, yy: 2, HH: 2, mm: 2, ss: 2 };

/** Ký tự có nghĩa đặc biệt trong regex — escape trước khi dùng phần NGOÀI token làm literal. */
function escapeRegExpLiteral(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * CHIỀU NGƯỢC của `formatDate` — người dùng gõ theo mặt nạ (`08/09/2026`), ta cần lại giá trị
 * SQL hiểu được (`2026-09-08`) để ghép vào `declare`/`set`.
 *
 * Dựng một regex từ CHÍNH mặt nạ: mỗi token thành một nhóm bắt đúng độ dài của nó (`dd`→2 chữ
 * số, `yyyy`→4), phần còn lại (dấu `/`, khoảng trắng, `:`) giữ NGUYÊN VĂN làm literal. Khớp
 * được thì ghép lại thành `yyyy-MM-dd` (kèm `HH:mm:ss` nếu mặt nạ có phần giờ); không khớp thì
 * `null` — gọi chỗ tự quyết định giữ nguyên giá trị cũ, KHÔNG đoán bừa một ngày.
 *
 * `yy` (hai chữ số năm) cộng thẳng `20` — FBO không có màn hình nào thật sự dùng mặt nạ hai chữ
 * số năm cho tham số lọc, nhưng xử lý cho trọn vẹn ba chữ cái z, không để rơi vào `NaN`.
 */
export function parseDisplayDate(text, mask) {
  const m = String(mask ?? '').trim();
  const t = String(text ?? '').trim();
  if (m === '' || t === '') return null;

  const order = [];
  let pattern = '';
  let last = 0;
  RE_DATE_TOKEN.lastIndex = 0;
  let tok;
  while ((tok = RE_DATE_TOKEN.exec(m)) !== null) {
    pattern += escapeRegExpLiteral(m.slice(last, tok.index));
    pattern += `(\\d{${DATE_TOKEN_LEN[tok[0]]}})`;
    order.push(tok[0]);
    last = RE_DATE_TOKEN.lastIndex;
  }
  pattern += escapeRegExpLiteral(m.slice(last));
  if (order.length === 0) return null;

  const found = new RegExp(`^${pattern}$`).exec(t);
  if (!found) return null;

  const get = (token, fallback) => {
    const i = order.indexOf(token);
    return i === -1 ? fallback : found[i + 1];
  };
  const yyyy = order.includes('yyyy') ? get('yyyy', '') : (order.includes('yy') ? `20${get('yy', '00')}` : '');
  if (!/^\d{4}$/.test(yyyy)) return null;

  const date = `${yyyy}-${get('MM', '01')}-${get('dd', '01')}`;
  const hasTime = order.includes('HH') || order.includes('mm') || order.includes('ss');
  return hasTime ? `${date} ${get('HH', '00')}:${get('mm', '00')}:${get('ss', '00')}` : date;
}

/**
 * Áp mặt nạ số của FBO.
 *
 * Đọc mặt nạ theo nghĩa đen: phần sau dấu `.` cuối cùng là số chữ số lẻ, ký tự KHÔNG phải `#`
 * hay `0` trong phần nguyên là dấu ngăn nhóm (FBO dùng khoảng trắng). Phần nguyên không có `0`
 * nào = mặt nạ `View` = số 0 hiện ra ô TRỐNG.
 */
function formatNumber(value, mask) {
  const raw = String(value ?? '').trim();
  if (raw === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  const dot = mask.lastIndexOf('.');
  const intMask = dot === -1 ? mask : mask.slice(0, dot);
  const decimals = dot === -1 ? 0 : mask.slice(dot + 1).replace(/[^#0]/g, '').length;

  if (n === 0 && !intMask.includes('0')) return '';

  const sep = (/[^#0]/.exec(intMask) ?? [''])[0];
  const fixed = Math.abs(n).toFixed(decimals);
  const [whole, frac] = fixed.split('.');
  const grouped = sep === '' ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Mặt nạ số FBO (`# ### ##0.00`, …) → chuỗi hiện. Không định dạng được thì `null`. */
export { formatNumber };

/**
 * Một ô dữ liệu THẬT → chuỗi hiện trên lưới.
 *
 * KHÔNG BAO GIỜ ném, và không bao giờ trả `null`: mọi nhánh không định dạng được đều rơi về giá
 * trị thô. Một ô hiện số thô vẫn đọc được; một bản vẽ chết vì một ô lạ thì không.
 *
 * @param {string} value   văn bản thô từ `sqlcmd` (`NULL` đã quy về chuỗi rỗng trước khi tới đây)
 * @param {object} field   `<field>` của cột
 * @param {Record<string,string>} formats  `{tên: mặt nạ}` đọc từ `Options/Options.xml`
 */
export function formatSampleValue(value, field, formats = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw === '') return '';

  const mask = resolveMask(field?.attrs?.dataFormatString, formats);

  /*
   * `X` / `x` là mặt nạ HOA/THƯỜNG (`upperCaseFormat`/`lowercaseFormat` của `Options.xml`),
   * không phải mặt nạ số hay ngày. `renderGridControl` đã lo phần hoa bằng `text-transform`,
   * nên ở đây chỉ cần KHÔNG đem nó đi định dạng số.
   */
  if (mask === 'X' || mask === 'x') return raw;

  if (isDateField(field)) {
    // Không khai mặt nạ thì vẫn phải cắt phần `.000` của SQL đi — nó không bao giờ hiện trên lưới.
    const out = formatDate(raw, mask === '' ? 'dd/MM/yyyy' : mask);
    return out === null ? raw : out;
  }

  if (isNumericField(field)) {
    if (mask === '' || !/[#0]/.test(mask)) return raw;
    const out = formatNumber(raw, mask);
    return out === null ? raw : out;
  }

  return raw;
}

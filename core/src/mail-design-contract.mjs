// mail-design-contract.mjs — hợp đồng giữa tầng vỏ và webview của Email Designer.
//
// File này CHỈ khai báo và kiểm tra. Không quét HTML, không lập kế hoạch sửa, không dựng HTML —
// những việc đó thuộc `mail-html.mjs` / `mail-edit.mjs` (Phase 3 trở đi) và phải tuân theo đúng
// những gì khai ở đây. Tài liệu kiến trúc: `docs/EMAIL-DESIGNER.md`.
//
// Vì sao hợp đồng nằm ở core: webview là phía KHÔNG TIN CẬY — nó cầm DOM của một mẫu mail do
// khách viết. Mọi thông điệp nó gửi lên phải qua một bộ kiểm THUẦN, test được bằng node trần
// (ADR-0002), trước khi tầng vỏ đọc bất kỳ trường nào.
//
// Ba luật mọi phase sau phải giữ:
//   1. Webview KHÔNG BAO GIỜ gửi toạ độ nguồn. Nó chỉ gửi `elementId` + `rev`; host tự dựng lại
//      chỉ mục phần tử từ VĂN BẢN HIỆN TẠI rồi mới quy ra dải cần sửa — cùng giao kèo «dựng lại
//      model mỗi lần sửa» của `preview-panel.js`. `validateMailMessage` vì thế bỏ mọi trường lạ:
//      một webview gửi kèm `start`/`end`/`file` cũng không lọt được chúng tới tầng ghi.
//   2. `data-fbo-el` chỉ sống trong BẢN VẼ gửi sang webview, không bao giờ nằm trong một splice.
//   3. Mỗi phép sửa là MỘT kế hoạch `{ok, edits}` → MỘT `applySplice` → MỘT mục trong
//      `edit-history.js`. Không có chồng hoàn tác thứ hai.

/** Thuộc tính đánh dấu phần tử — CHỈ gắn vào bản vẽ, không bao giờ ghi xuống Message.xml. */
export const DESIGN_ATTR = 'data-fbo-el';

/**
 * `e1`, `e2`… — số thứ tự (từ 1) của phần tử theo thứ tự xuất hiện trong dòng HTML của MỘT cặp
 * (action, body), đếm qua cả ba part. Không đệm số 0: `e01` là SAI, để mỗi phần tử có đúng một
 * cách viết id và phép so chuỗi phía host không phải chuẩn hoá gì.
 *
 * Id KHÔNG bền qua các lần sửa (chèn một phần tử là dồn số mọi phần tử phía sau) — bền là việc
 * của `rev` + dấu vân tay, xem `elementFingerprint`.
 */
export const ELEMENT_ID_RE = /^e[1-9]\d{0,5}$/;

export function formatElementId(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 999999) {
    throw new RangeError(`số thứ tự phần tử ngoài khoảng 1–999999: ${ordinal}`);
  }
  return `e${ordinal}`;
}

/** @returns {number|null} số thứ tự, hoặc `null` nếu không phải id hợp lệ */
export function parseElementId(id) {
  return typeof id === 'string' && ELEMENT_ID_RE.test(id) ? Number(id.slice(1)) : null;
}

/**
 * Dấu vân tay của một phần tử — thứ host so khi nhận một phép sửa, để biết id `eN` của lần vẽ
 * TRƯỚC còn trỏ đúng phần tử ấy trong văn bản HIỆN TẠI hay không.
 *
 * Nguyên văn thẻ mở (không phải chỉ tên thẻ): hai `<td>` liền nhau khác nhau ở `style`/`class`,
 * và chính cái khác ấy là thứ phép sửa sắp ghi đè. Người dùng vừa gõ tay vào XML làm lệch thứ
 * tự thì dấu vân tay không khớp → TỪ CHỐI và vẽ lại, không đoán — cùng thái độ với
 * `canEditRow`/`planNumericAttr` của Dir.
 */
export function elementFingerprint({ part, tag, openTag }) {
  return `${part}|${String(tag).toLowerCase()}|${openTag}`;
}

/** Ba part của một biến thể thân thư — ranh giới CỨNG, không phép sửa nào đi xuyên qua. */
export const MAIL_PARTS = Object.freeze(['header', 'detail', 'footer']);

/**
 * Vai trò của phần tử — quyết định nó làm được gì trên designer.
 *
 * Không dùng chữ "Entity" cho phần tử HTML: trong repo này "entity" là `<!ENTITY>`/`&Name;` của
 * XML (`entities.mjs`), và Message.xml có cả hai thứ đan vào nhau (`]]>&HeaderColor;<![CDATA[`
 * nằm GIỮA một thẻ `<td style="…">`). Hai nghĩa cho một chữ là công thức cho lỗi đọc nhầm.
 */
export const ELEMENT_ROLES = Object.freeze({
  /** Khung tài liệu: html/head/style/body…, và MỌI phần tử mở ở part này đóng ở part khác. */
  FRAME: 'frame',
  /** Hình học bảng: table/tr/td… — chỉ sửa chữ/style; cấu trúc đi qua phép cột/dòng riêng. */
  STRUCTURE: 'structure',
  /** Khối nội dung: p, div, h1–h6… — chọn, sửa, xoá, di chuyển, chèn quanh. */
  BLOCK: 'block',
  /** Nội tuyến: a, span, img, br… — như BLOCK. */
  INLINE: 'inline',
  /** Thẻ lạ (VML của Outlook `v:rect`, `o:p`…) — chỉ chọn và sửa style, không đụng cấu trúc. */
  UNKNOWN: 'unknown',
});

const TAG_ROLE = new Map([
  ...['html', 'head', 'body', 'style', 'meta', 'title', 'link', 'base', 'script', 'noscript']
    .map((t) => [t, ELEMENT_ROLES.FRAME]),
  ...['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup', 'caption']
    .map((t) => [t, ELEMENT_ROLES.STRUCTURE]),
  ...['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'center', 'ul', 'ol', 'li', 'blockquote', 'pre', 'section', 'article']
    .map((t) => [t, ELEMENT_ROLES.BLOCK]),
  ...['a', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'font', 'img', 'br', 'small', 'big', 'sub', 'sup', 'label', 'code']
    .map((t) => [t, ELEMENT_ROLES.INLINE]),
]);

/**
 * Vai trò MẶC ĐỊNH theo tên thẻ. Chỉ mục phần tử (Phase 3) còn áp luật VỊ TRÍ lên trên:
 *   - hạ về FRAME: phần tử mở/đóng ở hai part khác nhau, hoặc không tìm được thẻ đóng;
 *   - nâng `table` lên BLOCK: bảng nằm TRỌN trong một part — bảng layout của mail, nút kiểu bảng,
 *     khối người dùng vừa chèn. Hàng/ô bên trong vẫn là STRUCTURE.
 */
export function roleOfTag(tag) {
  return TAG_ROLE.get(String(tag ?? '').toLowerCase()) ?? ELEMENT_ROLES.UNKNOWN;
}

/**
 * Bảng phép sửa. `phase` là phase ĐƯA phép vào dùng (0 = đã có ở "Xem mail"); hợp đồng khai sẵn
 * cả những phép chưa làm để giao thức không phải đổi hình giữa chừng.
 *
 * `effect`: `replace` | `insert` | `delete` — hình dạng splice mà kế hoạch sinh ra.
 * `target`: `element` (cần `elementId`) | `template` (áp lên cặp action/body host đang vẽ).
 * Mọi phép đều ghi vào lịch sử hoàn tác chung — không có phép sửa nào "ngoài lịch sử".
 */
export const MAIL_OPS = Object.freeze({
  setText: Object.freeze({ phase: 3, effect: 'replace', target: 'element' }),
  setStyle: Object.freeze({ phase: 3, effect: 'replace', target: 'element' }),
  setAttr: Object.freeze({ phase: 4, effect: 'replace', target: 'element' }),
  removeElement: Object.freeze({ phase: 5, effect: 'delete', target: 'element' }),
  moveElement: Object.freeze({ phase: 5, effect: 'replace', target: 'element' }),
  insertComponent: Object.freeze({ phase: 5, effect: 'insert', target: 'element' }),
  // Bọc một ảnh trong `<a href>` — hai điểm chèn, một phép sửa, một mục hoàn tác.
  wrapLink: Object.freeze({ phase: 5, effect: 'insert', target: 'element' }),
  resizeColumn: Object.freeze({ phase: 0, effect: 'replace', target: 'template' }),
  addColumn: Object.freeze({ phase: 0, effect: 'insert', target: 'template' }),
  addRow: Object.freeze({ phase: 0, effect: 'insert', target: 'template' }),
});

/**
 * Thuộc tính CSS inline mà designer cho sửa — chỉ những gì mail client (kể cả Outlook bản
 * Word) vẽ đáng tin. `background` rút gọn cố tình vắng: Outlook bỏ qua nó, `background-color`
 * thì không. `border-radius` có mặt dù Outlook bỏ qua — nó xuống cấp êm (góc vuông), không vỡ.
 *
 * Nhóm chỉ để UI chọn ô nào hiện cho loại phần tử nào; bộ kiểm nhận hợp của mọi nhóm.
 */
export const STYLE_PROPERTIES = Object.freeze({
  text: Object.freeze(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'padding', 'margin']),
  image: Object.freeze(['width', 'height', 'border']),
  button: Object.freeze(['color', 'background-color', 'font-size', 'font-weight', 'padding', 'border', 'border-radius', 'text-align', 'text-decoration']),
  container: Object.freeze(['width', 'padding', 'background-color', 'border', 'text-align', 'vertical-align']),
  // Đường kẻ trong mail thật: `<hr>` hoặc một khối rỗng mang `border-top`/`height:1px;background-color`.
  divider: Object.freeze(['border-top', 'border-bottom', 'height', 'background-color', 'margin', 'width']),
  // Khoảng trống: khối rỗng cao cố định — Outlook cần cả `line-height`/`font-size` mới giữ đúng chiều cao.
  spacer: Object.freeze(['height', 'line-height', 'font-size']),
});

const ALL_STYLE_PROPERTIES = new Set(Object.values(STYLE_PROPERTIES).flat());

export function isStyleProperty(name) {
  return typeof name === 'string' && ALL_STYLE_PROPERTIES.has(name);
}

/**
 * Thuộc tính HTML sửa được, theo thẻ. Chỉ những thuộc tính trình mail cũ (Outlook bản Word) còn
 * đọc — `width`/`height` trên `<img>`, `bgcolor`/`align`/`valign` trên ô bảng — chính là lý do mẫu
 * mail còn dùng thuộc tính thay vì CSS. Giá trị kiểm theo kiểu ở `isValidAttrValue`.
 */
export const ATTRIBUTES = Object.freeze({
  a: Object.freeze(['href', 'target', 'title']),
  img: Object.freeze(['src', 'alt', 'width', 'height', 'align', 'border', 'title']),
  table: Object.freeze(['width', 'align', 'bgcolor', 'border', 'cellpadding', 'cellspacing']),
  tr: Object.freeze(['align', 'valign', 'bgcolor']),
  td: Object.freeze(['width', 'height', 'align', 'valign', 'bgcolor']),
  th: Object.freeze(['width', 'height', 'align', 'valign', 'bgcolor']),
  hr: Object.freeze(['width', 'size', 'align', 'color']),
  div: Object.freeze(['align']),
  p: Object.freeze(['align']),
});

const ALL_ATTRIBUTES = new Set(Object.values(ATTRIBUTES).flat());
const URL_ATTRIBUTES = new Set(['href', 'src']);

export function isAttributeAllowed(tag, name) {
  const list = ATTRIBUTES[String(tag ?? '').toLowerCase()];
  return Array.isArray(list) && list.includes(name);
}

/** Thuộc tính mang giá trị liệt kê — webview vẽ thành ô chọn, bộ kiểm chỉ nhận đúng các giá trị này. */
export const ATTRIBUTE_ENUMS = Object.freeze({
  align: Object.freeze(['left', 'center', 'right']),
  valign: Object.freeze(['top', 'middle', 'bottom']),
  target: Object.freeze(['_blank', '_self']),
});

const LENGTH_ATTRIBUTES = new Set(['width', 'height', 'border', 'cellpadding', 'cellspacing', 'size']);
const COLOR_ATTRIBUTES = new Set(['bgcolor', 'color']);

/**
 * Giá trị hợp lệ cho MỘT thuộc tính. Chuỗi rỗng = XOÁ thuộc tính (cùng quy ước `setStyle`).
 *
 * Kiểm theo KIỂU chứ không chỉ theo ký tự: `width="abc"` là dữ liệu hợp lệ về mặt HTML nhưng làm
 * Outlook vẽ ảnh bằng kích thước gốc — thứ người dùng không nhìn thấy trên bản xem trình duyệt.
 */
export function isValidAttrValue(name, value) {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (URL_ATTRIBUTES.has(name)) return isSafeUrl(value, { attr: name });
  if (Object.hasOwn(ATTRIBUTE_ENUMS, name)) return ATTRIBUTE_ENUMS[name].includes(value);
  if (LENGTH_ATTRIBUTES.has(name)) return /^\d{1,4}%?$/.test(value);
  if (COLOR_ATTRIBUTES.has(name)) return /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{3,20})$/i.test(value);
  return isSafeAttrValue(value);
}

/**
 * Component chèn được. `phase: null` = khai giữ chỗ, bộ kiểm TỪ CHỐI — Condition và Dynamic
 * Table cần một engine dữ liệu mà Message.xml không có sẵn (dòng lặp của mail là `<detail>`,
 * không phải một thẻ trong HTML), nên chưa có gì để sinh ra.
 */
export const COMPONENT_KINDS = Object.freeze({
  text: Object.freeze({ group: 'content', phase: 5 }),
  heading: Object.freeze({ group: 'content', phase: 5 }),
  image: Object.freeze({ group: 'content', phase: 5 }),
  link: Object.freeze({ group: 'content', phase: 5 }),
  button: Object.freeze({ group: 'content', phase: 5 }),
  container: Object.freeze({ group: 'layout', phase: 5 }),
  section: Object.freeze({ group: 'layout', phase: 5 }),
  column: Object.freeze({ group: 'layout', phase: 5 }),
  divider: Object.freeze({ group: 'layout', phase: 5 }),
  spacer: Object.freeze({ group: 'layout', phase: 5 }),
  table: Object.freeze({ group: 'layout', phase: 5 }),
  variable: Object.freeze({ group: 'dynamic', phase: 6 }),
  condition: Object.freeze({ group: 'dynamic', phase: null }),
  dynamicTable: Object.freeze({ group: 'dynamic', phase: null }),
});

export const INSERT_POSITIONS = Object.freeze(['before', 'after', 'append']);
export const MOVE_DIRECTIONS = Object.freeze(['up', 'down']);

export const MAX_TEXT_LENGTH = 4000;

/**
 * Cách bản vẽ hiện `{!tên}` (Phase 6) — CHỈ đổi bản vẽ, không bao giờ đổi nguồn:
 *   label   nhãn khai trong `<fields>` (như runtime), biến dữ liệu hiện thành chip `{!tên}`
 *   token   mọi biến hiện thành chip `{!tên}` — thấy nguyên cấu trúc biến của mẫu
 *   sample  biến dữ liệu lấy từ dữ liệu mẫu người dùng nhập; thiếu thì vẫn là chip
 */
export const PREVIEW_MODES = Object.freeze(['label', 'token', 'sample']);

/** Trần kích thước JSON dữ liệu mẫu gửi từ webview. */
export const MAX_SAMPLE_LENGTH = 100000;
const MAX_CSS_LENGTH = 200;
const MAX_ATTR_LENGTH = 2000;

/** Ký tự điều khiển — trừ tab/xuống dòng, thứ chữ thường có. */
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * Giá trị CSS an toàn để đặt vào `style="…"`.
 *
 * Chặn theo KÝ TỰ trước (`;` mở khai báo thứ hai, `"` thoát thuộc tính, `<>` thoát thẻ, `{}` mở
 * luật, `\` escape CSS), rồi theo MẪU những cửa CSS còn chạy được mã hoặc tải tài nguyên. Không
 * nhận `{!token}`: token trong style (`display:{!slink}`) là logic runtime của mẫu, sửa nó là
 * việc của XML, không phải của một ô nhập màu.
 */
export function isSafeCssValue(value) {
  if (typeof value !== 'string' || value.length > MAX_CSS_LENGTH) return false;
  if (CONTROL_RE.test(value) || /[;{}<>"\\\n\r\t]/.test(value)) return false;
  return !/url\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|@import|\/\*|behavior\s*:|-moz-binding/i.test(value);
}

/** Giá trị thuộc tính không phải URL — plan sẽ escape, ở đây chỉ chặn thứ không thể là dữ liệu hợp lệ. */
export function isSafeAttrValue(value) {
  return typeof value === 'string' && value.length <= MAX_ATTR_LENGTH && !CONTROL_RE.test(value) && !/[<>"\n\r]/.test(value);
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'cid']);

/**
 * URL an toàn cho `href`/`src`.
 *
 * - Không có scheme (tương đối, `#`, hay bắt đầu bằng `{!alink}` như corpus thật) → nhận.
 * - Có scheme → chỉ http/https/mailto/tel/cid; `src` nhận thêm `data:image/…;base64`.
 * - Chặn MỌI tham chiếu ký tự (`&#106;`, `&colon;`…) vì đó là đường lách bộ lọc scheme kinh điển;
 *   `&n=1` trong query string không phải tham chiếu ký tự nên vẫn qua.
 * - Bỏ khoảng trắng TRƯỚC khi đọc scheme: trình duyệt cũng bỏ, `java\tscript:` là `javascript:`.
 */
export function isSafeUrl(value, { attr = 'href' } = {}) {
  if (typeof value !== 'string' || value.length > MAX_ATTR_LENGTH) return false;
  if (CONTROL_RE.test(value) || /[<>"]/.test(value)) return false;
  if (/&(#|[a-z][a-z\d]*;)/i.test(value)) return false;
  const compact = value.replace(/\s+/g, '').toLowerCase();
  const scheme = /^([a-z][a-z\d+.-]*):/.exec(compact);
  if (!scheme) return true;
  if (SAFE_SCHEMES.has(scheme[1])) return true;
  return attr === 'src' && /^data:image\/(png|gif|jpe?g|webp);base64,[a-z\d+/=]+$/i.test(value.trim());
}

const ACTION_ID_RE = /^[\w.$:-]{1,128}$/;
const BODY_RE = /^body\d{0,3}$/;

const ok = (message) => ({ ok: true, message });
const bad = (reason) => ({ ok: false, reason });

function checkRev(rev) {
  return Number.isInteger(rev) && rev >= 0 && rev <= 0x7fffffff;
}

function checkIndex(n, max) {
  return Number.isInteger(n) && n >= 0 && n <= max;
}

/**
 * Kiểm và CHUẨN HOÁ một phép `edit` — trả về object MỚI chỉ gồm các trường hợp đồng biết.
 */
function validateEdit(msg) {
  const spec = Object.hasOwn(MAIL_OPS, msg.op) ? MAIL_OPS[msg.op] : null;
  if (!spec) return bad(`op không hỗ trợ: ${String(msg.op).slice(0, 40)}`);
  if (!checkRev(msg.rev)) return bad(`${msg.op}: thiếu rev hợp lệ`);

  const base = { type: 'edit', op: msg.op, rev: msg.rev };
  if (spec.target === 'element') {
    if (parseElementId(msg.elementId) === null) return bad(`${msg.op}: elementId không hợp lệ`);
    base.elementId = msg.elementId;
  }

  switch (msg.op) {
    case 'setText':
      if (typeof msg.value !== 'string' || msg.value.length > MAX_TEXT_LENGTH || CONTROL_RE.test(msg.value)) {
        return bad(`setText: chữ phải là chuỗi ≤ ${MAX_TEXT_LENGTH} ký tự, không có ký tự điều khiển`);
      }
      return ok({ ...base, value: msg.value });

    case 'setStyle':
      if (!isStyleProperty(msg.property)) return bad(`setStyle: thuộc tính CSS không nằm trong danh sách cho sửa: ${String(msg.property).slice(0, 40)}`);
      // Chuỗi rỗng = XOÁ khai báo đó khỏi `style`.
      if (msg.value !== '' && !isSafeCssValue(msg.value)) return bad(`setStyle: giá trị ${msg.property} không an toàn`);
      return ok({ ...base, property: msg.property, value: msg.value });

    case 'setAttr': {
      if (typeof msg.name !== 'string' || !ALL_ATTRIBUTES.has(msg.name)) return bad(`setAttr: thuộc tính không cho sửa: ${String(msg.name).slice(0, 40)}`);
      // Thẻ cụ thể có cho thuộc tính này không là việc của plan — ở đây host chưa biết `elementId` trỏ thẻ gì.
      if (!isValidAttrValue(msg.name, msg.value)) return bad(`setAttr: giá trị ${msg.name} không hợp lệ hoặc không an toàn`);
      return ok({ ...base, name: msg.name, value: msg.value });
    }

    case 'removeElement':
      return ok(base);

    // Hai hình dạng: `direction` (đổi chỗ với anh em liền kề) hoặc `targetId` + `position` (kéo thả).
    case 'moveElement':
      if (msg.direction !== undefined) {
        if (!MOVE_DIRECTIONS.includes(msg.direction)) return bad('moveElement: direction phải là up | down');
        return ok({ ...base, direction: msg.direction });
      }
      if (parseElementId(msg.targetId) === null) return bad('moveElement: cần direction, hoặc targetId + position');
      if (!INSERT_POSITIONS.includes(msg.position)) return bad('moveElement: position phải là before | after | append');
      return ok({ ...base, targetId: msg.targetId, position: msg.position });

    case 'wrapLink':
      if (typeof msg.href !== 'string' || msg.href === '' || !isSafeUrl(msg.href)) return bad('wrapLink: href không hợp lệ hoặc không an toàn');
      return ok({ ...base, href: msg.href });

    case 'insertComponent': {
      if (!INSERT_POSITIONS.includes(msg.position)) return bad('insertComponent: position phải là before | after | append');
      const kind = Object.hasOwn(COMPONENT_KINDS, msg.component) ? COMPONENT_KINDS[msg.component] : null;
      if (!kind) return bad(`insertComponent: component không có: ${String(msg.component).slice(0, 40)}`);
      if (kind.phase === null) return bad(`insertComponent: ${msg.component} chưa hỗ trợ`);
      return ok({ ...base, position: msg.position, component: msg.component });
    }

    case 'resizeColumn':
      if (!checkIndex(msg.columnIndex, 199)) return bad('resizeColumn: columnIndex không hợp lệ');
      // Cùng khoảng với `planResizeMailColumn` — kiểm hai lần là cố ý: đây là cửa vào, kia là luật.
      if (!Number.isInteger(msg.width) || msg.width < 10 || msg.width > 2000) return bad('resizeColumn: width phải là số nguyên 10–2000');
      return ok({ ...base, columnIndex: msg.columnIndex, width: msg.width });

    case 'addColumn':
      if (!checkIndex(msg.columnIndex, 199)) return bad('addColumn: columnIndex không hợp lệ');
      return ok({ ...base, columnIndex: msg.columnIndex });

    case 'addRow':
      // `detail` cố tình vắng — nhân bản dòng mẫu lặp là nhân đôi MỌI dòng dữ liệu, xem `listMailRows`.
      if (msg.part !== 'header' && msg.part !== 'footer') return bad('addRow: part phải là header | footer');
      if (!checkIndex(msg.rowIndex, 999)) return bad('addRow: rowIndex không hợp lệ');
      return ok({ ...base, part: msg.part, rowIndex: msg.rowIndex });

    default:
      return bad(`op không hỗ trợ: ${msg.op}`);
  }
}

/**
 * Cửa vào DUY NHẤT cho thông điệp webview → host của Email Designer.
 *
 * Chạy SAU `OverlayDialogs.handleMessage` (trả lời hộp thoại đi trước mọi thứ, như hai lối mở
 * designer hiện có) và TRƯỚC mọi nhánh xử lý. Kết quả `message` là bản sao đã lọc: nhánh xử lý
 * chỉ được đọc từ đó, không đọc lại `msg` gốc.
 *
 * @returns {{ok:true, message:object}|{ok:false, reason:string}}
 */
export function validateMailMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return bad('thông điệp không phải object');

  switch (msg.type) {
    case 'ready':
    case 'undo':
    case 'redo':
      return ok({ type: msg.type });

    case 'log':
      return ok({ type: 'log', text: String(msg.text ?? '').slice(0, 2000) });

    // Tên và hình dạng giữ nguyên của panel "Xem mail" (`mail-preview-host.js`) — cùng tính năng.
    case 'selection':
      if (typeof msg.actionId !== 'string' || !ACTION_ID_RE.test(msg.actionId)) return bad('selection: actionId không hợp lệ');
      if (typeof msg.body !== 'string' || !BODY_RE.test(msg.body)) return bad('selection: body không hợp lệ');
      return ok({
        type: 'selection', actionId: msg.actionId, body: msg.body, lang: msg.lang === 'en' ? 'en' : 'vi',
      });

    case 'gotoSource':
      if (!MAIL_PARTS.includes(msg.section)) return bad('gotoSource: section phải là header | detail | footer');
      return ok({ type: 'gotoSource', section: msg.section });

    // Chọn phần tử. `reveal` = Ctrl+click / double click → mở XML đúng dải của phần tử, cùng cử
    // chỉ với designer form (`revealSource`).
    case 'select':
      if (!checkRev(msg.rev)) return bad('select: thiếu rev hợp lệ');
      if (parseElementId(msg.elementId) === null) return bad('select: elementId không hợp lệ');
      return ok({
        type: 'select', rev: msg.rev, elementId: msg.elementId, reveal: msg.reveal === true,
      });

    case 'setPreview':
      if (!PREVIEW_MODES.includes(msg.mode)) return bad('setPreview: mode phải là label | token | sample');
      return ok({ type: 'setPreview', mode: msg.mode });

    // Dữ liệu mẫu đi dạng CHUỖI — host tự parse và kiểm hình dạng (`mail-variables.mjs#parseMailSample`).
    case 'setSampleData':
      if (typeof msg.text !== 'string' || msg.text.length > MAX_SAMPLE_LENGTH) {
        return bad(`setSampleData: text phải là chuỗi ≤ ${MAX_SAMPLE_LENGTH} ký tự`);
      }
      return ok({ type: 'setSampleData', text: msg.text });

    case 'edit':
      return validateEdit(msg);

    default:
      return bad(`type không hỗ trợ: ${String(msg.type).slice(0, 40)}`);
  }
}

/**
 * Hình dạng dữ liệu hai phía — chỉ để đọc, Phase 3 hiện thực.
 *
 * @typedef {'header'|'detail'|'footer'} MailPart
 *
 * @typedef {object} MailPiece  một mảnh của dòng HTML, theo toạ độ `clearText`
 * @property {MailPart} part
 * @property {'cdata'|'text'} kind   `cdata` = nguyên văn (sửa được); `text` = nút chữ XML đã giải
 *   mã (thường là entity như `&HeaderColor;`) — designer KHÔNG ghi vào đây
 * @property {number} htmlStart
 * @property {number} htmlEnd
 * @property {number} clearStart
 * @property {number} clearEnd
 * @property {string} file           file nguồn sở hữu mảnh (có thể là Include)
 * @property {boolean} fromEntity    mảnh do một `&Name;` sinh ra
 *
 * @typedef {object} MailElement  phía HOST — không bao giờ gửi nguyên sang webview
 * @property {string} id
 * @property {string} tag
 * @property {string} role           giá trị của ELEMENT_ROLES
 * @property {MailPart} part
 * @property {string|null} parentId
 * @property {{openStart:number, openEnd:number, closeStart:number|null, closeEnd:number|null}} html
 * @property {string} fingerprint    `elementFingerprint(...)`
 * @property {Record<string, true|string>} caps  op → `true` hoặc LÝ DO không làm được
 *
 * @typedef {object} MailElementWire  phía WEBVIEW — đủ để vẽ khung chọn và bảng thuộc tính
 * @property {string} id
 * @property {string} tag
 * @property {string} role
 * @property {MailPart} part
 * @property {string|null} parentId
 * @property {Record<string, true|string>} caps
 * @property {string} kind                      loại component (`mail-components.mjs#componentKindOf`)
 * @property {string[]} attrNames               = ATTRIBUTES[tag]
 * @property {Record<string, string>} attrLocks thuộc tính KHÔNG sửa được → lý do (vd do entity sinh ra)
 * @property {{up:string|null, down:string|null}} moveTargets  anh em liền kề đổi chỗ được (Phase 5)
 * @property {{before:true|string, after:true|string, append:true|string}} insertPositions  chỗ chèn/thả quanh phần tử
 * @property {Array<[string, string]>} style   khai báo inline theo đúng thứ tự trong nguồn
 * @property {Record<string, string>} attrs     chỉ các thuộc tính trong ATTRIBUTES[tag]
 * @property {string|null} text                 chỉ khi `caps.setText === true`
 *
 * @typedef {object} MailRenderMessage  host → webview, `type: 'render'`
 * @property {'render'} type
 * @property {number} rev                        tăng mỗi lần host vẽ; webview gửi lại trong select/edit
 * @property {{actionId:string, body:string, lang:'vi'|'en'}} template
 * @property {Array<{id:string, label:string, bodies:string[]}>} actions
 * @property {string} html                       đã làm sạch + gắn DESIGN_ATTR; vào `iframe.srcdoc`
 * @property {MailElementWire[]} elements
 * @property {string} file                       tên file (thanh công cụ)
 * @property {Record<string, string[]>} styleProperties  = STYLE_PROPERTIES — webview không chép lại whitelist
 * @property {Record<string, object>} componentPanels     = COMPONENT_PANELS (`mail-components.mjs`)
 * @property {Record<string, string[]>} attributeEnums    = ATTRIBUTE_ENUMS
 * @property {Array<{kind:string, label:string, group:string}>} components  = INSERTABLE_COMPONENTS
 * @property {{mode:'label'|'token'|'sample'}} preview   cách bản vẽ đang hiện `{!tên}` (Phase 6)
 * @property {Array<{name:string, kind:'label'|'data', label:{v:string,e:string}|null, count:number,
 *            contexts:string[], parts:string[]}>} variables   biến có trong (action, body) đang vẽ
 * @property {{text:string, skeleton:string}} sample     JSON dữ liệu mẫu đã lưu + khung rỗng dựng từ biến
 * @property {string|null} selectId             host chọn hộ sau một phép sửa (vd phần tử vừa di chuyển)
 * @property {string[]} warnings
 *
 * @typedef {{ok:true, edits:Array<{start:number,end:number,text:string,bias?:'left'|'right'}>, notes?:string[], label:string,
 *            selectId?:string|null}
 *          | {ok:false, reason:string}} MailEditPlan  toạ độ `clearText`, cùng khuôn `planResizeMailColumn`
 */

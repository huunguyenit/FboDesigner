// control.mjs — một `<field>` ra một control HTML tĩnh.
//
// Tên class KHÔNG phải do ta đặt: `FormTextInput`, `FormCheckInput`, `CellDivContainer`,
// `CellImage CellImgLookup`… là tên của runtime FBO thật. Phải dùng đúng tên đó thì CSS thật
// của program (`<program>\Css\Menu.css` có các rule kiểu
// `.UpdateDlgContent .FormCell .FormContainerInput input[type="text"]`) mới bám vào được.
// Đặt tên khác là tự cắt mình khỏi CSS thật, và preview vĩnh viễn không giống runtime.
//
// Bản đối chiếu: HTML runtime của `Dir/Site.xml` (dialog «Thêm kho hàng»). Ba chỗ file này
// từng khác runtime, và cả ba đều làm ô nhập sai kích thước:
//
//   1. Ô readOnly runtime dùng `FormInputDisabled FormTextInputDisabled` — THAY cho
//      `FormInput FormTextInput`, không phải cộng thêm. Cộng thêm là ô disabled ăn cả rule
//      của ô thường, và rule nào tới sau trong CSS program thì thắng — không đoán được.
//   2. Bề rộng ô Lookup/Calendar tính từ BỀ RỘNG Ô (tổng px các cột nó trải qua) trừ chỗ đeo
//      icon, KHÔNG phải từ `field@width`. Field của `Dir/` phần lớn không có `@width` —
//      runtime vẫn ra `style="width: 77px"` vì ô rộng 25+5+70 = 100.
//   3. Checkbox runtime là `FormInput FormCheckInput`, không phải `FormCheckInput` trần.
//
// Render TĨNH: không handler, không `$df`, không `.axd`. Đây là ảnh chụp cấu trúc, không phải
// chương trình chạy được.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESCAPES[c]);

/** Chỗ đeo icon Lookup/Calendar. Đo ở HAI màn hình runtime — `Dir/Site` và `Dir/Customer`
 *  đều cho ô 100px → `style="width: 77px"`. */
export const ADORNMENT_PX = 23;

/** Padding ngang của `<td class="FormCell">` ở runtime: `padding:4px!important` hai bên. */
export const CELL_PADDING_PX = 4;

const isTrue = (v) => String(v ?? '').toLowerCase() === 'true';

/**
 * `%l` ở cuối tên field là HẬU TỐ NGÔN NGỮ, không phải một phần của tên.
 *
 *   `ten_kh%l`  → tiếng Việt: `ten_kh`   · tiếng Anh: `ten_kh2`
 *
 * Tức `select ten_kh from dmkh` với bản Việt và `select ten_kh2 from dmkh` với bản Anh. Một tên
 * field trong XML vì thế trỏ tới HAI cột database khác nhau tuỳ ngôn ngữ đang xem.
 *
 * Phép thay THUẦN, không có ca biên: `ten_kh2%l` ra `ten_kh2` (Việt) và `ten_kh22` (Anh).
 *
 * `DevWorkFlow.Application/Language/InformationSqlBuilder.cs` khai NGƯỢC LẠI — nó ghi
 * «`ten_kh2%l` KHÔNG thành `ten_kh22`» và bỏ qua phần nối khi gốc đã kết thúc bằng `2`. Giữ bản
 * ở đây theo lời chủ hệ thống, và ghi ra chỗ lệch để lần sau không ai «sửa lại cho giống DWF»
 * mà không biết là đang lật một quyết định. Nếu hoá ra DWF đúng thì chỗ phải sửa là hàm này,
 * không phải chỗ gọi nó.
 *
 * Chỉ đụng hậu tố Ở CUỐI. Cắt tại dấu `%` đầu tiên (lối cũ của `safeId`) thì `a%lb` mất luôn
 * phần đuôi, và `%` giữa tên — hiếm nhưng không cấm — bị hiểu nhầm thành hậu tố.
 */
export function resolveLocaleName(name, vi = true) {
  const raw = String(name ?? '');
  if (!raw.endsWith('%l')) return raw;
  const base = raw.slice(0, -2);
  return vi ? base : `${base}2`;
}

function safeId(name, vi = true) {
  return resolveLocaleName(name, vi).replace(/[^\w-]/g, '_');
}

function itemsStyle(field) {
  return (field.items?.style ?? '').toLowerCase();
}

/** readOnly / disabled / inactivate / external — bốn cách khác nhau để nói "không nhập được". */
export function isDisabled(field) {
  const a = field.attrs ?? {};
  return isTrue(a.readOnly) || isTrue(a.disabled) || isTrue(a.inactivate) || isTrue(a.external);
}

function isBoolean(field) {
  const t = (field.attrs?.type ?? field.attrs?.dataType ?? '').toLowerCase();
  return t === 'boolean' || itemsStyle(field) === 'checkbox';
}

/**
 * Giá trị canh về phía nào TRONG ô — `field@align`, và mặc định theo KIỂU field.
 *
 * Ba nguồn, xét theo thứ tự này:
 *   `align="left|right|center"`  khai tay, thắng tất cả
 *   `<items style="Numeric">`    số canh phải — quy ước của cả hệ thống, không phải lựa chọn ở đây
 *   `type="Boolean"`             checkbox canh GIỮA, mặc định theo lời chủ hệ thống
 *
 * Vì sao phải trả về cho cả CONTAINER chứ không chỉ cho `<input>`: `text-align` trên một
 * `<input type="checkbox">` không làm gì cả — checkbox là một hộp có kích thước cố định, nó chỉ
 * dịch chuyển khi thứ BỌC nó canh nó. Chỉ đặt trên input là cột Boolean vĩnh viễn dính lề trái
 * dù khai `align` gì đi nữa.
 *
 * @returns {'left'|'right'|'center'|null} `null` = không khai gì, để trình duyệt tự xử.
 */
export function alignOf(field) {
  const a = field?.attrs ?? {};
  const declared = String(a.align ?? '').toLowerCase();
  if (declared === 'left' || declared === 'right' || declared === 'center') return declared;
  if (itemsStyle(field) === 'numeric') return 'right';
  if (isBoolean(field)) return 'center';
  return null;
}

function isCalendar(field) {
  const t = (field.attrs?.type ?? field.attrs?.dataType ?? '').toLowerCase();
  return t === 'datetime' || t === 'date' || itemsStyle(field) === 'calendar';
}

/** Lookup và AutoComplete cùng đeo icon kính lúp. */
function isLookup(field) {
  const s = itemsStyle(field);
  return s === 'lookup' || s === 'autocomplete';
}

/** `rows > 1` là dấu hiệu duy nhất của textarea trong `Dir/` — quyết cả canh dọc của cả hàng. */
export function isTextArea(field) {
  const rows = Number(field?.attrs?.rows);
  return Number.isFinite(rows) && rows > 1;
}

/** `clientDefault` thắng `defaultValue`. `Default` nghĩa là "rỗng theo kiểu", không phải chữ "Default". */
function defaultValue(field) {
  const a = field.attrs ?? {};
  const source = a.clientDefault || a.defaultValue || '';
  if (source === '') return null;
  if (source.toLowerCase() === 'default') return '';
  return source.replace(/^'(.*)'$/, '$1'); // defaultValue="''" là chuỗi rỗng trong cú pháp FBO
}

/** GIF 1×1 trong suốt. Không phụ thuộc file nào nên không bao giờ hỏng, không bao giờ cache cũ. */
const SPACER_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * Icon Lookup/Calendar là NỀN, không phải `src`.
 *
 * Runtime: `.CellImage` đặt sprite `fbo-cell-icons.gif` làm `background-image`, `.CellImgLookup`
 * dịch nền `-16px 0` và ghim hộp 15×11; `src` của thẻ `<img>` chỉ là ảnh 1×1 trong suốt.
 *
 * Bản trước trỏ `src` vào `<program>\Images\Lookup.png` — và đó là một sprite 22×44 hai trạng
 * thái, bị nén vào hộp 15×11 rồi VẼ ĐÈ lên sprite thật. Người dùng thấy một cái icon lạ và
 * tưởng trình duyệt cache hình cũ. `Calendar.png` thì không tồn tại trong program, nên ô lịch
 * ra thẳng ảnh vỡ.
 *
 * Bài học ghi lại kẻo lặp: ảnh của program KHÔNG phải nguồn của icon control. Nó là thư mục
 * khách tự bỏ ảnh vào, tên trùng nhau không có nghĩa là cùng một thứ.
 */
function adornment(imgClass) {
  return `<a class="CellDivContainer" tabindex="-1"><img class="CellImage ${imgClass}" src="${SPACER_GIF}" tabindex="-1" alt="" style="border:0;padding:0"></a>`;
}

/**
 * Bề rộng ô nhập đeo icon. Runtime lấy bề rộng Ô (không trừ padding) rồi trừ chỗ đeo icon.
 * `field@width` — có ở `Grid/`, hiếm ở `Dir/` — thắng khi được khai.
 */
function adornedWidth(field, cellWidth) {
  const declared = Number(field.attrs?.width);
  const base = Number.isFinite(declared) && declared > 0
    ? declared
    : (Number.isFinite(cellWidth) && cellWidth > 0 ? cellWidth : null);
  if (base === null) return `width:calc(100% - ${ADORNMENT_PX}px);`;
  return `width:${Math.max(base - ADORNMENT_PX, 1)}px;`;
}

/**
 * @param {object} field  phần tử của scanFields()
 * @param {{vi?: boolean, cellWidth?: number}} opts  `cellWidth` = tổng px các cột ô trải qua
 */
/**
 * Tooltip của một ô nhập: TÊN FIELD.
 *
 * Câu hỏi hay hỏi nhất khi nhìn một form FBO lạ là «ô này là field gì» — để viết JS, để tra cột
 * database, để tìm nó trong XML. Trước nay trả lời được bằng cách bấm vào ô rồi đọc bảng Debug,
 * tức ba thao tác cho một câu hỏi hỏi liên tục.
 *
 * Ghi CẢ HAI khi tên khai khác tên đã phân giải: `ten_kh%l` là thứ nằm trong XML (thứ cần tìm
 * kiếm), còn `ten_kh2` là cột database thật (thứ cần viết vào SQL). Chỉ đưa một cái thì người
 * dùng vẫn phải tự suy cái kia, và `%l` phân giải theo bản đang xem chứ không cố định.
 *
 * `title` không đổi một px nào của bố cục, nên nó không phá luật «form phải giống runtime từng
 * px» — nó chỉ thêm một tooltip mà runtime không có.
 */
export function fieldHint(field, vi) {
  const resolved = resolveLocaleName(field.name, vi);
  return resolved === field.name ? resolved : `${resolved}  ·  khai: ${field.name}`;
}

export function renderControl(field, { vi = true, cellWidth = null } = {}) {
  const a = field.attrs ?? {};
  const id = `fbo-field-${safeId(field.name, vi)}`;
  // Tên field gửi ra ngoài là tên ĐÃ PHÂN GIẢI hậu tố ngôn ngữ — `ten_kh%l` ra `ten_kh` hay
  // `ten_kh2` tuỳ bản đang xem. Đây là tên cột database thật, xem `resolveLocaleName`.
  const common = ` data-field-name="${esc(resolveLocaleName(field.name, vi))}" title="${esc(fieldHint(field, vi))}"`;
  const disabled = isDisabled(field);
  const value = defaultValue(field);

  if (isBoolean(field)) {
    const checked = value === '1' ? ' checked' : '';
    return `<input type="checkbox" id="${id}" class="FormInput FormCheckInput"${common}${disabled ? ' disabled' : ''}${checked}>`;
  }

  const style = itemsStyle(field);
  if (style === 'dropdownlist' || style === 'listbox') {
    const multiple = style === 'listbox' ? ' multiple' : '';
    const options = (field.options ?? []).map((o) => {
      const selected = value !== null && o.value === value ? ' selected' : '';
      return `<option value="${esc(o.value)}"${selected}>${esc(vi ? o.v : o.e)}</option>`;
    }).join('');
    // `FormComboBox` / `FormListBox` là tên của runtime — KHÔNG phải `FormInput`. Chúng có
    // rule riêng (combo cao 15px, listbox nền #f0f7fb); gắn nhầm `FormInput` là ép combo cao
    // 13px và listbox đổi màu.
    const cls = style === 'listbox'
      ? (disabled ? 'FormListBoxDisabled' : 'FormListBox')
      : (disabled ? 'FormComboBoxDisabled' : 'FormComboBox');
    return `<select id="${id}" class="${cls}"${multiple}${common}${disabled ? ' disabled' : ''}>${options}</select>`;
  }

  if (isTextArea(field)) {
    // `cols="50"` + `resize:none` là nguyên văn runtime; bề rộng thật do container quyết.
    const cls = disabled ? 'FormTextAreaDisabled FormTextInputDisabled' : 'FormTextArea FormTextInput';
    return `<textarea id="${id}" class="${cls}" rows="${Number(a.rows)}" cols="50" style="resize:none;"${common}${disabled ? ' readonly' : ''}>${esc(value ?? '')}</textarea>`;
  }

  const lookup = isLookup(field);
  const calendar = isCalendar(field);

  // Runtime THAY bộ class chứ không cộng dồn — xem ghi chú đầu file.
  const css = disabled ? ['FormInputDisabled', 'FormTextInputDisabled'] : ['FormInput', 'FormTextInput'];
  if (lookup) css.push(disabled ? 'FormTextInputLookupDisabled' : 'FormTextInputLookup');
  if (calendar) css.push(disabled ? 'FormTextInputCalendarDisabled' : 'FormTextInputCalendar');

  const inline = [];
  if (String(a.dataFormatString ?? '').toLowerCase().includes('uppercase')) inline.push('text-transform:uppercase;');
  const align = alignOf(field);
  if (align) inline.push(`text-align:${align};`);

  if (lookup || calendar) {
    inline.push(adornedWidth(field, cellWidth));
  } else {
    const width = Number(a.width);
    if (Number.isFinite(width) && width > 0) inline.push(`width:${width}px;`);
  }

  const styleAttr = inline.length ? ` style="${inline.join('')}"` : '';
  const valueAttr = value !== null ? ` value="${esc(value)}"` : '';
  const extra = disabled ? ' readonly tabindex="-1"' : '';
  const input = `<input type="text" id="${id}" class="${css.join(' ')}"${styleAttr}${common}${extra}${valueAttr}>`;

  if (lookup) return input + adornment('CellImgLookup');
  if (calendar) return input + adornment('CellImgCalendar');
  return input;
}

/**
 * Ô nhập TRONG LƯỚI — khác hẳn ô nhập của form, và là hàm riêng chứ không phải một cờ.
 *
 * Nguồn: `renderCell` trong `ScriptResource.axd` của runtime, cộng HTML thật của lưới «Hóa đơn
 * bán hàng». Khuôn của runtime chỉ có MỘT dạng:
 *
 *   <input class="CellInput {TextInput|CheckInput} {extra}" type="{text|checkbox}" value="…"
 *          [style="text-align:…"] [maxlength="N"]>
 *
 * Ba chỗ khác form đủ lớn để không gộp chung được, và cả ba đều đo được trên trang đã lưu:
 *
 *   1. KHÔNG có bộ class `Disabled`. Form đổi hẳn sang `FormInputDisabled`; lưới thì giữ nguyên
 *      `CellInput TextInput` và chỉ thêm thuộc tính `readonly` (checkbox thì `disabled`).
 *   2. KHÔNG có icon lookup/lịch. Cả trang runtime có ĐÚNG MỘT `CellDivContainer`, và nó thuộc
 *      form chứ không thuộc lưới — cột AutoComplete trong lưới là một ô chữ trơn, danh sách
 *      chọn hiện ra bằng menu chuột phải (`oncontextmenu`).
 *   3. KHÔNG có bề rộng inline. `.TextInput{width:100%}` cho ô lấp đầy div container, mà div ấy
 *      đã mang đúng bề rộng cột rồi. Ghim thêm px vào ô là hai nguồn cho một con số.
 *
 * Cũng không có `<select>` và `<textarea>`: lưới runtime dựng MỌI cột bằng `<input>`, kể cả cột
 * khai `DropDownList`. Dựng `<select>` ở đây là bịa thêm một thứ runtime không có.
 */
export function renderGridControl(field, { vi = true, cellWidth = null } = {}) {
  void cellWidth; // giữ cùng chữ ký với `renderControl` — lưới không dùng tới
  const a = field.attrs ?? {};
  const id = `fbo-field-${safeId(field.name, vi)}`;
  const common = ` data-field-name="${esc(resolveLocaleName(field.name, vi))}" title="${esc(fieldHint(field, vi))}"`;
  const disabled = isDisabled(field);
  const value = defaultValue(field);

  if (isBoolean(field)) {
    const checked = value === '1' ? ' checked' : '';
    return `<input type="checkbox" id="${id}" class="CellInput CheckInput"${common}${disabled ? ' disabled' : ''}${checked}>`;
  }

  const inline = [];
  if (String(a.dataFormatString ?? '').toLowerCase().includes('uppercase')) inline.push('text-transform:uppercase;');
  const align = alignOf(field);
  if (align) inline.push(`text-align:${align};`);

  // `maxlength` bị bỏ qua ở cột AutoComplete — nguyên văn runtime, vì ô ấy còn phải chứa được
  // giá trị người dùng gõ dở trước khi danh sách lọc xong.
  const max = Number(a.maxLength);
  const maxAttr = Number.isFinite(max) && max > 0 && !isLookup(field) ? ` maxlength="${max}"` : '';

  const styleAttr = inline.length ? ` style="${inline.join('')}"` : '';
  const valueAttr = value !== null ? ` value="${esc(value)}"` : '';
  const extra = disabled ? ' readonly tabindex="-1"' : '';
  return `<input type="text" id="${id}" class="CellInput TextInput"${styleAttr}${common}${maxAttr}${extra}${valueAttr}>`;
}

/** Tên lớp container `<div>` bọc control — runtime đổi theo loại control, CSS bám vào đó. */
export function containerClass(field) {
  if (!field) return 'FormContainer';
  if (isTextArea(field)) return 'FormContainer FormContainerTextArea';
  return isDisabled(field) ? 'FormContainer FormContainerInputDisabled' : 'FormContainer FormContainerInput';
}

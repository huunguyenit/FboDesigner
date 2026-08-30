// field-template.mjs — khai báo `<field>` cho một control MỚI.
//
// Vì sao cần: "thêm control" nghĩa là thêm một thứ CHƯA CÓ. Bản trước cho chọn trong danh sách
// field đã khai, tức chỉ đặt thêm một ô cho field sẵn có — không phải việc người dùng muốn làm,
// và cũng không có cách nào tạo field mới từ trong designer.
//
// Bảy kiểu dưới đây đều là "textbox cộng thêm gì đó". Khác biệt nằm ở `type`,
// `dataFormatString` và `<items style>` — ba thứ runtime dùng để chọn control. Mẫu lấy từ field
// THẬT trong `Dir/Customer.xml` của FBISP24, không phải bịa ra cho hợp lý:
//
//   ngay_gh    type="DateTime" dataFormatString="@datetimeFormat" align="left"
//   t_tien_cn  type="Decimal"  dataFormatString="@baseCurrencyAmountInputFormat" clientDefault="0"
//              + <items style="Numeric"/>
//   kh_yn      type="Boolean"  clientDefault="Default" defaultValue="true"
//
// Catalog: `core/config/fields.json` — sửa JSON để thêm/đổi kiểu, không cần đụng code sinh XML.

import { msg, FIELDS_CONFIG } from './msg.mjs';

/**
 * Bảy kiểu control tạo được.
 *
 * `tokens` là thứ tự ô trên hàng. Checkbox đảo ngược so với phần còn lại — ô tick đứng TRƯỚC
 * rồi mới tới nhãn (`[kh_yn], [kh_yn].Label` trong file thật), vì nhãn của checkbox nằm bên
 * phải hộp tick chứ không phải bên trái như mọi control khác.
 */
export const FIELD_KINDS = FIELDS_CONFIG.kinds.map((k) => ({
  id: k.id,
  label: k.label,
  detail: k.detail,
  attrs: { ...(k.attrs || {}) },
  items: k.items ?? null,
  ...(k.labelAfter ? { labelAfter: true } : {}),
}));

const NAME_RE = new RegExp(FIELDS_CONFIG.namePattern);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

/** Tên field FBO: chữ thường không dấu, số, `_`. `%l` cuối là field ngoại — vẫn cho qua. */
export function isValidFieldName(name) {
  return NAME_RE.test(String(name ?? '').trim());
}

/**
 * Dựng khai báo `<field>` và danh sách token của control mới.
 *
 * @param kindId  một trong `FIELD_KINDS[].id`
 * @param name    tên field
 * @param label   nhãn tiếng Việt; `labelEn` không có thì dùng luôn nhãn Việt
 * @param opts    `{width}` — bề rộng px cho CỘT LƯỚI; form không dùng (xem dưới)
 * @returns {{ok:true, xml:string, tokens:string[]}|{ok:false, reason:string}}
 */
export function buildField(kindId, name, label, labelEn, opts = {}) {
  const kind = FIELD_KINDS.find((k) => k.id === kindId);
  if (!kind) return { ok: false, reason: msg('field.unknown_kind', { kindId }) };

  const trimmed = String(name ?? '').trim();
  if (!isValidFieldName(trimmed)) {
    return { ok: false, reason: msg('field.invalid_name', { name }) };
  }

  const v = String(label ?? '').trim() || trimmed;
  const e = String(labelEn ?? '').trim() || v;

  /*
   * `width` CHỈ có nghĩa với cột lưới, và nó đứng NGAY SAU `name` — đúng chỗ corpus đặt nó
   * (`<field name="ma_bp0" width="100">` trong `Grid/APDetail.f`).
   *
   * Form thì không: ô của form không có bề rộng riêng, nó lấy px từ list cột của vùng
   * (`<item value="100, 60, …">`). Sinh `width` cho một field của form là khai một con số mà
   * runtime bỏ qua, và người đọc file sau này sẽ tin vào nó.
   *
   * Lưới thì ngược lại — cột KHÔNG khai `width` là cột runtime tự cho 100px, nên bỏ trống là
   * đẩy một quyết định về bề rộng sang chỗ không ai nhìn thấy.
   */
  const px = Number(opts.width);
  const widthAttr = Number.isFinite(px) && px >= 0 ? ` width="${Math.round(px)}"` : '';

  const attrs = Object.entries(kind.attrs)
    .map(([k, val]) => ` ${k}="${esc(val)}"`)
    .join('');

  const inner = [`<header v="${esc(v)}" e="${esc(e)}"/>`];
  if (kind.items) inner.push(`<items style="${kind.items}"/>`);

  /*
   * MỘT thẻ con thì viết một dòng; NHIỀU hơn thì xuống dòng và thụt vào — đúng như corpus viết.
   *
   * Đây không phải sở thích trình bày. Đo trên `Dir/Customer.xml`: field chỉ có `<header>` luôn
   * nằm gọn một dòng (`<field name="ngay_ct" type="DateTime"><header …/></field>`), còn field
   * có thêm `<items>` hay `<footer>` thì luôn tách dòng. Sinh ra một dòng dài
   * `<field …><header …/><items …/></field>` là thứ không giống bất kỳ dòng nào quanh nó, và
   * người đọc file nhận ra ngay «cái này do máy nhét vào».
   *
   * Thụt lề ở đây tính từ mốc 0; `planAddField` kê lại theo thụt lề thật của file đích — nó là
   * bên duy nhất biết file dùng mấy dấu cách.
   */
  const open = `<field name="${esc(trimmed)}"${widthAttr}${attrs}>`;
  const xml = inner.length === 1
    ? `${open}${inner[0]}</field>`
    : [open, ...inner.map((t) => `  ${t}`), '</field>'].join('\n');

  // Checkbox: ô tick trước, nhãn sau — xem ghi chú ở `FIELD_KINDS`.
  const tokens = kind.labelAfter
    ? [`[${trimmed}]`, `[${trimmed}].Label`]
    : [`[${trimmed}].Label`, `[${trimmed}]`];

  return { ok: true, xml, tokens };
}

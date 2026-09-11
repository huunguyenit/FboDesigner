// mail-components.mjs — LOẠI component của một phần tử trong mẫu mail, và bảng thuộc tính của nó.
//
// Mẫu mail không khai "đây là nút" hay "đây là khoảng trống" — nó chỉ là HTML. Loại ở đây SUY RA
// từ thẻ + style + nội dung, chỉ để bảng thuộc tính hiện đúng nhóm ô (ảnh cần src/alt/width, nút
// cần href/màu nền/bo góc…). Suy sai thì hậu quả là hiện nhầm nhóm ô, KHÔNG phải ghi sai: mọi phép
// ghi vẫn đi qua whitelist theo THẺ của hợp đồng (`ATTRIBUTES`, `STYLE_PROPERTIES`).
//
// Phase 5 (chèn component) sẽ thêm bộ sinh HTML cho từng loại vào đúng file này.

import { STYLE_PROPERTIES, COMPONENT_KINDS } from './mail-design-contract.mjs';

const freeze = (list) => Object.freeze([...list]);

/**
 * `styles`/`attrs`: ô hiện theo thứ tự này; webview lọc `attrs` theo `ATTRIBUTES[tag]` của phần tử.
 * `parentLink`: ảnh bọc trong `<a>` → hiện ô liên kết sửa `href` của thẻ CHA.
 * `parentAlign`: nút/liên kết → hiện ô căn lề sửa `align` của khối CHA (nút trong mail căn bằng ô chứa).
 */
export const COMPONENT_PANELS = Object.freeze({
  text: Object.freeze({ label: 'Chữ', styles: STYLE_PROPERTIES.text, attrs: freeze(['align']) }),
  link: Object.freeze({
    label: 'Liên kết', styles: freeze(['color', 'font-size', 'font-weight', 'text-decoration']), attrs: freeze(['href', 'target', 'title']), parentAlign: true,
  }),
  button: Object.freeze({
    label: 'Nút', styles: STYLE_PROPERTIES.button, attrs: freeze(['href', 'target', 'title']), parentAlign: true,
  }),
  image: Object.freeze({
    label: 'Ảnh', styles: STYLE_PROPERTIES.image, attrs: freeze(['src', 'alt', 'width', 'height', 'align', 'border', 'title']), parentLink: true,
  }),
  divider: Object.freeze({ label: 'Đường kẻ', styles: STYLE_PROPERTIES.divider, attrs: freeze(['width', 'size', 'align', 'color', 'height']) }),
  spacer: Object.freeze({ label: 'Khoảng trống', styles: STYLE_PROPERTIES.spacer, attrs: freeze(['height']) }),
  container: Object.freeze({
    label: 'Khung chứa', styles: STYLE_PROPERTIES.container, attrs: freeze(['width', 'height', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing']),
  }),
  frame: Object.freeze({ label: 'Khung tài liệu', styles: freeze([]), attrs: freeze([]) }),
});

// ─── Bộ sinh HTML (Phase 5) ───────────────────────────────────────────────────────────────────

const FONT = 'font-family:Arial,Helvetica,sans-serif;';
const PARAGRAPH = `margin:0;${FONT}font-size:14px;line-height:20px;color:#333333;`;
/** Bảng layout chuẩn mail: `role="presentation"` để trình đọc màn hình không đọc như bảng dữ liệu. */
const LAYOUT_TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

/**
 * Mảnh HTML của từng component — theo luật mail chứ không theo luật web:
 *   - style INLINE (nhiều mail client bỏ `<style>`), không class;
 *   - bố cục bằng `<table>` (Outlook bản Word không hiểu flex/grid/float);
 *   - nút là «bulletproof button»: nền ở `<td bgcolor>`, `<a>` bên trong mang đệm;
 *   - `&#160;` chứ không `&nbsp;` — nằm trong CDATA của Message.xml, một `&nbsp;` bị bộ bung entity
 *     báo là entity chưa khai.
 * Không chuỗi nào chứa `]]>`: mảnh này đi thẳng vào CDATA.
 */
const TEMPLATES = Object.freeze({
  text: `<p style="margin:0 0 12px;${FONT}font-size:14px;line-height:20px;color:#333333;">Nội dung</p>`,
  heading: `<h2 style="margin:0 0 12px;${FONT}font-size:20px;line-height:28px;color:#222222;">Tiêu đề</h2>`,
  image: '<img src="" alt="Ảnh" width="200" style="display:block;border:0;">',
  link: '<a href="#" style="color:#1677ff;text-decoration:underline;">Liên kết</a>',
  button: '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#1677ff" style="border-radius:4px;">'
    + `<a href="#" style="display:inline-block;padding:10px 20px;${FONT}font-size:14px;color:#ffffff;text-decoration:none;">Nút</a></td></tr></table>`,
  divider: '<hr style="border:0;border-top:1px solid #dddddd;margin:16px 0;">',
  spacer: '<div style="height:20px;line-height:20px;font-size:0;">&#160;</div>',
  container: `<table ${LAYOUT_TABLE}><tr><td style="padding:16px;"><p style="${PARAGRAPH}">Nội dung khung</p></td></tr></table>`,
  section: `<table ${LAYOUT_TABLE}><tr><td align="center" style="padding:24px 16px;background-color:#f5f5f5;"><p style="${PARAGRAPH}">Nội dung phần</p></td></tr></table>`,
  column: `<table ${LAYOUT_TABLE}><tr>`
    + `<td width="50%" valign="top" style="padding:8px;"><p style="${PARAGRAPH}">Cột 1</p></td>`
    + `<td width="50%" valign="top" style="padding:8px;"><p style="${PARAGRAPH}">Cột 2</p></td></tr></table>`,
  table: `<table width="100%" cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;${FONT}font-size:13px;">`
    + '<tr><th align="left">Cột 1</th><th align="left">Cột 2</th></tr><tr><td>…</td><td>…</td></tr></table>',
});

const LABELS = Object.freeze({
  text: 'Chữ', heading: 'Tiêu đề', image: 'Ảnh', link: 'Liên kết', button: 'Nút', divider: 'Đường kẻ', spacer: 'Khoảng trống',
  container: 'Khung chứa', section: 'Phần', column: 'Hai cột', table: 'Bảng',
});

/** @returns {string|null} mảnh HTML, hoặc `null` khi loại chưa có bộ sinh (variable/condition/dynamicTable). */
export function componentHtml(kind) {
  return Object.hasOwn(TEMPLATES, kind) ? TEMPLATES[kind] : null;
}

/** Danh sách cho bảng chèn của webview — chỉ những loại hợp đồng khai VÀ có bộ sinh. */
export const INSERTABLE_COMPONENTS = Object.freeze(Object.keys(TEMPLATES)
  .filter((kind) => Object.hasOwn(COMPONENT_KINDS, kind))
  .map((kind) => Object.freeze({ kind, label: LABELS[kind], group: COMPONENT_KINDS[kind].group })));

// ─── Suy loại (Phase 4) ───────────────────────────────────────────────────────────────────────

/** Dấu hiệu nút: một `<a>` được tô như khối bấm được — nền, đệm, viền, hoặc `display:inline-block`. */
const BUTTON_STYLES = ['background-color', 'background', 'padding', 'border', 'border-radius'];
const CONTAINER_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'div', 'center']);
/** Thẻ hay được dùng làm đường kẻ/khoảng trống khi để RỖNG. */
const EMPTY_BLOCK_TAGS = new Set(['div', 'td', 'th', 'p']);

function pxOf(value) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(String(value ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * @param {{tag:string, role:string, childCount?:number, style?:Map<string,string>,
 *          attrs?:Map<string,string>, text?:string}} el  `text` = chữ HIỆN RA (đã bỏ thẻ, đã giải
 *          `&nbsp;`) — khối chỉ chứa `&nbsp;` là khoảng trống, không phải chữ
 * @returns {'frame'|'image'|'divider'|'button'|'link'|'spacer'|'container'|'text'}
 */
export function componentKindOf({
  tag, role, childCount = 0, style = new Map(), attrs = new Map(), text = '',
}) {
  if (role === 'frame') return 'frame';
  if (tag === 'img') return 'image';
  if (tag === 'hr') return 'divider';
  if (tag === 'a') {
    const display = String(style.get('display') ?? '').trim();
    return BUTTON_STYLES.some((p) => style.has(p)) || display === 'inline-block' || display === 'block' ? 'button' : 'link';
  }
  if (EMPTY_BLOCK_TAGS.has(tag) && childCount === 0 && text.trim() === '') {
    if (style.has('border-top') || style.has('border-bottom')) return 'divider';
    const height = pxOf(style.get('height') ?? attrs.get('height'));
    if (height !== null && height <= 4 && (style.has('background-color') || attrs.has('bgcolor'))) return 'divider';
    // Ô trống KHÔNG khai chiều cao (ô tiêu đề để trắng của bảng dữ liệu) không phải khoảng trống.
    if (height !== null || style.has('line-height')) return 'spacer';
  }
  if (CONTAINER_TAGS.has(tag)) return 'container';
  return 'text';
}

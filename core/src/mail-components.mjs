// mail-components.mjs — LOẠI component của một phần tử trong mẫu mail, và bảng thuộc tính của nó.
//
// Mẫu mail không khai "đây là nút" hay "đây là khoảng trống" — nó chỉ là HTML. Loại ở đây SUY RA
// từ thẻ + style + nội dung, chỉ để bảng thuộc tính hiện đúng nhóm ô (ảnh cần src/alt/width, nút
// cần href/màu nền/bo góc…). Suy sai thì hậu quả là hiện nhầm nhóm ô, KHÔNG phải ghi sai: mọi phép
// ghi vẫn đi qua whitelist theo THẺ của hợp đồng (`ATTRIBUTES`, `STYLE_PROPERTIES`).
//
// Phase 5 (chèn component) sẽ thêm bộ sinh HTML cho từng loại vào đúng file này.

import { STYLE_PROPERTIES } from './mail-design-contract.mjs';

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

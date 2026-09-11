// mail-edit.mjs — kế hoạch sửa của Email Designer.
//
// Mọi hàm ở đây THUẦN: nhận dòng HTML (`buildMailView`) + chỉ mục (`indexMailElements`) dựng từ
// VĂN BẢN HIỆN TẠI, trả `{ok:true, edits, label}` theo toạ độ clearText hoặc `{ok:false, reason}`.
// Tầng vỏ quy edit về file nguồn (`mapMailEdits`) rồi ghi qua `applySplice` — một phép sửa là
// MỘT mục trong lịch sử hoàn tác. Không serialize lại HTML: chỉ splice đúng dải cần đổi.
//
// `{ok:false, noop:true}` = không có gì đổi (gõ lại đúng giá trị cũ). Tầng vỏ im lặng bỏ qua,
// không bắn cảnh báo cho một thao tác đúng.

import {
  cdataRange, cdataPoint, parseStyleDeclarations, textBounds, decodeMailText,
} from './mail-html.mjs';
import { isStyleProperty, isSafeCssValue, MAX_TEXT_LENGTH } from './mail-design-contract.mjs';

const bad = (reason) => ({ ok: false, reason });
const noop = () => ({ ok: false, noop: true, reason: 'không có gì đổi' });
const ENTITY_REASON = 'dải cần sửa có phần do entity (&…;) sinh ra — dùng chung cho nhiều mẫu, sửa trong XML';

/**
 * Phần tử `elementId` trong chỉ mục HIỆN TẠI, và đúng là phần tử webview đã thấy.
 *
 * `fingerprint` là dấu vân tay host ghi lại lúc vẽ. Lệch nghĩa là thứ tự phần tử đã đổi (thường
 * do gõ tay trong XML ngay giữa hai lượt vẽ) — ghi vào "e7" lúc này là ghi vào phần tử KHÁC.
 */
export function resolveMailElement(index, elementId, fingerprint) {
  const el = index.byId.get(elementId);
  if (!el) return bad(`không còn phần tử ${elementId} — mẫu vừa đổi, chọn lại rồi thử lại`);
  if (fingerprint !== undefined && fingerprint !== null && el.fingerprint !== fingerprint) {
    return bad(`phần tử ${elementId} đã đổi từ lần vẽ trước (có thể vừa sửa tay trong XML) — chọn lại rồi thử lại`);
  }
  return { ok: true, element: el };
}

const NBSP = String.fromCharCode(160);

/** Chữ người dùng gõ → chữ HTML. `{!token}` không chứa ký tự nào bị escape nên đi qua nguyên văn. */
export function escapeMailText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split(NBSP).join('&nbsp;');
}

/**
 * Thay chữ của một phần tử KHÔNG có phần tử con. Giữ nguyên khoảng trắng đầu/cuối của nội dung
 * gốc (thụt lề của file), chỉ thay phần giữa.
 */
export function planMailText(view, index, { elementId, value, fingerprint }) {
  const r = resolveMailElement(index, elementId, fingerprint);
  if (!r.ok) return r;
  const el = r.element;
  if (el.caps.setText !== true) return bad(`<${el.tag}>: ${el.caps.setText}`);
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) return bad(`chữ phải là chuỗi ≤ ${MAX_TEXT_LENGTH} ký tự`);

  const raw = view.html.slice(el.openEnd, el.closeStart);
  const { lead, trail } = textBounds(raw);
  if (decodeMailText(raw.slice(lead, raw.length - trail)) === value) return noop();

  const text = escapeMailText(value);
  if (text.includes(']]>')) return bad('chữ không được chứa "]]>"');
  const hs = el.openEnd + lead;
  const he = el.closeStart - trail;
  const label = `mail: sửa chữ <${el.tag}>`;

  if (hs === he) {
    const p = cdataPoint(view, hs, 'left');
    if (!p) return bad(ENTITY_REASON);
    return { ok: true, edits: [{ start: p.offset, end: p.offset, text, bias: p.bias }], label };
  }
  const range = cdataRange(view, hs, he);
  if (!range) return bad(ENTITY_REASON);
  return { ok: true, edits: [{ start: range.start, end: range.end, text }], label };
}

/**
 * Đặt / đổi / xoá MỘT khai báo CSS trong `style="…"` của chính phần tử. Không bao giờ đụng
 * `<style>` hay class: `.r1` dùng chung cho hàng chục mẫu, sửa nó là đổi mail của người khác.
 *
 * - `value === ''` → xoá khai báo; xoá khai báo cuối cùng thì bỏ luôn thuộc tính `style`.
 * - Khai báo trùng tên: sửa khai báo CUỐI (cái trình duyệt thật sự dùng).
 * - Khai báo đang mang `{!token}` (`display:{!slink}`) là logic runtime → từ chối.
 */
export function planMailStyle(view, index, { elementId, property, value, fingerprint }) {
  const r = resolveMailElement(index, elementId, fingerprint);
  if (!r.ok) return r;
  const el = r.element;
  if (el.caps.setStyle !== true) return bad(`<${el.tag}>: ${el.caps.setStyle}`);
  if (!isStyleProperty(property)) return bad(`thuộc tính CSS không cho sửa: ${property}`);
  if (value !== '' && !isSafeCssValue(value)) return bad(`giá trị ${property} không an toàn`);

  const label = value === '' ? `mail: xoá style ${property} <${el.tag}>` : `mail: style ${property} <${el.tag}>`;
  const cssValue = value.replace(/&/g, '&amp;');
  const attr = el.attrs.find((a) => a.name === 'style');

  const replace = (hs, he, text) => {
    const range = cdataRange(view, hs, he);
    return range ? { ok: true, edits: [{ start: range.start, end: range.end, text }], label } : bad(ENTITY_REASON);
  };
  const insert = (h, text) => {
    const p = cdataPoint(view, h, 'left');
    return p ? { ok: true, edits: [{ start: p.offset, end: p.offset, text, bias: p.bias }], label } : bad(ENTITY_REASON);
  };

  if (!attr) {
    if (value === '') return noop();
    return insert(el.insertAt, ` style="${property}:${cssValue};"`);
  }
  if (attr.valueStart === null || attr.quote === null) return bad('style không có giá trị trong dấu nháy — sửa trong XML');
  if (value.includes(attr.quote)) return bad(`giá trị chứa dấu ${attr.quote} trùng dấu nháy của thuộc tính style`);

  const decls = parseStyleDeclarations(attr.value);
  const target = decls.filter((d) => d.property === property).pop();
  const base = attr.valueStart;

  if (!target) {
    if (value === '') return noop();
    const trimmedEnd = attr.value.replace(/\s+$/, '').length;
    const needsSemi = trimmedEnd > 0 && attr.value[trimmedEnd - 1] !== ';';
    return insert(base + trimmedEnd, `${needsSemi ? ';' : ''}${property}:${cssValue};`);
  }
  if (target.value.includes('{!')) return bad(`${property} đang mang {!token} (logic runtime của mẫu) — sửa trong XML`);

  if (value === '') {
    if (decls.length === 1) {
      let s = attr.start;
      while (s > el.openStart && /\s/.test(view.html[s - 1])) s--;
      return replace(s, attr.end, '');
    }
    return replace(base + target.start, base + target.end + (target.semicolon ? 1 : 0), '');
  }
  if (target.value === value) return noop();
  return replace(base + target.valueStart, base + target.valueEnd, cssValue);
}

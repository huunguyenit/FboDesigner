// mail-structure.mjs — kế hoạch sửa CẤU TRÚC của Email Designer: xoá, di chuyển, chèn, bọc liên kết.
//
// Cùng giao kèo `mail-edit.mjs`: thuần, dựng từ văn bản hiện tại, trả edit theo toạ độ clearText.
// Thêm một trường: `selectId` — id MỚI của phần tử người dùng đang cầm sau phép sửa. Id là số thứ tự
// thẻ mở, nên chèn/xoá/di chuyển làm dồn số; host đưa `selectId` vào bản vẽ kế tiếp để khung chọn
// đi theo đúng phần tử, không đứng lại ở số cũ (lúc ấy đã là phần tử khác).
//
// Ranh giới (hợp đồng): mọi dải nằm trọn trong mảnh cdata; không đi qua part (header/detail/footer);
// không di chuyển giữa hai file nguồn (Message.xml ↔ Include); không xoá/di chuyển hàng/ô bảng.

import { cdataRange, cdataPoint } from './mail-html.mjs';
import { resolveMailElement } from './mail-edit.mjs';
import { formatElementId, isSafeUrl } from './mail-design-contract.mjs';
import { componentHtml } from './mail-components.mjs';

const bad = (reason) => ({ ok: false, reason });
const noop = () => ({ ok: false, noop: true, reason: 'không có gì đổi' });
const ENTITY_REASON = 'dải cần sửa có phần do entity (&…;) sinh ra — dùng chung cho nhiều mẫu, sửa trong XML';

const ordinalOf = (id) => Number(id.slice(1));

/** Phần tử và mọi hậu duệ — theo toạ độ: thẻ mở nằm trong `[openStart, closeEnd)`. */
function subtreeOf(index, el) {
  return index.elements.filter((x) => x.openStart >= el.openStart && x.openStart < el.closeEnd);
}

/** Số thẻ mở đứng trước vị trí `h`, bỏ qua các id trong `exclude`. */
function countBefore(index, h, exclude = null) {
  let n = 0;
  for (const x of index.elements) if (x.openStart < h && !(exclude && exclude.has(x.id))) n++;
  return n;
}

function siblingsOf(index, el) {
  return el.parentId ? index.byId.get(el.parentId).children : index.elements.filter((x) => x.parentId === null).map((x) => x.id);
}

/**
 * Phần tử đứng MỘT MÌNH trên dòng (chỉ khoảng trắng hai bên) → nới dải ra cả dòng, kể cả xuống
 * dòng, để xoá không để lại một dòng trắng. Nới mà ra khỏi mảnh cdata thì giữ dải gốc.
 */
function lineRange(view, s, e) {
  const { html } = view;
  let a = s;
  while (a > 0 && (html[a - 1] === ' ' || html[a - 1] === '\t')) a--;
  let b = e;
  while (b < html.length && (html[b] === ' ' || html[b] === '\t')) b++;
  const startsLine = a === 0 || html[a - 1] === '\n';
  let endsLine = false;
  if (html.startsWith('\r\n', b)) { b += 2; endsLine = true; } else if (html[b] === '\n') { b += 1; endsLine = true; }
  return startsLine && endsLine && cdataRange(view, a, b) ? { start: a, end: b } : { start: s, end: e };
}

/** Điểm chèn và phía bám của từng vị trí — trước thẻ mở / sau thẻ đóng / trước thẻ đóng (cuối nội dung). */
function insertionPoint(el, position) {
  if (position === 'before') return { h: el.openStart, bias: 'right' };
  if (position === 'after') return { h: el.closeEnd, bias: 'left' };
  return { h: el.closeStart, bias: 'right' };
}

const POSITION_LABEL = { before: 'trước', after: 'sau', append: 'vào cuối' };

/** Xoá trọn một khối/nội tuyến. Chọn lại anh em đứng trước, không có thì cha. */
export function planMailRemove(view, index, { elementId, fingerprint }) {
  const r = resolveMailElement(index, elementId, fingerprint);
  if (!r.ok) return r;
  const el = r.element;
  if (el.caps.removeElement !== true) return bad(`<${el.tag}>: ${el.caps.removeElement}`);

  const { start, end } = lineRange(view, el.openStart, el.closeEnd);
  const range = cdataRange(view, start, end);
  if (!range) return bad(ENTITY_REASON);

  const siblings = siblingsOf(index, el);
  const i = siblings.indexOf(el.id);
  // Anh em đứng trước và cha đều có số thứ tự NHỎ hơn phần tử bị xoá → id của chúng không đổi.
  const selectId = i > 0 ? siblings[i - 1] : el.parentId;
  return {
    ok: true, edits: [{ start: range.start, end: range.end, text: '' }], label: `mail: xoá <${el.tag}>`, selectId,
  };
}

/**
 * Di chuyển một khối/nội tuyến.
 *   - `direction`: đổi chỗ với anh em liền kề — MỘT splice thay cả dải, chữ ở giữa đứng yên.
 *   - `targetId` + `position`: kéo thả — xoá ở chỗ cũ + chèn ở chỗ mới, cùng part, cùng file.
 */
export function planMailMove(view, index, {
  elementId, fingerprint, direction, targetId, position,
}) {
  const r = resolveMailElement(index, elementId, fingerprint);
  if (!r.ok) return r;
  const el = r.element;
  if (el.caps.moveElement !== true) return bad(`<${el.tag}>: ${el.caps.moveElement}`);
  const { html } = view;

  if (direction) {
    const otherId = el.moveTargets[direction === 'up' ? 'up' : 'down'];
    if (!otherId) return bad(`không có phần tử anh em ${direction === 'up' ? 'phía trên' : 'phía dưới'} đổi chỗ được`);
    const other = index.byId.get(otherId);
    const [a, b] = direction === 'up' ? [other, el] : [el, other];
    const range = cdataRange(view, a.openStart, b.closeEnd);
    if (!range) return bad(ENTITY_REASON);
    const text = html.slice(b.openStart, b.closeEnd) + html.slice(a.closeEnd, b.openStart) + html.slice(a.openStart, a.closeEnd);
    // Lên: phần tử chiếm chỗ bắt đầu của anh em trước. Xuống: đứng sau cả cây của anh em sau.
    const selectId = formatElementId(direction === 'up' ? ordinalOf(a.id) : ordinalOf(a.id) + subtreeOf(index, b).length);
    return {
      ok: true,
      edits: [{ start: range.start, end: range.end, text }],
      label: `mail: di chuyển <${el.tag}> ${direction === 'up' ? 'lên' : 'xuống'}`,
      selectId,
    };
  }

  const target = index.byId.get(targetId);
  if (!target) return bad(`không còn phần tử đích ${targetId} — mẫu vừa đổi, thử lại`);
  const moved = new Set(subtreeOf(index, el).map((x) => x.id));
  if (moved.has(target.id)) return bad('không thả phần tử vào chính nó hay phần tử con của nó');
  const cap = target.insertPositions?.[position];
  if (cap !== true) return bad(`<${target.tag}>: ${cap ?? 'vị trí thả không hợp lệ'}`);
  if (target.part !== el.part) return bad('không di chuyển qua part khác (header/detail/footer) — part là ranh giới của mẫu');

  const { h, bias } = insertionPoint(target, position);
  const { start, end } = lineRange(view, el.openStart, el.closeEnd);
  if (h >= start && h <= end) return noop();
  const del = cdataRange(view, start, end);
  const ins = cdataPoint(view, h, bias);
  if (!del || !ins) return bad(ENTITY_REASON);
  if (del.file !== ins.file) return bad('không di chuyển giữa hai file nguồn (Message.xml ↔ Include) — cắt dán trong XML');

  return {
    ok: true,
    edits: [
      { start: del.start, end: del.end, text: '' },
      { start: ins.offset, end: ins.offset, text: html.slice(el.openStart, el.closeEnd), bias: ins.bias },
    ],
    label: `mail: di chuyển <${el.tag}> ${POSITION_LABEL[position]} <${target.tag}>`,
    selectId: formatElementId(countBefore(index, h, moved) + 1),
  };
}

/** Chèn một component mới quanh/trong phần tử neo. Chọn luôn phần tử vừa chèn. */
export function planMailInsert(view, index, {
  elementId, fingerprint, position, component,
}) {
  const r = resolveMailElement(index, elementId, fingerprint);
  if (!r.ok) return r;
  const el = r.element;
  const cap = el.insertPositions?.[position];
  if (cap !== true) return bad(`<${el.tag}>: ${cap ?? 'vị trí chèn không hợp lệ'}`);
  const fragment = componentHtml(component);
  if (fragment === null) return bad(`component "${component}" chưa hỗ trợ ở bản này`);
  if (fragment.includes(']]>')) return bad('mảnh HTML không được chứa "]]>"');

  const { h, bias } = insertionPoint(el, position);
  const p = cdataPoint(view, h, bias);
  if (!p) return bad(ENTITY_REASON);
  return {
    ok: true,
    edits: [{ start: p.offset, end: p.offset, text: fragment, bias: p.bias }],
    label: `mail: chèn ${component} ${POSITION_LABEL[position]} <${el.tag}>`,
    selectId: formatElementId(countBefore(index, h) + 1),
  };
}

/** Bọc ảnh trong `<a href>`. Hai điểm chèn trong cùng mảnh cdata; chọn lại chính ảnh (id dồn một). */
export function planMailWrapLink(view, index, { elementId, fingerprint, href }) {
  const r = resolveMailElement(index, elementId, fingerprint);
  if (!r.ok) return r;
  const el = r.element;
  if (el.caps.wrapLink !== true) return bad(`<${el.tag}>: ${el.caps.wrapLink}`);
  if (typeof href !== 'string' || href === '' || !isSafeUrl(href)) return bad('href không hợp lệ hoặc không an toàn');

  const range = cdataRange(view, el.openStart, el.closeEnd);
  if (!range) return bad(ENTITY_REASON);
  return {
    ok: true,
    edits: [
      { start: range.start, end: range.start, text: `<a href="${href}">`, bias: 'right' },
      { start: range.end, end: range.end, text: '</a>', bias: 'left' },
    ],
    label: `mail: bọc liên kết <${el.tag}>`,
    selectId: formatElementId(ordinalOf(el.id) + 1),
  };
}

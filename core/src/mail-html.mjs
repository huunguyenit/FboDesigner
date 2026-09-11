// mail-html.mjs — dòng HTML của MỘT mẫu mail (action × body) cho Email Designer.
//
// Hợp đồng: `mail-design-contract.mjs`. Kiến trúc: `docs/EMAIL-DESIGNER.md`.
//
// Bài toán khác `mail-template.mjs`: bên đó cắt lát và bỏ dấu CDATA để XEM; ở đây phải giữ được
// đường về NGUỒN cho từng ký tự, vì designer ghi ngược. Nên dòng HTML được dựng từ các MẢNH:
//
//   cdata  nguyên văn giữa `<![CDATA[` và `]]>` — toạ độ HTML ↔ clearText là phép DỊCH. Sửa được.
//   text   nút chữ XML ngoài CDATA (thực tế: chỗ một `&Name;` bung ra, như `&HeaderColor;` nằm
//          GIỮA một thẻ `<td style="…">`) — đã giải mã `&lt;`… nên toạ độ không tuyến tính.
//          Đọc được, KHÔNG BAO GIỜ ghi vào: sửa ở đây là sửa entity dùng chung cho mọi action.
//
// Mảnh `cdata` còn được cắt ở ranh giới đoạn của `entities.mjs`, nên một mảnh luôn thuộc đúng
// MỘT file nguồn — dải sửa nằm trọn trong một mảnh thì quy về nguồn chỉ còn là phép cộng.
//
// Không parser HTML nào ở đây cả (core không dependency, ADR-0002): tokenizer theo span, đủ cho
// HTML của mail thật (đo trên FBISP24: 1874 phần tử, 58 thuộc tính không nháy, 4 `<p>` đóng
// ngầm). Chỗ nào không chắc thì ghi lý do vào `caps` và designer TỪ CHỐI, không đoán.

import { locateMailText, substituteFieldTokens } from './mail-template.mjs';
import { segmentAt } from './entities.mjs';
import { decodeXmlText } from './render.mjs';
import {
  DESIGN_ATTR, MAIL_PARTS, ELEMENT_ROLES, ATTRIBUTES, formatElementId, elementFingerprint, roleOfTag,
} from './mail-design-contract.mjs';
import { componentKindOf } from './mail-components.mjs';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['style', 'script', 'title', 'textarea']);
/** Thẻ khối mở ra thì `<p>` đang mở đóng ngầm — luật của trình duyệt, mail client theo đúng nó. */
const CLOSES_P = new Set(['address', 'article', 'blockquote', 'center', 'div', 'dl', 'fieldset', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'ol', 'p', 'pre', 'section', 'table', 'ul']);

const NOT_YET = 'chưa hỗ trợ ở bản này';
const ENTITY_REASON = 'có phần do entity (&…;) sinh ra — dùng chung cho nhiều mẫu, sửa trong XML';

// ─── Dòng HTML ────────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} clearText văn bản ĐÃ bung entity
 * @param {Array} segments bản đồ đoạn của `expandEntities`
 * @returns {{ok:true, actionId, body, html:string, pieces:Array, parts:Array, segments:Array}
 *          |{ok:false, reason:string}}
 */
export function buildMailView(clearText, segments, { actionId, body }) {
  let html = '';
  const pieces = [];
  const parts = [];

  const pushCdata = (part, from, to) => {
    let s = from;
    while (s < to) {
      const seg = segmentAt(segments, s);
      const e = seg ? Math.min(to, seg.end) : to;
      pieces.push({
        part, kind: 'cdata', htmlStart: html.length, htmlEnd: html.length + (e - s), clearStart: s, clearEnd: e,
        file: seg ? seg.file : null, fromEntity: !!(seg && seg.ref),
      });
      html += clearText.slice(s, e);
      s = e;
    }
  };
  const pushText = (part, from, to) => {
    const seg = segmentAt(segments, from);
    const decoded = decodeXmlText(clearText.slice(from, to));
    pieces.push({
      part, kind: 'text', htmlStart: html.length, htmlEnd: html.length + decoded.length, clearStart: from, clearEnd: to,
      file: seg ? seg.file : null, fromEntity: !!(seg && seg.ref),
    });
    html += decoded;
  };

  for (const part of MAIL_PARTS) {
    const loc = locateMailText(clearText, { actionId, body, section: part });
    if (!loc) continue;
    const htmlStart = html.length;
    let i = loc.start;
    while (i < loc.end) {
      const cd = clearText.indexOf('<![CDATA[', i);
      const textEnd = cd === -1 || cd >= loc.end ? loc.end : cd;
      if (textEnd > i) pushText(part, i, textEnd);
      if (textEnd === loc.end) break;
      const contentStart = cd + 9;
      const close = clearText.indexOf(']]>', contentStart);
      const contentEnd = close === -1 || close > loc.end ? loc.end : close;
      if (contentEnd > contentStart) pushCdata(part, contentStart, contentEnd);
      i = contentEnd + 3;
    }
    parts.push({ part, htmlStart, htmlEnd: html.length });
  }

  if (parts.length === 0) {
    return { ok: false, reason: `"${actionId}" · <${body}> không có header/detail/footer nào có <text>.` };
  }
  return {
    ok: true, actionId, body, html, pieces, parts, segments,
  };
}

/** Part chứa vị trí `h` của dòng HTML. */
export function partAt(view, h) {
  const hit = view.parts.find((p) => h >= p.htmlStart && h < p.htmlEnd);
  return (hit ?? view.parts[view.parts.length - 1]).part;
}

/** Dải KHÔNG RỖNG `[hs, he)` của dòng HTML → dải clearText, chỉ khi nằm trọn trong MỘT mảnh cdata. */
export function cdataRange(view, hs, he) {
  const p = view.pieces.find((x) => x.kind === 'cdata' && hs >= x.htmlStart && he <= x.htmlEnd);
  return p ? { start: p.clearStart + (hs - p.htmlStart), end: p.clearStart + (he - p.htmlStart) } : null;
}

/**
 * Điểm chèn `h` → offset clearText. `bias` chọn mảnh khi `h` đúng ở biên hai mảnh: `left` bám ký
 * tự ĐỨNG TRƯỚC (chèn ngay sau `>` của thẻ mở), `right` bám ký tự ĐỨNG SAU. Cùng giá trị đi kèm
 * edit để `mapMailEdits` chọn đúng đoạn nguồn.
 *
 * @returns {{offset:number, bias:'left'|'right'}|null}
 */
export function cdataPoint(view, h, bias = 'left') {
  const tries = bias === 'left' ? ['left', 'right'] : ['right', 'left'];
  for (const b of tries) {
    const p = view.pieces.find((x) => x.kind === 'cdata'
      && (b === 'left' ? h > x.htmlStart && h <= x.htmlEnd : h >= x.htmlStart && h < x.htmlEnd));
    if (p) return { offset: p.clearStart + (h - p.htmlStart), bias: b };
  }
  return null;
}

// ─── Tokenizer + chỉ mục phần tử ──────────────────────────────────────────────────────────────

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Thuộc tính của thẻ mở trong `[from, to)` — toạ độ tuyệt đối trên dòng HTML. */
function parseAttributes(html, from, to) {
  const out = [];
  const src = html.slice(from, to);
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(src)) !== null) {
    const start = from + m.index;
    const end = start + m[0].length;
    let value = null;
    let quote = null;
    let valueStart = null;
    if (m[2] !== undefined) { value = m[2]; quote = '"'; valueStart = end - 1 - value.length; }
    else if (m[3] !== undefined) { value = m[3]; quote = "'"; valueStart = end - 1 - value.length; }
    else if (m[4] !== undefined) { value = m[4]; valueStart = end - value.length; }
    out.push({
      name: m[1].toLowerCase(), value, quote, start, end, valueStart, valueEnd: valueStart === null ? null : valueStart + value.length,
    });
  }
  return out;
}

/**
 * @returns {{elements: Array<object>, byId: Map<string, object>, warnings: string[]}}
 */
export function indexMailElements(view) {
  const { html } = view;
  const lower = html.toLowerCase();
  const elements = [];
  const warnings = [];
  const stack = [];
  const top = () => stack[stack.length - 1];
  const closeImplicit = (el, at) => { el.closeStart = at; el.closeEnd = at; el.explicitClose = false; };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      const e = html.indexOf('-->', lt + 4);
      i = e === -1 ? html.length : e + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const e = html.indexOf('>', lt);
      i = e === -1 ? html.length : e + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w:.-]*)\s*>/.exec(html.slice(lt, lt + 128));
      if (!m) { i = lt + 1; continue; }
      const name = m[1].toLowerCase();
      const end = lt + m[0].length;
      let k = stack.length - 1;
      while (k >= 0 && stack[k].tag !== name) k--;
      if (k === -1) warnings.push(`thẻ đóng </${name}> không có thẻ mở tương ứng — bỏ qua`);
      else {
        while (stack.length > k + 1) closeImplicit(stack.pop(), lt);
        const el = stack.pop();
        el.closeStart = lt;
        el.closeEnd = end;
        el.explicitClose = true;
      }
      i = end;
      continue;
    }

    const nm = /^<([a-zA-Z][\w:.-]*)/.exec(html.slice(lt, lt + 128));
    if (!nm) { i = lt + 1; continue; }
    const tag = nm[1].toLowerCase();
    let j = lt + nm[0].length;
    let q = null;
    for (; j < html.length; j++) {
      const c = html[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
    }
    if (j >= html.length) {
      warnings.push(`thẻ <${tag}> không có dấu ">" kết thúc — dừng quét`);
      break;
    }
    const openEnd = j + 1;
    const selfClosing = html[j - 1] === '/';

    if ((tag === 'td' || tag === 'th') && top() && (top().tag === 'td' || top().tag === 'th')) closeImplicit(stack.pop(), lt);
    if (tag === 'tr') {
      if (top() && (top().tag === 'td' || top().tag === 'th')) closeImplicit(stack.pop(), lt);
      if (top() && top().tag === 'tr') closeImplicit(stack.pop(), lt);
    }
    if (tag === 'li' && top() && top().tag === 'li') closeImplicit(stack.pop(), lt);
    if (CLOSES_P.has(tag) && top() && top().tag === 'p') closeImplicit(stack.pop(), lt);

    // Điểm chèn thuộc tính mới: ngay sau ký tự không trắng cuối cùng trước `/>` hoặc `>`.
    let insertAt = selfClosing ? j - 1 : j;
    while (insertAt > lt + nm[0].length && /\s/.test(html[insertAt - 1])) insertAt--;

    const parent = top() ?? null;
    const el = {
      id: formatElementId(elements.length + 1),
      tag,
      parentId: parent ? parent.id : null,
      children: [],
      openStart: lt,
      openEnd,
      insertAt,
      closeStart: null,
      closeEnd: null,
      explicitClose: false,
      void: false,
      attrs: parseAttributes(html, lt + nm[0].length, selfClosing ? j - 1 : j),
    };
    if (parent) parent.children.push(el.id);
    elements.push(el);

    if (VOID.has(tag) || selfClosing) {
      el.void = true;
      el.closeStart = openEnd;
      el.closeEnd = openEnd;
      el.explicitClose = true;
      i = openEnd;
      continue;
    }
    if (RAW_TEXT.has(tag)) {
      const c = lower.indexOf(`</${tag}`, openEnd);
      if (c === -1) {
        warnings.push(`<${tag}> (${el.id}) không có thẻ đóng`);
        i = html.length;
        continue;
      }
      const ce = html.indexOf('>', c);
      el.closeStart = c;
      el.closeEnd = ce === -1 ? html.length : ce + 1;
      el.explicitClose = true;
      i = el.closeEnd;
      continue;
    }
    stack.push(el);
    i = openEnd;
  }
  for (const el of stack) warnings.push(`<${el.tag}> (${el.id}) không có thẻ đóng`);

  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const el of elements) {
    el.part = partAt(view, el.openStart);
    el.openTag = html.slice(el.openStart, el.openEnd);
    el.fingerprint = elementFingerprint({ part: el.part, tag: el.tag, openTag: el.openTag });
    const parent = el.parentId ? byId.get(el.parentId) : null;
    let role = roleOfTag(el.tag);
    const closePart = el.closeEnd === null ? null : partAt(view, Math.max(el.openStart, el.closeEnd - 1));
    if (!el.void && (el.closeEnd === null || closePart !== el.part)) role = ELEMENT_ROLES.FRAME;
    else if (el.tag === 'table' && parent && ['td', 'th', 'div', 'center'].includes(parent.tag)) role = ELEMENT_ROLES.BLOCK;
    el.role = role;
  }
  for (const el of elements) {
    el.caps = {
      setText: textCapability(view, el),
      setStyle: styleCapability(view, el),
      setAttr: attrCapability(el),
      removeElement: NOT_YET,
      moveElement: NOT_YET,
      insertComponent: NOT_YET,
    };
    el.attrLocks = el.caps.setAttr === true ? attributeLocks(view, el) : {};
    el.kind = componentKindOf({
      tag: el.tag,
      role: el.role,
      childCount: el.children.length,
      style: styleMapOf(el),
      attrs: new Map(el.attrs.filter((a) => a.value !== null).map((a) => [a.name, a.value])),
      text: visibleText(html, el),
    });
  }
  return { elements, byId, warnings };
}

/** Khai báo style của phần tử thành bảng tên → giá trị (khai báo sau đè khai báo trước, như CSS). */
function styleMapOf(el) {
  const style = el.attrs.find((a) => a.name === 'style');
  return new Map(parseStyleDeclarations(style?.value ?? '').map((d) => [d.property, d.value]));
}

/** Chữ HIỆN RA của nội dung (bỏ thẻ, giải `&nbsp;`) — dùng để nhận ra khối rỗng. */
function visibleText(html, el) {
  if (el.void || el.closeStart === null) return '';
  return decodeMailText(html.slice(el.openEnd, el.closeStart).replace(/<!--[\s\S]*?-->|<[^>]*>/g, ''));
}

function attrCapability(el) {
  if (el.role === ELEMENT_ROLES.FRAME) return 'khung tài liệu — không sửa thuộc tính';
  if (!ATTRIBUTES[el.tag]) return `thẻ <${el.tag}> không có thuộc tính HTML nào cho sửa`;
  return true;
}

/**
 * Thuộc tính nào của thẻ KHÔNG sửa được, kèm lý do. Có sẵn mà nằm ngoài một mảnh cdata (entity
 * chen giữa), hoặc chưa có mà thẻ mở không có điểm chèn trong cdata — cả hai đều là ghi vào phần
 * do entity dùng chung sinh ra.
 */
function attributeLocks(view, el) {
  const locks = {};
  const canInsert = !!cdataPoint(view, el.insertAt, 'left');
  for (const name of ATTRIBUTES[el.tag] ?? []) {
    const attr = el.attrs.find((a) => a.name === name);
    if (attr) {
      if (!cdataRange(view, attr.start, attr.end)) locks[name] = `thuộc tính ${name} ${ENTITY_REASON}`;
    } else if (!canInsert) {
      locks[name] = `thẻ mở ${ENTITY_REASON}`;
    }
  }
  return locks;
}

/** Khoảng trắng ASCII đầu/cuối của nội dung — giữ nguyên khi ghi, để thụt lề của file không đổi. */
export function textBounds(raw) {
  const lead = /^[ \t\r\n]*/.exec(raw)[0].length;
  const trail = lead === raw.length ? 0 : /[ \t\r\n]*$/.exec(raw)[0].length;
  return { lead, trail };
}

const NBSP = String.fromCharCode(160);

/** Chữ HTML → chữ hiện cho người sửa. Chỉ giải những tham chiếu mail thật dùng; còn lại giữ nguyên văn. */
export function decodeMailText(raw) {
  return String(raw).replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi, (m, n) => {
    const k = n.toLowerCase();
    if (k === 'nbsp') return NBSP;
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos' || k === '#39') return "'";
    const code = k[1] === 'x' ? Number.parseInt(k.slice(2), 16) : Number.parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

function textCapability(view, el) {
  if (el.role === ELEMENT_ROLES.FRAME) return 'khung tài liệu (html/head/body, hoặc mở và đóng ở hai part khác nhau) — không sửa chữ';
  if (el.void) return 'thẻ rỗng, không có chữ';
  if (!el.explicitClose) return 'thẻ không đóng tường minh — sửa trong XML';
  if (el.role === ELEMENT_ROLES.STRUCTURE && el.tag !== 'td' && el.tag !== 'th') return 'chỉ sửa chữ được ở ô <td>/<th>';
  if (el.children.length > 0) return 'có phần tử con — chọn phần tử con để sửa chữ';
  const hs = el.openEnd;
  const he = el.closeStart;
  const ok = hs === he ? cdataPoint(view, hs, 'left') : cdataRange(view, hs, he);
  return ok ? true : `nội dung ${ENTITY_REASON}`;
}

function styleCapability(view, el) {
  if (el.role === ELEMENT_ROLES.FRAME) return 'khung tài liệu — không sửa style';
  const style = el.attrs.find((a) => a.name === 'style');
  if (style) {
    if (style.valueStart === null) return 'thuộc tính style không có giá trị — sửa trong XML';
    if (style.quote === null) return 'style không có dấu nháy — sửa trong XML';
    return cdataRange(view, style.start, style.end) ? true : `thuộc tính style ${ENTITY_REASON}`;
  }
  return cdataPoint(view, el.insertAt, 'left') ? true : `thẻ mở ${ENTITY_REASON}`;
}

// ─── Style inline ─────────────────────────────────────────────────────────────────────────────

/**
 * Khai báo trong một chuỗi `style` — tách ở `;` NGOÀI ngoặc và ngoài nháy (`url(data:…;base64)`
 * có `;` bên trong). Toạ độ tương đối trong chuỗi.
 *
 * @returns {Array<{property:string, value:string, start:number, end:number, semicolon:boolean,
 *                  valueStart:number, valueEnd:number}>}
 */
export function parseStyleDeclarations(text) {
  const out = [];
  const src = String(text ?? '');
  let depth = 0;
  let q = null;
  let segStart = 0;
  const flush = (end, semicolon) => {
    const raw = src.slice(segStart, end);
    const colon = raw.indexOf(':');
    if (raw.trim() !== '' && colon !== -1) {
      const afterColon = segStart + colon + 1;
      const valueRaw = src.slice(afterColon, end);
      const lead = valueRaw.length - valueRaw.trimStart().length;
      const trimmed = valueRaw.trim();
      out.push({
        property: raw.slice(0, colon).trim().toLowerCase(),
        value: trimmed,
        start: segStart,
        end,
        semicolon,
        valueStart: afterColon + lead,
        valueEnd: afterColon + lead + trimmed.length,
      });
    }
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ';' && depth === 0) { flush(i, true); segStart = i + 1; }
  }
  flush(src.length, false);
  return out;
}

// ─── Bản vẽ cho webview ───────────────────────────────────────────────────────────────────────

const DROP_ELEMENT = new Set(['script', 'iframe', 'object', 'embed', 'applet', 'frame', 'frameset', 'noscript', 'base', 'link']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'background', 'poster', 'xlink:href', 'lowsrc', 'dynsrc']);

/** Scheme chạy được mã — giải tham chiếu ký tự và bỏ khoảng trắng TRƯỚC khi đọc, như trình duyệt. */
function dangerousUrl(value) {
  const plain = decodeXmlText(String(value ?? '')).replace(/&(colon|tab|newline);/gi, (_, n) => (n.toLowerCase() === 'colon' ? ':' : ''));
  const compact = [...plain].filter((c) => c.charCodeAt(0) > 32).join('').toLowerCase();
  if (compact.startsWith('data:image/')) return false;
  return /^(javascript|vbscript|data|livescript):/.test(compact);
}

/**
 * HTML gửi sang webview: BẢN SAO đã làm sạch, mỗi phần tử mang `data-fbo-el`, `{!h_…}` thay bằng
 * nhãn như «Xem mail». Nguồn không bị đụng — mọi thay đổi ở đây chỉ sống trong chuỗi trả về.
 */
export function renderMailDesign(view, index, { labels = new Map(), vi = true } = {}) {
  const { html } = view;
  const patches = [];
  const dropped = [];

  for (const el of index.elements) {
    const isRefresh = el.tag === 'meta' && el.attrs.some((a) => a.name === 'http-equiv' && /refresh/i.test(a.value ?? ''));
    if (DROP_ELEMENT.has(el.tag) || isRefresh) {
      const end = el.closeEnd ?? el.openEnd;
      patches.push({ start: el.openStart, end, text: '' });
      dropped.push([el.openStart, end]);
      continue;
    }
    if (el.tag === 'form') {
      patches.push({ start: el.openStart, end: el.openEnd, text: '<div>' });
      if (el.explicitClose && el.closeEnd > el.closeStart) patches.push({ start: el.closeStart, end: el.closeEnd, text: '</div>' });
      continue;
    }
    for (const a of el.attrs) {
      if (a.name.startsWith('on') || a.name === 'srcdoc' || a.name.startsWith('data-fbo-')) {
        let s = a.start;
        while (s > el.openStart && /\s/.test(html[s - 1])) s--;
        patches.push({ start: s, end: a.end, text: '' });
      } else if (URL_ATTRS.has(a.name) && a.valueStart !== null && dangerousUrl(a.value)) {
        patches.push({ start: a.valueStart, end: a.valueEnd, text: '#' });
      }
    }
    patches.push({ start: el.insertAt, end: el.insertAt, text: ` ${DESIGN_ATTR}="${el.id}"` });
  }

  const inside = (p) => dropped.some(([s, e]) => p.start >= s && p.end <= e && !(p.start === s && p.end === e));
  const live = patches.filter((p) => !inside(p));
  // Áp từ CUỐI lên đầu; cùng điểm bắt đầu thì phép CHÈN (rỗng) đi trước phép xoá kết thúc tại đó.
  live.sort((a, b) => (b.start - a.start) || ((a.end - a.start) - (b.end - b.start)));
  let out = html;
  for (const p of live) out = out.slice(0, p.start) + p.text + out.slice(p.end);
  return substituteFieldTokens(out, labels, vi);
}

/** Phần tử theo hình dạng `MailElementWire` — không một mốc toạ độ nào đi sang webview. */
export function wireMailElements(view, index) {
  return index.elements.map((el) => {
    const style = el.attrs.find((a) => a.name === 'style');
    const allowed = ATTRIBUTES[el.tag] ?? [];
    const attrs = {};
    for (const a of el.attrs) if (allowed.includes(a.name) && a.value !== null) attrs[a.name] = a.value;
    let text = null;
    if (el.caps.setText === true) {
      const raw = view.html.slice(el.openEnd, el.closeStart);
      const { lead, trail } = textBounds(raw);
      text = decodeMailText(raw.slice(lead, raw.length - trail));
    }
    return {
      id: el.id,
      tag: el.tag,
      role: el.role,
      part: el.part,
      parentId: el.parentId,
      caps: el.caps,
      kind: el.kind,
      attrNames: allowed,
      attrLocks: el.attrLocks,
      style: parseStyleDeclarations(style?.value ?? '').map((d) => [d.property, d.value]),
      attrs,
      text,
    };
  });
}

// ─── Về nguồn ─────────────────────────────────────────────────────────────────────────────────

/**
 * Edit theo toạ độ clearText → edit theo file nguồn.
 *
 * Thay (`start < end`): phải nằm trong MỘT đoạn — một dải đi qua ranh giới entity/Include không
 * quy về một dải liền của một file. Chèn: `bias` chọn đoạn đứng trước hay sau điểm chèn.
 *
 * Khác `sourceRange` có chủ ý: hàm ấy phục vụ ĐI TỚI và đệm tối thiểu 1 ký tự — đệm như vậy ở
 * một phép ghi là ăn mất một ký tự của file (bẫy «Xem mail» đã gặp).
 *
 * @returns {{ok:true, edits:Array<{file,start,end,text}>}|{ok:false, reason:string}}
 */
export function mapMailEdits(segments, edits) {
  const out = [];
  for (const e of edits) {
    if (e.start === e.end) {
      const probe = e.bias === 'left' && e.start > 0 ? e.start - 1 : e.start;
      const seg = segmentAt(segments, probe);
      if (!seg) return { ok: false, reason: 'không quy được điểm chèn về file nguồn' };
      const at = seg.sourceStart + (e.start - seg.start);
      out.push({ file: seg.file, start: at, end: at, text: e.text });
      continue;
    }
    const seg = segmentAt(segments, e.start);
    if (!seg || e.end > seg.end) {
      return { ok: false, reason: 'dải sửa đi qua ranh giới entity/Include — không quy về một file nguồn được' };
    }
    out.push({
      file: seg.file, start: seg.sourceStart + (e.start - seg.start), end: seg.sourceStart + (e.end - seg.start), text: e.text,
    });
  }
  return { ok: true, edits: out };
}

/** Dải clearText của THẺ MỞ một phần tử — cho «đi tới XML». Mảnh `text` thì lấy trọn mảnh. */
export function mailElementClearRange(view, el) {
  const at = (h, left) => {
    const p = view.pieces.find((x) => (left ? h > x.htmlStart && h <= x.htmlEnd : h >= x.htmlStart && h < x.htmlEnd));
    if (!p) return null;
    if (p.kind === 'cdata') return p.clearStart + (h - p.htmlStart);
    return left ? p.clearEnd : p.clearStart;
  };
  const start = at(el.openStart, false);
  const end = at(el.openEnd, true);
  return start === null || end === null ? null : { start, end: Math.max(start, end) };
}

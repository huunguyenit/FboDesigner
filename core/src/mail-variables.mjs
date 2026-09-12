// mail-variables.mjs — biến `{!tên}` của mẫu mail: quét, gom, dữ liệu mẫu, và cách hiện trên bản vẽ.
//
// Luật của Message.xml (xem `mail-template.mjs#substituteFieldTokens`): `{!tên}` khai trong
// `<fields><field name><header v e>` là NHÃN — runtime thay bằng chữ của header; mọi `{!tên}` khác là
// DỮ LIỆU — runtime thay bằng cột của câu query lúc gửi. Tên chỉ gồm chữ/số/gạch dưới, không có
// đường dẫn `a.b` — dữ liệu mẫu vì thế là object PHẲNG, cộng `detail: [...]` cho dòng lặp.
//
// NHƯNG luật nhãn CÓ VÙNG: chỉ `<header>`/`<footer>` mới đọc `<fields>`; trong `<detail>` thì cùng một
// tên là GIÁ TRỊ của dòng. Mẫu thật dùng đúng cặp đó — `{!so_luong}` ở header là tiêu đề cột "Số lượng",
// ở detail là số lượng của từng dòng (corpus FBISP24: 22 chỗ, vd PurchaseRequisition/body `{!so_luong}`,
// `{!sl_duyet}`). Không phân vùng thì bản vẽ hiện tiêu đề cột nằm giữa dòng dữ liệu.
//
// Mọi thứ ở đây chỉ đổi BẢN VẼ. Nguồn giữ nguyên `{!tên}`; dữ liệu mẫu sống ở workspace state của
// VS Code (tầng vỏ), không bao giờ vào Message.xml.

import { PREVIEW_MODES } from './mail-design-contract.mjs';

const TOKEN_RE = /\{!([A-Za-z_]\w*)\}/g;
const NAME_RE = /^[A-Za-z_]\w*$/;
/** Nội dung của các thẻ này là chữ thô (CSS, tiêu đề) — không chèn chip HTML vào được. */
const RAW_TEXT = new Set(['style', 'title', 'script', 'textarea']);
export const MAX_SAMPLE_ROWS = 50;

const bad = (reason) => ({ ok: false, reason });

function partAtHtml(view, h) {
  const hit = view.parts.find((p) => h >= p.htmlStart && h < p.htmlEnd);
  return (hit ?? view.parts[view.parts.length - 1]).part;
}

/**
 * Mọi token trong dòng HTML kèm NGỮ CẢNH — quyết định bản vẽ được thay nó bằng gì:
 *   text  chữ hiện ra → chip HTML hoặc chữ đã escape
 *   attr  bên trong thẻ mở (`href="{!alink}"`, `style="display:{!slink}"`) → chỉ chữ, KHÔNG chip
 *   raw   trong `<style>`/`<title>` → chỉ chữ không mang `<>`
 *
 * @returns {Array<{name:string, start:number, end:number, context:'text'|'attr'|'raw', part:string}>}
 */
export function scanMailTokens(view, index) {
  const { html } = view;
  const tags = index.elements; // đã theo thứ tự thẻ mở
  const raws = tags.filter((e) => RAW_TEXT.has(e.tag) && e.closeStart !== null);
  const out = [];
  let k = -1;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(html)) !== null) {
    const start = m.index;
    while (k + 1 < tags.length && tags[k + 1].openStart <= start) k++;
    // Thẻ mở không lồng nhau: token nằm trong thẻ mở gần nhất đứng trước nó, hoặc không nằm trong thẻ nào.
    const owner = k >= 0 ? tags[k] : null;
    let context = 'text';
    if (owner && start < owner.openEnd) context = 'attr';
    else if (raws.some((r) => start >= r.openEnd && start < r.closeStart)) context = 'raw';
    out.push({
      name: m[1], start, end: start + m[0].length, context, part: partAtHtml(view, start),
    });
  }
  return out;
}

/**
 * Vai của MỘT lần xuất hiện: nhãn khai trong `<fields>` chỉ có tác dụng ngoài `<detail>` (xem luật ở
 * đầu file).
 */
export function mailTokenKind(name, part, labels) {
  return part !== 'detail' && labels.has(name) ? 'label' : 'data';
}

/**
 * Biến của (action, body) đang vẽ, theo thứ tự xuất hiện đầu tiên. `kind: 'label'` khi tên khai trong
 * `<fields>` VÀ đứng ngoài `<detail>`, `'data'` khi không — nên một tên có mặt ở cả hai vùng cho HAI
 * mục: nhãn ở header, dữ liệu ở detail.
 */
export function mailVariables(view, index, labels = new Map()) {
  const byName = new Map();
  for (const t of scanMailTokens(view, index)) {
    const kind = mailTokenKind(t.name, t.part, labels);
    const key = `${t.name}|${kind}`;
    let v = byName.get(key);
    if (!v) {
      v = {
        name: t.name, kind, label: kind === 'label' ? (labels.get(t.name) ?? null) : null, count: 0, contexts: [], parts: [],
      };
      byName.set(key, v);
    }
    v.count++;
    if (!v.contexts.includes(t.context)) v.contexts.push(t.context);
    if (!v.parts.includes(t.part)) v.parts.push(t.part);
  }
  return [...byName.values()];
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/**
 * Đọc JSON dữ liệu mẫu người dùng gõ. Hình dạng:
 *
 *   { "so_ct": "PN0001", "t_tien": 12500000, "detail": [ { "ma_vt": "VT01" }, … ] }
 *
 * Chuỗi rỗng = xoá dữ liệu mẫu. Giá trị chỉ là vô hướng — một object lồng không có `{!tên}` nào trỏ
 * tới được, nhận vào là để người dùng tin rằng nó đang được dùng.
 *
 * @returns {{ok:true, data:object}|{ok:false, reason:string}}
 */
export function parseMailSample(text) {
  if (typeof text !== 'string') return bad('dữ liệu mẫu phải là chuỗi JSON');
  if (text.trim() === '') return { ok: true, data: {} };
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return bad(`JSON không hợp lệ: ${err.message}`);
  }
  if (!isPlainObject(data)) return bad('dữ liệu mẫu phải là một object { "tên_biến": giá trị }');
  for (const [key, value] of Object.entries(data)) {
    if (key === 'detail') {
      if (!Array.isArray(value)) return bad('"detail" phải là mảng các dòng { "tên_biến": giá trị }');
      if (value.length > MAX_SAMPLE_ROWS) return bad(`"detail" tối đa ${MAX_SAMPLE_ROWS} dòng`);
      for (const [i, row] of value.entries()) {
        if (!isPlainObject(row)) return bad(`detail[${i}] phải là object`);
        for (const [name, cell] of Object.entries(row)) {
          if (!NAME_RE.test(name)) return bad(`tên biến không hợp lệ: detail[${i}]."${name}"`);
          if (!isScalar(cell)) return bad(`detail[${i}].${name} phải là chuỗi, số, true/false hoặc null`);
        }
      }
      continue;
    }
    if (!NAME_RE.test(key)) return bad(`tên biến không hợp lệ: "${key}" — chỉ chữ, số, gạch dưới (như {!so_ct})`);
    if (!isScalar(value)) return bad(`"${key}" phải là chuỗi, số, true/false hoặc null`);
  }
  return { ok: true, data };
}

/**
 * Giá trị mẫu thành chữ hiện ra. Số có dấu phân nhóm nghìn (`12500000` → `12,500,000`) — mail không
 * mang mặt nạ định dạng của field như Dir/Grid, nên đây là quy ước của bản xem, không phải của runtime.
 */
export function formatSampleScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  return String(value);
}

/**
 * Giá trị mẫu của một biến tại một part. Token nằm trong `<detail>` đọc dòng ĐẦU của `detail` trước —
 * bản vẽ designer chỉ có một dòng mẫu (nhân dòng là nhân id phần tử, khung chọn sẽ không biết trỏ vào
 * bản nào) — rồi mới rơi về giá trị ngoài cùng.
 *
 * @returns {string|null} `null` khi dữ liệu mẫu không có biến này
 */
export function sampleValueOf(sample, name, part, row = 0) {
  if (!isPlainObject(sample)) return null;
  // `row` > 0 chỉ bản xem trước đầy đủ dùng (`renderMailFullPreview` nhân dòng mẫu theo từng dòng).
  const detail = Array.isArray(sample.detail) ? sample.detail[row] : undefined;
  if (part === 'detail' && isPlainObject(detail) && Object.hasOwn(detail, name)) {
    return formatSampleScalar(detail[name]);
  }
  if (name !== 'detail' && Object.hasOwn(sample, name)) return formatSampleScalar(sample[name]);
  return null;
}

/** Khung dữ liệu mẫu rỗng dựng từ biến DỮ LIỆU: biến chỉ nằm trong `<detail>` vào `detail[0]`. */
export function sampleSkeleton(variables) {
  const top = {};
  const row = {};
  for (const v of variables) {
    if (v.kind !== 'data') continue;
    if (v.parts.length === 1 && v.parts[0] === 'detail') row[v.name] = '';
    else top[v.name] = '';
  }
  return Object.keys(row).length > 0 ? { ...top, detail: [row] } : top;
}

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

/** Chip chỉ sống trong iframe của bản vẽ — style inline vì CSS của trang designer không vào được iframe. */
const CHIP_STYLE = 'display:inline-block;padding:0 4px;margin:0 1px;border:1px solid #9cc0f5;border-radius:3px;'
  + 'background:#eaf2ff;color:#0a4fa3;font-size:0.92em;line-height:1.35;white-space:nowrap;';

/**
 * Patch cho bản vẽ (`renderMailDesign` áp cùng các patch làm sạch): mỗi token thay bằng chữ đã
 * escape hoặc chip `<span data-fbo-var>`. Chip KHÔNG mang `data-fbo-el` — bấm vào chip là chọn phần tử
 * chứa nó.
 *
 * Chữ thay thế theo thứ tự runtime: nhãn khai trong `<fields>` trước, giá trị mẫu sau (chế độ `sample`).
 */
export function tokenPatches(view, index, {
  labels = new Map(), vi = true, mode = 'label', sample = null, detailRow = 0, markers = true,
} = {}) {
  const m = PREVIEW_MODES.includes(mode) ? mode : 'label';
  const patches = [];
  for (const [i, t] of scanMailTokens(view, index).entries()) {
    const kind = mailTokenKind(t.name, t.part, labels);
    const label = kind === 'label' ? labels.get(t.name) : null;
    const labelText = label ? ((vi ? (label.v || label.e) : (label.e || label.v)) || null) : null;
    const value = m === 'sample' ? sampleValueOf(sample, t.name, t.part, detailRow) : null;
    const resolved = m === 'token' ? null : (labelText ?? value);
    // Dấu token: bấm vào CHỮ ĐÃ THAY trên bản vẽ vẫn phải trỏ về đúng `{!tên}` trong XML chứ không phải
    // thẻ chứa nó. Bản xem trước đầy đủ không mang dấu — nó là bản mail thật, không phải bản vẽ.
    const head = markers ? `<span data-fbo-var="${t.name}" data-fbo-tok="${i}"` : `<span data-fbo-var="${t.name}"`;

    if (t.context === 'text') {
      if (resolved !== null) {
        patches.push({ start: t.start, end: t.end, text: markers ? `${head}>${escText(resolved)}</span>` : escText(resolved) });
      } else {
        const note = labelText ? ` — ${labelText}` : (m === 'sample' ? ' — chưa có trong dữ liệu mẫu' : ' — dữ liệu lúc gửi');
        patches.push({
          start: t.start,
          end: t.end,
          text: `${head} title="${escAttr(`{!${t.name}}${note}`)}" style="${CHIP_STYLE}">{!${t.name}}</span>`,
        });
      }
    } else if (resolved !== null) {
      const text = t.context === 'attr' ? escAttr(resolved) : (/[<>]/.test(resolved) ? null : resolved);
      if (text !== null) patches.push({ start: t.start, end: t.end, text });
    }
  }
  return patches;
}

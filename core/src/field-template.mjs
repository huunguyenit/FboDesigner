// field-template.mjs — khai báo `<field>` cho một control MỚI.
//
// Form nhập (basic / advanced) khai hết trong `core/config/fields.json`:
//   dialog.modes · dialog.groups · attrs · types · styles · softDefaults
// Sửa JSON là đổi dialog / thuộc tính sinh XML — không cần đụng code dựng form.

import { msg, FIELDS_CONFIG } from './msg.mjs';

/** Type hay dùng (và bản advanced mở rộng) — từ `fields.json`. */
export const FIELD_TYPES = Object.freeze([...(FIELDS_CONFIG.types || [])]);

/** `items@style` — từ `fields.json`. */
export const FIELD_STYLES = Object.freeze([...(FIELDS_CONFIG.styles || [])]);

/** @deprecated giữ tên cũ cho chỗ còn import — map về type/style preset trong JSON nếu còn. */
export const FIELD_KINDS = Object.freeze((FIELDS_CONFIG.kinds || []).map((k) => ({
  id: k.id,
  label: k.label,
  detail: k.detail,
  attrs: { ...(k.attrs || {}) },
  items: k.items ?? null,
  ...(k.labelAfter ? { labelAfter: true } : {}),
})));

const NAME_RE = new RegExp(FIELDS_CONFIG.namePattern);
const ATTRS = FIELDS_CONFIG.attrs || {};
const DIALOG = FIELDS_CONFIG.dialog || {};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

const TYPE_SET = new Set(FIELD_TYPES.map((t) => t.toLowerCase()));

/** Tên field FBO: chữ thường không dấu, số, `_`. `%l` cuối là field ngoại — vẫn cho qua. */
export function isValidFieldName(name) {
  return NAME_RE.test(String(name ?? '').trim());
}

function resolveOptions(attr) {
  if (Array.isArray(attr.options)) return attr.options;
  const key = attr.optionsKey;
  if (!key) return [];
  const raw = FIELDS_CONFIG[key];
  if (!Array.isArray(raw)) return [];
  // `types` / `styles` / `formatOptions` là chuỗi thuần; `boolOptions` / `alignOptions` đã là {value,label}.
  let opts;
  if (raw.length > 0 && typeof raw[0] === 'string') {
    opts = raw.map((v) => ({ value: v, label: v }));
  } else {
    opts = raw.map((o) => ({
      value: o.value ?? '',
      label: o.labelKey ? (msg(o.labelKey) !== o.labelKey ? msg(o.labelKey) : (o.label ?? o.value)) : (o.label ?? o.value),
    }));
  }
  if (attr.allowEmpty) {
    const empty = resolveAttrText(attr, 'emptyLabel', 'emptyLabelKey', '(không)');
    return [{ value: '', label: empty }, ...opts];
  }
  return opts;
}

function resolveAttrText(attr, textProp, keyProp, fallback = '') {
  const key = attr?.[keyProp];
  if (key) {
    const translated = msg(key);
    if (translated && translated !== key) return translated;
  }
  if (attr?.[textProp]) return attr[textProp];
  return fallback;
}

function fieldItemFromAttr(id, attr) {
  if (!attr) return null;
  if (attr.control === 'header') {
    return {
      type: 'field-row',
      fields: [
        {
          type: 'field',
          name: 'header_v',
          label: resolveAttrText(attr, 'labelV', 'labelVKey', 'header v'),
          control: 'text',
          placeholder: resolveAttrText(attr, 'placeholder', 'placeholderKey', ''),
        },
        {
          type: 'field',
          name: 'header_e',
          label: resolveAttrText(attr, 'labelE', 'labelEKey', 'header e'),
          control: 'text',
          placeholder: resolveAttrText(attr, 'placeholder', 'placeholderKey', ''),
        },
      ],
    };
  }

  const item = {
    type: 'field',
    name: id,
    label: resolveAttrText(attr, 'label', 'labelKey', id),
    control: attr.control === 'select' ? 'select'
      : (attr.control === 'combobox' ? 'combobox' : 'text'),
    required: attr.required === true,
  };
  const placeholder = resolveAttrText(attr, 'placeholder', 'placeholderKey', '');
  if (placeholder) item.placeholder = placeholder;
  const hint = resolveAttrText(attr, 'hint', 'hintKey', '');
  if (hint) item.hint = hint;
  if (attr.value !== undefined) item.value = attr.value;
  if (item.control === 'select' || item.control === 'combobox') {
    item.options = resolveOptions(attr);
  }
  return item;
}

/**
 * Body hộp thoại «thêm control» — dựng từ `fields.json`.
 *
 * Basic: chỉ nhóm có mode basic (name + header [+ width lưới]).
 * Advanced: mọi nhóm; client ẩn/hiện theo mode-toggle.
 *
 * @param {{ context?: 'form'|'grid' }} [opts]
 * @returns {{ body: object[], size: string, defaultMode: string }}
 */
export function buildAddControlDialog(opts = {}) {
  const context = opts.context === 'grid' ? 'grid' : 'form';
  const defaultMode = DIALOG.defaultMode || 'basic';
  const modes = (Array.isArray(DIALOG.modes) ? DIALOG.modes : [
    { id: 'basic', label: 'Basic' },
    { id: 'advanced', label: 'Advanced' },
  ]).map((m) => ({
    id: m.id,
    label: resolveAttrText(m, 'label', 'labelKey', m.id),
  }));
  const groups = Array.isArray(DIALOG.groups) ? DIALOG.groups : [];

  const body = [
    {
      type: 'mode-toggle',
      name: '_mode',
      modes,
      value: defaultMode,
    },
  ];

  for (const group of groups) {
    const modeList = Array.isArray(group.modes) ? group.modes : ['advanced'];
    const fields = [];
    for (const attrId of group.attrs || []) {
      const attr = ATTRS[attrId];
      if (!attr) continue;
      if (attr.when && attr.when !== context) continue;
      const item = fieldItemFromAttr(attrId, attr);
      if (item) fields.push(item);
    }
    if (fields.length === 0) continue;
    body.push({
      type: 'group',
      id: group.id,
      label: resolveAttrText(group, 'label', 'labelKey', group.id),
      modes: modeList,
      fields,
    });
  }

  return {
    body,
    size: 'large',
    defaultMode,
  };
}

/**
 * Map `result.values` của dialog → spec cho `buildField`.
 * Bỏ `_mode` và chuỗi rỗng.
 */
export function valuesToFieldSpec(values, { context = 'form' } = {}) {
  const v = values && typeof values === 'object' ? values : {};
  const spec = {
    name: v.name,
    headerV: v.header_v,
    headerE: v.header_e,
  };
  for (const [id, attr] of Object.entries(ATTRS)) {
    if (id === 'name' || id === 'header') continue;
    if (attr.when && attr.when !== context) continue;
    const raw = v[id];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (s === '') continue;
    if (id === 'style') spec.style = s;
    else if (id === 'width') spec.width = s;
    else spec[id] = s;
  }
  return spec;
}

/** Áp softDefaults từ JSON — không ghi đè giá trị đã nhập. */
function applySoftDefaults(spec) {
  const out = { ...spec };
  const type = String(out.type || '').trim();
  const style = String(out.style || '').trim();
  const soft = FIELDS_CONFIG.softDefaults || {};

  const styleKey = Object.keys(soft.byStyle || {})
    .find((k) => k.toLowerCase() === style.toLowerCase());
  const byStyle = styleKey ? soft.byStyle[styleKey] : null;
  if (byStyle) {
    for (const [k, val] of Object.entries(byStyle)) {
      if (out[k] === undefined || out[k] === null || String(out[k]).trim() === '') out[k] = val;
    }
  }

  const typeKey = Object.keys(soft.byType || {})
    .find((k) => k.toLowerCase() === String(out.type || type).toLowerCase());
  const byType = typeKey ? soft.byType[typeKey] : null;
  if (byType) {
    for (const [k, val] of Object.entries(byType)) {
      if (k === 'labelAfter') {
        out.labelAfter = val === true;
        continue;
      }
      if (out[k] === undefined || out[k] === null || String(out[k]).trim() === '') out[k] = val;
    }
  }

  return out;
}

/**
 * Dựng khai báo `<field>` và danh sách token của control mới.
 *
 * Chữ ký mới: một object spec. Chữ ký cũ `buildField(kindId, name, label, labelEn, opts)`
 * vẫn nhận để test/chỗ cũ không vỡ ngay — chuyển nội bộ sang spec.
 *
 * @returns {{ok:true, xml:string, tokens:string[], name:string}|{ok:false, reason:string}}
 */
export function buildField(specOrKind, name, label, labelEn, opts = {}) {
  const spec = normalizeSpec(specOrKind, name, label, labelEn, opts);
  if (!spec.ok) return spec;

  const filled = applySoftDefaults(spec.value);
  const trimmed = String(filled.name ?? '').trim();
  if (!isValidFieldName(trimmed)) {
    return { ok: false, reason: msg('field.invalid_name', { name: trimmed }) };
  }

  const type = String(filled.type || '').trim();
  if (type && !TYPE_SET.has(type.toLowerCase())) {
    return { ok: false, reason: msg('field.unknown_type', { type }) };
  }

  const style = String(filled.style || '').trim();
  const typeCanon = type
    ? (FIELD_TYPES.find((t) => t.toLowerCase() === type.toLowerCase()) || type)
    : '';
  const styleCanon = style
    ? (FIELD_STYLES.find((s) => s.toLowerCase() === style.toLowerCase()) || style)
    : '';

  const v = String(filled.headerV ?? '').trim() || trimmed;
  const e = String(filled.headerE ?? '').trim() || v;

  const px = Number(filled.width);
  const widthAttr = Number.isFinite(px) && px >= 0 ? ` width="${Math.round(px)}"` : '';

  // Thuộc tính còn lại theo catalog `attrs.*.xml.place === 'attribute'` (trừ name/width đã xử lý).
  const skipAttr = new Set(['name', 'header', 'width', 'style', 'type']);
  const attrs = [];
  if (typeCanon) attrs.push(` type="${esc(typeCanon)}"`);

  for (const [id, def] of Object.entries(ATTRS)) {
    if (skipAttr.has(id)) continue;
    if (!def.xml || def.xml.place !== 'attribute') continue;
    const xmlName = def.xml.name || id;
    const raw = filled[id];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    attrs.push(` ${xmlName}="${esc(String(raw).trim())}"`);
  }

  // dataFormatString / align / … có thể đã nằm trong vòng trên; đảm bảo format từ softDefaults.
  // (vòng trên đã đọc filled[id] — đủ.)

  const inner = [`<header v="${esc(v)}" e="${esc(e)}"/>`];
  if (styleCanon) inner.push(`<items style="${esc(styleCanon)}"/>`);

  const open = `<field name="${esc(trimmed)}"${widthAttr}${attrs.join('')}>`;
  const xml = inner.length === 1
    ? `${open}${inner[0]}</field>`
    : [open, ...inner.map((t) => `  ${t}`), '</field>'].join('\n');

  const tokens = filled.labelAfter
    ? [`[${trimmed}]`, `[${trimmed}].Label`]
    : [`[${trimmed}].Label`, `[${trimmed}]`];

  return { ok: true, xml, tokens, name: trimmed };
}

/** Nhận object mới hoặc chữ ký cũ (kindId, name, label, …). */
function normalizeSpec(specOrKind, name, label, labelEn, opts) {
  if (specOrKind && typeof specOrKind === 'object' && !Array.isArray(specOrKind)) {
    return { ok: true, value: { ...specOrKind } };
  }

  const kindId = specOrKind;
  const kind = FIELD_KINDS.find((k) => k.id === kindId);
  if (!kind) return { ok: false, reason: msg('field.unknown_kind', { kindId }) };

  return {
    ok: true,
    value: {
      name,
      headerV: label,
      headerE: labelEn,
      type: kind.attrs.type || '',
      dataFormatString: kind.attrs.dataFormatString || '',
      style: kind.items || '',
      align: kind.attrs.align,
      clientDefault: kind.attrs.clientDefault,
      defaultValue: kind.attrs.defaultValue,
      labelAfter: kind.labelAfter === true,
      width: opts?.width,
    },
  };
}

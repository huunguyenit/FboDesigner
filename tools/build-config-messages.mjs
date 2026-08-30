#!/usr/bin/env node
/**
 * build-config-messages.mjs — dựng core/config/messages.json (phần core.*) từ source hiện tại
 * và in báo cáo. Không tự sửa source (để agent/StrReplace làm có kiểm soát).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PREFIX = {
  'edit.mjs': 'core.edit',
  'item-value.mjs': 'core.item',
  'columns.mjs': 'core.columns',
  'field-template.mjs': 'core.field',
  'filter-declare.mjs': 'core.filter',
  'add-column.mjs': 'core.addColumn',
  'entities.mjs': 'core.entity',
  'grid.mjs': 'core.grid',
  'render.mjs': 'core.render',
};

function slug(s) {
  const base = s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return base || 'msg';
}

function toTemplate(raw, templated) {
  if (!templated) return { template: raw, params: [] };
  const params = [];
  const template = raw.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    // only simple identifiers / member access → take last id
    const id = expr.trim().replace(/[^A-Za-z0-9_].*$/, '') || 'v';
    // prefer common names from expr
    let name = expr.trim();
    if (/^[A-Za-z_][\w.]*$/.test(name)) {
      name = name.includes('.') ? name.split('.').pop() : name;
    } else {
      name = `p${params.length}`;
    }
    // dedupe names
    let final = name;
    let n = 2;
    while (params.includes(final)) final = `${name}${n++}`;
    params.push({ name: final, expr: expr.trim() });
    return `{${final}}`;
  });
  return { template, params };
}

const messages = {};
const report = [];

for (const [file, prefix] of Object.entries(PREFIX)) {
  const text = fs.readFileSync(path.join(ROOT, 'core/src', file), 'utf8');
  const re = /(reason|message):\s*(?:'((?:\\'|[^'])*)'|`((?:\\`|[^`])*)`)/g;
  let m;
  const seenLocal = new Map();
  while ((m = re.exec(text))) {
    const kind = m[1];
    const templated = m[3] !== undefined;
    const raw = templated ? m[3] : m[2];
    const { template, params } = toTemplate(raw.replace(/\\'/g, "'").replace(/\\`/g, '`'), templated);
    const hash = crypto.createHash('sha1').update(template).digest('hex').slice(0, 8);
    let key;
    if (seenLocal.has(template)) {
      key = seenLocal.get(template);
    } else {
      key = `${prefix}.${slug(template)}_${hash}`;
      // shorten if static duplicate across files — keep per-file for safety
      seenLocal.set(template, key);
      messages[key] = template;
    }
    report.push({ file, kind, key, raw, template, params, templated });
  }
}

fs.mkdirSync(path.join(ROOT, 'core/config'), { recursive: true });
fs.mkdirSync(path.join(ROOT, '.build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.build', 'messages-core-draft.json'), JSON.stringify(messages, null, 2));
fs.writeFileSync(path.join(ROOT, '.build', 'messages-core-report.json'), JSON.stringify(report, null, 2));
process.stdout.write(`${Object.keys(messages).length} unique templates, ${report.length} sites → .build/messages-core-*.json\n`);

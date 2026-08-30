#!/usr/bin/env node
/**
 * migrate-core-msg.mjs — thay reason:/message: literal bằng msg(key[, params]) trong core/src.
 * Chạy một lần; idempotent nếu đã là msg(.
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
    let name = expr.trim();
    if (/^[A-Za-z_][\w.]*$/.test(name)) {
      name = name.includes('.') ? name.split('.').pop() : name;
    } else {
      name = `p${params.length}`;
    }
    let final = name;
    let n = 2;
    while (params.some((p) => p.name === final)) final = `${name}${n++}`;
    params.push({ name: final, expr: expr.trim() });
    return `{${final}}`;
  });
  return { template, params };
}

const messages = {};

for (const [file, prefix] of Object.entries(PREFIX)) {
  const abs = path.join(ROOT, 'core/src', file);
  let text = fs.readFileSync(abs, 'utf8');
  if (text.includes("from './msg.mjs'") || text.includes('from "./msg.mjs"')) {
    // already migrated partially — still rewrite remaining literals
  }

  const seen = new Map();
  const re = /(reason|message):\s*(?:'((?:\\'|[^'])*)'|`((?:\\`|[^`])*)`)/g;

  // Collect replacements from end to start so offsets stay valid
  const hits = [];
  let m;
  while ((m = re.exec(text))) {
    hits.push({
      index: m.index,
      full: m[0],
      kind: m[1],
      templated: m[3] !== undefined,
      raw: (m[3] !== undefined ? m[3] : m[2]).replace(/\\'/g, "'").replace(/\\`/g, '`'),
    });
  }

  for (const hit of hits) {
    const { template, params } = toTemplate(hit.raw, hit.templated);
    const hash = crypto.createHash('sha1').update(template).digest('hex').slice(0, 8);
    let key = seen.get(template);
    if (!key) {
      key = `${prefix}.${slug(template)}_${hash}`;
      seen.set(template, key);
      messages[key] = template;
    }
    hit.key = key;
    hit.params = params;
  }

  // Apply from end
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i];
    let replacement;
    if (hit.params.length === 0) {
      replacement = `${hit.kind}: msg('${hit.key}')`;
    } else {
      const obj = hit.params.map((p) => (p.name === p.expr ? p.name : `${p.name}: ${p.expr}`)).join(', ');
      replacement = `${hit.kind}: msg('${hit.key}', { ${obj} })`;
    }
    text = text.slice(0, hit.index) + replacement + text.slice(hit.index + hit.full.length);
  }

  if (hits.length && !/from '\.\/msg\.mjs'/.test(text)) {
    // Insert import after the last leading import or at top after comments block
    const importLine = "import { msg } from './msg.mjs';\n";
    const lastImport = [...text.matchAll(/^import .+$/gm)].pop();
    if (lastImport) {
      const at = lastImport.index + lastImport[0].length;
      text = text.slice(0, at) + '\n' + importLine + text.slice(at);
    } else {
      // after first block comment if any
      const bm = text.match(/^(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\n*)+/);
      if (bm) text = text.slice(0, bm[0].length) + importLine + '\n' + text.slice(bm[0].length);
      else text = importLine + '\n' + text;
    }
  }

  fs.writeFileSync(abs, text.replace(/\r\n/g, '\n'), 'utf8');
  process.stdout.write(`${file}: ${hits.length} sites\n`);
}

fs.writeFileSync(
  path.join(ROOT, 'core/config', 'messages-core-only.json'),
  JSON.stringify(messages, null, 2) + '\n',
  'utf8',
);
process.stdout.write(`wrote ${Object.keys(messages).length} keys → core/config/messages-core-only.json\n`);

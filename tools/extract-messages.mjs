#!/usr/bin/env node
// One-shot helper: extract reason:/message strings from core for messages.json scaffolding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'edit.mjs', 'item-value.mjs', 'columns.mjs', 'field-template.mjs', 'filter-declare.mjs',
  'add-column.mjs', 'entities.mjs', 'grid.mjs', 'render.mjs',
];

const reasons = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(ROOT, 'core/src', f), 'utf8');
  const re = /reason:\s*(?:'((?:\\'|[^'])*)'|`((?:\\`|[^`])*)`)/g;
  let m;
  while ((m = re.exec(text))) {
    reasons.push({ file: f, raw: m[1] !== undefined ? m[1] : m[2], templated: m[2] !== undefined });
  }
  // warnings / diagnostics .message = '...'
  const re2 = /message:\s*(?:'((?:\\'|[^'])*)'|`((?:\\`|[^`])*)`)/g;
  while ((m = re2.exec(text))) {
    reasons.push({ file: f, kind: 'message', raw: m[1] !== undefined ? m[1] : m[2], templated: m[2] !== undefined });
  }
}

fs.mkdirSync(path.join(ROOT, '.build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.build', 'reasons-extract.json'), JSON.stringify(reasons, null, 2));
process.stdout.write(`extracted ${reasons.length} strings → .build/reasons-extract.json\n`);

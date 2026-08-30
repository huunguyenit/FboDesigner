#!/usr/bin/env node
/**
 * merge-similar-messages.mjs — gom key gần trùng + rewrite call sites.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MSG = path.join(ROOT, 'core/config/messages.json');

const messages = JSON.parse(fs.readFileSync(MSG, 'utf8'));

/** oldKey → { to, drop?: true } — nếu drop thì xóa key cũ, call site đổi sang `to`. */
const MERGE = {
  'dialog.btn.huỷ': { to: 'dialog.btn.cancel' },
  'dialog.copy_fail_short': { to: 'dialog.copy_failed' },
  'edit.file_unread_2': { to: 'edit.file_unread' },
  'edit.region_missing_2': { to: 'edit.region_missing' },
  'edit.field_decl_missing_col': { to: 'edit.field_decl_missing' },
  'edit.target_row_not_found_2': { to: 'edit.target_row_not_found' },
  'extension.empty_cell': { to: 'common.empty_delete' },
  'item.other_cell_missing': { to: 'item.cell_missing' },
  'item.col_occupied_insert': { to: 'item.col_occupied' },
  'item.col_occupied_move': { to: 'item.col_occupied' },
  'item.col_occupied_place': { to: 'item.col_occupied' },
  'item.col_occupied_grow': { to: 'item.col_occupied' },
  'item.place_col_invalid': { to: 'common.target_col_invalid' },
  'item.target_col_invalid': { to: 'common.target_col_invalid' },
  'edit.target_col_invalid': { to: 'common.target_col_invalid' },
};

// Canonical templates after merge (override survivors)
const CANON = {
  'dialog.btn.cancel': 'Huỷ',
  'dialog.copy_failed': 'Chép hỏng',
  'edit.file_unread': 'không đọc được {file} để đối chiếu trước khi ghi',
  'edit.region_missing': 'không có vùng "{region}"',
  'edit.field_decl_missing': 'không tìm thấy khai báo <field name="{name}">',
  'edit.target_row_not_found': 'không tìm thấy hàng {toItem}',
  'common.empty_delete': 'ô trống, không có gì để xoá',
  'item.cell_missing': 'không có ô thứ {cellIndex}',
  'item.col_occupied': 'cột {p0} đang có control — bỏ nó trước rồi mới {action} được',
  'common.target_col_invalid': 'cột đích {col} không hợp lệ',
};

for (const [oldKey, { to }] of Object.entries(MERGE)) {
  delete messages[oldKey];
}
for (const [k, v] of Object.entries(CANON)) {
  messages[k] = v;
}

const ordered = {};
for (const k of Object.keys(messages).sort()) ordered[k] = messages[k];
fs.writeFileSync(MSG, JSON.stringify(ordered, null, 2) + '\n', 'utf8');

// --- rewrite sources ---
const EXTS = new Set(['.js', '.mjs']);
const SKIP = new Set(['node_modules', '.build', 'dist', '.git', 'tools']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

const pairs = Object.entries(MERGE).sort((a, b) => b[0].length - a[0].length);
let n = 0;
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, 'utf8');
  let next = text;
  for (const [oldKey, { to }] of pairs) {
    next = next.split(`'${oldKey}'`).join(`'${to}'`);
    next = next.split(`"${oldKey}"`).join(`"${to}"`);
  }
  if (next !== text) {
    fs.writeFileSync(file, next.replace(/\r\n/g, '\n'), 'utf8');
    n++;
  }
}
process.stdout.write(`merged ${Object.keys(MERGE).length} keys → ${Object.keys(ordered).length} total; rewrote ${n} files\n`);

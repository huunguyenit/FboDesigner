// msg.mjs — format chuỗi từ core/config/messages.json.
//
// Catalog load MỘT LẦN lúc import (đọc đĩa giống encoding.mjs). Core không ghi filesystem.
// Template dùng `{name}`; gọi `msg('edit.column_missing', { columnName: 'x' }).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev: file nằm ở `core/src/` → config ở `../config`.
 * VSIX: `package-vsix` chép thẳng vào `extension/core/` → config ở `./config`.
 */
function resolveConfigDir() {
  const candidates = [
    path.join(HERE, 'config'),
    path.join(HERE, '..', 'config'),
  ];
  const found = candidates.find((d) => fs.existsSync(path.join(d, 'messages.json')));
  if (!found) {
    throw new Error(`không tìm thấy core/config, đã thử:\n${candidates.join('\n')}`);
  }
  return found;
}

const CONFIG_DIR = resolveConfigDir();

function loadJson(name) {
  const file = path.join(CONFIG_DIR, name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @type {Record<string, string>} */
export const MESSAGES = loadJson('messages.json');

/** @type {import('../config/fields.json')} */
export const FIELDS_CONFIG = loadJson('fields.json');

/** @type {Record<string, unknown>} */
export const VIEWS_CONFIG = loadJson('views.json');

/** @type {import('../config/sql.json')} */
export const SQL_CONFIG = loadJson('sql.json');

/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function msg(key, params = {}) {
  const template = MESSAGES[key];
  if (template === undefined) {
    // Thiếu key thì lộ key ra — dễ phát hiện hơn là nuốt im.
    let fallback = key;
    for (const [k, v] of Object.entries(params)) {
      fallback = fallback.replaceAll(`{${k}}`, String(v ?? ''));
    }
    return fallback;
  }
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.replaceAll(`{${k}}`, String(v ?? ''));
  }
  return out;
}

/** Alias ngắn cho tầng extension / webview inject. */
export const t = msg;

// locale.js — đọc core/config/messages.json từ host CJS (F5 hoặc .vsix).
const fs = require('node:fs');
const path = require('node:path');

let catalog = null;

function configPath() {
  const candidates = [
    path.join(__dirname, '..', 'core', 'config', 'messages.json'),
    path.join(__dirname, '..', '..', 'core', 'config', 'messages.json'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function load() {
  if (catalog) return catalog;
  const file = configPath();
  if (!file) {
    catalog = {};
    return catalog;
  }
  catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  return catalog;
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 */
function t(key, params = {}) {
  const template = load()[key];
  if (template === undefined) return key;
  let out = template;
  for (const [k, v] of Object.entries(params)) {
    out = out.replaceAll(`{${k}}`, String(v ?? ''));
  }
  return out;
}

/** Toast với tiền tố "FBO Designer: ". */
function toast(key, params = {}) {
  return t('extension.prefix') + t(key, params);
}

function allMessages() {
  return { ...load() };
}

/** Subset webview.* (+ dialog chrome dùng overlay). */
function webviewMessages() {
  const all = load();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('webview.') || k.startsWith('dialog.')) out[k] = v;
  }
  return out;
}

module.exports = { t, toast, allMessages, webviewMessages, load };

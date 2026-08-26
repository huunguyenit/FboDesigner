#!/usr/bin/env node
// sweep.mjs — quét cả corpus, render từng file, đếm chỗ vỡ.
//
//   node core/tools/sweep.mjs "D:\...\FBISP24" Dir
//
// Test bằng fixture chỉ chứng minh code chạy đúng với ví dụ ta tự nghĩ ra. Corpus thật mới
// trả lời được "ngữ nghĩa có đúng không" — và nó có sẵn hàng nghìn file. Không crash trên
// toàn corpus là lưới an toàn tối thiểu; bảng cảnh báo phía dưới mới là thứ đáng đọc.

import fs from 'node:fs';
import path from 'node:path';
import { readSource } from '../src/encoding.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { expandEntities } from '../src/entities.mjs';

const readInclude = (abs) => {
  try { return fs.existsSync(abs) ? readSource(abs).text : null; } catch { return null; }
};

const [root, folder = 'Dir'] = process.argv.slice(2);
if (!root) {
  process.stderr.write('dùng: node core/tools/sweep.mjs <corpus-root> [Dir|Filter]\n');
  process.exit(2);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(xml|f)$/i.test(entry.name) && path.basename(path.dirname(full)).toLowerCase() === folder.toLowerCase()) {
      yield full;
    }
  }
}

const stats = { files: 0, rendered: 0, noView: 0, crashed: 0, warnings: 0, entityErrors: 0, encodings: {}, byMessage: new Map() };
const crashes = [];

for (const file of walk(root)) {
  stats.files++;
  try {
    const src = readSource(file);
    stats.encodings[src.encoding] = (stats.encodings[src.encoding] ?? 0) + 1;

    // Bung entity trước: không bung thì mọi field khai trong Include đều báo "không tồn tại",
    // và con số cảnh báo nói về giới hạn của công cụ chứ không nói gì về corpus.
    const expanded = expandEntities(src.text, { filePath: file, readFile: readInclude });
    stats.entityErrors += expanded.diagnostics.filter((d) => d.severity === 'error').length;

    const { model, warnings } = renderControllerHtml(expanded.clearText, {
      segments: expanded.segments,
      hostFile: file,
    });
    if (!model) { stats.noView++; continue; }
    stats.rendered++;
    stats.warnings += warnings.length;
    for (const w of warnings) {
      const key = w.message.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N');
      stats.byMessage.set(key, (stats.byMessage.get(key) ?? 0) + 1);
    }
  } catch (err) {
    stats.crashed++;
    crashes.push(`${file}: ${err.message}`);
  }
}

process.stdout.write(`\n${folder}/ trong ${root}\n`);
process.stdout.write(`  file quét        ${stats.files}\n`);
process.stdout.write(`  render được      ${stats.rendered}\n`);
process.stdout.write(`  không có <view>  ${stats.noView}\n`);
process.stdout.write(`  CRASH            ${stats.crashed}\n`);
process.stdout.write(`  encoding         ${JSON.stringify(stats.encodings)}\n`);
process.stdout.write(`  entity không giải ${stats.entityErrors}\n`);
process.stdout.write(`  tổng cảnh báo    ${stats.warnings}\n\n`);

const top = [...stats.byMessage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
if (top.length) {
  process.stdout.write('Cảnh báo hay gặp nhất:\n');
  for (const [msg, n] of top) process.stdout.write(`  ${String(n).padStart(6)}  ${msg}\n`);
}
if (crashes.length) {
  process.stdout.write('\nCRASH:\n');
  for (const c of crashes.slice(0, 20)) process.stdout.write(`  ${c}\n`);
}

process.exit(stats.crashed === 0 ? 0 : 1);

#!/usr/bin/env node
// import-runtime-css.mjs — nhận CSS trích từ FBO đang chạy, đặt vào base pack.
//
//   node tools/import-runtime-css.mjs runtime.css [--as fbo-base.css]
//
// Việc chính không phải là chép file — mà là **nói ra cái gì sẽ thiếu**. CSS trích từ trình
// duyệt mang theo `url(WebResource.axd?d=…)`, `url(../Images/x.png)`, `url(data:…)`. Chỉ loại
// cuối tự sống được. Bỏ file vào rồi im lặng thì lúc mở designer chỉ thấy vài icon mất tiêu
// mà không biết vì sao — nên bộ import liệt kê thẳng ra.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_DIR = path.join(ROOT, 'extension', 'media', 'base', 'css');

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
const asIndex = args.indexOf('--as');
const outName = asIndex !== -1 ? args[asIndex + 1] : 'fbo-base.css';

if (!src) {
  process.stderr.write('dùng: node tools/import-runtime-css.mjs <file.css> [--as <tên>.css]\n');
  process.exit(2);
}
if (!fs.existsSync(src)) {
  process.stderr.write(`không thấy file: ${src}\n`);
  process.exit(1);
}

const css = fs.readFileSync(src, 'utf8');
fs.mkdirSync(BASE_DIR, { recursive: true });
const dest = path.join(BASE_DIR, outName);
fs.writeFileSync(dest, css.replace(/\r\n/g, '\n'), 'utf8');

const refs = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2].trim());
const groups = { data: [], axd: [], relative: [], absolute: [] };
for (const r of refs) {
  if (r.startsWith('data:')) groups.data.push(r);
  else if (/webresource\.axd|scriptresource\.axd/i.test(r)) groups.axd.push(r);
  else if (/^https?:\/\//i.test(r)) groups.absolute.push(r);
  else groups.relative.push(r);
}

const uniq = (a) => [...new Set(a)];
const rel = uniq(groups.relative);
const missing = rel.filter((r) => !fs.existsSync(path.join(BASE_DIR, r.split(/[?#]/)[0])));

process.stdout.write(`\n${dest}\n  ${(css.length / 1024).toFixed(1)} KB · ${refs.length} tham chiếu url()\n\n`);
process.stdout.write(`  data: URI      ${uniq(groups.data).length}  — tự sống, không cần làm gì\n`);
process.stdout.write(`  tương đối      ${rel.length}  — thiếu ${missing.length} file trong base/\n`);
process.stdout.write(`  WebResource    ${uniq(groups.axd).length}  — PHẢI tải riêng, URL không còn ý nghĩa ngoài app\n`);
process.stdout.write(`  tuyệt đối http ${uniq(groups.absolute).length}  — CSP của webview chặn, phải nội hoá\n`);

for (const [label, list] of [['thiếu trong base/', missing], ['WebResource', uniq(groups.axd)], ['http tuyệt đối', uniq(groups.absolute)]]) {
  if (list.length === 0) continue;
  process.stdout.write(`\n  ${label}:\n`);
  for (const r of list.slice(0, 20)) process.stdout.write(`    ${r}\n`);
  if (list.length > 20) process.stdout.write(`    … và ${list.length - 20} cái nữa\n`);
}

process.stdout.write('\nĐóng gói lại:  node tools/package-vsix.mjs\n');

#!/usr/bin/env node
// package-vsix.mjs — đóng gói .vsix mà không cần `vsce`, không cần npm install.
//
//   node tools/package-vsix.mjs
//
// Một .vsix chỉ là file ZIP theo quy ước OPC:
//
//   [Content_Types].xml        khai kiểu nội dung cho từng đuôi file
//   extension.vsixmanifest     metadata mà VS Code/Cursor đọc để cài
//   extension/                 chính là nội dung extension
//
// `vsce` làm thêm nhiều việc (validate, chụp README, xử lý dependency npm) mà ở đây đều
// không có việc để làm: extension này zero-dependency và không lên marketplace. Đổi lại
// giữ được lời hứa "không npm install".
//
// Một điểm phụ thuộc nền tảng, ghi rõ để sau này không phải đoán: Node không có sẵn bộ nén
// ZIP, nên bước cuối gọi .NET `ZipFile.CreateFromDirectory` qua PowerShell. Nếu cần chạy trên
// máy khác Windows thì thay đúng hàm `zipDirectory` phía dưới, phần còn lại giữ nguyên.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(ROOT, '.build', 'vsix');
const DIST = path.join(ROOT, 'dist');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'package.json'), 'utf8'));
const { name, version, publisher, displayName, description } = manifest;
const engine = manifest.engines.vscode;

/** File nào vào gói — khai TƯỜNG MINH, không quét cả thư mục. Gói lỡ mang theo file lạ là gói không kiểm được. */
const CONTENT = [
  ['extension/package.json', 'extension/package.json'],
  ['README.md', 'extension/README.md'],
  ['extension/package.nls.json', 'extension/package.nls.json'],
  ['extension/src/extension.js', 'extension/src/extension.js'],
  ['extension/src/designer-editor.js', 'extension/src/designer-editor.js'],
  ['extension/src/designer-webview.js', 'extension/src/designer-webview.js'],
  ['extension/src/preview-panel.js', 'extension/src/preview-panel.js'],
  ['extension/src/render-host.js', 'extension/src/render-host.js'],
  ['extension/src/edit-host.js', 'extension/src/edit-host.js'],
  ['extension/src/edit-history.js', 'extension/src/edit-history.js'],
  ['extension/src/dialog/dialog-service.js', 'extension/src/dialog/dialog-service.js'],
  ['extension/src/dialog/dialog-overlay.js', 'extension/src/dialog/dialog-overlay.js'],
  ['extension/src/dialog/dialog-panel.js', 'extension/src/dialog/dialog-panel.js'],
  ['extension/src/dialog/dialog-types.js', 'extension/src/dialog/dialog-types.js'],
  ['extension/media/designer.css', 'extension/media/designer.css'],
  ['extension/media/designer.js', 'extension/media/designer.js'],
  ['extension/media/shell.html', 'extension/media/shell.html'],
  ['extension/src/filter-host.js', 'extension/src/filter-host.js'],
  ['extension/src/add-column-host.js', 'extension/src/add-column-host.js'],
  ['extension/src/sql-host.js', 'extension/src/sql-host.js'],
  ['extension/src/locale.js', 'extension/src/locale.js'],
  // core chép VÀO gói: khi cài từ .vsix thì không có package anh em bên cạnh nữa.
  ['core/src/index.mjs', 'extension/core/index.mjs'],
  ['core/src/encoding.mjs', 'extension/core/encoding.mjs'],
  ['core/src/spans.mjs', 'extension/core/spans.mjs'],
  ['core/src/item-value.mjs', 'extension/core/item-value.mjs'],
  ['core/src/columns.mjs', 'extension/core/columns.mjs'],
  ['core/src/edit.mjs', 'extension/core/edit.mjs'],
  ['core/src/field-template.mjs', 'extension/core/field-template.mjs'],
  ['core/src/msg.mjs', 'extension/core/msg.mjs'],
  ['core/src/control.mjs', 'extension/core/control.mjs'],
  ['core/config/fields.json', 'extension/core/config/fields.json'],
  ['core/config/views.json', 'extension/core/config/views.json'],
  ['core/config/messages.json', 'extension/core/config/messages.json'],
  ['core/config/sql.json', 'extension/core/config/sql.json'],
  ['core/src/entities.mjs', 'extension/core/entities.mjs'],
  ['core/src/program.mjs', 'extension/core/program.mjs'],
  ['core/src/render.mjs', 'extension/core/render.mjs'],
  ['core/src/grid.mjs', 'extension/core/grid.mjs'],
  ['core/src/filter-declare.mjs', 'extension/core/filter-declare.mjs'],
  ['core/src/add-column.mjs', 'extension/core/add-column.mjs'],
  ['core/src/sql-config.mjs', 'extension/core/sql-config.mjs'],
  ['core/src/css-scope.mjs', 'extension/core/css-scope.mjs'],
  ['core/src/xml-comment.mjs', 'extension/core/xml-comment.mjs'],
];

// Danh sách khai tay ở trên là chỗ dễ quên nhất khi thêm file mới: gói vẫn dựng xong, vẫn cài
// được, chỉ chết lúc `require`/`import` trên máy người khác. Đối chiếu với thư mục thật để
// quên là biết ngay, thay vì biết qua báo lỗi của khách.
const declared = new Set(CONTENT.map(([from]) => from.replace(/\\/g, '/')));
const missing = [];
/*
 * Quét ĐỆ QUY, và đó là bản vá của đúng lỗ hổng mà chính bộ kiểm này sinh ra để chặn.
 *
 * Bản trước đọc một tầng bằng `readdirSync`, nên cả thư mục `extension/src/dialog/` lọt qua
 * không một tiếng động: ba file dialog không được khai, gói vẫn dựng, vẫn cài, rồi chết ở
 * `require('./dialog/dialog-service')` ngay lúc activate trên máy người khác. Thư mục con là
 * chỗ nấp mà bản một-tầng không bao giờ nhìn tới.
 */
function scanForUndeclared(dir) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) scanForUndeclared(rel);
    else if (/\.(js|mjs)$/.test(e.name) && !declared.has(rel)) missing.push(rel);
  }
}
for (const dir of ['extension/src', 'core/src']) scanForUndeclared(dir);
if (missing.length) {
  process.stderr.write(`CONTENT thiếu file (thêm vào tools/package-vsix.mjs):\n  ${missing.join('\n  ')}\n`);
  process.exit(2);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="mjs" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="xml" ContentType="text/xml" />
  <Default Extension="txt" ContentType="text/plain" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="gif" ContentType="image/gif" />
  <Default Extension="html" ContentType="text/html" />
</Types>
`;


const VSIX_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${esc(name)}" Version="${esc(version)}" Publisher="${esc(publisher)}" />
    <DisplayName>${esc(displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(description)}</Description>
    <Tags>fbo,erp,designer,xml</Tags>
    <Categories>Visualization,Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${esc(engine)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
`;

/** Ghi UTF-8 KHÔNG BOM, LF — cùng quy ước output với hub 4AI. */
function write(rel, text) {
  const target = path.join(STAGE, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text.replace(/\r\n/g, '\n'), 'utf8');
}

const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * Nén theo DANH SÁCH entry, mỗi entry đặt tên tường minh.
 *
 * KHÔNG dùng `ZipFile::CreateFromDirectory`: trên Windows PowerShell 5.1 (.NET Framework) nó
 * đặt tên entry bằng dấu `\`, mà spec ZIP quy định `/`. Gói vẫn mở được bằng Explorer nên
 * nhìn thì tưởng xong, nhưng VS Code/Cursor đọc bằng thư viện đúng spec sẽ không thấy
 * `extension/package.json` và từ chối cài. Đã dính một lần — đó là lý do có hàm verify bên dưới.
 */
function zipEntries(entries, outFile) {
  const lines = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$ErrorActionPreference = "Stop"',
    `$zip = [System.IO.Compression.ZipFile]::Open(${ps(outFile)}, "Create")`,
    ...entries.map(({ abs, name }) =>
      `[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, ${ps(abs)}, ${ps(name)}, [System.IO.Compression.CompressionLevel]::Optimal)`),
    '$zip.Dispose()',
  ];
  const script = path.join(ROOT, '.build', 'zip.ps1');
  fs.writeFileSync(script, lines.join('\n'), 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'pipe' });
}

/**
 * Đọc central directory của ZIP để lấy tên entry thật.
 * Tự đọc chứ không hỏi lại PowerShell: bộ đóng gói phải kiểm được đầu ra của chính nó bằng
 * thứ độc lập với công cụ đã tạo ra nó, nếu không thì kiểm cái gì.
 */
function zipEntryNames(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('không tìm thấy End of Central Directory — file không phải ZIP hợp lệ');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory hỏng ở entry ${i}`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// --- dựng gói ---------------------------------------------------------------

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

write('[Content_Types].xml', CONTENT_TYPES);
write('extension.vsixmanifest', VSIX_MANIFEST);

// Base pack là thư mục, không phải danh sách cố định: nội dung do người dùng trích từ runtime
// bỏ vào (xem extension/media/base/README.md). Đây là ngoại lệ DUY NHẤT của luật khai tường minh.
const BASE_DIR = path.join(ROOT, 'extension', 'media', 'base');
for (const sub of ['css', 'image']) {
  const dir = path.join(BASE_DIR, sub);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (f === 'README.md') continue;
    CONTENT.push([`extension/media/base/${sub}/${f}`, `extension/media/base/${sub}/${f}`]);
  }
}

// Ảnh README: README nằm ở extension/README.md trong gói, đường dẫn tương đối docs/images/…
// phải khớp — chép nguyên cây docs/images vào extension/docs/images/.
const README_IMAGES = path.join(ROOT, 'docs', 'images');
if (fs.existsSync(README_IMAGES)) {
  for (const f of fs.readdirSync(README_IMAGES).sort()) {
    if (!/\.(png|gif|jpe?g|webp)$/i.test(f)) continue;
    CONTENT.push([`docs/images/${f}`, `extension/docs/images/${f}`]);
  }
}

/*
 * Đuôi file ảnh phải KHỚP nội dung thật.
 *
 * `[Content_Types].xml` khai kiểu theo ĐUÔI, và webview phục vụ ảnh với đúng header đó. Một file
 * PNG mang tên `.gif` vì thế được gửi đi là `image/gif` — và mọi icon lấy từ nó biến mất, trong
 * khi ảnh PNG đặt tên đúng ngay bên cạnh vẫn hiện. Đã xảy ra thật với `fbo-toolbar.gif`, và chỗ
 * khó chịu là bàn đo KHÔNG lộ ra: HTTP thường có sniff nên nó vẫn vẽ đúng.
 *
 * Đọc mấy byte đầu là đủ nhận dạng, không cần thư viện.
 */
const MAGIC = [
  { ext: 'png', head: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'gif', head: [0x47, 0x49, 0x46, 0x38] },
];
const mismatched = [];
for (const [from] of CONTENT) {
  const ext = path.extname(from).slice(1).toLowerCase();
  if (!MAGIC.some((m) => m.ext === ext)) continue;
  const head = [...fs.readFileSync(path.join(ROOT, from)).subarray(0, 4)];
  const real = MAGIC.find((m) => m.head.every((b, i) => b === head[i]));
  if (real && real.ext !== ext) mismatched.push(`${from} — nội dung là ${real.ext.toUpperCase()}`);
}
if (mismatched.length) {
  process.stderr.write(`Đuôi file ảnh không khớp nội dung (đổi tên file và sửa url() trong CSS):\n  ${mismatched.join('\n  ')}\n`);
  process.exit(2);
}

// OPC đòi khai kiểu cho MỌI đuôi file có trong gói. Thiếu một cái thì trình đọc chặt sẽ từ
// chối cả gói — kiểm ngay ở đây thay vì để phát hiện lúc cài trên máy khách.
{
  const declaredExt = new Set([...CONTENT_TYPES.matchAll(/Extension="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
  const used = new Set(CONTENT.map(([, to]) => path.extname(to).slice(1).toLowerCase()).filter(Boolean));
  const undeclared = [...used].filter((e) => !declaredExt.has(e));
  if (undeclared.length) {
    process.stderr.write(`[Content_Types].xml thiếu đuôi: ${undeclared.join(', ')}\n`);
    process.exit(2);
  }
}

for (const [from, to] of CONTENT) {
  const src = path.join(ROOT, from);
  if (!fs.existsSync(src)) {
    process.stderr.write(`thiếu file khai trong CONTENT: ${from}\n`);
    process.exit(1);
  }
  const dst = path.join(STAGE, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const entries = [
  { abs: path.join(STAGE, '[Content_Types].xml'), name: '[Content_Types].xml' },
  { abs: path.join(STAGE, 'extension.vsixmanifest'), name: 'extension.vsixmanifest' },
  ...CONTENT.map(([, to]) => ({ abs: path.join(STAGE, to), name: to })),
];

const out = path.join(DIST, `${name}-${version}.vsix`);
fs.rmSync(out, { force: true });
zipEntries(entries, out);

// --- tự kiểm: gói sai kiểu này vẫn mở được bằng Explorer, chỉ chết lúc cài ---

const actual = zipEntryNames(out);
const problems = [];
for (const n of actual) if (n.includes('\\')) problems.push(`entry dùng dấu "\\" thay vì "/": ${n}`);
for (const { name: n } of entries) if (!actual.includes(n)) problems.push(`thiếu entry: ${n}`);
if (!actual.includes('extension/package.json')) problems.push('không có extension/package.json — Cursor sẽ từ chối cài');
if (problems.length) {
  process.stderr.write(`\nGÓI HỎNG:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}

const size = fs.statSync(out).size;
process.stdout.write(`\n${out}\n  ${actual.length} entry · ${(size / 1024).toFixed(1)} KB · tên entry hợp lệ\n`);
process.stdout.write('\nCài: Cursor → Extensions → … → Install from VSIX…\n');

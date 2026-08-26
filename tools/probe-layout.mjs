#!/usr/bin/env node
// probe-layout.mjs — bàn đo hình học. Dựng bản sao shell của webview thành một trang tĩnh
// chạy được trong trình duyệt thường, để ĐO chứ không để đoán.
//
//   node tools/probe-layout.mjs                      # Dir/Site.f của corpus mặc định
//   node tools/probe-layout.mjs <đường-dẫn>.f        # file bất kỳ
//   node tools/probe-layout.mjs <đường-dẫn>.f --serve
//
// Vì sao cần: "form sai kích thước" là khiếu nại về PX. Không có bàn đo thì mọi câu trả lời
// đều là phép cộng trên giấy, và phép cộng trên giấy đã sai đúng một lần rồi — chuỗi bảy lớp
// div của dialog runtime cộng thêm 23px bề rộng mà preview không có lớp nào trong số đó.
//
// Mốc đối chiếu (HTML runtime của `Dir/Site.xml`, dialog «Thêm kho hàng»):
//   bảng 550px · panel width:573px (ngoài 575 kể cả viền) · input Lookup 77px · input cao 13px
//
// Trang này KHÔNG phải test tự động — nó không tự khẳng định gì. Phần khẳng định được nằm ở
// `core/test/test-render.mjs`, mục «đối chiếu runtime».
//
// MỘT CHỖ KHÁC webview thật, cố ý: base pack ở đây nạp bằng `<link>`, còn webview NHÚNG THẲNG
// nó vào trang với `url()` đã viết lại thành URI có dấu phiên bản (xem `inlineBaseCss` trong
// `render-host.js`). Không tái hiện được ở đây vì `asWebviewUri` chỉ có trong webview. Hệ quả:
// bảng Stylesheet của debug mode ở bàn đo hiện «URL» thay vì «nhúng thẳng» — khác biệt đó là
// của bàn đo, không phải dấu hiệu inline hỏng.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import url from 'node:url';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO, '.build', 'probe');
const PORT = 7391;

const { readSource } = await import(new URL('../core/src/encoding.mjs', import.meta.url));
const { expandEntities } = await import(new URL('../core/src/entities.mjs', import.meta.url));
const { renderControllerHtml } = await import(new URL('../core/src/render.mjs', import.meta.url));

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const target = args.find((a) => !a.startsWith('--'))
  || 'D:/Fast Source/Development/DevWorkFlow/FBISP24/App_Data/Controllers/Dir/Site.f';

if (!fs.existsSync(target)) {
  process.stderr.write(`không có file: ${target}\n`);
  process.exit(2);
}

const readInclude = (abs) => {
  try { return fs.existsSync(abs) ? readSource(abs).text : null; } catch { return null; }
};

const src = readSource(target);
const expanded = expandEntities(src.text, { filePath: target, readFile: readInclude });
const folder = path.basename(path.dirname(target));
/** Lưới Detail cho ô `<items style="Grid">` — `.xml` (bản customize) trước `.f` (bản chuẩn). */
const loadDetail = (name) => {
  const controllers = path.dirname(path.dirname(target));
  for (const ext of ['.xml', '.f']) {
    const candidate = path.join(controllers, 'Grid', `${name}${ext}`);
    if (!fs.existsSync(candidate)) continue;
    const detail = expandEntities(readSource(candidate).text, { filePath: candidate, readFile: readInclude });
    return { text: detail.clearText, segments: detail.segments, file: candidate };
  }
  return null;
};

/**
 * Cấu hình ẩn của lưới — bản sao của `loadGridConfig` ở `render-host.js`.
 *
 * Bàn đo phải nạp chính những thứ webview nạp, nếu không thì nó đo một màn hình thiếu cột so
 * với cái đang chạy — đúng loại lệch đã phải dọn một lần ở phần thân shell.
 */
const gridConfig = (() => {
  const name = path.basename(target).replace(/\.(xml|f)$/i, '');
  const configDir = path.join(path.dirname(path.dirname(target)), 'Grid', 'Config');
  const parts = [];
  const expand = (file) => {
    const ex = expandEntities(readSource(file).text, { filePath: file, readFile: readInclude });
    return { text: ex.clearText, segments: ex.segments, file };
  };

  const initFile = path.join(configDir, 'Initialize.xml');
  if (fs.existsSync(initFile) && /^[\w.-]+$/.test(name)) {
    const init = expand(initFile);
    const decl = new RegExp(`<controller\\s+name="${name}"[^>]*\\sgroup="([\\w.-]+)"`, 'i').exec(init.text);
    if (decl) {
      const body = new RegExp(`<group\\s+id="${decl[1]}"[\\s\\S]*?</group>`, 'i').exec(init.text);
      if (body) parts.push({ text: body[0], segments: init.segments, file: initFile });
    }
  }
  const fieldsFile = path.join(configDir, 'Fields', `${name}.xml`);
  if (fs.existsSync(fieldsFile)) parts.push(expand(fieldsFile));
  return parts;
})();

const result = renderControllerHtml(expanded.clearText, {
  segments: expanded.segments,
  hostFile: target,
  titleMode: folder.toLowerCase() === 'filter' ? 'plain' : 'add',
  loadDetail,
  gridConfig,
});

/** `<program>` suy từ chính file đang đo — `<program>/App_Data/Controllers/<Folder>/x.f`. */
const programRoot = path.dirname(path.dirname(path.dirname(path.dirname(target))));

/**
 * Quy `url(../Images/…)` trong CSS của controller về route `/program/…` của bàn đo.
 *
 * Webview thật quy chúng về `asWebviewUri`; bàn đo không có API đó nên phục vụ qua một route
 * riêng. Không làm thì icon nút riêng 404 và bàn đo nói dối về chuyện đã sửa xong.
 *
 * Mấy chuỗi CSS đó viết như thể nằm trong `<program>\Css\`, nên `../Images/` là
 * `<program>/Images/`.
 */
const RE_URL = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
function programCssUrls(css) {
  return String(css).replace(RE_URL, (m, _q, u) => {
    if (/^(data:|https?:|#|\/\/)/i.test(u)) return m;
    const abs = path.resolve(path.join(programRoot, 'Css'), u);
    const rel = path.relative(programRoot, abs).split(path.sep).join('/');
    return `url("/program/${rel}")`;
  });
}

const baseCss = fs.readdirSync(path.join(REPO, 'extension/media/base/css'))
  .filter((f) => f.toLowerCase().endsWith('.css')).sort()
  .map((f) => `<link rel="stylesheet" href="/extension/media/base/css/${f}" data-fbo-css="base/${f}">`)
  .join('\n');

const payload = {
  type: 'render',
  html: result.html,
  mode: result.mode,
  // Cùng một khoá với `buildPayload` của webview thật — bàn đo phải đo đúng cái đang chạy.
  fitWidth: result.fitWidth === true,
  modeLabel: `${folder} → ${result.mode === 'grid' ? (result.model?.type || 'Grid') : 'Form'}`,
  controllerCss: programCssUrls(result.css || ''),
  columns: result.model?.widths ?? [],
  warnings: result.warnings,
  encoding: src.encoding,
  eol: 'CRLF',
  file: path.basename(target),
  path: target,
  program: '(probe)',
  entities: {
    declared: expanded.declarations.size,
    foreignRows: result.model?.foreignRows ?? 0,
    diagnostics: expanded.diagnostics,
  },
};

// Thân shell đọc từ CHÍNH file webview thật dùng — không chép lại. Đây là điều kiện để bàn đo
// còn nghĩa lý: đo một bản sao đã trôi thì con số đo được không nói gì về cái đang chạy.
const shellBody = fs.readFileSync(path.join(REPO, 'extension/media/shell.html'), 'utf8');

// Trang thay `acquireVsCodeApi` bằng một cái giả rồi tự gửi payload — nhờ vậy `designer.js`
// chạy NGUYÊN BẢN, kể cả lớp blueprint.
const page = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>probe · ${payload.file}</title>
<link rel="stylesheet" href="/extension/media/designer.css">
${baseCss}
<style>:root{--vscode-font-family:"Segoe UI",sans-serif;--vscode-font-size:13px;--vscode-foreground:#333;--vscode-editor-background:#fff;--vscode-panel-border:#ddd;--vscode-editorWidget-background:#f3f3f3;--vscode-editorWarning-foreground:#bf8803;--vscode-errorForeground:#c00;--vscode-focusBorder:#0090f1;--vscode-list-hoverBackground:#eef;--vscode-input-background:#fff;--vscode-input-foreground:#000;}</style>
</head><body>
${shellBody}
<script>
  let __state = {};
  window.__sent = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => window.__sent.push(m),
    getState: () => __state,
    setState: (s) => { __state = s; },
  });
  window.__payload = ${JSON.stringify(payload)};
</script>
<script src="/extension/media/designer.js"></script>
<script>window.postMessage(window.__payload, '*');</script>
</body></html>`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), page, 'utf8');

process.stdout.write(`${target}\n`);
process.stdout.write(`  mode        ${result.mode}\n`);
process.stdout.write(`  list px     ${JSON.stringify(result.model?.widths ?? [])}\n`);
process.stdout.write(`  tổng px     ${result.model?.totalWidth}\n`);
if (result.mode === 'form') process.stdout.write(`  panel px    ${result.model?.panelWidth}\n`);
process.stdout.write(`  cảnh báo    ${result.warnings.length}\n`);
process.stdout.write(`  → ${path.join(OUT_DIR, 'index.html')}\n`);

if (!serve) process.exit(0);

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.gif': 'image/gif' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  // `/program/...` phục vụ từ thư mục program của file đang đo — ảnh của CSS controller nằm đó.
  const underProgram = rel.startsWith('/program/');
  // `path.resolve` cả hai vế: `programRoot` suy từ tham số dòng lệnh nên mang gạch xuôi, còn
  // `path.join` trên Windows trả gạch ngược — so `startsWith` giữa hai kiểu gạch luôn sai, và
  // mọi ảnh của program rơi vào 404.
  const rootDir = path.resolve(underProgram ? programRoot : REPO);
  const file = path.resolve(underProgram
    ? path.join(programRoot, rel.slice('/program/'.length))
    : path.join(REPO, rel === '/' ? '/.build/probe/index.html' : rel));
  if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('không có');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => process.stdout.write(`  phục vụ tại http://localhost:${PORT}/\n`));

// render-host.js — phần chung của hai cách xem: custom editor (gắn cứng vào một document) và
// preview panel (bám theo file đang active).
//
// Tách ra vì hai cái đó chỉ khác nhau ở CÂU HỎI "render file nào". Mọi thứ còn lại — suy
// program, dựng shell, bung entity, gọi core, đưa con trỏ về XML — phải giống hệt, nếu không
// thì có hai bản preview nói hai chuyện khác nhau về cùng một file.

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Chỉ ba thư mục này vẽ ra được màn hình: `Dir` và `Filter` ra Form, `Grid` ra lưới.
 *
 * Mọi thư mục khác dưới `Controllers\` — `Include\`, `Lookup\`, `Report\`, `Command\` — là
 * MẢNH, không phải màn hình. Trước đây nhận hết: mở một file Include ra thì designer cố vẽ và
 * cho ra một cái form cụt, trông như màn hình thật nhưng không phải. Thà không vẽ còn hơn vẽ
 * một thứ nói dối.
 *
 * Lưu ý: đây là bộ lọc "có mở designer cho file này không", KHÔNG phải bộ chọn cách vẽ.
 * Vẽ Form hay Grid là do GỐC TÀI LIỆU quyết (`scanRoot`) — có file `<grid>` nằm ngoài `Grid\`.
 */
const CONTROLLER_PATH = /[\\/]App_Data[\\/]Controllers[\\/](Dir|Filter|Grid)[\\/][^\\/]+$/i;

/** Tên thư mục quyết định file có được vẽ không — dùng chung cho thông báo lỗi. */
const RENDERABLE_FOLDERS = ['Dir', 'Filter', 'Grid'];

function config() {
  const c = vscode.workspace.getConfiguration('fboDesigner');
  return {
    autoProgramAssets: c.get('autoProgramAssets') !== false,
    stylesheets: c.get('stylesheets') || [],
    vietnamese: c.get('vietnamese') !== false,
    panelPosition: c.get('panelPosition') || 'right',
  };
}

/**
 * Cột mở panel designer.
 *
 * `ViewColumn.Beside` KHÔNG có nghĩa là "bên phải": nó nghe
 * `workbench.editor.openSideBySideDirection` của VS Code, và ai để setting đó bằng `down` thì
 * panel mở xuống ĐÁY. Đó đúng là chỗ nó đang mọc ra. Mặc định `right` vì thế không dùng
 * `Beside` mà chỉ ra hẳn cột kế tiếp — cột theo số luôn là một nhóm bên phải.
 */
function panelColumn(cfg) {
  const active = vscode.window.activeTextEditor?.viewColumn;
  if (!active) return vscode.ViewColumn.One;
  if (cfg.panelPosition === 'beside') return vscode.ViewColumn.Beside;
  if (cfg.panelPosition === 'active') return active;
  // `right`: VS Code chỉ nhận cột 1..9; kịch trần thì đành để nó tự xử.
  return active < 9 ? active + 1 : vscode.ViewColumn.Beside;
}

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.toLowerCase() === b.toLowerCase();

/** File này có phải controller FBO không — hỏi bằng đường dẫn, không bằng nội dung. */
function isControllerDocument(document) {
  if (!document || document.uri.scheme !== 'file') return false;
  if (!/\.(xml|f)$/i.test(document.uri.fsPath)) return false;
  return CONTROLLER_PATH.test(document.uri.fsPath);
}

/**
 * Tài nguyên của program suy từ CHÍNH FILE ĐANG MỞ, không từ cấu hình.
 * `<program>\App_Data\Controllers\Dir\Site.xml` → `<program>\{Css,Images,ClientScript}`.
 * Không có gì để khai nghĩa là không có gì để khai nhầm sang program của khách khác.
 */
function programAssets(core, fsPath, cfg, output) {
  const paths = core.resolveProgramPaths(fsPath);
  if (!paths || !cfg.autoProgramAssets) return { paths: null, stylesheets: cfg.stylesheets };

  if (!fs.existsSync(paths.programRoot)) {
    output.appendLine(`suy ra program root nhưng không truy cập được: ${paths.programRoot}`);
    return { paths: null, stylesheets: cfg.stylesheets };
  }

  // Khai tay thì tôn trọng khai tay; không khai thì lấy hết .css ở tầng đầu của <program>\Css.
  let stylesheets = cfg.stylesheets;
  if (stylesheets.length === 0 && fs.existsSync(paths.cssDir)) {
    stylesheets = fs.readdirSync(paths.cssDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.css'))
      .map((e) => path.join(paths.cssDir, e.name))
      .sort();
  }
  return { paths, stylesheets };
}

/**
 * `Dir/` và `Filter/` đều là `<dir>` nên đều ra Form; `Grid/` là `<grid type="Detail">` nên ra
 * lưới Detail. Nhãn ghép cả hai vế để nhìn là biết vì sao lại vẽ ra cái đang thấy.
 */
function modeLabel(folder, result) {
  const kind = result.mode === 'grid'
    ? (result.model?.type || result.root?.attrs?.type || 'Grid')
    : 'Form';
  return folder ? `${folder} → ${kind}` : kind;
}

/**
 * `Dir/` mở dialog «Thêm {title}»; `Filter/` thì title ĐÃ LÀ tên màn hình («Lọc dữ liệu»),
 * thêm chữ «Thêm» vào là ra "Thêm Lọc dữ liệu".
 */
function titleMode(folder) {
  return String(folder ?? '').toLowerCase() === 'filter' ? 'plain' : 'add';
}

/**
 * Đọc một lưới Detail cho ô `<items style="Grid" controller="X"/>`.
 *
 * `.xml` TRƯỚC `.f`: `.f` là bản chuẩn của sản phẩm, `.xml` cùng tên là bản customize của
 * khách, và runtime ưu tiên bản customize. Đọc nhầm thứ tự là designer vẽ lưới chuẩn trong khi
 * khách đang chạy lưới đã sửa — sai mà không có dấu hiệu gì.
 *
 * Bung entity luôn tại đây: file lưới có DOCTYPE riêng, chưa bung thì cột khai bằng `&k;`
 * không tra được về `<field>` nào và lưới mất cột.
 *
 * `cache` gom theo một lần render: một form có bốn tab lưới, mà bốn tab đó có thể trỏ chung
 * một Detail.
 */
/**
 * Cấu hình ẩn của một lưới — hai file KHÔNG được controller nhắc tên, nhưng vẫn thêm cột vào nó.
 *
 * Đọc file controller thôi là THIẾU CỘT, và thiếu im lặng: preview đủ hình dạng, chỉ vắng vài
 * cột mà không có dấu hiệu gì. Đo trên `Grid/SOTran.f`: hai cột «Diễn giải» và «Trạng thái» của
 * màn hình thật không có một chữ nào trong file controller.
 *
 *   `Grid/Config/Initialize.xml`   `<controller name="SOTran" group="001"/>` → thân `<group id="001">`
 *   `Grid/Config/Fields/SOTran.xml` bản khai riêng cho controller, và mang cả `arrangement`
 *
 * `Initialize.xml` PHẢI bung entity trước: `<controllers>` của nó gồm toàn `&Control.Field.…;`
 * kéo từ `Include\Field.ent`, chưa bung thì không có `<controller>` nào để đọc. Đo được: bung
 * xong ra 147 controller và 12 group, 0 lỗi entity.
 *
 * Thứ tự trả về là thứ tự GỘP: group trước, bản riêng của controller sau — bản riêng nói lời
 * cuối về `arrangement`.
 */
function loadGridConfig(core, hostPath, readFile, cache) {
  const name = path.basename(hostPath).replace(/\.(xml|f)$/i, '');
  if (cache.has(name)) return cache.get(name);

  const controllers = path.dirname(path.dirname(hostPath));
  const configDir = path.join(controllers, 'Grid', 'Config');
  const parts = [];

  const expand = (file) => {
    const text = readFile(file);
    if (text === null) return null;
    const ex = core.expandEntities(text, { filePath: file, readFile });
    return { text: ex.clearText, segments: ex.segments, file };
  };

  const initFile = path.join(configDir, 'Initialize.xml');
  // Tên controller và id group nhét thẳng vào `new RegExp` nên phải là định danh thuần — một
  // tên chứa `|` hay `(` sẽ đổi hẳn ý nghĩa phép tìm.
  if (fs.existsSync(initFile) && /^[\w.-]+$/.test(name)) {
    const init = expand(initFile);
    if (init) {
      const decl = new RegExp(`<controller\\s+name="${name}"[^>]*\\sgroup="([\\w.-]+)"`, 'i').exec(init.text);
      if (decl) {
        const body = new RegExp(`<group\\s+id="${decl[1]}"[\\s\\S]*?</group>`, 'i').exec(init.text);
        // Thân group nằm TRONG `Initialize.xml` đã bung, nên nó dùng chung `segments` của file ấy.
        if (body) parts.push({ text: body[0], segments: init.segments, file: initFile });
      }
    }
  }

  const fieldsFile = path.join(configDir, 'Fields', `${name}.xml`);
  if (fs.existsSync(fieldsFile)) {
    const own = expand(fieldsFile);
    if (own) parts.push(own);
  }

  cache.set(name, parts);
  return parts;
}

function loadDetail(core, hostPath, name, readFile, cache) {
  if (cache.has(name)) return cache.get(name);

  const controllers = path.dirname(path.dirname(hostPath)); // <program>\App_Data\Controllers
  let found = null;
  for (const ext of ['.xml', '.f']) {
    const candidate = path.join(controllers, 'Grid', `${name}${ext}`);
    if (fs.existsSync(candidate)) { found = candidate; break; }
  }

  let value = null;
  if (found) {
    const text = readFile(found);
    if (text !== null) {
      const expanded = core.expandEntities(text, { filePath: found, readFile });
      value = { text: expanded.clearText, segments: expanded.segments, file: found };
    }
  }
  cache.set(name, value);
  return value;
}


/**
 * Viết lại `url(...)` trong CSS do controller khai, quy về URI của webview.
 *
 * Mấy chuỗi CSS đó viết như thể chúng nằm trong `<program>\Css\`, nên `url(../Images/Extra.png)`
 * nghĩa là `<program>\Images\Extra.png`. Nhét thẳng vào `<style>` của webview thì đường dẫn
 * tương đối lại được tính theo URI của TRANG, trỏ đi đâu không biết — và nút «Khác…» mất icon
 * đúng theo cách khó lần ra nhất: CSS có đủ rule, chỉ ảnh là không tải được.
 *
 * `data:` giữ nguyên — icon của nút riêng thường nằm ngay trong đó.
 */
function rewriteControllerCssUrls(css, webview, paths, bust, output) {
  if (!css || !paths) return css || '';
  const cssDir = path.join(paths.programRoot, 'Css');
  return css.replace(RE_CSS_URL, (m, _q, url) => {
    if (/^(data:|https?:|#|\/\/)/i.test(url)) return m;
    const target = path.resolve(cssDir, url.split('?')[0].split('#')[0]);
    if (!fs.existsSync(target)) {
      output.appendLine(`css của controller: url(${url}) không có file tương ứng (${target})`);
      return m;
    }
    return `url("${assetUri(webview, target, bust)}")`;
  });
}

/** Bung entity rồi gọi core. Ném ra ngoài để người gọi quyết hiện lỗi thế nào. */
function buildPayload(core, document, { cfg, paths, output, webview = null, bust = 0 }) {
  const readFile = (abs) => {
    try { return fs.existsSync(abs) ? core.readSource(abs).text : null; } catch { return null; }
  };

  // Bung entity TRƯỚC khi render: hàng từ Include (vd BI mode) không tồn tại trong file gốc,
  // không bung thì form thiếu hàng mà không có cảnh báo nào.
  const expanded = core.expandEntities(document.getText(), {
    filePath: document.uri.fsPath,
    readFile,
  });
  const detailCache = new Map();
  const configCache = new Map();
  const result = core.renderControllerHtml(expanded.clearText, {
    vi: cfg.vietnamese,
    titleMode: titleMode(paths?.folder),
    segments: expanded.segments,
    hostFile: document.uri.fsPath,
    loadDetail: (name) => loadDetail(core, document.uri.fsPath, name, readFile, detailCache),
    // Cấu hình ẩn của `Grid/Config` — hai file không được controller nhắc tên nhưng vẫn thêm cột.
    gridConfig: loadGridConfig(core, document.uri.fsPath, readFile, configCache),
  });

  for (const d of expanded.diagnostics) output.appendLine(`entity [${d.severity}] ${d.message}`);

  // File nào đã GÓP nội dung vào bản vẽ này — controller cộng mọi Include mà nó kéo vào.
  //
  // Panel dùng nó để không tự xoá trắng khi người dùng nhảy sang một file Include: mở Include
  // ra chính là việc designer vừa bảo họ làm (bấm vào một ô là nhảy tới đó), nên coi cú nhảy
  // đó là "đổi sang file không vẽ được" thì form biến mất ngay lúc cần nhìn nó nhất.
  // Cộng cả file lưới Detail nhúng trong tab (và Include của CHÚNG) — mở một lưới con ra để
  // sửa cột cũng là việc thường, và panel không được xoá trắng vì chuyện đó.
  const sourceFiles = [...new Set([
    ...expanded.segments.map((s) => s.file),
    ...[...detailCache.values()].filter(Boolean).flatMap((d) => [d.file, ...d.segments.map((s) => s.file)]),
  ])];

  return {
    type: 'render',
    // Model KHÔNG gửi sang webview (nó có hàm, có Map — không postMessage được). Nó ở lại phía
    // host cho tầng edit dùng; `post()` bỏ qua khoá này.
    model: result.model,
    html: result.html,
    mode: result.mode,
    // Lưới danh sách đứng riêng (`type="Voucher"|"Report"`) rộng bằng khung nhìn chứ không bằng
    // tổng px cột — webview phải nới `#fbo-stage` ra, xem `fbo-fit-width`.
    fitWidth: result.fitWidth === true,
    modeLabel: modeLabel(paths?.folder, result),
    controllerCss: rewriteControllerCssUrls(result.css, webview, webview ? paths : null, bust, output),
    sourceFiles,
    // Lớp blueprint kẻ vạch theo ĐÚNG list px này, không đo lại từ DOM — xem designer.js.
    columns: result.model?.widths ?? [],
    warnings: result.warnings,
    // `document.encoding` là API mới; chưa có thì nói chưa biết, không đoán.
    encoding: document.encoding ?? '(VS Code không cho biết)',
    eol: document.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF',
    file: path.basename(document.uri.fsPath),
    path: document.uri.fsPath,
    program: paths ? paths.programRoot : '(không suy được program từ đường dẫn)',
    entities: {
      declared: expanded.declarations.size,
      foreignRows: result.model?.foreignRows ?? 0,
      diagnostics: expanded.diagnostics,
    },
  };
}

/**
 * URI tài nguyên có DẤU PHIÊN BẢN.
 *
 * Webview của VS Code cache theo URI, và URI do `asWebviewUri` sinh ra là cố định theo đường
 * dẫn — sửa CSS rồi cài lại .vsix thì webview vẫn dùng bản cũ trong cache, không có cách nào
 * ép nó tải lại ngoài việc đổi URI. `?v=<mtime>` đổi khi và chỉ khi file đổi, nên nó vừa ép
 * tải lại đúng lúc cần vừa không phá cache lúc không cần.
 *
 * `bust` là số phiên tăng thêm cho nút "Nạp lại tài nguyên" trong debug mode — dùng khi nghi
 * ngờ cache mà mtime không đổi (chép file bằng công cụ giữ nguyên timestamp chẳng hạn).
 */
function assetUri(webview, absPath, bust) {
  let mtime = '0';
  try { mtime = String(Math.floor(fs.statSync(absPath).mtimeMs)); } catch { /* thiếu file: để 0 */ }
  const query = bust ? `v=${mtime}.${bust}` : `v=${mtime}`;
  return webview.asWebviewUri(vscode.Uri.file(absPath)).with({ query });
}

const RE_CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Base pack NHÚNG THẲNG vào trang, với mọi `url()` viết lại thành URI có dấu phiên bản.
 *
 * Vì sao không để `<link>` như CSS của program: `?v=` trên thẻ `<link>` chỉ ép tải lại chính
 * file CSS. Ảnh mà CSS trỏ tới bằng đường dẫn tương đối (`url(../image/fbo-cell-icons.gif)`)
 * thì trình duyệt tự ghép URL — không có query, nên vẫn lấy từ cache. Sprite icon đổi mà
 * người dùng vẫn thấy hình cũ chính là chỗ này.
 *
 * Chỉ làm với base pack: nó nhỏ (~17KB), là của ta, và ta biết chắc mỗi `url()` trỏ đi đâu.
 * CSS của program giữ nguyên `<link>` — nó lớn, là của khách, và viết lại đường dẫn trong đó
 * là tự nhận rủi ro cho một thứ mình không kiểm soát.
 */
function inlineBaseCss(webview, baseDir, bust, output) {
  if (!fs.existsSync(baseDir)) return '';
  return fs.readdirSync(baseDir)
    .filter((f) => f.toLowerCase().endsWith('.css'))
    .sort()
    .map((f) => {
      const abs = path.join(baseDir, f);
      const raw = fs.readFileSync(abs, 'utf8');
      // Một chuỗi `</style` trong CSS sẽ thoát khỏi thẻ và phá cả trang. Không có file nào như
      // vậy hôm nay, nhưng nhúng thì phải kiểm — rơi về <link> còn hơn dựng ra trang hỏng.
      if (/<\/style/i.test(raw)) {
        output.appendLine(`base css ${f} có chuỗi </style — giữ dạng <link>, ảnh trong đó có thể bị cache`);
        return `<link rel="stylesheet" href="${assetUri(webview, abs, bust)}" data-fbo-css="base/${f}">`;
      }
      const css = raw.replace(RE_CSS_URL, (m, _q, url) => {
        if (/^(data:|https?:|#|\/\/)/i.test(url)) return m;
        const target = path.resolve(path.dirname(abs), url.split('?')[0].split('#')[0]);
        if (!fs.existsSync(target)) {
          output.appendLine(`base css ${f}: url(${url}) không có file tương ứng`);
          return m;
        }
        return `url("${assetUri(webview, target, bust)}")`;
      });
      return `<style data-fbo-css="base/${f}">\n${css}\n</style>`;
    })
    .join('\n');
}

/**
 * Shell HTML. CSP chặt: chỉ script mang nonce, chỉ tài nguyên qua `webview.cspSource`.
 * @param {number} bust số phiên, tăng lên khi người dùng bấm nạp lại tài nguyên
 */
function shellHtml(context, webview, stylesheets, output, bust = 0) {
  const n = nonce();
  const asset = (p) => assetUri(webview, p, bust);
  const links = stylesheets
    .filter((p) => {
      const okPath = fs.existsSync(p);
      if (!okPath) output.appendLine(`stylesheet không tồn tại, bỏ qua: ${p}`);
      return okPath;
    })
    .map((p) => `<link rel="stylesheet" href="${asset(p)}" data-fbo-css="${path.basename(p)}">`)
    .join('\n');

  const shellCss = asset(path.join(context.extensionUri.fsPath, 'media', 'designer.css'));
  const shellJs = asset(path.join(context.extensionUri.fsPath, 'media', 'designer.js'));

  // Base pack: CSS nền trích từ runtime. Nạp SAU khung, TRƯỚC CSS program — đúng thứ tự của
  // runtime, vì Menu.css của program là lớp vá (`padding-right: 1px !important`) chứ không
  // phải lớp nền. Đảo thứ tự là để lớp vá bị nền đè, tức là vá vô hiệu.
  // Giữ nguyên layout css/ + image/ của bộ gốc: `url(../image/fbo-required.png)` trong CSS
  // chỉ phân giải đúng khi file CSS còn nằm trong một thư mục `css/` anh em với `image/`.
  const baseDir = path.join(context.extensionUri.fsPath, 'media', 'base', 'css');
  const baseLinks = inlineBaseCss(webview, baseDir, bust, output);

  // Thân shell nằm ở file riêng, dùng chung với `tools/probe-layout.mjs`. Giữ hai bản là bàn
  // đo đo một cái shell khác cái đang chạy.
  const body = fs.readFileSync(path.join(context.extensionUri.fsPath, 'media', 'shell.html'), 'utf8');

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${n}';">
<link rel="stylesheet" href="${shellCss}">
${baseLinks}
${links}
</head>
<body>
${body}
<script nonce="${n}" src="${shellJs}"></script>
</body>
</html>`;
}

function rangeIn(document, start, end) {
  const max = document.getText().length;
  const a = Math.max(0, Math.min(start, max));
  const b = Math.max(a, Math.min(end, max));
  return new vscode.Range(document.positionAt(a), document.positionAt(b));
}

async function revealIn(document, viewColumn, start, end) {
  const range = rangeIn(document, start, end);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn,
    preserveFocus: true,
    selection: range,
  });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Bấm vào một ô → đưa con trỏ tới đúng khai báo sinh ra nó. Thứ tự ưu tiên, và thứ tự này
 * chính là yêu cầu "không cần mở file mà nhảy về đúng file đang mở":
 *
 *   1. File sở hữu ĐANG MỞ SẴN ở một editor nhìn thấy được → nhảy ngay tại editor đó, đúng
 *      cột đó. Không `openTextDocument`, không thêm tab, không đổi bố cục.
 *   2. Hàng đến từ Include mà file Include chưa mở → nhảy về dải `&Name;` trong chính file
 *      đang xem. Đó mới là chỗ người dùng sửa được, và nó nằm ngay trước mắt họ.
 *   3. Hết cách (hoặc người dùng Alt-click để đòi mở) mới mở file sở hữu ra, bên cạnh.
 */
/**
 * Bấm vào một ô → đưa con trỏ về chỗ ĐỊNH NGHĨA ra nó.
 *
 * Mặc định là mở đúng file khai hàng đó, kể cả khi file ấy là một Include. Trước đây mặc định
 * ngược lại — ở lại controller và trỏ vào `&Name;` đã kéo hàng vào — và cái đó hỏng theo cách
 * khó chịu: cả trăm hàng của một Include dùng chung ĐÚNG MỘT tham chiếu, nên bấm field nào con
 * trỏ cũng đứng nguyên một chỗ. Người dùng đọc ra thành "không navigation được", và đọc vậy là
 * đúng: không có thông tin nào mới hiện ra.
 *
 * Alt-click giữ lối cũ cho ai cần: chỉ ra chỗ trong file ĐANG MỞ đã kéo hàng đó vào, không rời
 * file đang sửa.
 */
async function revealSource(msg, hostDocument, output) {
  const hostPath = hostDocument?.uri.fsPath ?? '';
  const target = msg.file || hostPath;

  // Alt-click: ở lại file đang mở, trỏ vào chính `&Name;`.
  if (msg.hostRefOnly && !samePath(target, hostPath) && Number.isFinite(msg.hostStart)) {
    const hostEditor = vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, hostPath));
    if (hostEditor) return revealIn(hostEditor.document, hostEditor.viewColumn, msg.hostStart, msg.hostEnd);
    if (hostDocument) return revealIn(hostDocument, vscode.ViewColumn.Beside, msg.hostStart, msg.hostEnd);
  }

  // File đã mở sẵn thì dùng lại tab đó, đừng mở thêm một bản nữa ở cột khác.
  const visible = vscode.window.visibleTextEditors.find((e) => samePath(e.document.uri.fsPath, target));
  if (visible) return revealIn(visible.document, visible.viewColumn, msg.start, msg.end);

  const opened = await vscode.workspace.openTextDocument(vscode.Uri.file(target)).then(
    (d) => d,
    (err) => { output.appendLine(`không mở được ${target}: ${err.message}`); return null; },
  );
  if (!opened) return;
  return revealIn(opened, vscode.ViewColumn.Beside, msg.start, msg.end);
}

module.exports = {
  config,
  panelColumn,
  loadDetail,
  isControllerDocument,
  programAssets,
  buildPayload,
  shellHtml,
  revealSource,
  samePath,
};

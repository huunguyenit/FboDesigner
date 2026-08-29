// designer.js — code chạy TRONG webview. Không biết gì về FBO: nó hiển thị HTML core gửi sang
// và gửi ngược lại ý định của người dùng. Mọi ngữ nghĩa nằm ở core.
//
// Hai lớp, và ranh giới giữa chúng là điều quan trọng nhất của file này:
//
//   #fbo-form        HTML do core sinh, GIỮ NGUYÊN. Không thêm class, không sửa style, không
//                    bọc thêm thẻ. Đây là thứ phải giống runtime từng px.
//   #fbo-blueprint   lớp vẽ đè của designer: thước, vạch cột, khung slot. `position:absolute`,
//                    `pointer-events:none`, sinh lại từ đầu mỗi lần render.
//
// Trộn hai lớp là mất luôn khả năng trả lời "cái đang thấy có phải cái runtime vẽ không".

const vscode = acquireVsCodeApi();

const stage = document.getElementById('fbo-stage');
const zoomLayer = document.getElementById('fbo-zoom');
const formLayer = document.getElementById('fbo-form');
const blueprint = document.getElementById('fbo-blueprint');
const fileLabel = document.getElementById('fbo-file');
const modeLabel = document.getElementById('fbo-mode');
const metaLabel = document.getElementById('fbo-meta');
const blueprintToggle = document.getElementById('fbo-blueprint-toggle');
const zoomSelect = document.getElementById('fbo-zoom-select');
const debugToggle = document.getElementById('fbo-debug-toggle');
const debugPanel = document.getElementById('fbo-debug');
const debugBody = document.getElementById('fbo-debug-body');
const reloadAssetsButton = document.getElementById('fbo-reload-assets');

/** Chiều cao thước, và cũng là khoảng chừa ở `body.bp-on #fbo-stage { margin-top }`. */
const RULER_H = 20;
const RULER_GAP = 4;

let selected = null;
/** Ô đang multi-select (Shift+click). Luôn chứa `selected` khi size ≥ 1. */
let multiSelected = new Set();
/** Neo cho Shift+click range (ô click thường gần nhất). */
let selectAnchor = null;
let layout = null; // { widths: number[], mode: string }

const saved = vscode.getState() || {};
let blueprintOn = true;
if (blueprintToggle) {
  blueprintToggle.checked = true;
  const wrap = blueprintToggle.closest('.fbo-toggle');
  if (wrap) wrap.hidden = true;
}
document.body.classList.add('bp-on');
vscode.setState({ ...saved, blueprint: true });

/**
 * Tỉ lệ NHÌN — không phải tỉ lệ thật của form.
 *
 * Vì sao cần: form vẽ đúng 573px CSS như runtime, nhưng Cursor/VS Code áp `window.zoomLevel`
 * lên cả webview, còn trình duyệt có mức zoom riêng của nó. Cùng một con số px CSS mà hai bên
 * vẽ ra hai kích thước vật lý khác nhau — nhìn thì tưởng form bị thu nhỏ. Nút này cho phóng
 * to riêng vùng form mà không phải zoom cả cửa sổ Cursor.
 *
 * Ràng buộc: nó chỉ được đổi cách NHÌN. Thước blueprint vẫn ghi px khai trong XML, và mọi
 * phép đo trong `drawBlueprint` quy về hệ toạ độ đã nhân tỉ lệ bằng cách đo lại từ chính cái
 * bảng — xem `drawBlueprint`.
 */
let zoom = Number(saved.zoom) > 0 ? Number(saved.zoom) : 1;
zoomSelect.value = String(zoom);
applyZoom();

zoomSelect.addEventListener('change', () => {
  zoom = Number(zoomSelect.value) || 1;
  vscode.setState({ ...vscode.getState(), zoom });
  applyZoom();
  drawBlueprint();
});

function applyZoom() {
  zoomLayer.style.zoom = zoom === 1 ? '' : String(zoom);
}

// ---------------------------------------------------------------------------
// Debug mode
// ---------------------------------------------------------------------------
//
// Sinh ra từ một lỗi thật: icon Lookup hiện sai hình, và không có cách nào nhìn ra là do
// `<img src>` trỏ nhầm hay do webview giữ ảnh cũ trong cache — hai nguyên nhân khác hẳn nhau,
// cách sửa cũng khác hẳn. Bảng dưới đây phân biệt được chúng trong một cái liếc: mỗi ảnh
// hiện URL thật, kích thước THẬT của file tải về, và kích thước đang vẽ.

let debugOn = saved.debug === true;
debugToggle.checked = debugOn;
document.body.classList.toggle('debug-on', debugOn);
debugPanel.hidden = !debugOn;

debugToggle.addEventListener('change', () => {
  debugOn = debugToggle.checked;
  document.body.classList.toggle('debug-on', debugOn);
  debugPanel.hidden = !debugOn;
  vscode.setState({ ...vscode.getState(), debug: debugOn });
  if (debugOn) renderDebug();
});

reloadAssetsButton.addEventListener('click', () => vscode.postMessage({ type: 'reloadAssets' }));

/** Mọi URL ảnh đang thật sự dùng: `src` của `<img>` + `background-image` của mọi phần tử. */
function collectImageUrls() {
  const urls = new Map(); // url -> { từ: Set, dùngBởi: element đầu tiên }
  const add = (url, how, el) => {
    if (!url || url.startsWith('data:')) return;
    if (!urls.has(url)) urls.set(url, { how: new Set(), el });
    urls.get(url).how.add(how);
  };
  for (const img of formLayer.querySelectorAll('img')) add(img.currentSrc || img.src, 'img src', img);
  for (const el of formLayer.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    for (const m of bg.matchAll(/url\("?([^")]+)"?\)/g)) add(m[1], 'background', el);
  }
  return urls;
}

/** Tải riêng từng URL để biết kích thước THẬT — `<img>` bị CSS ép cỡ nên nhìn không ra. */
function probeImage(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ url, ok: true, w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => resolve({ url, ok: false, w: 0, h: 0 });
    probe.src = url;
  });
}

const shortUrl = (u) => {
  const q = u.indexOf('?');
  const name = u.slice(u.lastIndexOf('/') + 1, q === -1 ? undefined : q);
  return q === -1 ? name : `${name}?${u.slice(q + 1)}`;
};

function table(caption, headers, rows) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><caption>${esc(caption)}</caption><tr>${head}</tr>${body}</table>`;
}

async function renderDebug() {
  if (!debugOn) return;

  const sheets = [...document.querySelectorAll('link[data-fbo-css], style[data-fbo-css]')].map((el) => {
    const inline = el.tagName === 'STYLE';
    let loaded = inline;
    if (!inline) {
      for (const s of document.styleSheets) {
        try { if (s.href === el.href && s.cssRules) { loaded = true; break; } } catch { /* chặn = chưa nạp */ }
      }
    }
    return [
      el.dataset.fboCss,
      inline ? '<em>nhúng thẳng</em>' : shortUrl(el.href),
      loaded ? '<span class="ok">nạp được</span>' : '<span class="bad">KHÔNG nạp được</span>',
    ];
  });

  const urls = collectImageUrls();
  const probed = await Promise.all([...urls.keys()].map(probeImage));
  const images = probed.map((p) => {
    const info = urls.get(p.url);
    const el = info.el;
    const box = el ? el.getBoundingClientRect() : null;
    const how = [...info.how].join(' + ');

    // Ảnh nền là SPRITE: to hơn ô vẽ nó là chuyện bình thường, thứ cần nhìn là cắt ở đâu.
    // Ảnh qua `src` thì ngược lại — lệch cỡ nghĩa là đang bị CSS bóp méo, và đó chính là
    // triệu chứng của "icon hiện sai hình".
    let verdict;
    if (info.how.has('img src')) {
      const fits = p.ok && p.w === Math.round(box?.width) && p.h === Math.round(box?.height);
      verdict = fits ? '<span class="ok">đúng cỡ</span>' : '<span class="bad">bị CSS ép cỡ</span>';
    } else {
      const cs = el ? getComputedStyle(el) : null;
      verdict = cs ? `cắt tại ${cs.backgroundPosition} · ${cs.backgroundRepeat}` : '—';
    }

    return [
      how,
      shortUrl(p.url),
      p.ok ? `${p.w}×${p.h}` : '<span class="bad">không tải được</span>',
      box ? `${Math.round(box.width)}×${Math.round(box.height)}` : '—',
      verdict,
    ];
  });

  const cell = selected ? [
    ['token', selected.dataset.fboToken || '(trống)'],
    ['cột / trải / px', `${selected.dataset.fboCol} / ${selected.dataset.fboSpan} / ${selected.dataset.fboWidth}`],
    ['class', selected.className],
    ['file gốc', (selected.closest('[data-fbo-file]') || {}).dataset?.fboFile || '(chính file này)'],
    ['offset', (() => {
      const a = selected.closest('[data-fbo-src-start]');
      return a ? `${a.dataset.fboSrcStart}–${a.dataset.fboSrcEnd}` : '—';
    })()],
    ['HTML', `<pre>${selected.outerHTML.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`],
  ] : [];

  debugBody.innerHTML =
    table(`Stylesheet (${sheets.length})`, ['nguồn', 'URL', 'trạng thái'], sheets)
    + table(`Ảnh đang dùng (${images.length}) — ảnh nền là sprite nên to hơn ô là đúng; ảnh qua src thì phải bằng`,
      ['dùng qua', 'URL', 'cỡ file', 'cỡ ô vẽ', 'nhận xét'], images)
    + (cell.length
      ? table('Ô đang chọn', ['', ''], cell.map(([k, v]) => [k, v]))
      : '<p class="fbo-hint">Bấm một ô để xem chi tiết của nó ở đây.</p>');
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'error') return showError(msg);
  if (msg.type === 'idle') return showIdle(msg);
  if (msg.type === 'patchRow') return patchRow(msg);
  if (msg.type === 'dialog-show') return showDialog(msg.id, msg.options);
  if (msg.type !== 'render') return;

  formLayer.innerHTML = msg.html;
  layout = { widths: msg.columns || [], mode: msg.mode || 'form' };

  /*
   * Lưới danh sách đứng riêng chiếm hết bề ngang khung nhìn; mọi thứ khác ôm sát nội dung.
   *
   * `#fbo-stage` (và `#fbo-zoom`) là `inline-block` để thước blueprint không dài hơn cái form
   * nó đang đo. Nhưng `inline-block` co theo nội dung, nên `width:100%` mà core đặt trên panel
   * lưới sẽ quy về chính bề rộng co ấy — tức không nới được gì. Nới ở đây, bằng một class trên
   * `<body>`, thay vì lật `inline-block` vĩnh viễn: form thì vẫn cần ôm sát.
   */
  document.body.classList.toggle('fbo-fit-width', msg.fitWidth === true);

  fileLabel.textContent = msg.file;
  fileLabel.title = msg.path || msg.file;
  modeLabel.textContent = msg.modeLabel || '';
  modeLabel.hidden = !msg.modeLabel;
  metaLabel.textContent = `${msg.encoding} · ${msg.eol} · ${msg.program}`;
  metaLabel.title = msg.program;

  reportEntities(msg.entities);
  reportWarnings(msg.warnings);
  focused = null;
  selected = null;
  multiSelected.clear();
  selectAnchor = null;
  // File vừa vẽ lại: số cột có thể đã khác (chính phép tách/gộp này đổi nó), nên giữ lại chỉ số
  // cột cũ là trỏ vào một cột khác hẳn.
  colPick = null;
  applyControllerCss(msg.controllerCss);
  wireSelection(formLayer);
  wireTabs();
  syncGridScroll();
  drawBlueprint();
  renderDebug();
});

/**
 * RENDER CỤC BỘ: thay đúng một `<tr>` (hoặc hai khi vùng có split), giữ phần còn lại của trang.
 *
 * Chỉ gộp/tách ô đi đường này (host quyết, xem `preview-panel.js`). Cái được giữ lại mới là lý
 * do nó tồn tại: vị trí cuộn, tab đang mở, và trạng thái cuộn ngang của mọi lưới nhúng — dựng
 * lại `innerHTML` là mất sạch cả ba, và mất đúng vào lúc người dùng đang kéo cho vừa một hàng.
 *
 * Vùng có `split` → cùng `data-fbo-item` có HAI `<tr>` (trái + phải). `msg.html` mang đúng hai
 * hàng; thay từng cặp theo `data-fbo-split-side`, không chỉ cái đầu tiên.
 *
 * Ô đang chọn được CHỌN LẠI theo chỉ số, không giữ tham chiếu cũ: `<td>` cũ đã rời khỏi cây
 * DOM, và cầm tiếp nó thì thanh lệnh vẽ theo một hình chữ nhật không còn tồn tại.
 *
 * Không tìm thấy hàng thì im lặng — host đã tự vẽ lại toàn bộ trong trường hợp đó.
 */
function patchRow(msg) {
  const olds = [...formLayer.querySelectorAll(`tr.FormRow[data-fbo-item="${msg.item}"]`)];
  if (olds.length === 0) return;

  const holder = document.createElement('tbody');
  holder.innerHTML = msg.html;
  const fresh = [...holder.querySelectorAll('tr')];
  if (fresh.length === 0) return;

  const bySide = (rows, side) => rows.find((tr) => tr.dataset.fboSplitSide === side);
  const pairs = olds.length === fresh.length && olds.some((tr) => tr.dataset.fboSplitSide)
    ? olds.map((old) => {
      const side = old.dataset.fboSplitSide;
      return { old, next: (side && bySide(fresh, side)) || fresh[olds.indexOf(old)] };
    })
    : olds.map((old, i) => ({ old, next: fresh[Math.min(i, fresh.length - 1)] }));

  let selectedFresh = null;
  for (const { old, next } of pairs) {
    if (!next) continue;
    const wasSelected = old.classList.contains('fbo-row-selected');
    old.replaceWith(next);
    // Chỉ nối listener cho hàng MỚI. Nối lại cho cả `formLayer` là chồng thêm một bộ listener lên
    // mọi ô cũ, và sau mười lần gộp thì một cú bấm gửi đi mười thông điệp.
    wireSelection(next);
    if (wasSelected) selectedFresh = next;
  }

  if (selectedFresh) {
    // Sau phép DỜI, control nằm ở CỘT khác và chỉ số ô đã đổi theo (ô trống bị ăn mất). Chọn
    // lại theo cột mới; chỉ số ô chỉ đúng cho gộp/tách/thêm/xoá, nơi ô không đi đâu cả.
    // Ô có thể nằm ở nửa trái hoặc nửa phải — tìm trên mọi hàng vừa vá.
    const allFresh = pairs.map((p) => p.next).filter(Boolean);
    const byCol = msg.col === undefined || msg.col === null
      ? null
      : allFresh.map((tr) => tr.querySelector(`td[data-fbo-col="${msg.col}"]`)).find(Boolean);
    const cell = byCol
      || allFresh.map((tr) => tr.querySelector(`td[data-fbo-cell="${msg.cell}"]`)).find(Boolean)
      || selectedFresh.querySelector('td[data-fbo-cell]');
    if (cell) selectCell(cell);
  }
  reportWarnings(msg.warnings);
  drawBlueprint();
  renderDebug();
}

/**
 * Chuyển tab của các vùng `categoryIndex > 0`.
 *
 * Vẽ lại blueprint sau khi đổi tab là bắt buộc, không phải cho đẹp: panel đang ẩn có
 * `getBoundingClientRect()` toàn số 0, nên mọi slot của nó bị bỏ qua lúc vẽ. Không vẽ lại thì
 * tab vừa mở ra không có lưới, và người dùng tưởng vùng đó rỗng.
 */
/**
 * Tab NÀO đang mở — nhớ qua mỗi lần vẽ lại.
 *
 * Mọi phép sửa (gộp/tách/dời/xoá/thêm) đều làm file đổi, và file đổi thì cả form được dựng lại
 * từ đầu — `formLayer.innerHTML = …` xoá sạch trạng thái DOM, nên tab luôn nhảy về cái đầu tiên.
 * Người dùng đang đứng ở tab «Thông tin khác» sửa một control thì bị ném về tab «Chi tiết», rồi
 * phải tự bấm quay lại. Sửa mười control là mười lần như vậy.
 *
 * Nhớ theo `id` của panel chứ không theo chỉ số: chỉ số đổi khi thêm/bớt tab, và khi ấy khôi
 * phục theo chỉ số là mở nhầm tab. `id` không còn thì im lặng rơi về tab đầu — đó là hành vi cũ,
 * đúng cho trường hợp tab ấy vừa bị xoá.
 */
let activeTabId = null;

function selectTab(list, button) {
  for (const b of list.querySelectorAll('.DwfTabButton')) {
    b.setAttribute('aria-selected', String(b === button));
  }
  for (const panel of formLayer.querySelectorAll('.DwfTabPanel')) {
    panel.classList.toggle('DwfActive', panel.id === button.dataset.target);
  }
  activeTabId = button.dataset.target || null;
}

function wireTabs() {
  const list = formLayer.querySelector('.DwfTabList');
  if (!list) return;

  // Khôi phục TRƯỚC khi gắn listener: `restoreTab` chỉ đổi class, không bắn click nào.
  restoreTab(list);

  list.addEventListener('click', (e) => {
    const button = e.target.closest('.DwfTabButton');
    if (!button) return;
    selectTab(list, button);
    drawBlueprint();
  });
}

function restoreTab(list) {
  if (!activeTabId) {
    // Lần vẽ đầu: ghi lại tab mà core đã mở sẵn, để lần sau có mốc mà quay về.
    const current = list.querySelector('.DwfTabButton[aria-selected="true"]');
    activeTabId = current ? current.dataset.target || null : null;
    return;
  }
  const want = [...list.querySelectorAll('.DwfTabButton')]
    .find((b) => b.dataset.target === activeTabId);
  // Tab cũ không còn (vừa bị xoá) → để nguyên tab core mở sẵn, và quên mốc cũ đi.
  if (!want) { activeTabId = null; return; }
  selectTab(list, want);
}

/** Không có controller nào đang mở — nói thẳng, đừng để lại form của file trước trên màn hình. */
function showIdle(msg) {
  layout = null;
  selected = null;
  multiSelected.clear();
  selectAnchor = null;
  blueprint.innerHTML = '';
  formLayer.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'fbo-hint';
  p.textContent = msg.message;
  formLayer.appendChild(p);
  fileLabel.textContent = msg.file || '—';
  modeLabel.hidden = true;
  metaLabel.textContent = '';
}

/**
 * Số liệu chẩn đoán đi vào KÊNH OUTPUT, không lên thanh dưới.
 *
 * «Bung được bao nhiêu entity», «bao nhiêu hàng đến từ Include» là thứ cần đúng một lần, lúc
 * đang truy một chuyện lạ — không phải thứ chiếm một dòng cố định ngay dưới cái form suốt cả
 * phiên. Thanh dưới nay chỉ còn dòng hướng dẫn thao tác (xem `shell.html`).
 *
 * Vẫn phải nói ra chứ không im: entity không phân giải được nghĩa là form đang THIẾU hàng, và
 * thiếu im lặng thì người dùng tin cái họ đang nhìn là đủ.
 */
function reportEntities(info) {
  if (!info) return;
  const bad = (info.diagnostics || []).filter((d) => d.severity === 'error').length;
  const parts = [`${info.declared} entity`];
  if (info.foreignRows > 0) parts.push(`${info.foreignRows} hàng từ Include (khoá)`);
  // Hai màu, hai nghĩa khác nhau — nói ra để không ai đoán. Xem `data-fbo-product` ở designer.css.
  if (info.productRows > 0) parts.push(`${info.productRows} hàng/cột từ bản chuẩn .f (không sửa được)`);
  if (bad > 0) parts.push(`${bad} entity KHÔNG phân giải được — form đang thiếu hàng`);
  vscode.postMessage({ type: 'log', text: `entity: ${parts.join(' · ')}` });
}

function showError(msg) {
  layout = null;
  blueprint.innerHTML = '';
  formLayer.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'fbo-error';
  pre.textContent = `Lỗi render: ${msg.message}\n\n${msg.stack}`;
  formLayer.appendChild(pre);
}

/**
 * Cảnh báo của core cũng đi vào KÊNH OUTPUT — cùng lý do với `reportEntities`.
 *
 * Chúng nói về XML («pattern dài hơn số cột: cắt mất 1 control», «token không có <field>
 * tương ứng»), tức thứ người ta đọc khi đang truy một chỗ vẽ ra lạ, không phải thứ liếc trong
 * lúc kéo thả. Một danh sách gạch đầu dòng nằm cố định dưới form thì lần thứ ba đọc là hết
 * nhìn thấy nó nữa.
 */
function reportWarnings(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  // Mỗi cảnh báo một thông điệp: host gọi `appendLine`, nên một dòng Output cho một cảnh báo —
  // gộp cả cụm vào một chuỗi thì kênh Output chỉ xuống dòng chứ không đánh dấu thời điểm.
  vscode.postMessage({ type: 'log', text: `${list.length} cảnh báo trên bản vẽ:` });
  for (const w of list) vscode.postMessage({ type: 'log', text: `  item ${w.item}: ${w.message}` });
}

/**
 * Bấm một ô → CHỌN nó. Nhảy tới khai báo trong XML là một hành động RIÊNG.
 *
 * Vì sao tách làm hai: chọn là thao tác dùng liên tục — chọn để xem thông số, để mở thanh lệnh,
 * để nhắm trước khi gộp/tách. Nhảy tới nguồn thì ngược lại, nó có thể MỞ MỘT FILE KHÁC (hàng
 * đến từ Include) và cuốn con trỏ trong editor đi chỗ khác. Buộc hai thứ vào cùng một cú bấm
 * nghĩa là mỗi lần muốn chọn một ô lại phải trả giá bằng một lần editor nhảy — và người dùng
 * không có cách nào chọn mà không nhảy.
 *
 * Quy ước, theo đúng thói quen «đi tới định nghĩa» của editor:
 *   bấm             → chọn, không nhảy
 *   Ctrl/Cmd + bấm  → nhảy tới khai báo
 *   bấm đúp         → nhảy tới khai báo
 *   giữ thêm Alt    → ở lại file đang mở, chỉ trỏ vào `&Name;` đã kéo hàng đó vào
 *
 * Khi nhảy, gửi CẢ HAI mốc: `start/end` trong file sở hữu thật, và `hostStart/hostEnd` là dải
 * `&Name;` trong file đang mở. Bên extension chọn mốc nào tuỳ file nào đang mở sẵn — webview
 * không biết cửa sổ bên kia đang có gì, nên không được quyền quyết.
 */
function wireSelection(root) {
  for (const cell of root.querySelectorAll('td[data-fbo-col], th[data-fbo-col]')) {
    if (cell.closest('.DwfColRow')) continue;

    /*
     * Ô TRONG CÙNG thắng. Lưới nhúng trong tab là bảng lồng trong bảng, nên một cú bấm vào ô
     * của lưới đi qua HAI listener: ô của lưới trước, rồi ô `FormCellGrid` của form. Không
     * chặn thì cái sau ghi đè cái trước, và bấm vào cột nào cũng nhảy về `<item>` của form
     * thay vì về `<field>` của cột đó.
     *
     * Chặn ở đây cho ra đúng hai hành vi mong muốn: bấm vào cột → tới khai báo cột trong file
     * lưới; bấm vào vùng trống / toolbar của tab → nổi lên ô form và tới `<item>` của nó.
     */
    cell.addEventListener('mousedown', (ev) => {
      // Shift+click mở rộng vùng chọn ô — trình duyệt mặc định bôi đen chữ giữa hai điểm
      // (đặc biệt nhãn Label). Chặn từ mousedown, trước khi selection bắt đầu.
      if (ev.shiftKey) {
        ev.preventDefault();
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      }
    });

    cell.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.shiftKey) {
        ev.preventDefault();
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      }
      selectCell(cell, { additive: ev.shiftKey === true });
      if (ev.shiftKey) {
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      }
      if (ev.ctrlKey || ev.metaKey) revealCell(cell, ev);
    });

    // Bấm đúp: lối thứ hai tới cùng một việc, cho người quen bấm đúp hơn quen phím bổ trợ.
    // `selectCell` đã chạy ở cú `click` đầu tiên nên ở đây chỉ còn phần nhảy.
    cell.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      revealCell(cell, ev);
    });
  }
}

/** Đánh dấu ô (+ multi nếu Shift), rồi vẽ lại những thứ bám theo ô đang chọn. */
function selectCell(cell, { additive = false } = {}) {
  colPick = null;
  if (!cell) return;
  const empty = cell.classList.contains('DwfEmptyCell');
  // Ô trống ĐƯỢC chọn (để hiện nút + thêm field). Không multi-select ô trống.
  if (empty && additive) return;

  if (additive) {
    const anchor = selectAnchor || selected || cell;
    const range = contiguousCellRange(anchor, cell);
    if (!range) return;
    for (const c of multiSelected) c.classList.remove('fbo-selected');
    multiSelected.clear();
    for (const c of range) {
      multiSelected.add(c);
      c.classList.add('fbo-selected');
    }
    selected = cell;
    focused = cell;
    for (const r of formLayer.querySelectorAll('tr.fbo-row-selected')) r.classList.remove('fbo-row-selected');
    const items = new Set([...multiSelected].map((c) => c.closest('tr')?.dataset.fboItem).filter((v) => v !== undefined && v !== ''));
    for (const item of items) {
      for (const tr of formLayer.querySelectorAll(`tr.FormRow[data-fbo-item="${item}"]`)) {
        tr.classList.add('fbo-row-selected');
      }
    }
    renderDebug();
    drawBlueprint();
    return;
  }

  for (const c of multiSelected) {
    if (c !== cell) c.classList.remove('fbo-selected');
  }
  multiSelected.clear();
  if (selected && selected !== cell) selected.classList.remove('fbo-selected');
  for (const r of formLayer.querySelectorAll('tr.fbo-row-selected')) r.classList.remove('fbo-row-selected');
  const ownRow = cell.closest('tr');
  if (ownRow) {
    const item = ownRow.dataset.fboItem;
    // Vùng split: cùng item có hai `<tr>` (trái/phải) — tô cả hai để hàng nhìn liền.
    if (item !== undefined && item !== '') {
      for (const tr of formLayer.querySelectorAll(`tr.FormRow[data-fbo-item="${item}"]`)) {
        tr.classList.add('fbo-row-selected');
      }
    } else {
      ownRow.classList.add('fbo-row-selected');
    }
  }
  cell.classList.add('fbo-selected');
  multiSelected.add(cell);
  selected = cell;
  focused = cell;
  selectAnchor = cell;
  renderDebug();
  drawBlueprint();
}

/**
 * Vùng chữ nhật liền kề từ ô A → B trong CÙNG bảng form.
 * Chỉ lấy ô có token (không trống). Khác bảng / khác vùng → null.
 */
function contiguousCellRange(a, b) {
  const tableA = a.closest('table[data-fbo-col-widths]');
  const tableB = b.closest('table[data-fbo-col-widths]');
  if (!tableA || tableA !== tableB) return null;
  if (tableA.closest('.GridTabPanel')) return null;

  const rows = [...tableA.querySelectorAll('tr.FormRow[data-fbo-item]')]
    .filter((tr) => !tr.classList.contains('DwfColRow'));
  const ia = rows.indexOf(a.closest('tr.FormRow'));
  const ib = rows.indexOf(b.closest('tr.FormRow'));
  if (ia < 0 || ib < 0) return null;

  const ca = Number(a.dataset.fboCol) || 0;
  const cb = Number(b.dataset.fboCol) || 0;
  const r0 = Math.min(ia, ib);
  const r1 = Math.max(ia, ib);
  const c0 = Math.min(ca, cb);
  const c1 = Math.max(ca, cb);

  const out = [];
  for (let ri = r0; ri <= r1; ri++) {
    for (const td of rows[ri].querySelectorAll('td[data-fbo-cell]:not(.DwfEmptyCell)')) {
      if (td.closest('table[data-fbo-col-widths]') !== tableA) continue;
      const col = Number(td.dataset.fboCol) || 0;
      const span = Number(td.dataset.fboSpan) || 1;
      // Ô giao với [c0, c1] theo cột bắt đầu nằm trong khoảng, hoặc phủ overlap
      if (col <= c1 && col + span - 1 >= c0) out.push(td);
    }
  }
  return out.length > 0 ? out : null;
}

/** Các item index trong multi-select, đã sort — null nếu không liền kề trên bảng. */
function selectedItemBlock() {
  const cells = [...multiSelected];
  if (cells.length === 0) return null;
  const table = cells[0].closest('table[data-fbo-col-widths]');
  if (!table || cells.some((c) => c.closest('table[data-fbo-col-widths]') !== table)) return null;
  const rows = [...table.querySelectorAll('tr.FormRow[data-fbo-item]')]
    .filter((tr) => !tr.classList.contains('DwfColRow'));
  const indexes = [...new Set(cells.map((c) => rows.indexOf(c.closest('tr.FormRow'))))]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (indexes.length === 0) return null;
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i] !== indexes[i - 1] + 1) return null; // non-contiguous rows
  }
  const items = indexes.map((i) => Number(rows[i].dataset.fboItem));
  if (items.some((n) => !Number.isFinite(n))) return null;
  return { items, table, rowCount: indexes.length };
}

/** Đưa con trỏ trong file XML tới đúng khai báo sinh ra ô này. */
function revealCell(cell, ev) {
  const anchor = cell.closest('[data-fbo-src-start]');
  if (!anchor) return;
  const start = Number(anchor.dataset.fboSrcStart);
  const end = Number(anchor.dataset.fboSrcEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;

  const hostStart = Number(anchor.dataset.fboHostStart);
  const hostEnd = Number(anchor.dataset.fboHostEnd);
  vscode.postMessage({
    type: 'select',
    start,
    end,
    file: anchor.dataset.fboFile || '',
    hostStart: Number.isFinite(hostStart) ? hostStart : null,
    hostEnd: Number.isFinite(hostEnd) ? hostEnd : null,
    foreign: anchor.dataset.fboForeign === '1',
    /*
     * Mọi file cùng góp phần khai ra ô này — cho `fboDesigner.revealRelatedFiles = "all"`.
     *
     * Đọc từ tổ tiên gần nhất mang `data-fbo-related` (panel của lưới), không phải từ chính ô:
     * danh sách ấy nói về CẢ LƯỚI, và gắn nó lên từng ô là chép cùng một chuỗi vài chục lần vào
     * HTML. Không có tổ tiên nào thì gửi mảng rỗng — form thường chỉ có hai chỗ (file khai và
     * dòng `&Name;`), và cả hai đã nằm trong `file` với `hostStart`.
     */
    related: (cell.closest('[data-fbo-related]')?.dataset.fboRelated || '')
      .split('|').filter((f) => f !== ''),
    // Mặc định: nhảy tới chỗ ĐỊNH NGHĨA hàng, kể cả khi nó nằm trong file Include — đó là
    // câu hỏi người ta thật sự đang hỏi khi đi tới nguồn của một ô.
    // Giữ thêm Alt: ở lại file đang mở, chỉ trỏ vào `&Name;` đã kéo hàng đó vào.
    hostRefOnly: ev.altKey === true,
  });
}

// ---------------------------------------------------------------------------
// Blueprint: thước · vạch cột · khung slot
// ---------------------------------------------------------------------------

/**
 * Blueprint vẽ THEO VÙNG, không vẽ một lần cho cả form.
 *
 * Mỗi vùng (header · từng tab · footer) có list px RIÊNG, khai ở `<item>` đầu của view hoặc ở
 * `<category columns="…">`. Vẽ một bộ vạch chung cho cả form thì vạch chỉ đúng ở vùng nào tình
 * cờ trùng list px của view, và sai ở mọi vùng còn lại — mà sai kiểu đó nhìn không ra, vì vạch
 * vẫn thẳng và vẫn đều.
 *
 * Con số lấy từ `data-fbo-col-widths` của chính bảng đó, tức từ XML, KHÔNG đo lại từ DOM. Đó là
 * chủ ý: vạch không trùng mép ô nghĩa là có chuyện thật (`table-layout:fixed` không ăn, hoặc
 * list px thiếu cột so với pattern). Đo lại từ bảng thì vạch luôn luôn trùng, và lớp blueprint
 * hết nói được gì.
 */
function drawBlueprint() {
  if (!blueprintOn || !layout) {
    blueprint.innerHTML = '';
    return;
  }

  const stageBox = stage.getBoundingClientRect();
  // metaDrag cần vẽ lại split/anchor theo value mới — không dùng đường nhẹ.
  const light = !!(drag || moveDrag) && !metaDrag;

  /*
   * Đường NHẸ khi đang kéo: giữ thước/slot đã vẽ, chỉ thay bóng. Xóa cả blueprint mỗi
   * mousemove là nguồn giật chính so với WinForms.
   */
  if (light && blueprint.childNodes.length > 0) {
    for (const node of [...blueprint.querySelectorAll('.bp-drag, .bp-move, .bp-move-bad, .bp-move-swap, .bp-bar, .bp-focus, .bp-grip, .bp-span, .bp-row-add, .bp-slot-add')]) {
      node.remove();
    }
    const frag = document.createDocumentFragment();
    drawHandles(frag, stageBox);
    drawDragShadow(frag, stageBox);
    drawMoveShadow(frag, stageBox);
    blueprint.appendChild(frag);
    return;
  }

  blueprint.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const table of formLayer.querySelectorAll('table[data-fbo-col-widths]')) {
    drawRegion(frag, table, stageBox);
  }
  drawSlots(frag, stageBox);
  drawSpanBadges(frag, stageBox);
  drawTabHeightHandles(frag, stageBox);
  drawHandles(frag, stageBox);
  drawRowAddButtons(frag, stageBox);
  drawColumnHandles(frag, stageBox);
  drawDragShadow(frag, stageBox);
  drawMoveShadow(frag, stageBox);

  blueprint.appendChild(frag);
}

/** Gộp nhiều mousemove vào một frame — tránh drawBlueprint chạy 2–3 lần / frame. */
let bpRaf = 0;
function drawBlueprintSoon() {
  if (bpRaf) return;
  bpRaf = requestAnimationFrame(() => {
    bpRaf = 0;
    drawBlueprint();
  });
}

/**
 * Tay cầm kéo chiều cao — có thể HAI thanh trên cùng một tab:
 *
 *   hổ phách (`.bp-hheight-view`) → `view@height` — dùng chung vùng main
 *   vàng     (`.bp-hheight-grid`) → `field@rows`  — riêng tab lưới, ĐÚNG số khai (144),
 *                                                   không gồm chrome 60px (toolbar+split+footer)
 *
 * Hai thanh độc lập: kéo cái này không đổi cái kia. Con số neo MÉP PHẢI vùng main
 * (cạnh line y), không nằm trên thanh kéo ở đáy.
 *
 * Chỉ vẽ cho tab ĐANG MỞ: panel ẩn đo ra 0×0.
 */
/** Chrome ngoài `field@rows`: toolbar 30 + divSplit 8 + divFooter 22. */
const GRID_OUTER_CHROME_PX = 60;

function readDeclaredRows(panel) {
  const raw = Number(panel.dataset.fboRows);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  const grid = panel.querySelector('.GridTabPanel');
  const fromGrid = Number(grid?.dataset.fboRows);
  if (Number.isFinite(fromGrid) && fromGrid >= 0) return fromGrid;
  const block = Number(grid?.dataset.fboBlock);
  if (Number.isFinite(block) && block >= GRID_OUTER_CHROME_PX) return block - GRID_OUTER_CHROME_PX;
  return null;
}

function readDeclaredViewHeight(panel) {
  const raw = Number(panel.dataset.fboViewHeight);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return Math.round(panel.getBoundingClientRect().height);
}

function appendHeightBar(frag, {
  left, top, width, kind, title, onDown,
}) {
  const bar = el('div', `bp-hheight bp-hheight-${kind}`, {
    left: px(left),
    top: px(top),
    width: px(width),
  });
  bar.title = title;
  bar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onDown(e);
  });
  frag.appendChild(bar);
}

/** Nhãn chiều cao neo MÉP PHẢI vùng main (bên trong line y) — không nằm trên thanh kéo ở đáy. */
function appendHeightSideLabel(frag, { right, top, kind, value }) {
  const label = el('div', `bp-hheight-label bp-hheight-label-${kind}`, {
    left: px(right + 46),
    top: px(top),
  });
  label.textContent = `${value}`;
  frag.appendChild(label);
}

function drawTabHeightHandles(frag, stageBox) {
  for (const panel of formLayer.querySelectorAll('.DwfTabPanel.DwfActive')) {
    const box = panel.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;

    const field = panel.dataset.fboRowsField || null;
    const viewH = readDeclaredViewHeight(panel);
    const rows = field ? readDeclaredRows(panel) : null;
    const left = box.left - stageBox.left;
    const width = box.width;
    const panelTop = box.top - stageBox.top;
    const panelBottom = box.bottom - stageBox.top;
    const right = left + width;

    // Thanh view (hổ phách) — luôn có. Nằm sát mép dưới panel.
    appendHeightBar(frag, {
      left, top: panelBottom - 3, width,
      kind: 'view',
      title: `Kéo đổi view@height = ${viewH} — dùng chung vùng main`,
      onDown: (e) => startHeightDrag(panel, e.clientY, 'view'),
    });

    // Thanh grid (vàng) — chỉ khi tab có lưới. Đặt phía trên thanh view để không chồng.
    let gridBottom = panelBottom;
    if (field) {
      const grid = panel.querySelector('.GridTabPanel');
      const gbox = grid?.getBoundingClientRect();
      gridBottom = gbox && gbox.height > 0
        ? gbox.bottom - stageBox.top
        : panelBottom;
      // Nếu lưới kín panel, xếp vàng ngay trên hổ phách (cách 8px).
      const overlap = Math.abs(gridBottom - panelBottom) < 4;
      const top = (overlap ? panelBottom - 3 - 8 : gridBottom - 3);
      const rowsVal = rows ?? 0;
      appendHeightBar(frag, {
        left, top, width: gbox && gbox.width > 0 ? gbox.width : width,
        kind: 'grid',
        title: `Kéo đổi rows của [${field}] = ${rowsVal} — riêng tab này`,
        onDown: (e) => startHeightDrag(panel, e.clientY, 'rows'),
      });
    }

    // Con số chiều cao: mép phải vùng main (giữa theo chiều dọc), xếp dọc rows rồi view.
    const midY = panelTop + (panelBottom - panelTop) / 2;
    if (field && rows !== null) {
      appendHeightSideLabel(frag, { right, top: midY - 14, kind: 'grid', value: rows });
      appendHeightSideLabel(frag, { right, top: midY + 2, kind: 'view', value: viewH });
    } else {
      appendHeightSideLabel(frag, { right, top: midY - 6, kind: 'view', value: viewH });
    }
  }
}

/**
 * Một vùng: dải px + vạch dọc + mỏ neo + vạch chia.
 *
 * Vùng đang ẩn (tab chưa mở) đo ra 0×0 — bỏ qua. `wireTabs` vẽ lại khi đổi tab, nên tab vừa mở
 * vẫn có lưới của nó.
 */
function drawRegion(frag, table, stageBox) {
  const widths = (table.dataset.fboColWidths || '')
    .split(',').map(Number).filter((n) => Number.isFinite(n));
  if (widths.length === 0) return;

  const box = table.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return;

  const offsets = [0];
  for (const w of widths) offsets.push(offsets[offsets.length - 1] + w);
  const total = offsets[offsets.length - 1];

  /*
   * LƯỚI KHÔNG có vạch dọc; form thì có. Khác biệt này không phải sở thích, nó theo đúng chỗ
   * con số nằm trong XML — xem chú thích dài ở nhánh `if (!isGrid)` phía dưới.
   *
   * Phải biết SỚM, ngay từ đây: hai bên đo tỉ lệ zoom bằng hai công thức khác nhau.
   */
  const isGrid = table.closest('.GridTabPanel') !== null;

  /**
   * HAI HỆ TOẠ ĐỘ, và trộn chúng là lỗi đã mắc một lần.
   *
   * Khi có `zoom` ở tổ tiên (nút Tỉ lệ, hoặc bất kỳ ai đặt zoom), `getBoundingClientRect()`
   * trả về toạ độ ĐÃ NHÂN — bảng 550px đo ra 1100 ở 200%. Nhưng `style.left = "24px"` ghi
   * vào một phần tử NẰM TRONG vùng zoom lại là px LAYOUT, và trình duyệt nhân nó lên lần
   * nữa. Lấy số từ rect rồi ghi thẳng vào style là vạch trôi gấp đôi.
   *
   * `k` đo chính tỉ lệ đó từ cái bảng. `lay()` đưa số từ hệ rect về hệ layout. Mốc cột lấy từ
   * list px thì ĐÃ ở hệ layout rồi — không đụng vào.
   *
   * FORM đo bằng `rộng thật / tổng px khai`, và phải giữ đúng như vậy: bảng của form là
   * `table-layout:fixed` rộng đúng tổng px, nên thương số ấy CHÍNH LÀ zoom, và vạch không trùng
   * mép ô là một tín hiệu thật (bảng đang không nghe list px).
   *
   * LƯỚI thì công thức đó SAI, và đây là nguyên nhân của lỗi «kéo giãn cột thì dải px tụt
   * xuống». Bảng lưới không fixed: mỗi ô rộng `width:Npx` content-box còn div container bên
   * trong cộng thêm `padding:4px` hai bên, nên bảng luôn rộng hơn tổng px khai — `k` ra 1.078
   * ngay cả khi zoom = 1. Tệ hơn: mẫu số là TỔNG PX KHAI, nên mỗi lần kéo giãn một cột (bề
   * rộng thật đổi trước, list px đổi theo sau) thì `k` nhảy, và `y0 = lay(box.top …)` nhảy theo
   * — dải px của lưới trôi lên hoặc xuống trong khi cột chỉ đổi bề RỘNG. Kéo một cột mà cả dải
   * số dịch chỗ là thứ nhìn ra ngay nhưng không ai đoán được vì sao.
   *
   * `offsetWidth` là bề rộng LAYOUT (nguyên, chưa nhân zoom) nên `rect / offsetWidth` đúng bằng
   * zoom và không dính gì tới việc bảng rộng bao nhiêu hay cột vừa bị kéo tới đâu. Cùng công
   * thức `gridTicks` đang dùng cho mốc nhãn.
   */
  const k = isGrid
    ? (table.offsetWidth > 0 ? box.width / table.offsetWidth : 1)
    : (total > 0 && box.width > 0 ? box.width / total : 1);
  const lay = (v) => v / k;

  const x0 = lay(box.left - stageBox.left);
  const y0 = lay(box.top - stageBox.top);
  const bottom = y0 + lay(box.height);
  const regionId = table.dataset.fboRegionTable || '';

  /*
   * Dải px mặc định vẽ Ở TRÊN bảng (`y0 - RULER_H`) — đúng cho dải header, vì phía trên nó
   * chẳng có gì. SAI cho một TAB: `.DwfTabList` (thanh nút đổi tab) là ANH EM đứng ngay phía
   * trên `.DwfTabPanel` chứa bảng này, gần như dính sát, và RULER_H (20px) đủ để dải trùm lên
   * nguyên hàng nút đó — bấm vào dải hoá ra bấm trúng chỗ lẽ ra phải đổi tab.
   *
   * Đo đúng mép dưới của `.DwfTabList` (nếu có — header/footer không nằm trong panel nào nên
   * không tìm thấy, giữ nguyên vị trí cũ) và không bao giờ để dải trèo lên trên nó. Mép dưới ấy
   * luôn ≤ `y0` (thanh tab là anh em đứng TRƯỚC panel trong luồng bình thường, không thể nằm
   * dưới panel), nên clamp kiểu này không bao giờ đẩy dải chui xuống dưới cả điểm bắt đầu của
   * bảng — cùng lắm dải chỉ mỏng lại, không bao giờ đè lên hàng nội dung đầu tiên.
   */
  const tabList = table.closest('.DwfTabPanel')?.parentElement?.querySelector(':scope > .DwfTabList');
  let stripTop = y0 - RULER_H;
  if (regionId === 'footer') {
    // Footer có dải đệm riêng khi bật blueprint (xem designer.css), nên ruler luôn nằm ở
    // đó: ngay TRÊN bảng footer, không chồng lên control vùng main hay control footer.
    stripTop = y0 - RULER_H;
  }
  if (tabList && regionId !== 'footer') {
    const tabListBottom = lay(tabList.getBoundingClientRect().bottom - stageBox.top);
    if (tabListBottom > stripTop) stripTop = tabListBottom;
  }

  /*
   * LƯỚI KHÔNG có vạch dọc; form thì có. Khác biệt này không phải sở thích, nó theo đúng chỗ
   * con số nằm trong XML:
   *
   *   form  — một list px CHUNG cho cả vùng, ô bám vào mốc cộng dồn của list ấy bằng `colspan`.
   *           Vạch dọc là cách duy nhất thấy được «ô này bắt đầu ở mốc nào», và vạch KHÔNG trùng
   *           mép ô là một tín hiệu thật (`table-layout:fixed` không ăn, list px thiếu cột).
   *   lưới  — mỗi cột mang bề rộng RIÊNG ở `<field width="N">`, không có mốc chung nào để so.
   *           Vạch dọc ở đây chỉ vẽ lại đúng mép ô mà mắt đã thấy, và kéo suốt chiều cao thì nó
   *           cắt ngang cả hàng tiêu đề lẫn hàng mẫu — đúng cảnh «lưới đầy line cam».
   *
   * Cái lưới CẦN là con số: cột này rộng bao nhiêu px. Dải px phía dưới lo phần đó, cho cả hai.
   */

  /*
   * TAB DẠNG LƯỚI thì KHÔNG vẽ anchor/split — theo chủ hệ thống: ở đó hai con số ấy không có
   * nghĩa gì.
   *
   * Khác với `isGrid` ngay trên: cái đó bắt bảng CỦA CHÍNH lưới (nằm TRONG `.GridTabPanel`).
   * Còn đây là bảng của TAB, và lưới là con của nó — `closest` không thấy, `querySelector` mới
   * thấy. Không có nhánh này thì một tab chỉ chứa lưới vẫn mọc ra mỏ neo và vạch chia kéo được,
   * và kéo chúng là ghi một con số vô nghĩa vào `<category>`.
   *
   * Đòi MỌI ô có nội dung đều là ô lưới, không chỉ "có một cái lưới đâu đó": tab trộn lưới với
   * vài hàng form thường thì anchor/split vẫn nói về mấy hàng ấy, và tắt đi là lấy mất một
   * thao tác đang đúng.
   *
   * `data-fbo-grid-only` do core gắn khi mọi token trong vùng là `<items style="Grid"/>` —
   * nguồn sự thật phía XML. Heuristic DOM là lớp dự phòng khi cờ thiếu sau patch cục bộ.
   */
  const gridCells = [...table.querySelectorAll('td.FormCellGrid')]
    .filter((td) => td.closest('table[data-fbo-col-widths]') === table).length;
  const contentCells = [...table.querySelectorAll('td[data-fbo-col]:not(.DwfEmptyCell)')]
    .filter((td) => td.closest('table[data-fbo-col-widths]') === table
      && !td.closest('tr.DwfColRow'));
  const isGridTab = table.dataset.fboGridOnly === '1'
    || (gridCells > 0 && contentCells.length > 0
      && contentCells.every((td) => td.classList.contains('FormCellGrid')));

  if (!isGrid) {
    offsets.forEach((o, i) => {
      const atEnd = i === offsets.length - 1;
      const edge = i === 0 || atEnd;
      // Cột width=0: vẫn vẽ vạch cùng kiểu/màu cột thường (hai mốc trùng — không nới bảng).
      const zeroCol = i > 0 && widths[i - 1] === 0;
      const guide = el('div', `bp-guide${edge ? ' bp-edge' : ''}`, {
        left: px(x0 + o),
        top: px(y0),
        height: px(bottom - y0),
      });
      // Mép phải: border-left nằm đúng `left` nên dễ bị cắt sát cạnh stage (`inset:0`).
      // Kéo 1px vào trong để vạch vẫn thấy khi cột cuối width>0 (không có tick "0" che).
      if (atEnd) guide.style.marginLeft = '-1px';
      if (zeroCol) guide.title = `cột ${i} · 0px (neo/đệm — vẫn là một cột trong pattern)`;
      frag.appendChild(guide);
    });
    // Vạch cột vẫn vẽ cho tab lưới — chúng nói về list px, thứ tab lưới vẫn dùng thật.
    if (!isGridTab) drawAnchorAndSplit(frag, table, { offsets, x0, y0, height: bottom - y0 });
  }

  /*
   * Dải px của form nằm TRÊN bảng, của lưới nằm TRONG hàng tiêu đề.
   *
   * Không phải hai kiểu cho vui: phía trên bảng lưới là dải nút toolbar, cao 26px và kín đặc.
   * Đặt dải px lên đó thì con số nằm đè lên nút, đọc không ra mà còn che mất icon. Hàng tiêu đề
   * của lưới thì cao 30px và chỉ có một dòng chữ canh giữa — thừa chỗ ở mép dưới cho một con số
   * canh phải. Form không có toolbar nên khoảng chừa `RULER_H` phía trên là chỗ tự nhiên.
   */
  /*
   * Chỗ ĐẶT nhãn: form tính từ mốc px, lưới ĐO TỪ Ô THẬT. Con số ghi ra thì cả hai đều là px
   * khai trong XML — chỉ vị trí mới khác.
   *
   * Lý do phải khác: bảng của form là `table-layout:fixed` rộng đúng tổng px, nên mốc cộng dồn
   * TRÙNG mép ô, và vạch không trùng là một tín hiệu thật (xem đầu `drawRegion`). Bảng lưới thì
   * không fixed: mỗi ô rộng `width:Npx` content-box, mà div container bên trong lại `width:Npx`
   * CỘNG `padding:4px` hai bên, nên ô phình ra N+9. Đo được trên `Grid/SOTran.f`: nhãn lệch dần
   * 9px mỗi cột, tới cột thứ tám là 65px — nhãn của cột này rơi vào giữa tên cột kia.
   *
   * Đây KHÔNG phải phá luật «không đo lại từ DOM». Luật ấy có để vạch của form còn tố cáo được
   * khi bảng không nghe list px. Lưới thì không có list px chung nào để mà tố cáo — nhãn ở đó
   * chỉ có một việc: nói cột NÀY rộng bao nhiêu. Nói đúng thì phải đứng đúng trên cột ấy.
   */
  const ticks = isGrid
    ? gridTicks(table, widths, stageBox)
    : widths.map((w, i) => ({ left: x0 + offsets[i], width: w, label: w }));

  drawWidthStrip(frag, {
    ticks,
    top: isGrid ? bottom - GRID_TICK_H : stripTop,
    isGrid,
    clip: isGrid ? clipRangeOf(table, stageBox, lay) : null,
    /*
     * Chỉ FORM THẬT mới bấm được vào con số để tách/gộp BIÊN cột — cả `isGrid` LẪN `isGridTab`
     * đều phải chặn, không chỉ `isGrid`:
     *
     *   isGrid     bảng CỦA CHÍNH lưới — không có biên chung nào để tách/gộp, mỗi cột một
     *              `width` riêng ở `<field>`. "Tách một cột" ở đó là chèn hẳn cột mới
     *              (`colInsert`), việc đã có nút riêng trên thanh lệnh tiêu đề cột.
     *   isGridTab  bảng của TAB, nhưng cả tab chỉ là một ô nhúng lưới — dải px ở đây trải gần
     *              hết bề ngang panel để nói hộ cho MỘT ô, và `.DwfTabList` (thanh nút đổi tab)
     *              đứng NGAY PHÍA TRÊN panel đó. Bật bấm ở đây là con số che mất, chặn luôn cú
     *              bấm đổi tab — đúng lỗi đã gặp. `region: null` là chốt DUY NHẤT: `drawWidthStrip`
     *              chỉ gắn `pointer-events` khi `region !== null`, nên null ở đây là ticks
     *              hoàn toàn trong suốt với chuột, tab bấm được như chưa từng có blueprint.
     */
    region: (isGrid || isGridTab) ? null : (table.dataset.fboRegionTable || null),
    colOffset: tableColOffset(table),
  });
}

/**
 * Mốc nhãn của lưới, đo từ chính hàng tiêu đề.
 *
 * `widths` và các `<td>` của `tr.GridHeader` khớp nhau từng cái một — `renderGridHtml` dựng
 * `indexCell + header`, còn `widths` là `[INDEX_COL_PX, ...mọi cột]`, kể cả cột ẩn. Ghép theo
 * chỉ số nên không phải dò tên, và cột ẩn (rộng 0) tự bị loại ở vòng vẽ.
 */
function gridTicks(table, widths, stageBox) {
  const cells = [...table.querySelectorAll('tr.GridHeader > td')];
  if (cells.length !== widths.length) return [];

  /*
   * Tỉ lệ đo bằng `rect / offsetWidth`, KHÔNG bằng `rect / tổng px khai` như `drawRegion` làm.
   *
   * Hai công thức chỉ bằng nhau khi bảng rộng đúng tổng px — đúng với form (`table-layout:fixed`)
   * nhưng SAI với lưới: ô lưới phình ra 9px mỗi cột vì div container cộng thêm padding. Dùng
   * công thức của form ở đây thì `k` ra 1.078 ngay cả khi zoom = 1, và mọi nhãn bị co lại 7% —
   * lệch dần y hệt cái đang phải sửa, chỉ đổi chiều.
   *
   * `offsetWidth` là bề rộng LAYOUT (nguyên, chưa nhân zoom), nên thương số này đúng bằng tỉ lệ
   * zoom và không dính gì tới việc bảng rộng bao nhiêu.
   *
   * `drawRegion` thì phải giữ công thức cũ: ở form, vạch KHÔNG trùng mép ô là tín hiệu thật —
   * bảng đang không nghe list px. Đổi sang `offsetWidth` là bịt mất đúng cái tín hiệu ấy.
   */
  const box = table.getBoundingClientRect();
  const k = table.offsetWidth > 0 ? box.width / table.offsetWidth : 1;

  return cells.map((td, i) => {
    const r = td.getBoundingClientRect();
    return { left: (r.left - stageBox.left) / k, width: r.width / k, label: widths[i] };
  });
}

/** Chiều cao dải px vẽ trong hàng tiêu đề lưới. */
const GRID_TICK_H = 10;

/**
 * Gốc vùng form — khi có `split` là `.FormSplit` (list px đầy đủ + split/anchor);
 * không thì chính bảng FormTable.
 */
function regionRootOf(el) {
  return el?.closest?.('[data-fbo-region-root]') || el?.closest?.('table[data-fbo-col-widths]') || null;
}

/** List px ĐẦY ĐỦ của vùng (không phải nửa trái/phải). */
function regionWidthsOf(el) {
  const root = regionRootOf(el);
  if (!root) return [];
  return (root.dataset.fboColWidths || '').split(',').map(Number).filter((n) => Number.isFinite(n));
}

/** Chỉ số cột đầu của nửa bảng trong vùng (0 với bảng trái / không split). */
function tableColOffset(table) {
  return Number(table?.dataset?.fboColOffset) || 0;
}

/**
 * `view@anchor` và `view@split` — hai con số của vùng main mà không có gì trên form nói ra.
 *
 * Cả hai là CHỈ SỐ CỘT tính từ 1, không phải px. Runtime chia bảng làm hai FormTable khi có
 * split; blueprint vẫn vẽ vạch/mỏ neo theo cùng công thức DWF:
 *
 *   split  → vạch tại `offsets[split]`, tức MÉP PHẢI của cột `split`; ranh giới nằm SAU cột đó
 *   anchor → mỏ neo tại `offsets[anchor] - 14`, tức nép vào mép phải của CHÍNH cột `anchor`
 *
 * Khi vùng đã tách thành hai bảng, vạch split vẽ trên mép phải bảng trái; mỏ neo chỉ vẽ trên
 * nửa chứa cột `anchor`. Metadata đọc từ `.FormSplit` (hoặc chính bảng nếu không split).
 *
 * Cả hai KÉO ĐƯỢC: thả ra thì chỉ số cột mới được ghi vào đúng thẻ đã khai vùng đó — `<view>`
 * cho dải header, `<category index="n">` cho một tab. Core chọn thẻ (`planRegionMetadata`), nên
 * webview chỉ gửi đi id vùng chứ không tự đoán.
 */
function drawAnchorAndSplit(frag, table, { offsets, x0, y0, height }) {
  const last = offsets.length - 1;
  const root = regionRootOf(table) || table;
  const region = root.dataset.fboRegionTable || table.dataset.fboRegionTable || '';
  const side = table.dataset.fboSplitSide || '';
  const colOffset = tableColOffset(table);

  // List px ĐẦY ĐỦ — khi đang kéo split, vạch có thể trượt sang nửa phải; offsets cục bộ
  // của bảng trái không đủ. `x0` của bảng trái = mép trái vùng, nên cộng fullOffsets là đúng.
  const fullWidths = regionWidthsOf(table);
  const fullOffsets = [0];
  for (const w of fullWidths) fullOffsets.push(fullOffsets[fullOffsets.length - 1] + w);
  const fullLast = fullOffsets.length - 1;

  // Split: chỉ vẽ một lần trên bảng trái (hoặc bảng đơn).
  const splitHere = !side || side === 'left';
  const split = Number(root.dataset.fboSplit);
  if (splitHere && Number.isFinite(split) && split > 0 && fullLast > 0) {
    const at = metaDrag && metaDrag.attr === 'split' && metaDrag.region === region
      ? metaDrag.value
      : split;
    const clamped = Math.min(Math.max(at, 0), fullLast);
    const line = el('div', 'bp-split', {
      left: px(x0 + fullOffsets[clamped]),
      top: px(y0),
      height: px(height),
    });
    line.title = `split = ${clamped} — bảng chia làm hai sau cột ${clamped}. Kéo ngang để đổi.`;
    line.addEventListener('mousedown', (e) => startMetaDrag(e, table, 'split', fullOffsets, x0));
    frag.appendChild(line);
  }

  const anchor = Number(root.dataset.fboAnchor);
  if (Number.isFinite(anchor) && anchor > 0) {
    const at = metaDrag && metaDrag.attr === 'anchor' && metaDrag.region === region
      ? metaDrag.value
      : anchor;
    const localAt = at - colOffset;
    // Mỏ neo chỉ hiện trên nửa đang chứa cột đó (hoặc bảng đơn).
    if (localAt > 0 && localAt <= last) {
      const icon = el('div', 'bp-anchor', {
        left: px(x0 + offsets[Math.min(localAt, last)] - 14),
        top: px(y0 - 15),
      });
      icon.textContent = '⚓';
      icon.title = `anchor = ${at} — cột ${at} là cột được neo. Kéo ngang để đổi.`;
      // Anchor kéo trên offsets cục bộ + colOffset (startMetaDrag cộng lại).
      icon.addEventListener('mousedown', (e) => startMetaDrag(e, table, 'anchor', offsets, x0));
      frag.appendChild(icon);
    }
  }
}

/**
 * Kéo mỏ neo / vạch chia sang cột khác.
 *
 * Kéo ra CHỈ SỐ CỘT, không ra px: cả hai thuộc tính là số thứ tự cột, nên con trỏ nằm đâu thì
 * bám vào mốc cột gần nhất ở đó. Cho kéo tự do theo px là hứa một thứ định dạng không có, và
 * con số ghi xuống XML sẽ không khớp chỗ người dùng vừa thả tay.
 *
 * Mốc so là `offsets` — list px khai trong XML của chính vùng đó, đã ở hệ toạ độ layout. Đo lại
 * từ DOM ở đây là trộn hai hệ khi có `zoom`, đúng cái bẫy đã ghi ở `drawRegion`.
 */
let metaDrag = null;

function startMetaDrag(e, table, attr, offsets, x0) {
  e.preventDefault();
  e.stopPropagation();
  const root = regionRootOf(table) || table;
  const region = root.dataset.fboRegionTable || table.dataset.fboRegionTable || '';
  // split/anchor nằm trên `.FormSplit` khi vùng đã chia đôi — không đọc từ nửa FormTable.
  const from = Number(attr === 'anchor' ? root.dataset.fboAnchor : root.dataset.fboSplit);
  // split kéo trên offsets ĐẦY ĐỦ (xem drawAnchorAndSplit) → colOffset = 0.
  // anchor kéo trên offsets cục bộ của nửa bảng → cộng offset của nửa đó.
  const colOffset = attr === 'split' ? 0 : tableColOffset(table);
  metaDrag = { region, attr, offsets, x0, from, value: from, table, colOffset, root };
  // Lớp riêng, không dùng chung với `fbo-dragging` của gộp/tách: mỏ neo và vạch chia được DỜI
  // sang cột khác, không phải co giãn ra — con trỏ phải nói đúng chuyện đang xảy ra.
  document.body.classList.add('fbo-dragging-move');
}

/** Mốc cột gần con trỏ nhất — trả CHỈ SỐ CỘT tuyệt đối của vùng (cộng `colOffset` của nửa bảng). */
function columnIndexAt(clientX) {
  const stageBox = stage.getBoundingClientRect();
  // Đo bề rộng vùng ĐẦY ĐỦ khi kéo split (offsets là full); nửa bảng thì đo chính bảng đó.
  const measure = metaDrag.attr === 'split'
    ? (metaDrag.root || regionRootOf(metaDrag.table) || metaDrag.table)
    : metaDrag.table;
  const box = measure.getBoundingClientRect();
  const total = metaDrag.offsets[metaDrag.offsets.length - 1];
  const k = total > 0 && box.width > 0 ? box.width / total : 1;
  const x = (clientX - stageBox.left) / k - metaDrag.x0;

  let best = 0;
  let bestGap = Infinity;
  metaDrag.offsets.forEach((o, i) => {
    const gap = Math.abs(o - x);
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best + (metaDrag.colOffset || 0);
}

window.addEventListener('mousemove', (e) => {
  if (!metaDrag) return;
  const next = columnIndexAt(e.clientX);
  if (next === metaDrag.value) return;
  metaDrag.value = next;
  drawBlueprintSoon();
});

window.addEventListener('mouseup', () => {
  if (!metaDrag) return;
  const { region, attr, value, from } = metaDrag;
  metaDrag = null;
  document.body.classList.remove('fbo-dragging-move');
  drawBlueprint();
  // Thả về đúng cột cũ thì không gửi gì — và cũng không có gì để ghi.
  if (value !== from) postEdit({ op: 'regionMeta', region, attr, value });
});

/**
 * Vùng x NHÌN THẤY ĐƯỢC của một lưới, tính theo hệ layout.
 *
 * Lưới nhiều cột nằm trong một khung `overflow:auto` và cuộn ngang. Bảng tiêu đề khi ấy thò
 * hẳn ra ngoài khung: `getBoundingClientRect()` của nó vẫn trả cả bề rộng thật, nên nhãn px vẽ
 * theo nó sẽ trôi ra ngoài lưới, chồng lên tab bên cạnh và lên cả mép form. Lớp blueprint
 * `position:absolute` không bị khung nào cắt hộ, nên phải tự cắt.
 */
function clipRangeOf(table, stageBox, lay) {
  const panel = table.closest('.GridTabPanel');
  if (!panel) return null;
  const box = panel.getBoundingClientRect();
  return { from: lay(box.left - stageBox.left), to: lay(box.right - stageBox.left) };
}

/**
 * Dải px của từng cột — con số khai trong XML, viết ngay trên đầu cột của nó.
 *
 * Đây là thứ trả lời câu hỏi hay hỏi nhất khi nhìn một form FBO: «cột này rộng bao nhiêu». Đọc
 * nó từ `<item value="100, 200, 25, …">` thì phải tự cộng dồn trong đầu; đọc trên hình thì
 * không.
 *
 * Số ghi là px KHAI TRONG XML, không nhân theo nút Tỉ lệ — chỉ VỊ TRÍ mới nhân. Phóng to 200%
 * mà con số cũng nhân đôi thì thước hết là thước.
 *
 * Nhãn được phép TRÀN ra khỏi ô của nó: cột 25px không đủ chỗ cho chữ "25", nhưng cắt cụt thì
 * người đọc mất đúng con số họ cần. Chỉ cột 0px là thật sự không có gì để ghi — đó là cột khoá
 * kỹ thuật (`stt_rec`), runtime cũng không vẽ.
 */
function drawWidthStrip(frag, { ticks, top, isGrid, clip, region, colOffset = 0 }) {
  // Grid column widths are now shown directly in header cells.
  if (isGrid) return;
  ticks.forEach(({ left, width, label }, i) => {
    if (clip && (left + width <= clip.from || left >= clip.to)) return;

    /*
     * Cột 0px VẪN LÀ MỘT CỘT trong pattern/list (neo, đệm, khóa kỹ thuật). Runtime để
     * `width:0` nên ô co về 0 — bảng không phình. Blueprint phải HIỆN nó (không nới bảng):
     * vạch nét đứt + nhãn "0" trên lớp overlay, bề rộng nhãn chỉ nằm trên blueprint.
     */
    const zero = label === 0;
    if (!zero && !(label > 0)) return;

    // Chỉ số CỘT TOÀN VÙNG — nửa phải FormTable bắt đầu từ `colOffset`, không reset về 0.
    const absCol = colOffset + i;

    // Cột 0px: giữ `left` đúng mốc guide. Không dùng `left - 6` để canh giữa chữ — `.bp-tick`
    // có `border-left`, dời left sẽ lệch vạch tick khỏi guide. Canh giữa chữ bằng CSS.
    const picked = region !== null && colPick && colPick.region === region && colPick.col === absCol;
    const isLast = i === ticks.length - 1;
    // Cột cuối width>0: các cột trước lấy mép phải nhờ border-left của tick kế; cột cuối
    // không có tick kế → thiếu vạch phải (khi cuối = 0 thì tick "0" đứng đúng mép phải).
    const tick = el('div', `bp-tick${isGrid ? ' bp-tick-grid' : ''}`
      + (region === null ? '' : ' bp-tick-pick') + (picked ? ' bp-tick-on' : '')
      + (zero ? ' bp-tick-zero' : '')
      + (isLast && !zero ? ' bp-tick-end' : ''), {
      left: px(left),
      top: px(top),
      width: px(zero ? 12 : width),
    });
    tick.textContent = String(label);
    tick.title = zero
      ? `cột ${absCol + 1} · 0px (neo/đệm — vẫn đếm trong pattern, không nới form)`
      : (region === null
        ? `cột ${absCol} · ${label}px`
        : `cột ${absCol + 1} · ${label}px — bấm để tách hoặc gộp BIÊN cột của cả vùng`);

    /*
     * `region !== null` là CHỐT DUY NHẤT cho việc chọn cột — không lặp lại `isGrid`/`isGridTab`
     * ở đây. `drawRegion` đã gộp cả hai điều kiện ấy thành MỘT giá trị (`region: null` cho lưới
     * lẫn tab-lưới) trước khi truyền xuống; kiểm tra lại hai cờ riêng ở tầng này là hai nguồn sự
     * thật cho cùng một câu hỏi, và chúng lệch nhau là đúng lúc lỗi tái phát mà không ai để ý.
     */
    if (region !== null) {
      tick.addEventListener('mousedown', (e) => e.stopPropagation());
      tick.addEventListener('click', (e) => {
        e.stopPropagation();
        // Bấm lại đúng cột đang chọn thì bỏ chọn — không có nút "đóng" nào trên thanh lệnh, và
        // thêm một nút nữa chỉ để tắt thanh là thừa.
        // Chọn cột là nhắm vào danh sách biên của cả vùng, nên phải ẩn luôn thao tác đang chọn
        // trên ô hiện tại để thanh property của control không còn hiển thị.
        if (!picked) {
          if (selected) selected.classList.remove('fbo-selected');
          for (const c of multiSelected) c.classList.remove('fbo-selected');
          multiSelected.clear();
          for (const r of formLayer.querySelectorAll('tr.fbo-row-selected')) r.classList.remove('fbo-row-selected');
          selected = null;
          focused = null;
        }
        colPick = picked ? null : { region, col: absCol };
        drawBlueprint();
      });
    }
    frag.appendChild(tick);

    if (picked) {
      const fullCount = regionWidthsOf(
        formLayer.querySelector(`[data-fbo-region-root="${region}"], table[data-fbo-region-table="${region}"]`)
      ).length || (colOffset + ticks.length);
      drawColumnEdgeBar(frag, {
        left, width: zero ? 0 : width, top, region, col: absCol, count: fullCount, pxWidth: label,
      });
    }
  });
}

/**
 * Thanh lệnh của một BIÊN CỘT — tách cột đang chọn làm hai, hoặc gộp nó với cột liền kề.
 *
 * Khác hẳn thanh lệnh của một ô (`drawHandles`), và khác ở chỗ phải nói ra cho rõ: `⊣`/`⊢` trên
 * thanh của ô đổi SỐ CỘT MỘT CONTROL đang trải, trong danh sách biên có sẵn — một hàng, một
 * `<item>`. Mấy nút ở đây đổi CHÍNH danh sách biên, nên **mọi hàng dùng chung nó đều dồn theo**,
 * kể cả hàng ở tab khác và hàng nằm trong file Include. Tooltip nói thẳng điều đó, vì nhìn vào
 * hai cái nút thì không đoán ra được.
 *
 * Có cả `Gộp◄` lẫn `Gộp►` chứ không chỉ một: cột khai 0px (cột neo, cột đệm) không vẽ ra con số
 * nào để mà bấm vào, nên cách duy nhất nuốt nó là gọi từ cột hàng xóm — thiếu một chiều là có
 * những cột vĩnh viễn không gộp được bằng chuột.
 */
/** Chiều cao thanh lệnh biên cột (và khoảng lật dưới khi sát mép trên). */
const ACTION_BAR_H = 22;

function drawColumnEdgeBar(frag, { left, width, top, region, col, count, pxWidth }) {
  /*
   * Chốt phòng hờ, không phải đường vào chính: `drawWidthStrip` chỉ gọi hàm này khi `picked`
   * đúng, mà `picked` đã đòi `region !== null` — tức lưới (`isGrid`) và tab-lưới (`isGridTab`)
   * không bao giờ tới được đây qua luồng bình thường (`drawRegion` đã gắn `region: null` cho
   * cả hai, xem chú thích ở đó). Giữ lại kiểm tra này vì đây là nơi PHÁT SINH `postEdit` thật —
   * nút bấm gửi thẳng `op: 'colSplit'/'colMerge'` xuống host, và host tin `region` mù quáng.
   * Một chỗ gọi tương lai lỡ quên gác `region` đúng thì nút vẫn không mọc ra để mà bấm nhầm.
   */
  if (!region) return;

  // Dải px của dải header nằm sát mép trên stage, nên thanh treo phía trên nó bị cắt cụt —
  // lật xuống dưới, cùng luật với thanh lệnh của ô (`drawHandles`).
  const below = top < ACTION_BAR_H + 2;
  const bar = el('div', 'bp-bar bp-bar-cols', {
    left: px(left + width / 2),
    top: px(below ? top + 17 : top - 2),
  });
  bar.classList.toggle('bp-bar-below', below);

  const make = (label, title, disabled, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bp-act';
    b.textContent = label;
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('mousedown', (ev) => ev.stopPropagation());
    b.addEventListener('click', (ev) => { ev.stopPropagation(); if (!disabled) onClick(); });
    bar.appendChild(b);
  };

  const all = 'mọi hàng dùng chung danh sách biên cột này (kể cả ở tab khác) sẽ dồn theo';
  make('Tách', `Tách cột ${col + 1} (${pxWidth}px) thành hai — ${all}`, false,
    () => postEdit({ op: 'colSplit', region, col }));
  bar.appendChild(el('span', 'bp-act-sep', {}));
  make('< Gộp', col === 0 ? 'Cột đầu — bên trái không còn cột nào' : `Gộp cột ${col} với cột ${col + 1} — ${all}`,
    col === 0, () => postEdit({ op: 'colMerge', region, col: col - 1 }));
  make('Gộp >', col + 1 >= count ? 'Cột cuối — bên phải không còn cột nào' : `Gộp cột ${col + 1} với cột ${col + 2} — ${all}`,
    col + 1 >= count, () => postEdit({ op: 'colMerge', region, col }));

  const note = el('span', 'bp-act-note', {});
  note.textContent = `cột ${col + 1}/${count}`;
  bar.appendChild(note);

  frag.appendChild(bar);
}

/**
 * Ô CHƯA DÙNG — gạch chéo, để nhìn ra ngay chỗ nào còn thả control vào được.
 *
 * CHỈ ô trống, không phải mọi ô. Bản trước vẽ khung cho cả 28 ô của một form dày và kết quả là
 * lớp blueprint phủ kín form: vạch cột chìm nghỉm giữa một rừng khung, và chính cái form —
 * thứ cần nhìn — không còn đọc được. Ô đã có control thì mép của nó đã nhìn thấy được rồi;
 * thứ KHÔNG nhìn thấy được là một ô trống lọt giữa hai control, vì nó trông hệt như khoảng
 * đệm. Gạch chéo nói ra đúng chỗ đó.
 */
function drawSlots(frag, stageBox) {
  for (const cell of formLayer.querySelectorAll('td.DwfEmptyCell[data-fbo-col]')) {
    if (cell.closest('.DwfColRow')) continue;
    const box = cell.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;

    // Tỉ lệ đo lại từ chính bảng chứa ô — mỗi vùng một bảng, nhưng zoom thì dùng chung.
    const table = cell.closest('table[data-fbo-col-widths]');
    const total = table
      ? (table.dataset.fboColWidths || '').split(',').reduce((a, b) => a + (Number(b) || 0), 0)
      : 0;
    const tableBox = table ? table.getBoundingClientRect() : null;
    const k = total > 0 && tableBox && tableBox.width > 0 ? tableBox.width / total : 1;
    const lay = (v) => v / k;

    const foreign = cell.dataset.fboForeign === '1' || cell.closest('[data-fbo-foreign="1"]') !== null;
    const slot = el('div', `bp-slot bp-empty${foreign ? ' bp-foreign' : ''}`, {
      left: px(lay(box.left - stageBox.left)),
      top: px(lay(box.top - stageBox.top)),
      width: px(lay(box.width)),
      height: px(lay(box.height)),
    });

    const span = Number(cell.dataset.fboSpan) || 1;
    const width = cell.dataset.fboWidth;
    slot.title = `slot trống · cột ${cell.dataset.fboCol} · trải ${span} · ${width}px`;
    frag.appendChild(slot);
  }
}

/**
 * Số cột mà mỗi control ĐANG CHIẾM, vẽ đè lên chính nó.
 *
 * `drawSlots` chỉ vẽ ô TRỐNG, nên con số `colspan` của ô CÓ control trước nay chỉ đọc được bằng
 * cách rê chuột chờ tooltip — mà colspan lại đúng là thứ người ta cần thấy khi sắp lại layout:
 * một ô trải 3 và một ô trải 1 nhìn y hệt nhau nếu list px của chúng cộng lại bằng nhau.
 *
 * Chỉ vẽ khi trải > 1: một cái nhãn "1" trên mọi ô là nhiễu, và `1` cũng là mặc định ai cũng
 * đoán được. Ô trải 1 vẫn có tooltip như cũ.
 *
 * Đặt ở góc trên-phải của ô và KHÔNG nhận chuột (`pointer-events:none` ở CSS): nó là nhãn đọc,
 * không phải chỗ bấm — che mất một cú bấm chọn ô thì tệ hơn là không có nhãn.
 */
function drawSpanBadges(frag, stageBox) {
  for (const cell of formLayer.querySelectorAll('td[data-fbo-col][data-fbo-span]')) {
    if (cell.classList.contains('DwfEmptyCell')) continue; // ô trống đã có `drawSlots` lo
    const span = Number(cell.dataset.fboSpan) || 1;
    if (span <= 1) continue;

    const box = cell.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;

    const badge = el('div', 'bp-span', {
      left: px(box.right - stageBox.left),
      top: px(box.top - stageBox.top),
    });
    badge.textContent = String(span);
    badge.title = `[${cell.dataset.fboToken || cell.dataset.fboColumn || '?'}] trải ${span} cột`
      + `${cell.dataset.fboWidth ? ` · ${cell.dataset.fboWidth}px` : ''}`;
    frag.appendChild(badge);
  }
}

/**
 * Bóng mờ của control đang được DỜI — chỗ nó sắp đáp xuống.
 *
 * Cùng hàng / một hàng: span = 1 mỗi control, hiện tên token.
 * Nhiều hàng (block): một dải cao N hàng tại vị trí thả — không gom vào một pattern.
 */
function drawMoveShadow(frag, stageBox) {
  if (!moveDrag || !moveDrag.armed) return;
  const drop = moveDrag.drop ?? {
    cell: moveDrag.cell,
    col: moveDrag.col,
    toItem: moveDrag.fromItem,
    other: moveDrag.target.cell,
    span: 1,
  };
  const table = drop.cell.closest('table[data-fbo-col-widths]');
  if (!table) return;

  // List px ĐẦY ĐỦ + mép trái vùng — khi có split, `data-fbo-col` là tuyệt đối còn mỗi
  // FormTable chỉ giữ một nửa widths; đo từ root thì bóng đáp đúng cột.
  const root = regionRootOf(table) || table;
  const widths = regionWidthsOf(table);
  const offsets = [0];
  for (const w of widths) offsets.push(offsets[offsets.length - 1] + w);

  const box = root.getBoundingClientRect();
  const total = offsets[offsets.length - 1];
  const k = total > 0 && box.width > 0 ? box.width / total : 1;
  const lay = (v) => v / k;
  const cellBox = drop.cell.getBoundingClientRect();

  if (moveDrag.isBlock && moveDrag.blockItems?.length > 1) {
    const n = moveDrag.blockItems.length;
    const left = lay(box.left - stageBox.left);
    const width = lay(box.width);
    const top = lay(cellBox.top - stageBox.top);
    const height = lay(cellBox.height) * n;
    const tone = moveDrag.blockItems.includes(drop.toItem) ? ' bp-move-bad' : '';
    const shadow = el('div', `bp-move${tone}`, {
      left: px(left),
      top: px(top),
      width: px(Math.max(width, 2)),
      height: px(Math.max(height, 2)),
    });
    const lab = el('span', 'bp-move-label');
    lab.textContent = `${n} hàng · ${(moveDrag.members || []).map((m) => m.label).join(', ')}`;
    shadow.appendChild(lab);
    shadow.title = tone
      ? 'thả vào chính block đang kéo — không đổi'
      : `chèn ${n} hàng trước hàng đích`;
    frag.appendChild(shadow);
    return;
  }

  const { col, fromCol } = moveDrag;
  const members = moveDrag.members || [{ td: moveDrag.cell, token: moveDrag.cell.dataset.fboToken || '?' }];
  const footprint = members.map((m, i) => ({
    col: col + i,
    span: 1,
    label: tokenDisplayName(m.td) || m.token || '?',
  }));

  const verdict = moveVerdict(moveDrag, widths.length);
  const tone = verdict.kind === 'bad' ? ' bp-move-bad' : (verdict.kind === 'swap' ? ' bp-move-swap' : '');

  if (col === fromCol && drop.toItem === moveDrag.fromItem && members.length === 1) return;

  for (const part of footprint) {
    if (part.col < 0 || part.col >= widths.length) continue;
    const left = lay(box.left - stageBox.left) + offsets[Math.min(part.col, offsets.length - 1)];
    const right = lay(box.left - stageBox.left)
      + offsets[Math.min(part.col + part.span, offsets.length - 1)];
    const shadow = el('div', `bp-move${tone}`, {
      left: px(left),
      top: px(lay(cellBox.top - stageBox.top)),
      width: px(Math.max(right - left, 2)),
      height: px(lay(cellBox.height)),
    });
    const lab = el('span', 'bp-move-label');
    lab.textContent = part.label;
    shadow.appendChild(lab);
    shadow.title = (MOVE_HINT[verdict.kind](part.col, 1)) + ` · ${part.label}`;
    frag.appendChild(shadow);
  }
}

const MOVE_HINT = {
  move: (col, span) => `dời tới cột ${col + 1}${span > 1 ? ` (trải ${span})` : ''}`,
  swap: (col, span) => `đổi chỗ với control ở cột ${col + 1}${span > 1 ? ` (slot trải ${span})` : ''}`,
  bad: (col) => `cột ${col + 1} không nhận được — vượt hàng, hoặc đang có control khác bề rộng`,
};

/** Tên hiện trên bóng kéo: `ong_ba.Label` / `ong_ba` từ `data-fbo-token`. */
function tokenDisplayName(td) {
  const raw = td?.dataset?.fboToken || '';
  const m = /^\[([^\]]*)\](?:\.(.*))?$/i.exec(raw);
  if (!m) return raw || '';
  const kind = (m[2] || '').trim();
  return kind ? `${m[1]}.${kind}` : m[1];
}

/** Đọc field/kind từ `data-fbo-token` (`[ma_kh]`, `[ma_kh].Label`, …). */
function tokenInfoFromTd(td) {
  const raw = td?.dataset?.fboToken || '';
  const m = /^\[([^\]]*)\](?:\.(.*))?$/i.exec(raw);
  if (!m) return null;
  const kindRaw = (m[2] || '').trim().toLowerCase();
  const kind = kindRaw === '' ? 'input' : kindRaw;
  return {
    field: m[1],
    kind,
    col: Number(td.dataset.fboCol) || 0,
    span: Number(td.dataset.fboSpan) || 1,
    td,
    token: raw,
  };
}

/**
 * Chỗ sắp thả xuống nhận được kiểu gì — `'move'`, `'swap'`, hay `'bad'`.
 *
 * Footprint mỗi control đang kéo = 1 cột (điểm thả). Multi → nhiều cột liên tiếp từ cột thả.
 * `'swap'` khi đúng một ô kéo thả trúng ĐÚNG đầu một control khác — pattern/slot đứng yên,
 * chỉ hoán token (kể cả khi hai bên khác span: ma_kh@2 ↔ dien_giai@9).
 */
function moveVerdict(md, columnCount) {
  const drop = md.drop ?? { cell: md.cell, col: md.col, toItem: md.fromItem, span: 1 };
  const { col } = md;
  const members = md.members || [{ td: md.cell }];
  const parts = members.map((m, i) => ({ col: col + i, span: 1, td: m.td }));

  if (parts.some((p) => p.col < 0 || p.col + p.span > columnCount)) {
    return { kind: 'bad', other: null };
  }

  const row = drop.cell.closest('tr.FormRow');
  if (!row) return { kind: 'bad', other: null };

  const hits = [];
  for (const td of row.querySelectorAll('td[data-fbo-cell]:not(.DwfEmptyCell)')) {
    if (parts.some((p) => p.td === td) && drop.toItem === md.fromItem) continue;
    const c = Number(td.dataset.fboCol) || 0;
    const n = Number(td.dataset.fboSpan) || 1;
    for (const p of parts) {
      if (p.col < c + n && c < p.col + p.span) {
        hits.push({ td, col: c, span: n });
        break;
      }
    }
  }
  let verdict;
  if (hits.length === 0) verdict = { kind: 'move', other: null };
  else if (members.length === 1 && hits.length === 1 && hits[0].col === col) {
    const other = Number(hits[0].td.dataset.fboCell);
    if (Number.isFinite(other)) verdict = { kind: 'swap', other, toItem: drop.toItem };
  }
  if (!verdict) verdict = { kind: 'bad', other: null };
  return verdict;
}

/** Số cột của vùng chứa ô — đọc từ list px ĐẦY ĐỦ của vùng (`.FormSplit` hoặc FormTable). */
function colCountOf(cell) {
  const widths = regionWidthsOf(cell);
  return widths.length;
}

function el(tag, className, style) {
  const node = document.createElement(tag);
  node.className = className;
  Object.assign(node.style, style);
  return node;
}

// Giữ hai chữ số thập phân, không làm tròn về số nguyên: ở tỉ lệ lẻ (125%, 150%) làm tròn
// đẩy vạch lệch tới nửa px so với mép ô — nhỏ, nhưng blueprint mà lệch thì nó hết là bằng chứng.
const px = (n) => `${Math.round(n * 100) / 100}px`;

// Font web nạp xong, cuộn ngang, đổi zoom — hình học của bảng đổi thì vạch phải đổi theo.
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(() => drawBlueprint());
  ro.observe(formLayer);
}
window.addEventListener('resize', drawBlueprint);

/**
 * SPIKE P0, CÂU HỎI 2: CSP của webview có cho nạp CSS thật của FBO qua asWebviewUri không.
 * Đếm bằng quan sát chứ không tin `<link>` đã phát ra là đã nạp được.
 */
function probeAssets() {
  const declared = Array.from(document.querySelectorAll('link[data-fbo-css]'));
  const loadedHrefs = new Set();
  for (const sheet of document.styleSheets) {
    // cssRules ném SecurityError nếu sheet không nạp được / khác origin — đó là tín hiệu.
    try {
      if (sheet.cssRules && sheet.href) loadedHrefs.add(sheet.href);
    } catch {
      /* bỏ qua: coi như chưa nạp được */
    }
  }
  const failedHrefs = declared.map((l) => l.href).filter((h) => !loadedHrefs.has(h));
  const payload = {
    type: 'assets',
    declared: declared.length,
    loaded: declared.length - failedHrefs.length,
    failed: failedHrefs.length,
    failedHrefs,
  };
  // Host ghi con số này vào Output; thanh dưới không còn dòng nào cho nó (xem `shell.html`),
  // và panel Debug vẫn liệt kê từng stylesheet một khi cần nhìn kỹ.
  vscode.postMessage(payload);

  drawBlueprint(); // CSS vừa nạp xong có thể đổi hình học của bảng
  renderDebug();
}

window.addEventListener('load', probeAssets);
vscode.postMessage({ type: 'ready' });

// ---------------------------------------------------------------------------
// P3 — chỗ nối cho kéo thả.
//
// Khi tới đó, webview KHÔNG được tự sửa DOM rồi báo sau. Nó gửi ý định
// ({type:'setSpan', item, cell, span}), extension gọi core.setSpan → splice → WorkspaceEdit,
// document đổi → render() chạy lại. Một chiều duy nhất. Cho webview sửa DOM trước là mở đường
// cho designer và file XML nói hai chuyện khác nhau.
//
// Slot của blueprint đã là đơn vị thả: nó phủ đúng ô, biết `data-fbo-col` và `data-fbo-span`,
// và nằm ở lớp không tham gia layout nên kéo nó không làm form nhảy.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sửa: tay cầm quanh ô đang chọn, và kéo cạnh phải để đổi span
// ---------------------------------------------------------------------------
//
// Tay cầm vẽ trong LỚP BLUEPRINT, không chèn vào `#fbo-form`. Đây là cùng một ranh giới đã giữ
// từ đầu file: `#fbo-form` phải giống HTML runtime từng px, nên không được mọc thêm nút bấm
// nào. Chèn nút vào trong ô còn làm ô rộng ra, và preview bắt đầu nói dối đúng về cái thứ nó
// tồn tại để nói thật.

/** Ô đang có tay cầm. `null` khi không ô nào được chọn. */
let focused = null;

/**
 * BIÊN CỘT đang chọn trên dải px của một vùng — `{region, col}`, `col` tính từ 0.
 *
 * Tách hẳn khỏi `focused`: `focused` là một Ô (một control trong một hàng), còn cái này là một
 * CỘT của cả vùng. Hai thứ ở hai cấp khác nhau và không bao giờ cùng có nghĩa một lúc, nên chọn
 * cái này thì bỏ cái kia — xem `selectCell`.
 */
let colPick = null;

/** Bề rộng vùng bắt kéo ở cạnh phải của ô, tính bằng px NHÌN THẤY. */
const RESIZE_GRIP_PX = 6;

function editTarget(cell) {
  const row = cell.closest('tr.FormRow');
  const item = Number(row?.dataset.fboItem);
  const index = Number(cell.dataset.fboCell);
  if (!Number.isFinite(item) || !Number.isFinite(index)) return null;
  return { item, cell: index };
}

function postEdit(msg) {
  vscode.postMessage({ type: 'edit', ...msg });
}

/**
 * Vòng chọn + vạch kéo gộp/tách trên ô đang chọn.
 *
 * KHÔNG còn thanh lệnh (`+← +→ +↑ +↓ ×`): thêm hàng bằng dấu + ngoài form khi rê chuột lên
 * hàng; thêm field bằng nút (+) trên slot trống đang chọn. Xoá vẫn dùng Delete / Shift+Delete.
 */
function drawHandles(frag, stageBox) {
  if (!focused || !blueprintOn) return;
  if (!focused.matches('td[data-fbo-cell]')) return;
  const box = focused.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return;

  const table = focused.closest('table[data-fbo-col-widths]');
  const total = table
    ? (table.dataset.fboColWidths || '').split(',').reduce((a, b) => a + (Number(b) || 0), 0)
    : 0;
  const tb = table ? table.getBoundingClientRect() : null;
  const k = total > 0 && tb && tb.width > 0 ? tb.width / total : 1;
  const lay = (v) => v / k;

  const left = lay(box.left - stageBox.left);
  const top = lay(box.top - stageBox.top);
  const w = lay(box.width);
  const h = lay(box.height);

  const ring = el('div', 'bp-focus', { left: px(left), top: px(top), width: px(w), height: px(h) });
  frag.appendChild(ring);

  const empty = focused.classList.contains('DwfEmptyCell');

  // Dấu hiệu NHÌN THẤY của chỗ kéo gộp/tách, ở CẢ HAI cạnh. `pointer-events` để mặc định (lớp
  // blueprint tắt sẵn) — chúng chỉ để chỉ chỗ; cú kéo thật vẫn do `wireResize` bắt trên
  // `#fbo-form` bên dưới, nên vạch không thể cướp chuột của chính thao tác nó đang quảng cáo.
  if (!empty) {
    frag.appendChild(el('div', 'bp-grip', { left: px(left - 1), top: px(top), height: px(h) }));
    frag.appendChild(el('div', 'bp-grip', { left: px(left + w - 3), top: px(top), height: px(h) }));
  }

  // Slot trống đang chọn → nút (+) giữa ô, raise insert/add field vào CHÍNH ô đó.
  if (empty) {
    const target = editTarget(focused);
    if (target && Number(focused.dataset.fboCell) >= 0) {
      const btn = el('button', 'bp-slot-add', {
        left: px(left + w / 2),
        top: px(top + h / 2),
      });
      btn.type = 'button';
      btn.textContent = '+';
      btn.title = 'Thêm field vào slot trống này';
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        postEdit({ op: 'insert', ...target, side: 'in' });
      });
      frag.appendChild(btn);
    }
  }
}

/** Hàng đang rê chuột — dùng để vẽ dấu + thêm dòng phía ngoài form. */
let hoverRowItem = null;

/**
 * Dấu + ngoài mép form — chèn hàng trống `---------` bên dưới.
 *
 * Form thường: 1 nút mép trái. Form split: 2 nút ở hai mép ngoài.
 * Tab lưới: không vẽ.
 */
function drawRowAddButtons(frag, stageBox) {
  if (!blueprintOn || hoverRowItem === null) return;
  const rows = [...formLayer.querySelectorAll(`tr.FormRow[data-fbo-item="${hoverRowItem}"]`)]
    .filter((tr) => !tr.classList.contains('DwfColRow'));
  if (rows.length === 0) return;

  const table = rows[0].closest('table[data-fbo-col-widths]');
  const panel = table?.closest('.DwfTabPanel');
  // Tab chỉ chứa lưới Detail — không thêm hàng form.
  const gridOnly = table?.dataset.fboGridOnly === '1'
    || (panel && panel.querySelector('.GridTabPanel')
      && !panel.querySelector('td[data-fbo-cell]:not(.FormCellGrid):not(.DwfEmptyCell)'));
  if (gridOnly) return;

  let top = Infinity;
  let bottom = -Infinity;
  let leftEdge = Infinity;
  let rightEdge = -Infinity;
  for (const tr of rows) {
    const r = tr.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    leftEdge = Math.min(leftEdge, r.left);
    rightEdge = Math.max(rightEdge, r.right);
  }
  if (!Number.isFinite(top) || bottom < top) return;

  const root = regionRootOf(table) || table;
  const total = regionWidthsOf(table).reduce((a, b) => a + b, 0);
  const tb = root ? root.getBoundingClientRect() : null;
  const k = total > 0 && tb && tb.width > 0 ? tb.width / total : 1;
  const lay = (v) => v / k;

  const midY = lay((top + bottom) / 2 - stageBox.top);
  const xLeft = lay(leftEdge - stageBox.left) - 18;
  const xRight = lay(rightEdge - stageBox.left) + 18;
  const isSplit = rows.some((r) => r.dataset.fboSplitSide);

  const makeBtn = (x, side) => {
    const btn = el('button', 'bp-row-add', {
      left: px(Math.max(2, x)),
      top: px(midY),
    });
    btn.type = 'button';
    btn.dataset.fboRowAddSide = side;
    btn.textContent = '+';
    btn.title = 'Thêm hàng trống bên dưới (---------)';
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const item = Number(hoverRowItem);
      if (!Number.isFinite(item)) return;
      postEdit({
        op: 'addRow',
        item,
        cell: 0,
        side: 'below',
        blank: true,
        splitSide: side,
      });
    });
    frag.appendChild(btn);
  };

  makeBtn(xLeft, 'left');
  if (isSplit) makeBtn(xRight, 'right');
}

/** Dải mép ngoài giữ hover khi rê từ hàng sang nút + (tránh mất nút ở khoảng trống). */
const ROW_ADD_HIT_PX = 28;

function rowBandOf(item) {
  const rows = [...formLayer.querySelectorAll(`tr.FormRow[data-fbo-item="${item}"]`)]
    .filter((tr) => !tr.classList.contains('DwfColRow'));
  if (rows.length === 0) return null;
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (const tr of rows) {
    const r = tr.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  if (!Number.isFinite(top) || bottom < top) return null;
  return { top, bottom, left, right };
}

function wireRowHover() {
  /*
   * Theo dõi trên `#fbo-stage` (ôm cả form + blueprint), không phải chỉ `#fbo-form`.
   * Khi rê từ hàng sang nút + có một khe trống — `mouseleave` form sẽ xóa hover trước khi
   * chuột kịp vào nút. Giữ hover nếu Y còn trong dải hàng và X còn trong mép ± ROW_ADD_HIT_PX.
   */
  stage.addEventListener('mousemove', (e) => {
    if (drag || moveDrag || colDrag || metaDrag) return;
    if (e.target.closest?.('.bp-row-add')) {
      return;
    }

    const tr = e.target.closest?.('tr.FormRow[data-fbo-item]');
    if (tr && !tr.classList.contains('DwfColRow') && formLayer.contains(tr)) {
      const item = tr.dataset.fboItem;
      if (item !== hoverRowItem) {
        hoverRowItem = item;
        drawBlueprintSoon();
      }
      return;
    }

    if (hoverRowItem === null) return;
    const band = rowBandOf(hoverRowItem);
    if (band
      && e.clientY >= band.top && e.clientY <= band.bottom
      && e.clientX >= band.left - ROW_ADD_HIT_PX
      && e.clientX <= band.right + ROW_ADD_HIT_PX) {
      return;
    }

    hoverRowItem = null;
    drawBlueprintSoon();
  });

  stage.addEventListener('mouseleave', () => {
    if (hoverRowItem === null) return;
    hoverRowItem = null;
    drawBlueprintSoon();
  });
}

/**
 * Kéo CẢ HAI cạnh của ô đang chọn để gộp/tách.
 *
 * Kéo ra NẤC CỘT, không ra px. Đó là luật của định dạng: một ô không có bề rộng riêng, nó chỉ có
 * cột bắt đầu và số cột chiếm. Cho kéo ra px tự do là hứa một thứ FBO không làm được, và con số
 * ghi xuống XML sẽ không khớp cái người dùng vừa nhìn thấy.
 *
 * Hai cạnh đổi hai đại lượng khác nhau, và đây là chỗ dễ nhầm nhất:
 *   cạnh PHẢI → `span` (cột bắt đầu đứng yên, ô dài/ngắn về bên phải)
 *   cạnh TRÁI → `col`  (cột kết thúc đứng yên, chính ký tự `1` trong pattern dời chỗ)
 * Quy cạnh trái về "kéo cạnh phải của ô liền trước" thì hỏng ngay ca thường gặp nhất: ô liền
 * trước gần như luôn là ô TRỐNG, mà ô trống thì không có span để đổi.
 *
 * Bóng mờ chạy theo mốc cột để thấy trước sẽ ăn tới đâu; thả ra mới gửi đi. Thả về đúng chỗ cũ
 * thì không gửi gì.
 */
let drag = null;

/**
 * KÉO DỜI một control sang slot khác — khác hẳn `drag`, thứ kéo CẠNH để co giãn.
 *
 * `armed` là chốt phân biệt bấm-để-chọn với kéo-để-dời. Bắt đầu kéo ngay từ `mousedown` thì mọi
 * cú bấm chọn ô đều trở thành một phép dời dài 0px, và người dùng mất luôn thao tác chọn. Chỉ
 * khi con trỏ đi quá `MOVE_ARM_PX` mới coi là kéo.
 */
let moveDrag = null;
const MOVE_ARM_PX = 4;

/** Dải bắt kéo ở cạnh PHẢI — dùng cho cột lưới, thứ chỉ kéo giãn được từ một phía. */
function edgeOf(cell, clientX) {
  const box = cell.getBoundingClientRect();
  return clientX >= box.right - RESIZE_GRIP_PX && clientX <= box.right + 2;
}

/**
 * Cạnh nào của ô đang nằm dưới con trỏ — `'left'`, `'right'`, hoặc `null`.
 *
 * CHỈ trên ô ĐANG CHỌN. Trước đây mọi ô đều bắt kéo, nên chỉ rê chuột ngang qua form là dễ túm
 * nhầm cạnh của một ô mình không định đụng tới — và ở form dày đặc thì các cạnh chỉ cách nhau
 * vài px. Buộc phải chọn trước là bắt người dùng nói rõ họ đang sửa ô nào, và cũng khớp với
 * chỗ thanh lệnh với vạch chỉ chỗ đang hiện ra.
 *
 * Ô trống không có cạnh nào để kéo: nó không có `1` trong pattern, nên chẳng có span hay cột
 * bắt đầu nào tồn tại để mà đổi.
 */
function resizeEdgeAt(cell, clientX) {
  if (!cell || cell !== focused || cell.classList.contains('DwfEmptyCell')) return null;
  const box = cell.getBoundingClientRect();
  if (clientX >= box.right - RESIZE_GRIP_PX && clientX <= box.right + 2) return 'right';
  if (clientX >= box.left - 2 && clientX <= box.left + RESIZE_GRIP_PX) return 'left';
  return null;
}

/** Mốc cột gần con trỏ nhất trong một bảng — dùng cho phép kéo cạnh trái. */
function colAt(cell, clientX) {
  const table = cell.closest('table[data-fbo-col-widths]');
  if (!table) return 0;
  const edges = columnEdges(table);
  let best = 0;
  let bestGap = Infinity;
  edges.forEach((e, i) => {
    const gap = Math.abs(e.left - clientX);
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best;
}

/** Ô đang nằm dưới con trỏ để làm đích thả của phép dời, hoặc null nếu trượt ra ngoài form. */
function moveDropAt(md, clientX, clientY) {
  const hit = document.elementFromPoint(clientX, clientY)?.closest?.('td[data-fbo-cell]') ?? null;
  const cell = hit || md.cell;
  if (!cell) return null;
  const row = cell.closest('tr.FormRow');
  const toItem = Number(row?.dataset.fboItem);
  const other = Number(cell.dataset.fboCell);
  const col = Number(cell.dataset.fboCol) || 0;
  const span = Number(cell.dataset.fboSpan) || 1;
  if (!Number.isFinite(toItem) || !Number.isFinite(other)) return null;
  return { cell, toItem, other, col, span };
}

function columnEdges(table) {
  // Gom th từ CẢ HAI nửa khi vùng có split — `data-fbo-col` là chỉ số tuyệt đối, sort để
  // edges[i] khớp cột i (spanAt / colAt dựa vào điều đó).
  const root = regionRootOf(table) || table;
  const ths = [...root.querySelectorAll('.DwfColRow th[data-fbo-col]')]
    .sort((a, b) => (Number(a.dataset.fboCol) || 0) - (Number(b.dataset.fboCol) || 0));
  return ths.map((th) => th.getBoundingClientRect());
}

/** Span suy từ vị trí con trỏ: ăn tới cột nào thì span tới đó. Tối thiểu 1. */
function spanAt(cell, clientX) {
  const table = cell.closest('table[data-fbo-col-widths]');
  if (!table) return 1;
  const col = Number(cell.dataset.fboCol) || 0;
  const edges = columnEdges(table);
  let span = 1;
  for (let i = col; i < edges.length; i++) {
    if (clientX >= edges[i].left) span = i - col + 1;
  }
  return Math.max(1, span);
}

/**
 * Gắn MỘT LẦN cho cả phiên, không gắn lại mỗi lần render.
 *
 * `formLayer` chỉ bị thay `innerHTML`, bản thân phần tử thì sống suốt phiên — nên listener gắn
 * lên nó không mất đi theo. Gọi lại sau mỗi lần render là chồng thêm một bộ listener nữa, và
 * sau mười lần đổi file thì một cú kéo gửi đi mười thông điệp sửa.
 */
function wireResize() {
  formLayer.addEventListener('mousemove', (e) => {
    if (drag) return;
    const cell = e.target.closest('td[data-fbo-cell]');
    formLayer.classList.toggle('fbo-resizing', resizeEdgeAt(cell, e.clientX) !== null);
  });

  formLayer.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('td[data-fbo-cell]');
    const side = resizeEdgeAt(cell, e.clientX);

    /*
     * Không phải cạnh → có thể là KÉO DỜI. Chỉ theo dõi, chưa `preventDefault`: cú bấm này vẫn
     * phải chọn được ô như cũ, và chỉ hoá thành phép dời khi con trỏ thật sự đi.
     *
     * Chỉ trên ô ĐANG CHỌN, cùng luật với kéo cạnh: mọi ô đều bắt kéo thì rê chuột ngang qua
     * form là dễ dời nhầm một control mình không định đụng.
     */
    if (!side) {
      if (cell && !cell.classList.contains('DwfEmptyCell')
        && (cell === focused || multiSelected.has(cell))) {
        const t = editTarget(cell);
        if (t) {
          const col = Number(cell.dataset.fboCol) || 0;
          const block = (multiSelected.size > 1 && multiSelected.has(cell))
            ? selectedItemBlock()
            : null;
          const isBlock = !!(block && block.rowCount > 1);
          // Multi cùng 1 hàng: dời các ô đã chọn (span 1). Nhiều hàng liền kề: dời cả block hàng.
          const group = (multiSelected.size > 1 && multiSelected.has(cell) && !isBlock)
            ? [...multiSelected]
            : [cell];
          group.sort((a, b) => {
            const ia = Number(a.closest('tr')?.dataset?.fboItem ?? 0);
            const ib = Number(b.closest('tr')?.dataset?.fboItem ?? 0);
            if (ia !== ib) return ia - ib;
            return (Number(a.dataset.fboCol) || 0) - (Number(b.dataset.fboCol) || 0);
          });
          const members = isBlock
            ? [...multiSelected].map((td) => ({
              td,
              target: editTarget(td),
              token: td.dataset.fboToken || '',
              label: tokenDisplayName(td),
            })).filter((m) => m.target)
            : group.map((td) => ({
              td,
              target: editTarget(td),
              token: td.dataset.fboToken || '',
              label: tokenDisplayName(td),
            })).filter((m) => m.target);
          if (members.length === 0) return;
          moveDrag = {
            cell,
            target: t,
            members,
            isBlock,
            blockItems: isBlock ? block.items : null,
            x0: e.clientX,
            y0: e.clientY,
            col,
            fromCol: col,
            span: 1,
            fromItem: t.item,
            toItem: t.item,
            drop: { cell, toItem: t.item, other: t.cell, col, span: 1 },
            armed: false,
          };
        }
      }
      return;
    }
    const target = editTarget(cell);
    if (!target) return;

    e.preventDefault();
    const span = Number(cell.dataset.fboSpan) || 1;
    const col = Number(cell.dataset.fboCol) || 0;
    // Hai cạnh, hai đại lượng khác nhau. Cạnh phải đổi SPAN (cột bắt đầu đứng yên); cạnh trái
    // đổi CỘT BẮT ĐẦU (cột kết thúc đứng yên). Gộp chung vào một con số là một trong hai chiều
    // kéo sẽ dịch cả ô thay vì co giãn nó.
    drag = { cell, target, side, span, from: span, col, fromCol: col, end: col + span };
    document.body.classList.add('fbo-dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (moveDrag) {
      if (!moveDrag.armed) {
        if (Math.abs(e.clientX - moveDrag.x0) < MOVE_ARM_PX) return;
        moveDrag.armed = true;
        document.body.classList.add('fbo-dragging-move');
      }
      // Bám MỐC CỘT, không bám con trỏ: cột là đơn vị duy nhất định dạng cho phép, và bóng phải
      // nói đúng thứ sắp được ghi xuống.
      const drop = moveDropAt(moveDrag, e.clientX, e.clientY);
      if (!drop) return;
      moveDrag.drop = drop;
      moveDrag.col = drop.col;
      moveDrag.toItem = drop.toItem;
      drawBlueprintSoon();
      return;
    }
    if (!drag) return;
    if (drag.side === 'left') drag.col = Math.min(colAt(drag.cell, e.clientX), drag.end - 1);
    else drag.span = spanAt(drag.cell, e.clientX);
    drawBlueprintSoon();
  });

  window.addEventListener('mouseup', () => {
    if (moveDrag) {
      const md = moveDrag;
      moveDrag = null;
      document.body.classList.remove('fbo-dragging-move');
      drawBlueprint();
      // Chưa `armed` = đây là một cú bấm chọn, không phải phép dời. Không gửi gì cả.
      if (md.armed) {
        if (md.isBlock && Array.isArray(md.blockItems) && md.blockItems.length > 1) {
          const items = md.blockItems;
          if (Number.isFinite(md.toItem) && !items.includes(md.toItem)) {
            postEdit({ op: 'moveBlock', items, toItem: md.toItem, side: 'before' });
          }
        } else if (md.col !== md.fromCol || md.toItem !== md.fromItem) {
          /*
           * Thả lên một control CÙNG SPAN là ĐỔI CHỖ, không phải dời — và đó là con đường trực
           * tiếp mà trước đây không có: `moveCell` từ chối chỗ đã có người, nên đổi thứ tự hai
           * field phải làm tay qua hai bước.
           *
           * `'bad'` vẫn gửi đi dưới dạng `move`: bóng đỏ nói ĐƯỢC/KHÔNG, còn câu từ chối của host
           * mới nói RÕ VÌ SAO (vượt hàng? khác bề rộng?). Nuốt lặng cú thả là để người dùng đoán.
           */
          const v = moveVerdict(md, colCountOf(md.drop?.cell ?? md.cell));
          if (v.kind === 'swap' && (!md.members || md.members.length <= 1)) {
            postEdit({ op: 'swap', ...md.target, toItem: v.toItem, other: v.other });
          } else {
            const targets = (md.members || []).map((m) => m.target).filter(Boolean);
            postEdit({
              op: 'move',
              ...md.target,
              toItem: md.toItem,
              col: md.col,
              targets: targets.length > 1 ? targets : undefined,
            });
          }
        }
      }
      return;
    }
    if (!drag) return;
    const { target, side, span, from, col, fromCol } = drag;
    drag = null;
    document.body.classList.remove('fbo-dragging');
    formLayer.classList.remove('fbo-resizing');
    drawBlueprint();
    if (side === 'left') {
      if (col !== fromCol) postEdit({ op: 'resize', ...target, side: 'left', col });
    } else if (span !== from) {
      postEdit({ op: 'resize', ...target, span });
    }
  });
}

/**
 * Bóng mờ của ô đang kéo — vẽ đè lên, để thấy trước sẽ ăn tới đâu.
 *
 * Vẽ theo MỐC CỘT của bảng chứ không theo con trỏ: kéo ra nấc cột là thứ định dạng cho phép, và
 * bóng phải nói đúng thứ sắp được ghi xuống. Bóng chạy mượt theo chuột rồi nhảy về nấc lúc thả
 * tay là hứa một chuyện rồi làm một chuyện khác.
 */
function drawDragShadow(frag, stageBox) {
  if (!drag) return;
  const table = drag.cell.closest('table[data-fbo-col-widths]');
  if (!table) return;
  const edges = columnEdges(table);

  // Cạnh trái kéo thì mốc TRÁI chạy, mốc phải đứng yên; cạnh phải thì ngược lại.
  const from = drag.side === 'left' ? drag.col : Number(drag.cell.dataset.fboCol) || 0;
  const to = drag.side === 'left' ? drag.end - 1 : from + drag.span - 1;
  const first = edges[Math.max(0, Math.min(from, edges.length - 1))];
  const last = edges[Math.max(0, Math.min(to, edges.length - 1))];
  if (!first || !last) return;

  const root = regionRootOf(table) || table;
  const total = regionWidthsOf(table).reduce((a, b) => a + b, 0);
  const tb = root.getBoundingClientRect();
  const k = total > 0 && tb.width > 0 ? tb.width / total : 1;
  const lay = (v) => v / k;

  const box = drag.cell.getBoundingClientRect();
  frag.appendChild(el('div', 'bp-drag', {
    left: px(lay(first.left - stageBox.left)),
    top: px(lay(box.top - stageBox.top)),
    width: px(lay(last.right - first.left)),
    height: px(lay(box.height)),
  }));
}

/**
 * Delete xoá control; Shift+Delete xoá cả cụm của nó — Label, Footer, Description, và khai báo
 * `<field>` nếu không còn hàng nào dùng.
 *
 * Ba kind ấy chỉ tô điểm cho ô Input, không sống độc lập: để chúng ở lại là để lại một cái nhãn
 * trỏ vào hư không và một dòng chú thích của một control không còn tồn tại. Việc gom cụm nằm ở
 * host (`removeControl`), vì nó phải mở những file khác — hàng `.Description` có thể ở Include.
 */
window.addEventListener('keydown', (e) => {
  // Esc bỏ chọn biên cột — thanh lệnh của nó không có nút đóng, và bấm ra ngoài thì rơi vào ô
  // của form (tức chọn một Ô), không phải lúc nào cũng là điều người dùng muốn.
  if (e.key === 'Escape' && colPick) {
    colPick = null;
    drawBlueprint();
    return;
  }
  if (e.key !== 'Delete' || !focused) return;
  if (focused.classList.contains('DwfEmptyCell')) return;
  const target = editTarget(focused);
  if (!target) return;
  e.preventDefault();
  postEdit({ op: 'remove', ...target, withField: e.shiftKey === true });
});

/**
 * Ctrl+Z / Ctrl+Y bấm khi con trỏ đang ở TRONG designer.
 *
 * Undo của VS Code bám vào editor đang active. Đứng trong webview thì editor active chính là
 * cái webview này — không phải TextEditor nào cả — nên phím tắt của workbench không có gì để
 * bám và cú Ctrl+Z rơi vào hư không: người dùng vừa kéo hỏng một ô, bấm Ctrl+Z, và không có gì
 * xảy ra. Host giữ một chồng hoàn tác riêng cho những phép sửa do designer gây ra; xem
 * `extension/src/edit-history.js`.
 *
 * `Cmd` cũng nghe, để bản macOS không phải là một ca riêng. Ctrl+Shift+Z và Ctrl+Y cùng là
 * «làm lại» — hai thói quen, cùng một việc.
 */
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = String(e.key || '').toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    vscode.postMessage({ type: 'undo' });
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    vscode.postMessage({ type: 'redo' });
  }
});

wireResize();
wireRowHover();

// ---------------------------------------------------------------------------
// Cột của lưới: kéo giãn, chèn, bỏ
// ---------------------------------------------------------------------------
//
// Khác hẳn ô của form. Ô form đổi SPAN (số cột nó chiếm) vì một ô không có bề rộng riêng; cột
// lưới thì ngược lại — nó CÓ bề rộng riêng, khai ở `<field width="N">`, và runtime cũng cho kéo
// giãn bằng cách sửa đúng con số đó. Nên ở đây kéo ra px thật, không phải nấc cột.

let colDrag = null;

/** Tên lưới Detail chứa ô này — `data-fbo-grid` nằm trên ô `FormCellGrid` của form. */
function gridOf(cell) {
  const host = cell.closest('[data-fbo-grid]');
  return host ? host.dataset.fboGrid : null;
}

function gridColTarget(cell) {
  const grid = gridOf(cell);
  const column = cell.dataset.fboColumn;
  return grid && column ? { grid, column } : null;
}

/**
 * MỌI ô cùng một cột trong một lưới — tiêu đề, các hàng mẫu, và ô tổng.
 *
 * Đây là chỗ phép kéo giãn cột đã hỏng: nó chỉ sửa `style.width` của ô TIÊU ĐỀ. Nhưng lưới của
 * runtime không có `table-layout:fixed` và cũng không có `<col>` nào — bề rộng nằm trên TỪNG
 * `<td>`, và tiêu đề với thân còn nằm ở hai BẢNG khác nhau (`divHeader` / `divGrid`, xem
 * `renderGridHtml`). Sửa một bên thì bên kia không có đường nào biết: tiêu đề giãn ra, hàng dữ
 * liệu đứng im, và từ ô thứ hai trở đi tiêu đề lệch hẳn khỏi cột của nó.
 *
 * Ghép theo VỊ TRÍ trong hàng, không theo `data-fbo-column`: ô tổng (`GridFooter`) và ô số thứ
 * tự cố tình KHÔNG mang `data-fbo-*` — chúng là chrome, không phải slot sửa được. Nhưng chúng
 * vẫn phải giãn theo, nếu không thì dải footer lệch cột y hệt. Thứ tự ô của bốn hàng khớp nhau
 * từng cái một vì cả bốn do cùng một vòng `model.columns` dựng ra.
 */
function gridColumnCells(th) {
  const panel = th.closest('.GridTabPanel');
  const row = th.parentElement;
  const pos = row ? [...row.children].indexOf(th) : -1;
  if (!panel || pos === -1) return { cells: [th], panel: null, pos: -1 };

  const cells = [];
  for (const tr of panel.querySelectorAll('tr.GridHeader, tr.GridDataRow, tr.GridFooter')) {
    const td = tr.children[pos];
    if (td) cells.push(td);
  }
  return { cells: cells.length > 0 ? cells : [th], panel, pos };
}

/**
 * Đặt bề rộng cho cả cột — ô và div container BÊN TRONG ô.
 *
 * Phải sửa cả hai: `<td style="width:Npx">` là content-box, còn div bên trong mang lại đúng
 * con số ấy cộng `padding:4px` hai bên. Chỉ sửa `<td>` thì div bên trong ghim ô ở bề rộng cũ và
 * cột không nhúc nhích.
 *
 * `data-fbo-col-widths` của bảng tiêu đề cũng đổi THEO, và đó là vế thứ hai của lỗi «con số px
 * không chạy theo»: thước blueprint đọc nhãn từ list px ấy (xem `gridTicks`), nên không đổi nó
 * thì cột giãn ra trước mắt mà con số dưới thước vẫn đứng im ở giá trị cũ.
 */
function applyGridColumnWidth({ cells, panel, pos }, width) {
  for (const td of cells) {
    td.style.width = `${width}px`;
    const inner = td.firstElementChild;
    if (inner) inner.style.width = `${width}px`;
    if (td.dataset.fboCol) td.dataset.fboWidth = String(width);
  }
  if (!panel || pos < 0) return;
  for (const table of panel.querySelectorAll('table[data-fbo-col-widths]')) {
    const list = (table.dataset.fboColWidths || '').split(',');
    if (pos >= list.length) continue;
    list[pos] = String(width);
    table.dataset.fboColWidths = list.join(',');
  }
}

function wireGridColumns() {
  formLayer.addEventListener('mousemove', (e) => {
    if (colDrag || drag) return;
    const th = e.target.closest('.GridHeader td[data-fbo-column]');
    const can = th && !th.dataset.fboHidden && edgeOf(th, e.clientX);
    /*
     * CHỈ bật, không bao giờ tắt. Handler của ô form (`wireResize`) đăng ký TRƯỚC và đã lo phần
     * tắt rồi; nếu ở đây cũng `toggle` thì mỗi lần chuột đi qua một ô form, handler này chạy sau
     * và tắt luôn con trỏ mà handler kia vừa bật — gộp/tách mất hẳn dấu hiệu kéo được, và
     * nhìn ra ngoài đúng như "tính năng biến mất".
     */
    if (can) formLayer.classList.add('fbo-resizing');
  });

  formLayer.addEventListener('mousedown', (e) => {
    const th = e.target.closest('.GridHeader td[data-fbo-column]');
    if (!th || th.dataset.fboHidden || !edgeOf(th, e.clientX)) return;
    const target = gridColTarget(th);
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();
    const from = Number(th.dataset.fboWidth) || Math.round(th.getBoundingClientRect().width);
    // Gom sẵn cả cột lúc BẮT ĐẦU kéo, không gom lại mỗi nhịp chuột: `querySelectorAll` trên một
    // lưới 20 cột × 6 hàng cho mỗi pixel di chuyển là công vô ích, và danh sách ô không đổi
    // trong suốt cú kéo.
    colDrag = { th, target, from, width: from, startX: e.clientX, column: gridColumnCells(th) };
    document.body.classList.add('fbo-dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!colDrag) return;
    // Kéo ra px THẬT — cột lưới có bề rộng riêng, không bám nấc nào cả.
    colDrag.width = Math.max(0, Math.round(colDrag.from + (e.clientX - colDrag.startX)));
    // Đổi luôn trên DOM để thấy ngay; đây chỉ là xem trước, file chưa đổi gì.
    applyGridColumnWidth(colDrag.column, colDrag.width);
    colDrag.th.title = `${colDrag.target.column} · ${colDrag.width}px`;
    drawBlueprint();
  });

  window.addEventListener('mouseup', () => {
    if (!colDrag) return;
    const { target, width, from } = colDrag;
    colDrag = null;
    document.body.classList.remove('fbo-dragging');
    formLayer.classList.remove('fbo-resizing');
    // Thả về đúng chỗ cũ thì không gửi gì — và cũng không cần vẽ lại.
    if (width !== from) postEdit({ op: 'colWidth', ...target, width });
  });
}

/**
 * Thanh lệnh của một cột lưới — cùng bố cục với thanh của ô form, cùng lý do.
 *
 * Bản trước đặt `+` phải tại `left + box.width`, tức đúng dải bắt kéo giãn cột của
 * `wireGridColumns`: chọn một cột xong là không kéo giãn nó được nữa. Nay mọi nút nằm trên một
 * thanh phía trên tiêu đề, cạnh phải trả lại cho phép kéo, và có thêm một vạch chỉ chỗ kéo.
 *
 * Không có `+↑` / `+↓`: thêm HÀNG của lưới là việc của runtime lúc nhập liệu (nút «Thêm» trên
 * toolbar), không phải việc của designer. Designer chỉ định nghĩa CỘT. Cũng không có nút
 * gộp/tách: cột lưới có bề rộng riêng bằng px, không có `colspan` nào để gộp — kéo giãn mới là
 * phép sửa đúng ở đây.
 */
function drawColumnHandles(frag, stageBox) {
  if (!focused || !blueprintOn) return;
  if (!focused.matches('.GridHeader td[data-fbo-column]')) return;

  const target = gridColTarget(focused);
  if (!target) return;

  const box = focused.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return;
  const left = box.left - stageBox.left;
  const top = box.top - stageBox.top;
  const width = Number(focused.dataset.fboWidth) || Math.round(box.width);

  frag.appendChild(el('div', 'bp-grip', {
    left: px(left + box.width - 3), top: px(top), height: px(box.height),
  }));

  const bar = el('div', 'bp-bar', {
    left: px(left + box.width / 2),
    top: px(top < ACTION_BAR_H + 2 ? top + box.height + ACTION_BAR_H + 2 : top - 2),
  });
  bar.classList.toggle('bp-bar-below', top < ACTION_BAR_H + 2);

  const make = (cls, label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `bp-act ${cls}`;
    b.textContent = label;
    b.title = title;
    b.addEventListener('mousedown', (ev) => ev.stopPropagation());
    b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    bar.appendChild(b);
  };

  make('bp-add', '+←', `Chèn cột bên trái "${target.column}"`,
    () => postEdit({ op: 'colInsert', ...target, side: 'left' }));
  make('bp-add', '+→', `Chèn cột bên phải "${target.column}"`,
    () => postEdit({ op: 'colInsert', ...target, side: 'right' }));
  bar.appendChild(el('span', 'bp-act-sep', {}));
  make('bp-del', '×', `Bỏ cột "${target.column}" khỏi lưới`,
    () => postEdit({ op: 'colRemove', ...target }));

  const tag = el('span', 'bp-act-note', {});
  tag.textContent = `${width}px`;
  tag.title = 'Kéo mép phải của tiêu đề cột để đổi bề rộng';
  bar.appendChild(tag);

  frag.appendChild(bar);
}

wireGridColumns();

/**
 * Lưới nhiều cột: footer cuộn ngang, tiêu đề và thân nhận `scrollLeft` đồng bộ.
 *
 * Runtime tách tiêu đề (`divHeader`) và footer (`divFooter`) thành bảng riêng. Nếu không đồng bộ
 * thì cuộn sang cột thứ 12 mà tiêu đề vẫn đứng ở cột 1, và không còn biết cột nào là cột nào.
 */
function syncGridScroll() {
  for (const panel of formLayer.querySelectorAll('.GridTabPanel')) {
    const body = panel.querySelector('.divGrid');
    const head = panel.querySelector('.divHeader');
    const foot = panel.querySelector('.divFooter');
    if (!body) continue;

    if (body.dataset.fboSyncBody !== '1') {
      body.dataset.fboSyncBody = '1';
      body.addEventListener('scroll', () => {
        if (head && head.scrollLeft !== body.scrollLeft) head.scrollLeft = body.scrollLeft;
        if (foot && foot.scrollLeft !== body.scrollLeft) foot.scrollLeft = body.scrollLeft;
        drawBlueprint();
      });
    }

    if (foot && foot.dataset.fboSyncFoot !== '1') {
      foot.dataset.fboSyncFoot = '1';
      foot.addEventListener('scroll', () => {
        if (body.scrollLeft !== foot.scrollLeft) body.scrollLeft = foot.scrollLeft;
        if (head && head.scrollLeft !== foot.scrollLeft) head.scrollLeft = foot.scrollLeft;
        drawBlueprint();
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Kéo chiều cao: vùng main (`view@height`) và lưới (`field@rows`) — HAI thanh độc lập
// ---------------------------------------------------------------------------
//
// Trước đây một thanh duy nhất: tab lưới → ghi panel-height vào `rows` (204 thay vì 144).
// Nay:
//   thanh hổ phách → `view@height` (dùng chung vùng main)
//   thanh vàng     → `field@rows`  (riêng tab lưới; đúng số khai, không gồm chrome 60px)
//
// `data-fbo-rows-field` / `data-fbo-rows` / `data-fbo-view-height` do core gắn sẵn.

let heightDrag = null;

/** Con trỏ đổi trong dải 6px sát MÉP DƯỚI. */
function bottomEdgeOf(el, clientY) {
  const box = el.getBoundingClientRect();
  return clientY >= box.bottom - RESIZE_GRIP_PX && clientY <= box.bottom + 2;
}

function heightTargetAt(e) {
  const panel = e.target.closest('.DwfTabPanel.DwfActive');
  if (!panel || !bottomEdgeOf(panel, e.clientY)) return null;
  // Mép dưới panel luôn là view@height — rows có thanh vàng riêng.
  return {
    panel,
    kind: 'view',
    msg: { op: 'viewHeight' },
    label: 'view@height',
  };
}

/** Giữ mép trên form cố định trong viewport — tăng cao thì footer đi XUỐNG, không đẩy header lên. */
function keepFormTopStable(formEl, topBefore) {
  const surface = document.getElementById('fbo-surface');
  if (!surface || !formEl) return;
  const topAfter = formEl.getBoundingClientRect().top;
  const drift = topAfter - topBefore;
  if (Math.abs(drift) >= 0.5) surface.scrollTop += drift;
}

/** Xem trước `field@rows` trên DOM — chỉ đổi thân lưới, không đụng `view@height`. */
function previewFieldRows(panel, rows) {
  panel.dataset.fboRows = String(rows);
  const grid = panel.querySelector('.GridTabPanel');
  if (!grid) return;
  grid.dataset.fboRows = String(rows);
  grid.dataset.fboBlock = String(GRID_OUTER_CHROME_PX + rows);
  const header = grid.querySelector('.divHeader');
  const headerPx = header && header.offsetHeight > 0 ? header.offsetHeight : 30;
  const divGrid = grid.querySelector('.divGrid');
  if (divGrid) divGrid.style.height = `${Math.max(0, rows - headerPx)}px`;
}

/** Xem trước `view@height` — chỉ đổi panel, không đụng `field@rows`. */
function previewViewHeight(panel, height) {
  panel.style.height = `${height}px`;
  panel.dataset.fboViewHeight = String(height);
}

/**
 * Bắt đầu kéo chiều cao.
 * @param {'view'|'rows'} kind
 */
function startHeightDrag(panel, clientY, kind = 'view') {
  const field = panel.dataset.fboRowsField || null;
  const formEl = panel.closest('.FormParent') || panel;
  let from;
  let msg;
  let label;
  if (kind === 'rows' && field) {
    from = readDeclaredRows(panel) ?? 0;
    msg = { op: 'fieldRows', field };
    label = `rows của [${field}]`;
  } else {
    kind = 'view';
    from = readDeclaredViewHeight(panel);
    msg = { op: 'viewHeight' };
    label = 'view@height';
  }
  heightDrag = {
    panel,
    formEl,
    kind,
    msg,
    label,
    from,
    height: from,
    startY: clientY,
  };
  document.body.classList.add('fbo-dragging-v');
}

function wireHeights() {
  formLayer.addEventListener('mousemove', (e) => {
    if (heightDrag || drag || colDrag) return;
    if (heightTargetAt(e)) formLayer.classList.add('fbo-resizing-v');
    else formLayer.classList.remove('fbo-resizing-v');
  });

  formLayer.addEventListener('mousedown', (e) => {
    const target = heightTargetAt(e);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    startHeightDrag(target.panel, e.clientY, target.kind || 'view');
  });

  window.addEventListener('mousemove', (e) => {
    if (!heightDrag) return;
    const topBefore = heightDrag.formEl.getBoundingClientRect().top;
    heightDrag.height = Math.max(0, Math.round(heightDrag.from + (e.clientY - heightDrag.startY)));
    if (heightDrag.kind === 'rows') {
      previewFieldRows(heightDrag.panel, heightDrag.height);
    } else {
      previewViewHeight(heightDrag.panel, heightDrag.height);
    }
    heightDrag.panel.title = `${heightDrag.label} · ${heightDrag.height}px`;
    keepFormTopStable(heightDrag.formEl, topBefore);
    drawBlueprint();
  });

  window.addEventListener('mouseup', () => {
    if (!heightDrag) return;
    const { msg, height, from, kind } = heightDrag;
    heightDrag = null;
    document.body.classList.remove('fbo-dragging-v');
    formLayer.classList.remove('fbo-resizing-v');
    if (height !== from) postEdit({ ...msg, height });
  });
}

wireHeights();

/**
 * CSS do chính controller khai (`<css><text>`) — nạp sau base pack để nó đè lên được.
 *
 * Đây là chỗ program định nghĩa kiểu cho thứ base pack không thể biết trước: nút toolbar riêng
 * của khách kèm icon base64 của nó (`div.APTranImport`), `.Break`, `.LabelDescription`…
 *
 * Lọc trước khi nạp, vì chuỗi này đến từ file của KHÁCH và webview có `acquireVsCodeApi()`:
 *   - `</style` đóng sớm thẻ rồi thoát ra HTML — chặn.
 *   - `javascript:` / `expression(` / `behavior:` là đường chạy mã ở trình duyệt cũ — chặn.
 *   - `@import` kéo file ngoài, CSP chặn sẵn nhưng bỏ luôn cho khỏi ồn.
 * `url(data:…)` thì GIỮ: icon của nút riêng nằm đúng ở đó.
 */
function applyControllerCss(css) {
  const box = document.getElementById('fbo-controller-css');
  if (!box) return;
  const raw = String(css || '');
  const safe = raw
    .replace(/<\/style/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/behaviou?r\s*:/gi, '');
  box.textContent = safe;
}

/* ── Hộp thoại ngay trên form ────────────────────────────────────────────────
 *
 * Vẽ lớp phủ ĐÈ LÊN designer thay vì mở một tab webview riêng. Người dùng bấm Delete trên một
 * ô rồi phải trả lời một câu hỏi về chính cái ô đó — nhấc họ sang tab khác là lấy mất thứ họ
 * cần nhìn để quyết định.
 *
 * Dựng bằng DOM API, KHÔNG nối chuỗi HTML. Nội dung câu hỏi mang tên file và tên field của
 * khách (chuỗi kiểu `<field name="ma_vt">` là thường), và mỗi lần dự án này nối chuỗi để dựng
 * hộp thoại đều đã trả giá: một ký tự escape lọt qua hai tầng template literal từng giết cả
 * script và làm mọi nút bấm chết câm. `textContent` không có hạng lỗi đó.
 *
 * Khối `html`/`custom` là ngoại lệ DUY NHẤT dùng `innerHTML`, và chúng đã qua `sanitizeHtml`
 * ở phía host trước khi qua cầu — xem `extension/src/dialog/dialog-overlay.js`.
 */

const DIALOG_GLYPH = { info: 'i', success: '✓', warning: '!', error: '×' };

let dialogOpen = null; // { id, root, lastFocus }

function dialogEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}

/** Một khối thân hộp thoại → DOM. Kiểu lạ thì trả null, không dựng thẻ rỗng. */
function dialogBlock(item) {
  if (!item || typeof item !== 'object') return null;

  if (item.type === 'text') {
    const box = dialogEl('div', 'fbo-dlg-block fbo-dlg-text');
    // Xuống dòng trong nội dung là có ý — tách thành <br> chứ không để nó co lại thành dấu cách.
    String(item.content ?? '').split('\n').forEach((line, i) => {
      if (i) box.appendChild(document.createElement('br'));
      box.appendChild(document.createTextNode(line));
    });
    return box;
  }

  if (item.type === 'list') {
    const box = dialogEl('div', 'fbo-dlg-block fbo-dlg-list');
    const list = document.createElement(item.ordered ? 'ol' : 'ul');
    for (const entry of item.items || []) list.appendChild(dialogEl('li', null, entry ?? ''));
    box.appendChild(list);
    return box;
  }

  if (item.type === 'details') {
    const box = dialogEl('div', 'fbo-dlg-block fbo-dlg-details');
    for (const row of item.rows || []) {
      const line = dialogEl('div', 'fbo-dlg-row');
      line.appendChild(dialogEl('div', 'fbo-dlg-key', row.key ?? ''));
      line.appendChild(dialogEl('div', 'fbo-dlg-val', row.value ?? ''));
      box.appendChild(line);
    }
    return box;
  }

  if (item.type === 'highlight') {
    const box = dialogEl('div', 'fbo-dlg-block');
    box.appendChild(dialogEl('span', `fbo-dlg-tag ${item.kind || 'info'}`, item.content ?? ''));
    return box;
  }

  if (item.type === 'code') {
    const box = dialogEl('div', 'fbo-dlg-block fbo-dlg-code');
    const head = dialogEl('div', 'fbo-dlg-code-head');
    head.appendChild(dialogEl('span', 'fbo-dlg-lang', item.language || 'text'));
    const copy = dialogEl('button', 'fbo-dlg-copy', 'Copy');
    copy.type = 'button';
    const content = String(item.content ?? '');
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(
        () => { copy.textContent = '✓ Đã chép'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); },
        () => { copy.textContent = 'Chép hỏng'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); },
      );
    });
    head.appendChild(copy);
    box.appendChild(head);
    box.appendChild(dialogEl('pre', 'fbo-dlg-pre', content));
    return box;
  }

  if (item.type === 'html' || item.type === 'custom') {
    const box = dialogEl('div', 'fbo-dlg-block fbo-dlg-rich');
    box.innerHTML = String(item.content ?? ''); // đã sanitize ở host
    return box;
  }

  return null;
}

function closeDialog(action, buttonId) {
  if (!dialogOpen) return;
  const { id, root, lastFocus } = dialogOpen;
  dialogOpen = null;
  root.remove();
  // Trả tiêu điểm về chỗ cũ: người dùng vừa bấm Del trên một ô, trả lời xong phải còn đứng ở
  // đúng ô đó — không thì mỗi câu hỏi lại làm mất chỗ đang làm việc.
  if (lastFocus && document.contains(lastFocus)) {
    try { lastFocus.focus(); } catch (e) { /* ô đã biến mất cùng control vừa xoá */ }
  }
  vscode.postMessage({ type: 'dialog-result', id, action, buttonId });
}

function showDialog(id, options) {
  // Câu hỏi cũ chưa trả lời mà câu mới tới: đóng cái cũ bằng 'close' để host khỏi treo `await`.
  if (dialogOpen) closeDialog('close', null);

  const opt = options || {};
  const root = dialogEl('div', 'fbo-dlg-backdrop');
  root.dataset.type = opt.type || 'info';

  const card = dialogEl('div', `fbo-dlg fbo-dlg-${opt.size || 'medium'}`);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const head = dialogEl('header', 'fbo-dlg-head');
  head.appendChild(dialogEl('span', 'fbo-dlg-icon', DIALOG_GLYPH[opt.type] || 'i'));
  const titles = dialogEl('div', 'fbo-dlg-titles');
  titles.appendChild(dialogEl('div', 'fbo-dlg-title', opt.title || ''));
  if (opt.subtitle) titles.appendChild(dialogEl('div', 'fbo-dlg-sub', opt.subtitle));
  head.appendChild(titles);
  if (opt.showCloseButton !== false) {
    const x = dialogEl('button', 'fbo-dlg-x', '×');
    x.type = 'button';
    x.title = 'Đóng';
    x.setAttribute('aria-label', 'Đóng');
    x.addEventListener('click', () => closeDialog('close', null));
    head.appendChild(x);
  }
  card.appendChild(head);

  const body = dialogEl('div', 'fbo-dlg-body');
  for (const item of opt.body || []) {
    const block = dialogBlock(item);
    if (block) body.appendChild(block);
  }
  if (body.childNodes.length) card.appendChild(body);

  const foot = dialogEl('footer', 'fbo-dlg-foot');
  let primary = null;
  for (const button of opt.buttons || []) {
    const el = dialogEl('button', `fbo-dlg-btn ${button.variant || 'secondary'}`, button.label || 'OK');
    el.type = 'button';
    el.disabled = Boolean(button.disabled);
    el.addEventListener('click', () => closeDialog(button.action || 'confirm', button.id));
    if (!primary && (button.variant === 'primary' || button.variant === 'danger')) primary = el;
    foot.appendChild(el);
  }
  card.appendChild(foot);

  root.appendChild(card);
  document.body.appendChild(root);
  dialogOpen = { id, root, lastFocus: document.activeElement };

  // Bấm ra ngoài thẻ = đóng, nhưng CHỈ khi cú bấm bắt đầu trên nền: bôi đen chữ trong hộp rồi
  // nhả chuột ngoài nền cũng bắn `click` lên nền, mà lúc ấy người dùng đang đọc chứ không huỷ.
  root.addEventListener('mousedown', (e) => { if (e.target === root) root.dataset.armed = '1'; });
  root.addEventListener('click', (e) => {
    if (e.target === root && root.dataset.armed === '1' && opt.canClose !== false) closeDialog('close', null);
    delete root.dataset.armed;
  });

  (primary || foot.querySelector('.fbo-dlg-btn') || card).focus();
}

/*
 * Phím tắt của hộp thoại phải chạy TRƯỚC phím tắt của form.
 *
 * Designer nghe `keydown` trên document cho Del / Ctrl+Z / mũi tên. Hộp thoại đang mở mà bấm
 * Del thì không được xoá thêm một control nữa — nên bắt ở pha CAPTURE và chặn hẳn đường lan.
 */
document.addEventListener('keydown', (event) => {
  if (!dialogOpen) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    return closeDialog('close', null);
  }

  if (event.key === 'Tab') {
    // Giam tiêu điểm trong hộp: Tab ra ngoài là vào cái form đang bị hỏi về, và bấm được cả nút
    // của nó — tức trả lời một câu hỏi bằng cách gây thêm một thao tác nữa.
    const focusable = [...dialogOpen.root.querySelectorAll('button:not([disabled])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const at = document.activeElement;
    if (event.shiftKey && (at === first || !dialogOpen.root.contains(at))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }

  event.stopPropagation();
}, true);

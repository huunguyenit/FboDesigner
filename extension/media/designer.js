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
 * RENDER CỤC BỘ: thay đúng một `<tr>`, giữ nguyên phần còn lại của trang.
 *
 * Chỉ gộp/tách ô đi đường này (host quyết, xem `preview-panel.js`). Cái được giữ lại mới là lý
 * do nó tồn tại: vị trí cuộn, tab đang mở, và trạng thái cuộn ngang của mọi lưới nhúng — dựng
 * lại `innerHTML` là mất sạch cả ba, và mất đúng vào lúc người dùng đang kéo cho vừa một hàng.
 *
 * Ô đang chọn được CHỌN LẠI theo chỉ số, không giữ tham chiếu cũ: `<td>` cũ đã rời khỏi cây
 * DOM, và cầm tiếp nó thì thanh lệnh vẽ theo một hình chữ nhật không còn tồn tại.
 *
 * Không tìm thấy hàng thì im lặng — host đã tự vẽ lại toàn bộ trong trường hợp đó.
 */
function patchRow(msg) {
  const old = formLayer.querySelector(`tr.FormRow[data-fbo-item="${msg.item}"]`);
  if (!old) return;

  const holder = document.createElement('tbody');
  holder.innerHTML = msg.html;
  const fresh = holder.querySelector('tr');
  if (!fresh) return;

  const wasSelected = old.classList.contains('fbo-row-selected');
  old.replaceWith(fresh);
  // Chỉ nối listener cho hàng MỚI. Nối lại cho cả `formLayer` là chồng thêm một bộ listener lên
  // mọi ô cũ, và sau mười lần gộp thì một cú bấm gửi đi mười thông điệp.
  wireSelection(fresh);

  if (wasSelected) {
    // Sau phép DỜI, control nằm ở CỘT khác và chỉ số ô đã đổi theo (ô trống bị ăn mất). Chọn
    // lại theo cột mới; chỉ số ô chỉ đúng cho gộp/tách/thêm/xoá, nơi ô không đi đâu cả.
    const byCol = msg.col === undefined || msg.col === null
      ? null
      : fresh.querySelector(`td[data-fbo-col="${msg.col}"]`);
    const cell = byCol
      || fresh.querySelector(`td[data-fbo-cell="${msg.cell}"]`)
      || fresh.querySelector('td[data-fbo-cell]');
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
    cell.addEventListener('click', (ev) => {
      ev.stopPropagation();
      selectCell(cell);
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

/** Đánh dấu ô + cả hàng chứa nó, rồi vẽ lại những thứ bám theo ô đang chọn. */
function selectCell(cell) {
  if (selected) selected.classList.remove('fbo-selected');
  // Cả DÒNG được đánh dấu, không chỉ ô: người dùng đang chọn một hàng khai báo, và hàng mới
  // là đơn vị họ sửa (`<item value>`). Đánh dấu mỗi ô thì ở form dày đặc nhìn không ra.
  for (const r of formLayer.querySelectorAll('tr.fbo-row-selected')) r.classList.remove('fbo-row-selected');
  const ownRow = cell.closest('tr');
  if (ownRow) ownRow.classList.add('fbo-row-selected');
  cell.classList.add('fbo-selected');
  selected = cell;
  focused = cell;
  // Chọn một Ô thì bỏ chọn BIÊN CỘT: hai thanh lệnh cùng hiện là hai họ thao tác ở hai cấp
  // khác nhau nằm cạnh nhau, và bấm nhầm giữa chúng là sửa nhầm cả vùng thay vì một hàng.
  colPick = null;
  renderDebug();
  drawBlueprint();
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
  blueprint.innerHTML = '';
  if (!blueprintOn || !layout) return;

  const stageBox = stage.getBoundingClientRect();
  const frag = document.createDocumentFragment();

  for (const table of formLayer.querySelectorAll('table[data-fbo-col-widths]')) {
    drawRegion(frag, table, stageBox);
  }
  drawSlots(frag, stageBox);
  drawSpanBadges(frag, stageBox);
  drawTabHeightHandles(frag, stageBox);
  drawHandles(frag, stageBox);
  drawColumnHandles(frag, stageBox);
  drawDragShadow(frag, stageBox);
  drawMoveShadow(frag, stageBox);

  blueprint.appendChild(frag);
}

/**
 * Tay cầm kéo chiều cao — MỘT cái cho tab đang mở, nhìn thấy được.
 *
 * Trước đây chỗ kéo là "dải 6px sát mép dưới panel", không có dấu hiệu gì. Mà mép dưới panel
 * của một tab có lưới lại nằm ngay dưới dải footer của lưới, nên thao tác duy nhất tìm được
 * bằng mắt là "kéo cái footer lên" — trông như đang kéo lưới, trong khi con số bị sửa lại là
 * chiều cao TAB. Nay dải ấy được vẽ ra, có màu, có tooltip nói thẳng nó sửa thuộc tính nào.
 *
 * Mỗi tab một chiều cao riêng, và nguồn con số khác nhau — đây là chỗ dễ sửa nhầm nhất:
 *   tab CÓ lưới    → `field@rows` của chính field mang `<items style="Grid">`; RIÊNG tab đó
 *   tab KHÔNG lưới → `view@height`; DÙNG CHUNG cho mọi tab không có lưới
 * Tooltip nói rõ cái nào, vì kéo nhầm loại thứ hai là mọi tab khác cùng co lại theo.
 *
 * Chỉ vẽ cho tab ĐANG MỞ: panel ẩn đo ra 0×0, và một tay cầm trôi về góc trên bên trái thì tệ
 * hơn là không có tay cầm nào.
 */
function drawTabHeightHandles(frag, stageBox) {
  for (const panel of formLayer.querySelectorAll('.DwfTabPanel.DwfActive')) {
    const box = panel.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;

    const field = panel.dataset.fboRowsField;
    const bar = el('div', 'bp-hheight', {
      left: px(box.left - stageBox.left),
      top: px(box.bottom - stageBox.top - 3),
      width: px(box.width),
    });
    bar.title = field
      ? `Kéo đổi chiều cao tab này — rows của [${field}], riêng tab này`
      : 'Kéo đổi chiều cao — view@height, dùng chung cho mọi tab không có lưới';
    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startHeightDrag(panel, e.clientY);
    });
    frag.appendChild(bar);
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
   */
  const gridCells = table.querySelectorAll('td.FormCellGrid').length;
  /*
   * `td[data-fbo-col]` KHÔNG CHỈ nói về ô của BẢNG NÀY.
   *
   * `colAttrs` trong `grid.mjs` gắn CÙNG một tên thuộc tính `data-fbo-col` lên ô tiêu đề của
   * chính LƯỚI nhúng — `td.FormCellGrid` chứa cả một `<table data-fbo-col-widths>` con bên
   * trong nó, và `querySelectorAll` đi xuyên qua ranh giới bảng lồng nhau. Đếm mù bằng
   * `data-fbo-col` cộng luôn mấy ô tiêu đề của lưới con vào, nên `gridCells === filledCells`
   * (1 ô `FormCellGrid` so với 1 + N ô tiêu đề lưới) không bao giờ khớp — `isGridTab` LUÔN
   * `false` dù tab đó chỉ có một cái lưới, và đúng cái lỗi vừa bắt được: split/merge vẫn mọc
   * ra trên một tab toàn lưới.
   *
   * Lọc bằng `closest('table[data-fbo-col-widths]') === table`: chỉ nhận ô mà bảng gần nhất
   * bao nó CHÍNH LÀ bảng đang xét, không phải một bảng lưới lồng bên trong.
   */
  const filledCells = [...table.querySelectorAll('td[data-fbo-col]:not(.DwfEmptyCell)')]
    .filter((td) => td.closest('table[data-fbo-col-widths]') === table).length;
  const isGridTab = gridCells > 0 && gridCells === filledCells;

  if (!isGrid) {
    offsets.forEach((o, i) => {
      const edge = i === 0 || i === offsets.length - 1;
      frag.appendChild(el('div', `bp-guide${edge ? ' bp-edge' : ''}`, {
        left: px(x0 + o),
        top: px(y0),
        height: px(bottom - y0),
      }));
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
 * `view@anchor` và `view@split` — hai con số của vùng main mà không có gì trên form nói ra.
 *
 * Cả hai là CHỈ SỐ CỘT tính từ 1, không phải px. Chúng không đổi cách bảng được vẽ, nên nếu
 * blueprint không vẽ chúng thì chúng vô hình hoàn toàn: người đọc phải mở XML mới biết form có
 * khai hay không, và khai ở cột nào.
 *
 * Cách vẽ và cả hai công thức chỉ số lấy từ bản DWF (`DesignWebViewHost.xaml.cs`,
 * `splitAndAnchor`), kể cả chỗ hai bên đánh chỉ số LỆCH NHAU một nấc — đây là bẫy thật:
 *
 *   split  → vạch tại `offsets[split]`, tức MÉP PHẢI của cột `split`; ranh giới nằm SAU cột đó
 *   anchor → mỏ neo tại `offsets[anchor] - 14`, tức nép vào mép phải của CHÍNH cột `anchor`
 *
 * Đọc lướt thì trông như cùng một phép tính, nhưng một cái nói về ranh giới còn cái kia nói về
 * bản thân cột. Lấy nhầm là marker lệch đúng một cột — sai kiểu nhìn không ra, vì nó vẫn nằm
 * ngay ngắn trên một mốc cột nào đó.
 *
 * Cả hai KÉO ĐƯỢC: thả ra thì chỉ số cột mới được ghi vào đúng thẻ đã khai vùng đó — `<view>`
 * cho dải header, `<category index="n">` cho một tab. Core chọn thẻ (`planRegionMetadata`), nên
 * webview chỉ gửi đi id vùng chứ không tự đoán.
 */
function drawAnchorAndSplit(frag, table, { offsets, x0, y0, height }) {
  const last = offsets.length - 1;
  const region = table.dataset.fboRegionTable || '';

  const split = Number(table.dataset.fboSplit);
  if (Number.isFinite(split) && split > 0 && split < last) {
    const at = metaDrag && metaDrag.attr === 'split' && metaDrag.region === region ? metaDrag.value : split;
    const line = el('div', 'bp-split', {
      left: px(x0 + offsets[Math.min(Math.max(at, 0), last)]),
      top: px(y0),
      height: px(height),
    });
    line.title = `split = ${at} — bảng chia làm hai sau cột ${at}. Kéo ngang để đổi.`;
    line.addEventListener('mousedown', (e) => startMetaDrag(e, table, 'split', offsets, x0));
    frag.appendChild(line);
  }

  const anchor = Number(table.dataset.fboAnchor);
  if (Number.isFinite(anchor) && anchor > 0 && anchor <= last) {
    const at = metaDrag && metaDrag.attr === 'anchor' && metaDrag.region === region ? metaDrag.value : anchor;
    const icon = el('div', 'bp-anchor', {
      left: px(x0 + offsets[Math.min(Math.max(at, 0), last)] - 14),
      top: px(y0 - 15),
    });
    icon.textContent = '⚓';
    icon.title = `anchor = ${at} — cột ${at} là cột được neo. Kéo ngang để đổi.`;
    icon.addEventListener('mousedown', (e) => startMetaDrag(e, table, 'anchor', offsets, x0));
    frag.appendChild(icon);
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
  const region = table.dataset.fboRegionTable || '';
  const from = Number(attr === 'anchor' ? table.dataset.fboAnchor : table.dataset.fboSplit);
  metaDrag = { region, attr, offsets, x0, from, value: from, table };
  // Lớp riêng, không dùng chung với `fbo-dragging` của gộp/tách: mỏ neo và vạch chia được DỜI
  // sang cột khác, không phải co giãn ra — con trỏ phải nói đúng chuyện đang xảy ra.
  document.body.classList.add('fbo-dragging-move');
}

/** Mốc cột gần con trỏ nhất, tính bằng hệ layout của chính bảng đang kéo. */
function columnIndexAt(clientX) {
  const stageBox = stage.getBoundingClientRect();
  const box = metaDrag.table.getBoundingClientRect();
  const total = metaDrag.offsets[metaDrag.offsets.length - 1];
  const k = total > 0 && box.width > 0 ? box.width / total : 1;
  const x = (clientX - stageBox.left) / k - metaDrag.x0;

  let best = 0;
  let bestGap = Infinity;
  metaDrag.offsets.forEach((o, i) => {
    const gap = Math.abs(o - x);
    if (gap < bestGap) { bestGap = gap; best = i; }
  });
  return best;
}

window.addEventListener('mousemove', (e) => {
  if (!metaDrag) return;
  const next = columnIndexAt(e.clientX);
  if (next === metaDrag.value) return;
  metaDrag.value = next;
  drawBlueprint();
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
function drawWidthStrip(frag, { ticks, top, isGrid, clip, region }) {
  // Grid column widths are now shown directly in header cells.
  if (isGrid) return;
  ticks.forEach(({ left, width, label }, i) => {
    // Cột khai 0px là cột khoá kỹ thuật (`stt_rec`, `line_nbr`) — runtime không vẽ nó, và
    // không có con số nào đáng ghi cho một cột không tồn tại trên màn hình.
    if (!(label > 0)) return;
    if (clip && (left + width <= clip.from || left >= clip.to)) return;

    const picked = region !== null && colPick && colPick.region === region && colPick.col === i;
    const tick = el('div', `bp-tick${isGrid ? ' bp-tick-grid' : ''}`
      + (region === null ? '' : ' bp-tick-pick') + (picked ? ' bp-tick-on' : ''), {
      left: px(left),
      top: px(top),
      width: px(width),
    });
    tick.textContent = String(label);
    tick.title = region === null
      ? `cột ${i} · ${label}px`
      : `cột ${i + 1} · ${label}px — bấm để tách hoặc gộp BIÊN cột của cả vùng`;

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
          for (const r of formLayer.querySelectorAll('tr.fbo-row-selected')) r.classList.remove('fbo-row-selected');
          selected = null;
          focused = null;
        }
        colPick = picked ? null : { region, col: i };
        drawBlueprint();
      });
    }
    frag.appendChild(tick);

    if (picked) drawColumnEdgeBar(frag, { left, width, top, region, col: i, count: ticks.length, pxWidth: label });
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
 * Bóng mờ của control ĐANG ĐƯỢC DỜI, vẽ tại chỗ nó sắp đáp xuống.
 *
 * Vẽ theo mốc cột chứ không theo con trỏ, cùng lý do với `drawDragShadow`: bóng chạy mượt theo
 * chuột rồi nhảy về nấc lúc thả tay là hứa một chuyện rồi làm một chuyện khác.
 *
 * Đổi màu khi chỗ đích KHÔNG nhận được — vượt khỏi hàng, hoặc đang có control. Nói trước bằng
 * màu rẻ hơn nhiều so với thả tay xuống rồi đọc một câu từ chối.
 */
function drawMoveShadow(frag, stageBox) {
  if (!moveDrag || !moveDrag.armed) return;
  const drop = moveDrag.drop ?? {
    cell: moveDrag.cell,
    col: moveDrag.col,
    toItem: moveDrag.fromItem,
    other: moveDrag.target.cell,
    span: moveDrag.span,
  };
  const table = drop.cell.closest('table[data-fbo-col-widths]');
  if (!table) return;

  const widths = (table.dataset.fboColWidths || '').split(',').map(Number).filter((n) => Number.isFinite(n));
  const offsets = [0];
  for (const w of widths) offsets.push(offsets[offsets.length - 1] + w);

  const box = table.getBoundingClientRect();
  const total = offsets[offsets.length - 1];
  const k = total > 0 && box.width > 0 ? box.width / total : 1;
  const lay = (v) => v / k;

  const { col, span, fromCol } = moveDrag;
  const cellBox = drop.cell.getBoundingClientRect();

  const verdict = moveVerdict(moveDrag, widths.length);
  const tone = verdict.kind === 'bad' ? ' bp-move-bad' : (verdict.kind === 'swap' ? ' bp-move-swap' : '');

  const left = lay(box.left - stageBox.left) + offsets[Math.min(col, offsets.length - 1)];
  const right = lay(box.left - stageBox.left) + offsets[Math.min(col + span, offsets.length - 1)];
  const shadow = el('div', `bp-move${tone}`, {
    left: px(left),
    top: px(lay(cellBox.top - stageBox.top)),
    width: px(Math.max(right - left, 2)),
    height: px(lay(cellBox.height)),
  });
  shadow.title = MOVE_HINT[verdict.kind](col, span);
  if (col !== fromCol) frag.appendChild(shadow);
}

const MOVE_HINT = {
  move: (col, span) => `dời tới cột ${col + 1}${span > 1 ? ` (trải ${span})` : ''}`,
  swap: (col, span) => `đổi chỗ với control ở cột ${col + 1}${span > 1 ? ` (cùng trải ${span})` : ''}`,
  bad: (col) => `cột ${col + 1} không nhận được — vượt hàng, hoặc đang có control khác bề rộng`,
};

/**
 * Chỗ sắp thả xuống nhận được kiểu gì — `'move'`, `'swap'`, hay `'bad'`.
 *
 * Quét TRONG CÙNG HÀNG, không quét cả bảng: một control ở hàng khác đứng cùng cột chẳng cản trở
 * gì, vì mọi phép trên `<item value>` chỉ tính trên hàng của nó. Quét cả bảng là báo đỏ ở những
 * chỗ thả xuống vẫn chạy được — bản trước mắc đúng lỗi ấy.
 *
 * `'swap'` chỉ khi vùng đích TRÙNG KHÍT một control khác: cùng cột bắt đầu, cùng số cột chiếm.
 * Đó cũng đúng là điều kiện của `swapCells` bên core — hai bên phải nói cùng một luật, không thì
 * hoặc bóng xanh mà thả xuống bị từ chối, hoặc bóng đỏ mà đáng lẽ đi được. Trùng MỘT PHẦN thì
 * không phải đổi chỗ mà là đè lên, và ai đè lên ai là chuyện người dùng phải nói rõ.
 */
function moveVerdict(md, columnCount) {
  const drop = md.drop ?? { cell: md.cell, col: md.col, toItem: md.fromItem, span: md.span };
  const { col, span } = md;
  if (col + span > columnCount) return { kind: 'bad', other: null };
  const row = drop.cell.closest('tr.FormRow');
  if (!row) return { kind: 'bad', other: null };

  const hits = [];
  for (const td of row.querySelectorAll('td[data-fbo-cell]:not(.DwfEmptyCell)')) {
    if (td === md.cell && drop.toItem === md.fromItem) continue;
    const c = Number(td.dataset.fboCol) || 0;
    const n = Number(td.dataset.fboSpan) || 1;
    if (col < c + n && c < col + span) hits.push({ td, col: c, span: n });
  }
  if (hits.length === 0) return { kind: 'move', other: null };
  if (hits.length === 1 && hits[0].col === col && hits[0].span === span) {
    const other = Number(hits[0].td.dataset.fboCell);
    if (Number.isFinite(other)) return { kind: 'swap', other, toItem: drop.toItem };
  }
  return { kind: 'bad', other: null };
}

/** Số cột của vùng chứa ô — đọc từ list px của bảng, cùng nguồn với `drawMoveShadow`. */
function colCountOf(cell) {
  const table = cell.closest('table[data-fbo-col-widths]');
  if (!table) return 0;
  return (table.dataset.fboColWidths || '').split(',').map(Number).filter((n) => Number.isFinite(n)).length;
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
 * MỘT thanh lệnh nổi phía trên ô đang chọn, thay cho năm nút rải quanh bốn cạnh.
 *
 * Đây là chỗ sửa lỗi «gộp/tách chỉ chạy khi CHƯA chọn ô». Nguyên nhân không nằm ở logic kéo mà
 * nằm ở hình học: nút `+` bên phải là hình tròn 16px đặt tại `left + w`, tức đúng giữa cạnh
 * phải — chồng khít lên dải 6px bắt kéo của `wireResize`. Chọn ô xong là cái nút chiếm luôn
 * chỗ đó, chuột không bao giờ chạm tới `#fbo-form` nữa, nên kéo gộp/tách chết. Không chọn ô thì
 * không có nút, và kéo lại chạy — đúng triệu chứng.
 *
 * Nên luật của bố cục mới là: KHÔNG nút nào được đặt trên cạnh ô. Mọi thứ dồn lên một thanh
 * nằm ngoài ô, và bốn cạnh trả lại hết cho thao tác kéo.
 *
 * Thanh gồm hai nhóm, ngăn bằng vạch dọc, để hai họ thao tác không lẫn vào nhau:
 *   chèn  `+←  +→  +↑  +↓`   thêm control (trái/phải) hoặc thêm hàng (trên/dưới)
 *   xoá   `×`
 *
 * Gộp/tách có NÚT chứ không chỉ có kéo: kéo cạnh là thao tác phải đoán ra mới biết là có, còn
 * nút thì nhìn thấy. Kéo vẫn giữ nguyên cho ai muốn nhắm thẳng tới một cột xa.
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

  const target = editTarget(focused);
  if (!target) return;
  const empty = focused.classList.contains('DwfEmptyCell');
  const span = Number(focused.dataset.fboSpan) || 1;

  // Dấu hiệu NHÌN THẤY của chỗ kéo gộp/tách, ở CẢ HAI cạnh. `pointer-events` để mặc định (lớp
  // blueprint tắt sẵn) — chúng chỉ để chỉ chỗ; cú kéo thật vẫn do `wireResize` bắt trên
  // `#fbo-form` bên dưới, nên vạch không thể cướp chuột của chính thao tác nó đang quảng cáo.
  //
  // Chỉ vẽ trên ô ĐANG CHỌN, và đó cũng đúng là điều kiện để kéo được — hai thứ phải khớp nhau,
  // nếu không thì hoặc có vạch mà kéo không ăn, hoặc kéo được mà không có gì chỉ chỗ.
  if (!empty) {
    frag.appendChild(el('div', 'bp-grip', { left: px(left - 1), top: px(top), height: px(h) }));
    frag.appendChild(el('div', 'bp-grip', { left: px(left + w - 3), top: px(top), height: px(h) }));
  }

  frag.appendChild(actionBar(target, {
    left, top, w, empty, cell: focused,
    // Ô ở sát mép trên của vùng thì không còn chỗ phía trên — lật xuống dưới.
    below: top < ACTION_BAR_H + 2,
  }));
}

/** Chiều cao thanh lệnh, kể cả viền. Dùng để biết còn chỗ đặt nó phía trên ô hay không. */
const ACTION_BAR_H = 22;

function actionBar(target, { left, top, w, empty, below, cell }) {
  const bar = el('div', 'bp-bar', {
    left: px(left + w / 2),
    top: px(below ? top + ACTION_BAR_H + 2 : top - 2),
  });
  bar.classList.toggle('bp-bar-below', below);

  const add = (cls, label, title, onClick, disabled = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `bp-act ${cls}`;
    b.textContent = label;
    b.title = title;
    b.disabled = disabled;
    // `mousedown` phải chặn: không chặn thì cú nhấn rơi xuống form, `wireResize` tưởng là bắt
    // đầu kéo, và nút vừa bấm biến mất giữa chừng vì blueprint vẽ lại.
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) onClick(e); });
    bar.appendChild(b);
    return b;
  };
  const sep = () => bar.appendChild(el('span', 'bp-act-sep', {}));

  add('bp-add', '+←', 'Thêm control bên trái (dùng ô trống kề bên)',
    () => postEdit({ op: 'insert', ...target, side: 'left' }));
  add('bp-add', '+→', 'Thêm control bên phải (dùng ô trống kề bên)',
    () => postEdit({ op: 'insert', ...target, side: 'right' }));
  add('bp-add', '+↑', 'Thêm hàng mới phía trên',
    () => postEdit({ op: 'addRow', ...target, side: 'above' }));
  add('bp-add', '+↓', 'Thêm hàng mới phía dưới',
    () => postEdit({ op: 'addRow', ...target, side: 'below' }));

  /*
   * KHÔNG có nút gộp/tách ở đây.
   *
   * Gộp/tách là phép sửa LIÊN TỤC — người ta kéo tới khi vừa mắt, chứ không bấm từng nấc một.
   * Đưa nó lên thanh lệnh dưới dạng hai nút `−`/`+` biến một cú kéo thành năm cú bấm, mà mỗi cú
   * lại đi trọn một vòng ghi file rồi vẽ lại. Hai vạch chỉ chỗ ở hai cạnh ô (`bp-grip`) mới là
   * bề mặt của phép ấy — xem `resizeEdgeAt`.
   *
   * Thanh lệnh giữ đúng những phép RỜI RẠC: thêm và xoá.
   */

  // Ô trống không có control để xoá — nút mờ đi thay vì bấm vào là báo lỗi.
  sep();
  add('bp-del', '×', empty
    ? 'Ô trống, không có control để xoá'
    : 'Xoá control (giữ Shift: xoá cả khai báo <field>)',
  (e) => postEdit({ op: 'remove', ...target, withField: e.shiftKey === true }), empty);

  return bar;
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
  const ths = [...table.querySelectorAll('.DwfColRow th[data-fbo-col]')];
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
      if (cell && cell === focused && !cell.classList.contains('DwfEmptyCell')) {
        const t = editTarget(cell);
        if (t) {
          const col = Number(cell.dataset.fboCol) || 0;
          const span = Number(cell.dataset.fboSpan) || 1;
          moveDrag = {
            cell,
            target: t,
            x0: e.clientX,
            y0: e.clientY,
            col,
            fromCol: col,
            span,
            fromItem: t.item,
            toItem: t.item,
            drop: { cell, toItem: t.item, other: t.cell, col, span },
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
      drawBlueprint();
      return;
    }
    if (!drag) return;
    if (drag.side === 'left') drag.col = Math.min(colAt(drag.cell, e.clientX), drag.end - 1);
    else drag.span = spanAt(drag.cell, e.clientX);
    drawBlueprint();
  });

  window.addEventListener('mouseup', () => {
    if (moveDrag) {
      const md = moveDrag;
      moveDrag = null;
      document.body.classList.remove('fbo-dragging-move');
      drawBlueprint();
      // Chưa `armed` = đây là một cú bấm chọn, không phải phép dời. Không gửi gì cả.
      if (md.armed && (md.col !== md.fromCol || md.toItem !== md.fromItem)) {
        /*
         * Thả lên một control CÙNG SPAN là ĐỔI CHỖ, không phải dời — và đó là con đường trực
         * tiếp mà trước đây không có: `moveCell` từ chối chỗ đã có người, nên đổi thứ tự hai
         * field phải làm tay qua hai bước.
         *
         * `'bad'` vẫn gửi đi dưới dạng `move`: bóng đỏ nói ĐƯỢC/KHÔNG, còn câu từ chối của host
         * mới nói RÕ VÌ SAO (vượt hàng? khác bề rộng?). Nuốt lặng cú thả là để người dùng đoán.
         */
        const v = moveVerdict(md, colCountOf(md.drop?.cell ?? md.cell));
        if (v.kind === 'swap') postEdit({ op: 'swap', ...md.target, toItem: v.toItem, other: v.other });
        else postEdit({ op: 'move', ...md.target, toItem: md.toItem, col: md.col });
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

  const total = (table.dataset.fboColWidths || '').split(',').reduce((a, b) => a + (Number(b) || 0), 0);
  const tb = table.getBoundingClientRect();
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
// Kéo chiều cao: vùng main và từng tab
// ---------------------------------------------------------------------------
//
// Hai con số ở hai chỗ khác nhau trong XML, và chọn nhầm thì kéo một tab nhưng mọi tab khác
// cùng co lại:
//
//   tab CÓ lưới     → `field@rows` của chính field mang `<items style="Grid">` (riêng tab đó)
//   tab KHÔNG lưới  → `view@height` (dùng chung cho cả vùng main)
//
// `data-fbo-rows-field` do core gắn sẵn lên panel, nên ở đây không phải đoán.

let heightDrag = null;

/** Con trỏ đổi trong dải 6px sát MÉP DƯỚI. */
function bottomEdgeOf(el, clientY) {
  const box = el.getBoundingClientRect();
  return clientY >= box.bottom - RESIZE_GRIP_PX && clientY <= box.bottom + 2;
}

function heightTargetAt(e) {
  const panel = e.target.closest('.DwfTabPanel.DwfActive');
  if (!panel || !bottomEdgeOf(panel, e.clientY)) return null;
  const field = panel.dataset.fboRowsField;
  return {
    panel,
    // Tab có lưới thì con số thuộc về RIÊNG nó; không có thì nó dùng chung view@height.
    msg: field ? { op: 'fieldRows', field } : { op: 'viewHeight' },
    label: field ? `rows của [${field}]` : 'view@height (mọi tab không có lưới)',
  };
}

/**
 * Bắt đầu kéo chiều cao của MỘT panel tab.
 *
 * Tách riêng vì có hai lối vào cùng dẫn tới đây: tay cầm nhìn thấy được ở lớp blueprint
 * (`drawTabHeightHandles`) và dải 6px sát mép dưới panel (`heightTargetAt`). Hai lối, một
 * trạng thái — nếu không thì cầm tay này rồi thả tay kia là kẹt cứng ở giữa.
 */
function startHeightDrag(panel, clientY) {
  const field = panel.dataset.fboRowsField;
  const from = Math.round(panel.getBoundingClientRect().height);
  heightDrag = {
    panel,
    msg: field ? { op: 'fieldRows', field } : { op: 'viewHeight' },
    label: field ? `rows của [${field}]` : 'view@height (mọi tab không có lưới)',
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
    startHeightDrag(target.panel, e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    if (!heightDrag) return;
    heightDrag.height = Math.max(0, Math.round(heightDrag.from + (e.clientY - heightDrag.startY)));
    // Xem trước ngay trên DOM; file chưa đổi gì cho tới lúc thả tay.
    heightDrag.panel.style.height = `${heightDrag.height}px`;
    heightDrag.panel.title = `${heightDrag.label} · ${heightDrag.height}px`;
    drawBlueprint();
  });

  window.addEventListener('mouseup', () => {
    if (!heightDrag) return;
    const { msg, height, from } = heightDrag;
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

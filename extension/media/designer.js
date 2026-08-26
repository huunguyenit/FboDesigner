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
const warningsBox = document.getElementById('fbo-warnings');
const assetsBox = document.getElementById('fbo-assets');
const entitiesBox = document.getElementById('fbo-entities');
const scaleBox = document.getElementById('fbo-scale');
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
let blueprintOn = saved.blueprint === true;
blueprintToggle.checked = blueprintOn;
document.body.classList.toggle('bp-on', blueprintOn);

blueprintToggle.addEventListener('change', () => {
  blueprintOn = blueprintToggle.checked;
  document.body.classList.toggle('bp-on', blueprintOn);
  vscode.setState({ ...vscode.getState(), blueprint: blueprintOn });
  drawBlueprint();
});

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
  showScale();
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

/**
 * Nói thẳng ra tỉ lệ đang vẽ, để "sao nhìn nhỏ hơn trên web" trả lời được bằng số.
 * `devicePixelRatio` = tỉ lệ màn hình của Windows × mức zoom của cửa sổ. So con số này với
 * `devicePixelRatio` gõ trong F12 của trình duyệt: lệch nhau nghĩa là hai bên đang zoom khác
 * nhau, chứ không phải form khác kích thước.
 */
function showScale() {
  const dpr = window.devicePixelRatio;
  scaleBox.textContent = `Tỉ lệ nhìn: ${Math.round(zoom * 100)}% · 1 px CSS = ${dpr.toFixed(2)} px màn hình`
    + ' — form luôn dựng đúng px khai trong XML; muốn so với trình duyệt thì mở F12 gõ devicePixelRatio.';
  scaleBox.className = 'fbo-ok';
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'error') return showError(msg);
  if (msg.type === 'idle') return showIdle(msg);
  if (msg.type === 'patchRow') return patchRow(msg);
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

  showEntities(msg.entities);
  focused = null;
  selected = null;
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
    const cell = fresh.querySelector(`td[data-fbo-cell="${msg.cell}"]`)
      || fresh.querySelector('td[data-fbo-cell]');
    if (cell) selectCell(cell);
  }
  if (msg.warnings) showWarnings(msg.warnings);
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
function wireTabs() {
  const list = formLayer.querySelector('.DwfTabList');
  if (!list) return;

  list.addEventListener('click', (e) => {
    const button = e.target.closest('.DwfTabButton');
    if (!button) return;

    for (const b of list.querySelectorAll('.DwfTabButton')) {
      b.setAttribute('aria-selected', String(b === button));
    }
    for (const panel of formLayer.querySelectorAll('.DwfTabPanel')) {
      panel.classList.toggle('DwfActive', panel.id === button.dataset.target);
    }
    drawBlueprint();
  });
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
  warningsBox.textContent = '';
  entitiesBox.textContent = '';
}

/** Entity đã bung được bao nhiêu, và bao nhiêu hàng thật ra thuộc file khác. */
function showEntities(info) {
  if (!info) return;
  const bad = (info.diagnostics || []).filter((d) => d.severity === 'error').length;
  const parts = [`${info.declared} entity`];
  if (info.foreignRows > 0) parts.push(`${info.foreignRows} hàng từ Include (khoá)`);
  if (bad > 0) parts.push(`${bad} entity không phân giải được`);
  entitiesBox.textContent = parts.join(' · ');
  entitiesBox.className = bad > 0 ? 'fbo-warn' : 'fbo-ok';
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

function showWarnings(list) {
  warningsBox.textContent = '';
  if (list.length === 0) {
    warningsBox.textContent = 'Không có cảnh báo.';
    warningsBox.className = 'fbo-ok';
    return;
  }
  warningsBox.className = 'fbo-warn';
  const title = document.createElement('strong');
  title.textContent = `${list.length} cảnh báo:`;
  warningsBox.appendChild(title);
  const ul = document.createElement('ul');
  for (const w of list) {
    const li = document.createElement('li');
    li.textContent = `item ${w.item}: ${w.message}`;
    ul.appendChild(li);
  }
  warningsBox.appendChild(ul);
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
  drawTabHeightHandles(frag, stageBox);
  drawHandles(frag, stageBox);
  drawColumnHandles(frag, stageBox);
  drawDragShadow(frag, stageBox);

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

  /**
   * HAI HỆ TOẠ ĐỘ, và trộn chúng là lỗi đã mắc một lần.
   *
   * Khi có `zoom` ở tổ tiên (nút Tỉ lệ, hoặc bất kỳ ai đặt zoom), `getBoundingClientRect()`
   * trả về toạ độ ĐÃ NHÂN — bảng 550px đo ra 1100 ở 200%. Nhưng `style.left = "24px"` ghi
   * vào một phần tử NẰM TRONG vùng zoom lại là px LAYOUT, và trình duyệt nhân nó lên lần
   * nữa. Lấy số từ rect rồi ghi thẳng vào style là vạch trôi gấp đôi.
   *
   * `k` đo chính tỉ lệ đó từ cái bảng (rộng thật / tổng px khai). `lay()` đưa số từ hệ rect
   * về hệ layout. Mốc cột lấy từ list px thì ĐÃ ở hệ layout rồi — không đụng vào.
   */
  const k = total > 0 && box.width > 0 ? box.width / total : 1;
  const lay = (v) => v / k;

  const x0 = lay(box.left - stageBox.left);
  const y0 = lay(box.top - stageBox.top);
  const bottom = y0 + lay(box.height);
  const stripTop = y0 - RULER_H;

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
  const isGrid = table.closest('.GridTabPanel') !== null;

  if (!isGrid) {
    offsets.forEach((o, i) => {
      const edge = i === 0 || i === offsets.length - 1;
      frag.appendChild(el('div', `bp-guide${edge ? ' bp-edge' : ''}`, {
        left: px(x0 + o),
        top: px(y0),
        height: px(bottom - y0),
      }));
    });
    drawAnchorAndSplit(frag, table, { offsets, x0, y0, height: bottom - y0 });
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
function drawWidthStrip(frag, { ticks, top, isGrid, clip }) {
  ticks.forEach(({ left, width, label }, i) => {
    // Cột khai 0px là cột khoá kỹ thuật (`stt_rec`, `line_nbr`) — runtime không vẽ nó, và
    // không có con số nào đáng ghi cho một cột không tồn tại trên màn hình.
    if (!(label > 0)) return;
    if (clip && (left + width <= clip.from || left >= clip.to)) return;

    const tick = el('div', `bp-tick${isGrid ? ' bp-tick-grid' : ''}`, {
      left: px(left),
      top: px(top),
      width: px(width),
    });
    tick.textContent = String(label);
    tick.title = `cột ${i} · ${label}px`;
    frag.appendChild(tick);
  });
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
  const program = declared.filter((l) => !l.dataset.fboCss.startsWith('base/'));
  const payload = {
    type: 'assets',
    declared: declared.length,
    loaded: declared.length - failedHrefs.length,
    failed: failedHrefs.length,
    failedHrefs,
  };
  vscode.postMessage(payload);

  assetsBox.textContent = program.length === 0
    ? 'CSS thật: không suy được program từ đường dẫn file — đang dùng base pack.'
    : `CSS thật: ${payload.loaded}/${declared.length} nạp được (kể cả base pack).`;
  assetsBox.className = payload.failed > 0 ? 'fbo-warn' : 'fbo-ok';
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
 * Thanh gồm ba nhóm, ngăn bằng vạch dọc, để hai họ thao tác không lẫn vào nhau:
 *   chèn  `+←  +→  +↑  +↓`   thêm control (trái/phải) hoặc thêm hàng (trên/dưới)
 *   rộng  `⊣   ⊢`            tách (span−1) · gộp (span+1) — cùng một `op:'resize'` với phép kéo
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
    left, top, w, empty,
    // Ô ở sát mép trên của vùng thì không còn chỗ phía trên — lật xuống dưới.
    below: top < ACTION_BAR_H + 2,
  }));
}

/** Chiều cao thanh lệnh, kể cả viền. Dùng để biết còn chỗ đặt nó phía trên ô hay không. */
const ACTION_BAR_H = 22;

function actionBar(target, { left, top, w, empty, below }) {
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
   * Thanh lệnh giữ đúng những phép RỜI RẠC: thêm, và xoá.
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
    if (!side) return;
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
    if (!drag) return;
    if (drag.side === 'left') drag.col = Math.min(colAt(drag.cell, e.clientX), drag.end - 1);
    else drag.span = spanAt(drag.cell, e.clientX);
    drawBlueprint();
  });

  window.addEventListener('mouseup', () => {
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

/** Shift+Delete trên bàn phím — lối tắt của nút `×` có giữ Shift. */
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' || !focused) return;
  if (focused.classList.contains('DwfEmptyCell')) return;
  const target = editTarget(focused);
  if (!target) return;
  e.preventDefault();
  postEdit({ op: 'remove', ...target, withField: e.shiftKey === true });
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
    colDrag = { th, target, from, width: from, startX: e.clientX };
    document.body.classList.add('fbo-dragging');
  });

  window.addEventListener('mousemove', (e) => {
    if (!colDrag) return;
    // Kéo ra px THẬT — cột lưới có bề rộng riêng, không bám nấc nào cả.
    colDrag.width = Math.max(0, Math.round(colDrag.from + (e.clientX - colDrag.startX)));
    // Đổi luôn trên DOM để thấy ngay; đây chỉ là xem trước, file chưa đổi gì.
    colDrag.th.style.width = `${colDrag.width}px`;
    const inner = colDrag.th.firstElementChild;
    if (inner) inner.style.width = `${colDrag.width}px`;
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
 * Lưới nhiều cột: thân cuộn ngang, tiêu đề và footer cuộn theo.
 *
 * Runtime để tiêu đề ở BẢNG RIÊNG (`divHeader`) nên nó không tự cuộn cùng thân — phải kéo tay
 * bằng `scrollLeft`. Không đồng bộ thì cuộn sang cột thứ 12 mà tiêu đề vẫn đứng ở cột 1, và
 * không còn biết cột nào là cột nào.
 */
function syncGridScroll() {
  for (const body of formLayer.querySelectorAll('.divGrid')) {
    if (body.dataset.fboSynced === '1') continue;
    body.dataset.fboSynced = '1';
    const panel = body.closest('.GridTabPanel');
    body.addEventListener('scroll', () => {
      for (const sel of ['.divHeader', '.divFooter']) {
        const other = panel && panel.querySelector(sel);
        if (other) other.scrollLeft = body.scrollLeft;
      }
      drawBlueprint();
    });
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

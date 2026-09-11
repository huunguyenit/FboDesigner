// mail-preview-host.js — lệnh «Xem mail»: dựng HTML tham khảo cho MỌI action/body khai trong
// App_Data\Controllers\Options\Message.xml, rồi để một panel riêng tự điều hướng giữa chúng.
//
// Panel này KHÔNG bám theo file đang mở như `preview-panel.js`: Message.xml không phải
// Dir/Grid/Filter (`render-host.js#CONTROLLER_PATH` cố tình loại thư mục `Options\` ra), và mục
// đích ở đây là XEM, không phải thiết kế. Không có kênh sửa nào giữa panel và file nguồn.
//
// Điều hướng (chọn mẫu, chọn biến thể, đổi ngôn ngữ, so sánh) chạy HẲN Ở PHÍA WEBVIEW, không
// round-trip qua extension host: mọi bản HTML (action × body × ngôn ngữ) được dựng MỘT LẦN khi
// mở lệnh và nhúng thẳng vào trang — số lượng thực tế trên corpus (vài chục action, mỗi action
// vài biến thể) chỉ tốn vài trăm KB, rẻ hơn nhiều so với một kênh `postMessage` cho mỗi lần đổi
// lựa chọn. Kênh `postMessage` CHỈ dùng cho hai việc không thể làm ở phía webview: nhớ lựa chọn
// (host giữ trạng thái qua nhiều lần mở lệnh) và «đi tới định nghĩa» (chỉ host mở được editor).

const vscode = require('vscode');
const path = require('node:path');
const { toast } = require('./locale');
const { cachedReadFile, samePath } = require('./render-host');
const { dialogs } = require('./dialog/dialog-service');
const { applySplice } = require('./edit-host');

function nonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Chèn một object vào `<script>` an toàn — `</script` bên trong dữ liệu (một mẫu mail có thể
 * chứa nguyên văn chuỗi đó) sẽ đóng sớm thẻ script nếu không escape `<`. Cùng kỹ thuật
 * `render-host.js#shellHtml` dùng cho `webviewMessages()`. */
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Dựng sẵn HTML cho MỌI action × body × ngôn ngữ trong file, cộng bảng phân tích cấu trúc cột/
 * dòng cho mỗi (action, body) — panel điều hướng VÀ sửa cấu trúc đều dùng dữ liệu này, không gọi
 * lại core lần nào nữa sau khi mở (trừ lúc thật sự GHI, xem `applyMailTablePlan`).
 *
 * @returns {{actions: Array<{id,label,table,bodies:string[]}>, html: Record<string,string>,
 *            table: Record<string,{columns:Array<{width:number|null}>|null, columnsError:string|null,
 *            rows:Array<{section,rowIndex,preview}>}>}}
 *          khoá của `html`/`table` là `"<actionId>::<bodyKey>"` (+ `::vi|en` riêng cho `html`).
 */
function buildAllRenders(core, clearText, actions) {
  const html = {};
  const htmlBlueprint = {};
  const table = {};
  for (const a of actions) {
    for (const body of a.bodies) {
      for (const vi of [true, false]) {
        const langKey = vi ? 'vi' : 'en';
        const r = core.renderMailPreview(clearText, { actionId: a.id, body, vi });
        const key = `${a.id}::${body}::${langKey}`;
        html[key] = r.ok
          ? r.html
          : `<div style="font:13px 'Segoe UI',sans-serif;color:#900;padding:16px;">${esc(r.reason)}</div>`;

        // Bản riêng cho chế độ blueprint (kéo giãn cột) — gắn `data-fbo-col` vào <td> tiêu đề
        // cột. Dựng SẴN cả hai ngôn ngữ cùng lúc với bản thường, không đợi người dùng bật "Sửa
        // cấu trúc bảng" mới gọi lại core — cùng triết lý với `html`.
        const rb = core.renderMailPreview(clearText, {
          actionId: a.id, body, vi, blueprint: true,
        });
        htmlBlueprint[key] = rb.ok ? rb.html : html[key];
      }

      const tableKey = `${a.id}::${body}`;
      const analysis = core.analyzeMailColumns(clearText, { actionId: a.id, body });
      table[tableKey] = {
        columns: analysis.ok ? analysis.columns.map((c) => ({ width: c.width })) : null,
        columnsError: analysis.ok ? null : analysis.reason,
        rows: core.listMailRows(clearText, { actionId: a.id, body })
          .map((r) => ({ section: r.section, rowIndex: r.rowIndex, preview: r.preview })),
      };
    }
  }
  return {
    actions: actions.map((a) => ({
      id: a.id,
      label: a.v || a.e || a.id,
      table: a.table,
      bodies: a.bodies,
    })),
    html,
    htmlBlueprint,
    table,
  };
}

/**
 * Khung panel: thanh công cụ (combobox tìm mẫu mail, chọn biến thể, đổi ngôn ngữ, so sánh, đi
 * tới định nghĩa) cộng một iframe cô lập chứa HTML của chính bức mail. Bọc trong iframe, không
 * nhúng thẳng vào trang: HTML của khách tự khai `<style>`/`<html>`/`<body>` riêng
 * (`renderMailPreview` trả về một tài liệu trọn vẹn), nhúng thẳng là để CSS của khách và CSS của
 * thanh công cụ giẫm lên nhau.
 *
 * Combobox tự viết (input + danh sách lọc), không dùng `<datalist>`: cần hiện kèm `id` và số
 * biến thể bên cạnh tên, thứ `<datalist>` không vẽ được, và hành vi lọc/phím tắt của nó khác
 * nhau giữa các engine — tự viết thì mọi trình duyệt trong webview (Chromium cố định) thấy
 * giống hệt nhau.
 *
 * @param {{actionId:string|null, body:string|null, lang:'vi'|'en'}} initial lựa chọn mở đầu —
 *   xem `lastSelection` ở `viewMail`. Webview tự kiểm lại (`actionId`/`body` có còn tồn tại
 *   không) chứ không tin thẳng, vì file có thể đã đổi từ lần mở panel trước.
 */
function panelHtml(data, initial) {
  const n = nonce();
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; child-src 'self'; img-src https: http: data:; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<title>Xem mail</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; }
  body { margin: 0; font-family: "Segoe UI", sans-serif; background: #fff; display: flex; flex-direction: column; }
  .fbo-mail-toolbar {
    display: flex; align-items: center; gap: 10px; padding: 6px 10px; box-sizing: border-box;
    background: #f3f3f3; border-bottom: 1px solid #ddd; font-size: 12px; color: #333; flex-wrap: wrap;
    flex: 0 0 auto;
  }
  .fbo-mail-field { display: flex; align-items: center; gap: 5px; }
  .fbo-mail-field label { white-space: nowrap; }
  .fbo-mail-toolbar .fbo-mail-spacer { flex: 1; }
  .fbo-mail-toolbar button, .fbo-mail-toolbar select, .fbo-mail-toolbar input {
    font-size: 12px; padding: 3px 8px; cursor: pointer; border: 1px solid #ccc; background: #fff;
    border-radius: 3px; font-family: inherit;
  }
  .fbo-mail-toolbar button:disabled { cursor: default; opacity: .45; }
  .fbo-mail-toolbar button[aria-pressed="true"] { background: #0a63c2; color: #fff; border-color: #0a63c2; }
  .fbo-mail-toolbar .fbo-sep { width: 1px; align-self: stretch; background: #ddd; margin: 0 2px; }
  .fbo-combo { position: relative; }
  .fbo-combo input { width: 260px; cursor: text; }
  .fbo-combo-list {
    position: absolute; top: 100%; left: 0; margin-top: 2px; width: 360px; max-height: 280px;
    overflow-y: auto; background: #fff; border: 1px solid #ccc; border-radius: 3px;
    box-shadow: 0 2px 8px rgba(0,0,0,.15); z-index: 10;
  }
  .fbo-combo-item { padding: 5px 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fbo-combo-item .fbo-combo-id { color: #777; margin-left: 6px; }
  .fbo-combo-item:hover, .fbo-combo-item.fbo-combo-active { background: #0a63c2; color: #fff; }
  .fbo-combo-item:hover .fbo-combo-id, .fbo-combo-item.fbo-combo-active .fbo-combo-id { color: #dbe9fb; }
  .fbo-combo-empty { padding: 6px 8px; color: #777; }
  .fbo-mail-body { flex: 1 1 auto; min-height: 0; }
  iframe.fbo-mail-frame { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
  #fboSingleWrap { height: 100%; position: relative; }
  .fbo-blueprint-overlay { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
  .fbo-col-handle {
    position: absolute; width: 5px; margin-left: -2px; background: rgba(10,99,194,.55);
    cursor: col-resize; pointer-events: auto;
  }
  .fbo-col-handle:hover { background: rgba(10,99,194,.9); }
  .fbo-col-handle.fbo-col-handle-fixed { background: repeating-linear-gradient(45deg,rgba(150,150,150,.4) 0 3px,transparent 3px 6px); cursor: not-allowed; }
  .fbo-col-tooltip {
    position: absolute; background: #0a63c2; color: #fff; font: 11px/1.4 "Segoe UI", sans-serif;
    padding: 2px 6px; border-radius: 3px; z-index: 20; white-space: nowrap;
  }
  body.fbo-mail-resizing, body.fbo-mail-resizing * { cursor: col-resize !important; user-select: none; }
  .fbo-edit-hint { color: #666; }
  #fboCompareWrap { height: 100%; display: flex; gap: 1px; background: #ddd; }
  .fbo-compare-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; background: #fff; }
  .fbo-compare-head {
    flex: 0 0 auto; padding: 4px 8px; background: #f3f3f3; border-bottom: 1px solid #ddd; font-size: 12px;
  }
  .fbo-compare-pane iframe { flex: 1; min-height: 0; }
  .fbo-edit-panel {
    flex: 0 0 auto; box-sizing: border-box; padding: 8px 10px; background: #fffbe6;
    border-bottom: 1px solid #e6d9a0; font-size: 12px; display: flex; flex-direction: column; gap: 8px;
  }
  .fbo-edit-columns { display: flex; flex-wrap: wrap; gap: 8px; }
  .fbo-edit-col {
    display: flex; align-items: center; gap: 4px; border: 1px solid #ddd; border-radius: 4px;
    padding: 3px 6px; background: #fff;
  }
  .fbo-edit-col input[type="number"] { width: 62px; }
  .fbo-edit-col button { padding: 1px 6px; }
  .fbo-edit-actions { display: flex; gap: 8px; align-items: center; }
  .fbo-edit-error { color: #900; }
</style>
</head>
<body>
<div class="fbo-mail-toolbar">
  <div class="fbo-mail-field fbo-combo" id="fboActionCombo">
    <label for="fboActionInput">Mẫu mail</label>
    <input id="fboActionInput" type="text" autocomplete="off" spellcheck="false" placeholder="Gõ để tìm theo tên hoặc id…">
    <div id="fboActionList" class="fbo-combo-list" hidden></div>
  </div>
  <div class="fbo-mail-field" id="fboBodyField" hidden>
    <label for="fboBodySelect">Biến thể</label>
    <select id="fboBodySelect"></select>
  </div>
  <button id="fboMailCompare" type="button" aria-pressed="false" title="So sánh hai biến thể cạnh nhau">So sánh biến thể</button>
  <button id="fboMailEdit" type="button" aria-pressed="false" title="Kéo giãn cột / thêm dòng / thêm cột — ghi thật vào Message.xml">Sửa cấu trúc bảng</button>
  <span class="fbo-mail-spacer"></span>
  <div class="fbo-mail-field">
    <label>Đi tới XML</label>
    <button id="fboGotoHeader" type="button">Header</button>
    <button id="fboGotoDetail" type="button">Detail</button>
    <button id="fboGotoFooter" type="button">Footer</button>
  </div>
  <span class="fbo-sep"></span>
  <button id="fboMailVi" type="button" aria-pressed="true">Tiếng Việt</button>
  <button id="fboMailEn" type="button" aria-pressed="false">English</button>
</div>
<div id="fboEditPanel" class="fbo-edit-panel" hidden>
  <div id="fboEditHint" class="fbo-edit-hint">Kéo vạch xanh ngay trên bản xem để đổi bề rộng cột.</div>
  <div id="fboEditColumns" class="fbo-edit-columns"></div>
  <div class="fbo-edit-actions">
    <button id="fboAddRowBtn" type="button">+ Thêm dòng (chọn dòng có sẵn để nhân bản)</button>
  </div>
  <div id="fboEditError" class="fbo-edit-error" hidden></div>
</div>
<div class="fbo-mail-body">
  <div id="fboSingleWrap">
    <iframe id="fboMailFrame" class="fbo-mail-frame" sandbox="allow-same-origin"></iframe>
    <div id="fboBlueprintOverlay" class="fbo-blueprint-overlay"></div>
    <div id="fboColTooltip" class="fbo-col-tooltip" hidden></div>
  </div>
  <div id="fboCompareWrap" hidden>
    <div class="fbo-compare-pane">
      <div class="fbo-compare-head"><select id="fboCompareBodyA"></select></div>
      <iframe id="fboFrameA" class="fbo-mail-frame" sandbox=""></iframe>
    </div>
    <div class="fbo-compare-pane">
      <div class="fbo-compare-head"><select id="fboCompareBodyB"></select></div>
      <iframe id="fboFrameB" class="fbo-mail-frame" sandbox=""></iframe>
    </div>
  </div>
</div>
<script nonce="${n}">
(function () {
  // \`acquireVsCodeApi\` chỉ tồn tại BÊN TRONG webview thật của VS Code — che chắn để trang vẫn
  // chạy được khi mở rời (xem trước ngoài trình duyệt để thử combobox/so sánh): lúc đó "nhớ lựa
  // chọn" và "đi tới định nghĩa" chỉ đơn giản không làm gì, mọi điều hướng khác vẫn hoạt động.
  const vscodeApi = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : { postMessage() {} };
  const DATA = ${embedJson(data)};
  const INITIAL = ${embedJson(initial)};

  const input = document.getElementById('fboActionInput');
  const list = document.getElementById('fboActionList');
  const combo = document.getElementById('fboActionCombo');
  const bodyField = document.getElementById('fboBodyField');
  const bodySelect = document.getElementById('fboBodySelect');
  const singleWrap = document.getElementById('fboSingleWrap');
  const frame = document.getElementById('fboMailFrame');
  const btnVi = document.getElementById('fboMailVi');
  const btnEn = document.getElementById('fboMailEn');
  const btnCompare = document.getElementById('fboMailCompare');
  const compareWrap = document.getElementById('fboCompareWrap');
  const bodyASel = document.getElementById('fboCompareBodyA');
  const bodyBSel = document.getElementById('fboCompareBodyB');
  const frameA = document.getElementById('fboFrameA');
  const frameB = document.getElementById('fboFrameB');
  const btnGotoHeader = document.getElementById('fboGotoHeader');
  const btnGotoDetail = document.getElementById('fboGotoDetail');
  const btnGotoFooter = document.getElementById('fboGotoFooter');
  const btnEdit = document.getElementById('fboMailEdit');
  const editPanel = document.getElementById('fboEditPanel');
  const editColumns = document.getElementById('fboEditColumns');
  const editError = document.getElementById('fboEditError');
  const btnAddRow = document.getElementById('fboAddRowBtn');

  const byId = new Map(DATA.actions.map((a) => [a.id, a]));
  let actionId = byId.has(INITIAL.actionId) ? INITIAL.actionId : (DATA.actions[0] && DATA.actions[0].id) || null;
  let bodyKey = null;
  let lang = INITIAL.lang === 'en' ? 'en' : 'vi';
  let compareMode = false;
  let editOpen = false;
  let activeIndex = -1;
  let visible = [];

  btnVi.setAttribute('aria-pressed', String(lang === 'vi'));
  btnEn.setAttribute('aria-pressed', String(lang === 'en'));

  function notifySelection() {
    vscodeApi.postMessage({ type: 'selection', actionId, body: bodyKey, lang });
  }

  function render() {
    const key = actionId + '::' + bodyKey + '::' + lang;
    const src = editOpen ? DATA.htmlBlueprint : DATA.html;
    frame.srcdoc = (src && src[key]) || '<p style="font:13px sans-serif;padding:16px;">Không có bản render.</p>';
  }

  function populateCompareBodies(a) {
    bodyASel.innerHTML = '';
    bodyBSel.innerHTML = '';
    for (const b of a.bodies) {
      const oa = document.createElement('option');
      oa.value = b; oa.textContent = '<' + b + '>';
      bodyASel.appendChild(oa);
      bodyBSel.appendChild(oa.cloneNode(true));
    }
    bodyASel.value = a.bodies[0];
    bodyBSel.value = a.bodies[1] || a.bodies[0];
  }

  function renderCompare() {
    if (!bodyASel.value || !bodyBSel.value) return;
    frameA.srcdoc = DATA.html[actionId + '::' + bodyASel.value + '::' + lang] || '';
    frameB.srcdoc = DATA.html[actionId + '::' + bodyBSel.value + '::' + lang] || '';
  }

  /**
   * Cập nhật CẢ HAI chế độ xem mỗi lần trạng thái đổi — dù cái nào đang ẩn cũng không bỏ qua.
   *
   * Trước đây chỉ dựng lại chế độ ĐANG BẬT (so sánh thì chỉ renderCompare, xem đơn thì chỉ
   * render): bật lại so sánh, hoặc bấm tắt so sánh để quay về xem đơn, sẽ có một khung vừa hiện
   * ra lại đang cầm bản srcdoc CŨ từ TRƯỚC lần đổi mẫu/ngôn ngữ gần nhất — vì lượt đổi đó chỉ
   * render đúng khung đang hiện, khung kia bị bỏ qua. Luôn dựng cả hai thì khung nào hiện ra
   * cũng đã sẵn đúng nội dung, thuộc tính ẩn/hiện chỉ còn lo mỗi việc ẩn/hiện, không còn phải lo
   * cả việc "còn nợ một lượt render".
   */
  function refreshFrames() {
    render();
    renderCompare();
  }

  function applyCompareVisibility() {
    singleWrap.hidden = compareMode;
    compareWrap.hidden = !compareMode;
    btnCompare.setAttribute('aria-pressed', String(compareMode));
  }

  /**
   * Bảng điều khiển "Sửa cấu trúc" — luôn theo (actionId, bodyKey) đang xem ở khung ĐƠN, kể cả
   * khi đang bật so sánh (so sánh hai biến thể lúc đang sửa cấu trúc của MỘT biến thể là hai câu
   * hỏi khác nhau, trộn vào một bảng điều khiển chỉ gây rối).
   *
   * Bề rộng lấy từ DATA.table — dựng SẴN lúc mở panel (phân tích cột/dòng chạy ở phía host khi
   * xây dữ liệu), không hỏi lại host chỉ để hiện danh sách; hỏi host CHỈ khi thật sự ghi.
   */
  function renderEditPanel() {
    if (!editOpen) return;
    const info = DATA.table[actionId + '::' + bodyKey];
    editColumns.innerHTML = '';

    if (!info || !info.columns) {
      editError.hidden = false;
      editError.textContent = (info && info.columnsError)
        || 'Không có thông tin cấu trúc bảng cho biến thể này.';
    } else {
      editError.hidden = true;
      info.columns.forEach((col, index) => {
        const wrap = document.createElement('div');
        wrap.className = 'fbo-edit-col';

        // Chỉ HIỆN bề rộng — SỬA nó là việc của vạch kéo trên bản xem (hàm buildColumnOverlay
        // bên dưới), không phải ô nhập ở đây nữa. Cột không có width riêng vẫn liệt kê (để còn
        // nhân bản được), chỉ khác là ghi rõ "dùng chung" thay vì một con số.
        const label = document.createElement('span');
        label.textContent = 'Cột ' + (index + 1) + ': ' + (col.width !== null ? col.width + 'px' : 'dùng chung');

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = '+ cột';
        addBtn.title = 'Nhân bản cột này (header + detail), chèn ngay sau';
        addBtn.addEventListener('click', () => {
          vscodeApi.postMessage({ type: 'addColumn', actionId, body: bodyKey, columnIndex: index });
        });

        wrap.appendChild(label);
        wrap.appendChild(addBtn);
        editColumns.appendChild(wrap);
      });
    }

    btnAddRow.disabled = !info || !info.rows || info.rows.length === 0;
  }

  /**
   * Chế độ blueprint — kéo giãn cột TRỰC TIẾP trên bản xem, cùng cảm giác với vùng form của
   * chính designer này (xem wireRegionColumnResize trong extension/media/designer.js).
   *
   * Vì sao đọc được DOM bên trong iframe: sandbox mang allow-same-origin (không mang
   * allow-scripts — nội dung mail vẫn không chạy được lấy một dòng JS nào, chỉ riêng CHA đọc
   * được DOM con). Không có quyền đó thì frame.contentDocument bị chặn cross-origin, không
   * cách nào đo được cột đang nằm ở đâu trên màn hình để vẽ tay cầm đúng chỗ.
   *
   * Toạ độ neo vào thuộc tính data-fbo-col="N" trên các ô tiêu đề cột — do CHÍNH core gắn sẵn
   * lúc dựng DATA.htmlBlueprint (renderMailPreview với blueprint:true), chỉ đánh dấu HÀNG TIÊU
   * ĐỀ CỘT (nơi width:Npx thật sự nằm trong corpus) — không đoán bằng cách đếm ô phía webview,
   * tránh lệch khỏi đúng luật analyzeMailColumns đã dùng để tính offset ghi ngược.
   */
  const overlayEl = document.getElementById('fboBlueprintOverlay');
  const tooltipEl = document.getElementById('fboColTooltip');
  let dragState = null;

  function clearOverlay() {
    overlayEl.innerHTML = '';
    tooltipEl.hidden = true;
  }

  function buildColumnOverlay() {
    overlayEl.innerHTML = '';
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    if (!doc) return;
    const cells = [...doc.querySelectorAll('[data-fbo-col]')];
    if (cells.length === 0) return;

    const wrapRect = singleWrap.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const offsetX = frameRect.left - wrapRect.left;
    const offsetY = frameRect.top - wrapRect.top;
    // Vạch kéo cao hết nội dung THẬT của trang con (không chỉ hết khung nhìn) — cuộn xuống vẫn
    // thấy nguyên vạch, đúng cảm giác "đường biên cột" chạy dọc cả bảng.
    const contentHeight = doc.documentElement ? doc.documentElement.scrollHeight : frameRect.height;

    const info = DATA.table[actionId + '::' + bodyKey];
    for (const cell of cells) {
      const idx = Number(cell.getAttribute('data-fbo-col'));
      const r = cell.getBoundingClientRect();
      const width = info && info.columns && info.columns[idx] ? info.columns[idx].width : null;

      const handle = document.createElement('div');
      handle.className = 'fbo-col-handle' + (width === null ? ' fbo-col-handle-fixed' : '');
      handle.dataset.col = String(idx);
      handle.style.left = (offsetX + r.right) + 'px';
      handle.style.top = offsetY + 'px';
      handle.style.height = contentHeight + 'px';
      handle.title = width !== null
        ? ('Kéo để đổi bề rộng cột ' + (idx + 1) + ' (đang ' + width + 'px)')
        : ('Cột ' + (idx + 1) + ' dùng bề rộng chung (class CSS) — không kéo được, tự sửa tay trong XML');
      overlayEl.appendChild(handle);
    }
  }

  function moveTooltip(handle, width) {
    tooltipEl.hidden = false;
    tooltipEl.textContent = Math.round(width) + 'px';
    tooltipEl.style.left = (parseFloat(handle.style.left) + 8) + 'px';
    tooltipEl.style.top = (parseFloat(handle.style.top) + 4) + 'px';
  }

  overlayEl.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.fbo-col-handle');
    if (!handle || handle.classList.contains('fbo-col-handle-fixed')) return;
    const columnIndex = Number(handle.dataset.col);
    const info = DATA.table[actionId + '::' + bodyKey];
    const startWidth = info && info.columns && info.columns[columnIndex] ? info.columns[columnIndex].width : null;
    if (startWidth === null) return;
    e.preventDefault();
    dragState = {
      handle, columnIndex, startWidth, startX: e.clientX, originLeft: parseFloat(handle.style.left),
    };
    document.body.classList.add('fbo-mail-resizing');
    moveTooltip(handle, startWidth);
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragState) return;
    const delta = e.clientX - dragState.startX;
    const newWidth = Math.max(10, dragState.startWidth + delta);
    dragState.handle.style.left = (dragState.originLeft + (newWidth - dragState.startWidth)) + 'px';
    dragState.currentWidth = newWidth;
    moveTooltip(dragState.handle, newWidth);
  });

  window.addEventListener('mouseup', () => {
    if (!dragState) return;
    document.body.classList.remove('fbo-mail-resizing');
    tooltipEl.hidden = true;
    const { columnIndex, startWidth, currentWidth } = dragState;
    dragState = null;
    const finalWidth = Math.round(currentWidth ?? startWidth);
    // Nhả chuột đúng ngay vị trí cũ (không kéo đi đâu) — không có gì để ghi, tránh một hộp thoại
    // xác nhận vô nghĩa cho một thao tác không đổi gì.
    if (finalWidth !== startWidth) {
      // Chạy qua blueprint = commit NGAY, không hộp thoại xác nhận — đúng cảm giác kéo-thả của
      // vùng form (wireRegionColumnResize cũng ghi thẳng, an toàn dựa vào Ctrl+Z chứ không hỏi
      // từng lần kéo). Đây là thao tác THỬ NHIỀU LẦN LIÊN TỤC để canh mắt, hỏi mỗi lần thả chuột
      // sẽ phá hỏng đúng cái cảm giác đang cố tái tạo.
      vscodeApi.postMessage({
        type: 'resizeColumn', actionId, body: bodyKey, columnIndex, width: finalWidth, viaBlueprint: true,
      });
    }
  });

  window.addEventListener('resize', () => { if (editOpen) buildColumnOverlay(); });

  frame.addEventListener('load', () => {
    if (editOpen) buildColumnOverlay(); else clearOverlay();
  });

  btnEdit.addEventListener('click', () => {
    editOpen = !editOpen;
    btnEdit.setAttribute('aria-pressed', String(editOpen));
    editPanel.hidden = !editOpen;
    render(); // đổi nguồn iframe giữa DATA.html (thường) và DATA.htmlBlueprint (có marker)
    renderEditPanel();
  });

  btnAddRow.addEventListener('click', () => {
    if (btnAddRow.disabled) return;
    vscodeApi.postMessage({ type: 'requestAddRow', actionId, body: bodyKey });
  });

  function selectAction(id, preferredBody) {
    const a = byId.get(id);
    if (!a) return;
    actionId = id;
    input.value = a.label;
    closeList();

    bodySelect.innerHTML = '';
    for (const b of a.bodies) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = '<' + b + '>';
      bodySelect.appendChild(opt);
    }
    bodyKey = (preferredBody && a.bodies.includes(preferredBody)) ? preferredBody : (a.bodies[0] || null);
    bodySelect.value = bodyKey || '';
    bodyField.hidden = a.bodies.length <= 1;

    const canCompare = a.bodies.length > 1;
    btnCompare.disabled = !canCompare;
    if (!canCompare) compareMode = false;
    // Luôn dựng lại danh sách so sánh theo action MỚI khi còn so sánh được — không đợi tới lúc
    // người dùng bật "So sánh" mới dựng: đổi mẫu trong lúc panel so sánh ĐANG MỞ phải thấy đúng
    // hai biến thể của mẫu mới ngay, không phải danh sách của mẫu vừa rời đi.
    if (canCompare) populateCompareBodies(a);
    applyCompareVisibility();
    refreshFrames();
    renderEditPanel();
    notifySelection();
  }

  function closeList() {
    list.hidden = true;
    activeIndex = -1;
  }

  function highlight(i) {
    const items = list.querySelectorAll('.fbo-combo-item');
    items.forEach((el, idx) => el.classList.toggle('fbo-combo-active', idx === i));
    if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
    activeIndex = i;
  }

  function openList(filterText) {
    const q = filterText.trim().toLowerCase();
    visible = !q ? DATA.actions : DATA.actions.filter((a) =>
      a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));

    list.innerHTML = '';
    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fbo-combo-empty';
      empty.textContent = 'Không khớp mẫu mail nào.';
      list.appendChild(empty);
    } else {
      for (const a of visible.slice(0, 300)) {
        const item = document.createElement('div');
        item.className = 'fbo-combo-item';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = a.label;
        const idSpan = document.createElement('span');
        idSpan.className = 'fbo-combo-id';
        idSpan.textContent = a.id + ' · ' + a.bodies.length + ' biến thể';
        item.appendChild(nameSpan);
        item.appendChild(idSpan);
        // mousedown (không phải click): nổ ra TRƯỚC blur của input, nên input không kịp đóng
        // danh sách trước khi lựa chọn được ghi nhận.
        item.addEventListener('mousedown', (e) => { e.preventDefault(); selectAction(a.id); });
        list.appendChild(item);
      }
    }
    list.hidden = false;
    activeIndex = -1;
  }

  input.addEventListener('input', () => openList(input.value));
  input.addEventListener('focus', () => openList(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeList(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) openList(input.value); else highlight(Math.min(activeIndex + 1, visible.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(activeIndex - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = visible[activeIndex] || visible[0];
      if (pick) selectAction(pick.id);
    }
  });
  document.addEventListener('click', (e) => { if (!combo.contains(e.target)) closeList(); });

  bodySelect.addEventListener('change', () => {
    bodyKey = bodySelect.value;
    refreshFrames();
    renderEditPanel();
    notifySelection();
  });

  // Bấm "So sánh" chỉ LẬT hiện/ẩn — nội dung của cả hai chế độ luôn được giữ mới sẵn qua
  // refreshFrames() (đổi mẫu, đổi ngôn ngữ, đổi body), nên bấm lần nữa để quay lại xem đơn
  // không bao giờ lộ ra bản srcdoc cũ.
  btnCompare.addEventListener('click', () => {
    if (btnCompare.disabled) return;
    compareMode = !compareMode;
    applyCompareVisibility();
  });
  bodyASel.addEventListener('change', renderCompare);
  bodyBSel.addEventListener('change', renderCompare);

  function setLang(next) {
    lang = next;
    btnVi.setAttribute('aria-pressed', String(lang === 'vi'));
    btnEn.setAttribute('aria-pressed', String(lang === 'en'));
    refreshFrames();
    notifySelection();
  }
  btnVi.addEventListener('click', () => setLang('vi'));
  btnEn.addEventListener('click', () => setLang('en'));

  function gotoSource(section) {
    vscodeApi.postMessage({ type: 'gotoSource', actionId, body: bodyKey, section });
  }
  btnGotoHeader.addEventListener('click', () => gotoSource('header'));
  btnGotoDetail.addEventListener('click', () => gotoSource('detail'));
  btnGotoFooter.addEventListener('click', () => gotoSource('footer'));

  if (actionId) selectAction(actionId, INITIAL.body);
})();
</script>
</body>
</html>`;
}

/** Panel đơn — mở lại lệnh khi đã có một panel thì cập nhật NGAY panel đó, không mở thêm tab,
 * cùng lý do `PreviewPanel.current` chỉ giữ một bản: đây là công cụ xem, không phải tài liệu
 * người dùng muốn giữ nhiều bản song song. */
let currentPanel = null;

/** Lựa chọn gần nhất — sống suốt phiên VS Code (không ghi xuống đĩa), qua MỌI lần mở lệnh, kể cả
 * sau khi panel đã đóng. Webview tự kiểm lại actionId/body còn tồn tại không khi mở panel mới
 * (`panelHtml`'s `selectAction`) — file có thể đã đổi từ lần trước. */
let lastSelection = { actionId: null, body: null, lang: 'vi' };

/** Bản đã bung entity của lần quét GẦN NHẤT (mở lệnh, hoặc ghi xong một sửa cấu trúc) — handler
 * `onDidReceiveMessage` (đăng ký một lần lúc tạo panel) đọc biến này tại THỜI ĐIỂM NHẬN TIN,
 * không phải lúc đăng ký, nên "đi tới định nghĩa" và các thao tác sửa luôn quy theo file mới
 * nhất kể cả khi panel đã sống qua nhiều lần mở lệnh / nhiều lần ghi. */
let currentSource = null;

/** Đường dẫn file Message.xml đang cấp dữ liệu cho panel — cần để MỞ LẠI đúng file đó và dựng
 * lại panel sau khi một thao tác sửa cấu trúc ghi thành công (`refreshPanelAfterEdit`). */
let currentDocumentPath = null;

/**
 * Mở (hoặc focus lại) đúng vị trí `[start,end)` của `file` trong một text editor.
 *
 * Ưu tiên editor ĐANG MỞ SẴN nhìn thấy được — không ép người dùng rời bố cục đang có; hết cách
 * mới mở file mới ở cột 1. Cùng tinh thần `render-host.js#revealIn`, viết lại gọn hơn vì ở đây
 * không có ngữ cảnh "file phụ" hay "alt-click" cần phân biệt.
 */
async function revealSpan(file, start, end) {
  const target = String(file).toLowerCase();
  const visibleEditor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath.toLowerCase() === target);
  const doc = visibleEditor ? visibleEditor.document : await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const range = new vscode.Range(doc.positionAt(start), doc.positionAt(end));
  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: visibleEditor ? visibleEditor.viewColumn : vscode.ViewColumn.One,
    preserveFocus: false,
    preview: false,
    selection: range,
  });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

const GOTO_SECTIONS = new Set(['header', 'detail', 'footer']);

/**
 * Quét lại một document đã xác nhận là mail template, dựng dữ liệu cho panel, và cập nhật
 * `currentSource`/`currentDocumentPath`. Dùng chung cho lần mở lệnh ĐẦU TIÊN (`viewMail`) và mỗi
 * lần dựng lại panel SAU KHI GHI xong một sửa cấu trúc (`refreshPanelAfterEdit`) — hai chỗ đó
 * phải tuyệt đối giống nhau, nếu không panel sau khi sửa sẽ hiện một bản khác bản `viewMail` sẽ
 * hiện nếu người dùng đóng rồi mở lại lệnh.
 *
 * @returns {{ok:true, data:object, initial:object, actionCount:number, bodyCount:number}|{ok:false}}
 */
function refreshFromDocument(core, document, output) {
  const readFile = cachedReadFile(core);
  const expanded = core.expandEntities(document.getText(), { filePath: document.uri.fsPath, readFile });
  for (const d of expanded.diagnostics) output.appendLine(`xem mail [${d.severity}] ${d.message}`);

  const actions = core.scanMailActions(expanded.clearText);
  if (actions.length === 0) return { ok: false };

  currentSource = { clearText: expanded.clearText, segments: expanded.segments };
  currentDocumentPath = document.uri.fsPath;

  const data = buildAllRenders(core, expanded.clearText, actions);
  // Lựa chọn gần nhất còn hợp lệ với danh sách VỪA quét không (file có thể đã đổi) — không thì
  // panel tự rơi về mẫu đầu tiên (xem `panelHtml`'s `selectAction`, nó cũng tự kiểm lại body).
  const initial = lastSelection.actionId && actions.some((a) => a.id === lastSelection.actionId)
    ? lastSelection
    : { actionId: actions[0].id, body: null, lang: lastSelection.lang };

  return {
    ok: true, data, initial, actionCount: actions.length, bodyCount: actions.reduce((n, a) => n + a.bodies.length, 0),
  };
}

/** Dựng lại panel đang mở từ ĐÚNG file vừa ghi — chạy sau mỗi lần `applySplice` thành công, để
 * người dùng thấy ngay kết quả (cột mới rộng ra, dòng/cột vừa nhân bản đã xuất hiện) mà không
 * phải tự đóng mở lại lệnh. Im lặng bỏ qua nếu panel đã đóng entretemps hoặc file đột nhiên
 * không còn mẫu mail nào (không nên xảy ra — vừa ghi xong bằng chính plan tính từ file đó). */
async function refreshPanelAfterEdit(core, output) {
  if (!currentPanel || !currentDocumentPath) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(currentDocumentPath));
  const built = refreshFromDocument(core, doc, output);
  if (built.ok) currentPanel.webview.html = panelHtml(built.data, built.initial);
}

/**
 * Áp một kế hoạch sửa (`{ok:true, edits, notes?}` từ `core.planResizeMailColumn`/
 * `planAddMailRow`/`planAddMailColumn`) — quy từng splice về file nguồn, hỏi xác nhận MỘT lần
 * (bao gồm cảnh báo file dùng chung/notes nếu có), rồi ghi qua đúng hạ tầng `applySplice` đã
 * kiểm chứng của Dir/Grid (một `WorkspaceEdit`, lưu, vào lịch sử hoàn tác).
 *
 * `warning: null` khi gọi `applySplice`: đã tự hỏi ở ĐÂY rồi, để `applySplice` hỏi thêm
 * `confirmForeign` của riêng nó là hỏi hai lần cho cùng một việc.
 */
async function applyMailTablePlan(core, output, plan, description) {
  if (!plan.ok) {
    vscode.window.showWarningMessage(`FBO Designer: ${plan.reason}`);
    return;
  }
  if (!currentSource || !currentDocumentPath) return;

  const sourceEdits = [];
  for (const e of plan.edits) {
    /*
     * CHÈN (start === end) và THAY (start < end) phải quy về nguồn bằng HAI hàm khác nhau.
     *
     * `sourceRange` được viết cho việc REVEAL/CHỌN một dải chữ đã có (đi tới định nghĩa) — nó cố
     * tình đệm tối thiểu 1 ký tự (`Math.max(to, from + 1)` trong entities.mjs) vì một dải rỗng
     * không tô sáng được gì trên editor. Dùng nó cho một điểm CHÈN THUẦN TUÝ (như bản sao cột/
     * dòng ở đây) là biến "chèn tại đây" thành "THAY 1 KÝ TỰ tại đây" — và ký tự bị thay chính là
     * `<` của thẻ đứng ngay sau, một lỗi ĂN MẤT MỘT KÝ TỰ hoàn toàn im lặng (đo được thật khi thử
     * `addColumn` trên file thật của HOATP: đẻ ra `td style=…` cụt mất dấu `<`). `mapToSource`
     * không đệm gì cả — đúng thứ cần cho một điểm chèn.
     */
    const isInsert = e.start === e.end;
    const src = isInsert
      ? (() => {
        const m = core.mapToSource(currentSource.segments, e.start);
        return m ? { file: m.file, start: m.offset, end: m.offset } : null;
      })()
      : core.sourceRange(currentSource.segments, e.start, e.end);
    if (!src) {
      vscode.window.showErrorMessage('FBO Designer: không quy được vị trí sửa về file nguồn — huỷ thao tác.');
      return;
    }
    sourceEdits.push({
      file: src.file, start: src.start, end: src.end, text: e.text,
    });
  }

  const hostDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(currentDocumentPath));
  const foreignFile = sourceEdits.find((e) => !samePath(e.file, hostDocument.uri.fsPath))?.file ?? null;

  const body = [{ type: 'text', content: description }];
  if (foreignFile) {
    body.push({
      type: 'text',
      content: `Một phần nằm ở ${path.basename(foreignFile)} — sửa là đổi cho MỌI mẫu khác đang dùng chung file đó.`,
    });
  }
  for (const note of plan.notes ?? []) body.push({ type: 'text', content: `⚠ ${note}` });

  const answer = await dialogs().ask({
    type: 'warning',
    title: 'Ghi thay đổi vào Message.xml?',
    subtitle: path.basename(currentDocumentPath),
    size: 'medium',
    body,
    buttons: [
      { id: 'cancel', label: 'Huỷ', variant: 'secondary', action: 'cancel' },
      { id: 'go', label: 'Ghi', variant: foreignFile ? 'danger' : 'primary', action: 'confirm' },
    ],
  });
  if (answer !== 'go') return;

  const wrote = await applySplice({ edits: sourceEdits, warning: null }, hostDocument, output, 'sửa mẫu mail');
  if (wrote) await refreshPanelAfterEdit(core, output);
}

/**
 * @param {object} core module `core/src/index.mjs` đã nạp
 * @param {import('vscode').OutputChannel} output
 */
function onPanelMessage(core, output) {
  return async (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'selection') {
      lastSelection = {
        actionId: typeof msg.actionId === 'string' ? msg.actionId : null,
        body: typeof msg.body === 'string' ? msg.body : null,
        lang: msg.lang === 'en' ? 'en' : 'vi',
      };
      return;
    }

    if (msg.type === 'gotoSource') {
      if (!currentSource || !GOTO_SECTIONS.has(msg.section)) return;
      const loc = core.locateMailSection(currentSource.clearText, {
        actionId: msg.actionId, body: msg.body, section: msg.section,
      });
      if (!loc) {
        vscode.window.showWarningMessage(
          `FBO Designer: "${msg.actionId}" · <${msg.body}> không có <${msg.section}> để mở.`,
        );
        return;
      }
      const src = core.sourceRange(currentSource.segments, loc.start, loc.end);
      if (!src) return;
      try {
        await revealSpan(src.file, src.start, src.end);
      } catch (err) {
        output.appendLine(`xem mail: đi tới định nghĩa lỗi — ${err.message}`);
        vscode.window.showErrorMessage(`FBO Designer: không mở được ${src.file} — ${err.message}`);
      }
      return;
    }

    if (msg.type === 'resizeColumn') {
      if (!currentSource) return;
      const width = Number(msg.width);
      const plan = core.planResizeMailColumn(currentSource.clearText, {
        actionId: msg.actionId, body: msg.body, columnIndex: Number(msg.columnIndex), width,
      });
      await applyMailTablePlan(
        core, output, plan,
        `Đổi bề rộng cột ${Number(msg.columnIndex) + 1} thành ${width}px — "${msg.actionId}" · <${msg.body}>.`,
      );
      return;
    }

    if (msg.type === 'addColumn') {
      if (!currentSource) return;
      const plan = core.planAddMailColumn(currentSource.clearText, {
        actionId: msg.actionId, body: msg.body, columnIndex: Number(msg.columnIndex),
      });
      await applyMailTablePlan(
        core, output, plan,
        `Thêm cột (nhân bản cột ${Number(msg.columnIndex) + 1}) — "${msg.actionId}" · <${msg.body}>.`,
      );
      return;
    }

    if (msg.type === 'requestAddRow') {
      if (!currentSource) return;
      const rows = core.listMailRows(currentSource.clearText, { actionId: msg.actionId, body: msg.body });
      if (rows.length === 0) {
        vscode.window.showInformationMessage('FBO Designer: không có dòng nào trong <header>/<footer> để nhân bản.');
        return;
      }
      const items = rows.map((r) => ({
        label: `<${r.section}> — ${r.preview}`,
        description: `dòng ${r.rowIndex + 1}`,
        row: r,
      }));
      const picked = await vscode.window.showQuickPick(items, {
        title: 'Thêm dòng — chọn dòng có sẵn để nhân bản',
        placeHolder: 'Dòng mới sẽ giống hệt dòng chọn, chèn ngay sau nó',
        matchOnDescription: true,
      });
      if (!picked) return;
      const plan = core.planAddMailRow(currentSource.clearText, {
        actionId: msg.actionId, body: msg.body, section: picked.row.section, rowIndex: picked.row.rowIndex,
      });
      await applyMailTablePlan(
        core, output, plan,
        `Thêm dòng (nhân bản <${picked.row.section}> dòng ${picked.row.rowIndex + 1}) — "${msg.actionId}" · <${msg.body}>.`,
      );
    }
  };
}

/**
 * @param {object} core module `core/src/index.mjs` đã nạp
 * @param {vscode.OutputChannel} output
 */
async function viewMail(core, output) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) {
    vscode.window.showWarningMessage(toast('extension.no_file'));
    return;
  }

  const source = document.getText();
  if (!core.isMailTemplateDoc(source)) {
    vscode.window.showWarningMessage(
      'FBO Designer: "Xem mail" chỉ áp dụng cho file khai <message xmlns="urn:schemas-fast-com:data-message"> '
      + '— thường là App_Data\\Controllers\\Options\\Message.xml. Mở file đó rồi chạy lại lệnh.',
    );
    return;
  }

  const built = refreshFromDocument(core, document, output);
  if (!built.ok) {
    vscode.window.showInformationMessage('FBO Designer: không tìm thấy mẫu mail nào trong <mail><template> của file này.');
    return;
  }

  const title = 'Xem mail';
  if (currentPanel) {
    currentPanel.title = title;
    currentPanel.reveal(vscode.ViewColumn.Beside, false);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'fboDesigner.mailPreview',
      title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    currentPanel.onDidDispose(() => { currentPanel = null; });
    currentPanel.webview.onDidReceiveMessage(onPanelMessage(core, output));
  }
  currentPanel.webview.html = panelHtml(built.data, built.initial);

  output.appendLine(`xem mail: ${document.uri.fsPath} — ${built.actionCount} mẫu, ${built.bodyCount} biến thể`);
}

/** Chỉ dùng cho test: mỗi kịch bản cần bắt đầu từ "chưa có panel nào" và "chưa nhớ gì", còn
 * trạng thái thật (khi có) sống suốt phiên VS Code như mọi singleton khác trong extension
 * (`PreviewPanel.current`). */
function resetForTests() {
  currentPanel = null;
  currentSource = null;
  currentDocumentPath = null;
  lastSelection = { actionId: null, body: null, lang: 'vi' };
}

module.exports = { viewMail, resetForTests };

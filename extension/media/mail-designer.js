// mail-designer.js — webview của Email Designer (host: `extension/src/mail-designer-editor.js`).
//
// Webview KHÔNG giữ sự thật: nó vẽ đúng thứ host gửi (`render`), và mọi thay đổi chỉ đi lên dưới
// dạng Ý ĐỊNH `{type:'edit', op, rev, elementId, …}`. Không tự sửa DOM của mẫu rồi báo sau — chỗ
// đó là chỗ designer và file XML bắt đầu nói hai chuyện khác nhau.
//
// Vì sao bắt chuột ở lớp phủ `#md-hit` chứ không gắn listener vào DOM của iframe: iframe mang
// `sandbox="allow-same-origin"` KHÔNG `allow-scripts` — mẫu mail do khách viết không chạy được
// dòng JS nào. Trang cha vẫn ĐỌC được DOM con (cùng origin), nên hỏi `elementFromPoint` là đủ
// biết chuột đang trên phần tử nào, và link trong mail không bao giờ nhận được cú click.

(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const frame = $('md-frame');
  const hit = $('md-hit');
  const hoverBox = $('md-hover');
  const selectedBox = $('md-selected');
  const message = $('md-message');
  const actionInput = $('md-action');
  const actionList = $('md-action-list');
  const dropButton = $('md-action-drop');
  const bodySelect = $('md-body');
  const langButton = $('md-lang');

  const ROLE_LABEL = {
    frame: 'khung', structure: 'cấu trúc bảng', block: 'khối', inline: 'nội tuyến', unknown: 'thẻ lạ',
  };
  const COLOR_PROPS = new Set(['color', 'background-color']);
  const ID_RE = /^e[1-9]\d{0,5}$/;

  const state = {
    rev: 0,
    template: null,
    actions: [],
    elements: new Map(),
    styleProperties: {},
    componentPanels: {},
    attributeEnums: {},
    skeleton: '{}',
    sampleDirty: false,   // ô dữ liệu mẫu đang gõ dở — bản vẽ mới không được đè lên
    issues: [],
    fullPreview: false,   // bản xem trước đầy đủ — chỉ đọc, không có phần tử
    selectedId: null,
    hoverId: null,
    templateKey: '',
  };
  let pendingScroll = null;

  const post = (msg) => vscode.postMessage(msg);

  // ─── Thông điệp từ host ───────────────────────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'dialog-show') return showDialog(msg.id, msg.options);
    if (msg.type === 'render') onRender(msg);
    else if (msg.type === 'idle' || msg.type === 'error') showMessage(msg.message, msg.type === 'error');
    // Delete do host bắt (VS Code nuốt phím trước webview) — xem `designer-webview.js`.
    else if (msg.type === 'hotkey' && (msg.key === 'Delete' || msg.key === 'Del')) onDeleteHotkey();
    else if (msg.type === 'sampleError') showSampleError(msg.reason);
    else if (msg.type === 'reveal') onReveal(msg);
  });

  // ─── Hộp thoại overlay (cùng giao kèo designer form — không mở webview riêng) ───────────────
  const DIALOG_GLYPH = { info: 'i', success: '✓', warning: '!', error: '×' };
  let dialogOpen = null;

  function dialogEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  function dialogBlock(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'text') {
      const box = dialogEl('div', 'fbo-dlg-block fbo-dlg-text');
      String(item.content ?? '').split('\n').forEach((line, i) => {
        if (i) box.appendChild(document.createElement('br'));
        box.appendChild(document.createTextNode(line));
      });
      return box;
    }
    if (item.type === 'highlight') {
      const box = dialogEl('div', 'fbo-dlg-block');
      box.appendChild(dialogEl('span', `fbo-dlg-tag ${item.kind || 'info'}`, item.content ?? ''));
      return box;
    }
    return null;
  }

  function closeDialog(action, buttonId) {
    if (!dialogOpen) return;
    const { id, root, lastFocus } = dialogOpen;
    dialogOpen = null;
    root.remove();
    if (lastFocus && document.contains(lastFocus)) {
      try { lastFocus.focus(); } catch { /* ignore */ }
    }
    post({
      type: 'dialog-result', id, action, buttonId, values: null,
    });
  }

  function showDialog(id, options) {
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
      el.addEventListener('click', () => closeDialog(button.action || 'confirm', button.id));
      if (!primary && (button.variant === 'primary' || button.variant === 'danger')) primary = el;
      foot.appendChild(el);
    }
    card.appendChild(foot);
    root.appendChild(card);
    document.body.appendChild(root);
    dialogOpen = { id, root, lastFocus: document.activeElement, primary };
    root.addEventListener('mousedown', (e) => { if (e.target === root) root.dataset.armed = '1'; });
    root.addEventListener('click', (e) => {
      if (e.target === root && root.dataset.armed === '1' && opt.canClose !== false) closeDialog('close', null);
      delete root.dataset.armed;
    });
    (primary || foot.querySelector('.fbo-dlg-btn') || card).focus();
  }

  document.addEventListener('keydown', (event) => {
    if (!dialogOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return closeDialog('close', null);
    }
    event.stopPropagation();
  }, true);

  /**
   * Phím tắt Delete của VS Code chặn phím ở MỌI chỗ trong editor này, kể cả trong ô nhập của bảng
   * thuộc tính. Con trỏ đang ở ô chữ thì làm đúng việc phím Delete lẽ ra làm ở đó — xoá ký tự /
   * vùng chọn — thay vì xoá phần tử người dùng đang gõ dở thuộc tính.
   */
  function onDeleteHotkey() {
    const field = document.activeElement;
    if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type === 'text')) {
      const s = field.selectionStart;
      const e = field.selectionEnd;
      if (s === null) return;
      field.setRangeText('', s, s === e ? Math.min(s + 1, field.value.length) : e, 'end');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (field instanceof HTMLSelectElement) return;
    removeSelected();
  }

  function onRender(msg) {
    message.hidden = true;
    state.rev = msg.rev;
    state.template = msg.template;
    state.actions = msg.actions || [];
    state.elements = new Map((msg.elements || []).map((e) => [e.id, e]));
    state.styleProperties = msg.styleProperties || {};
    state.componentPanels = msg.componentPanels || {};
    state.attributeEnums = msg.attributeEnums || {};
    $('md-preview').value = (msg.preview && msg.preview.mode) || 'label';
    $('md-follow').checked = msg.follow !== false;
    state.fullPreview = msg.fullPreview === true;
    document.body.classList.toggle('md-readonly', state.fullPreview);
    state.issues = msg.issues || [];
    renderIssues();
    state.skeleton = (msg.sample && msg.sample.skeleton) || '{}';
    if (!state.sampleDirty) {
      $('md-sample').value = (msg.sample && msg.sample.text) || '';
      $('md-sample-error').hidden = true;
    }
    const keys = (msg.sample && msg.sample.keys) || {};
    if (document.activeElement !== $('md-sample-stt-rec')) {
      $('md-sample-stt-rec').value = keys.stt_rec || '';
    }
    if (document.activeElement !== $('md-sample-contact-id')) {
      $('md-sample-contact-id').value = keys.contactID || '';
    }
    $('md-file').textContent = msg.file || '';

    const key = `${msg.template.actionId}::${msg.template.body}`;
    const sameTemplate = key === state.templateKey;
    state.templateKey = key;
    const wanted = msg.selectId || (sameTemplate ? state.selectedId : null);
    state.selectedId = wanted && state.elements.has(wanted) ? wanted : null;
    state.hoverId = null;

    renderToolbar();
    // srcdoc mới là tài liệu mới — cuộn về đầu. Giữ chỗ cuộn khi vẫn là cùng mẫu (vừa sửa chữ/style).
    const view = frameWindow();
    pendingScroll = sameTemplate && view ? { x: view.scrollX, y: view.scrollY } : null;
    if (frame.srcdoc === msg.html) afterLoad();
    else frame.srcdoc = msg.html;
    renderProps();
  }

  function showMessage(text, isError) {
    message.textContent = text || '';
    message.classList.toggle('md-error', !!isError);
    message.hidden = false;
    state.elements = new Map();
    state.selectedId = null;
    state.hoverId = null;
    drawBoxes();
    renderProps();
  }

  // ─── Khung mẫu mail ───────────────────────────────────────────────────────────────────────

  function frameDoc() {
    try { return frame.contentDocument; } catch { return null; }
  }
  function frameWindow() {
    try { return frame.contentWindow; } catch { return null; }
  }

  frame.addEventListener('load', afterLoad);

  function afterLoad() {
    const view = frameWindow();
    if (view && pendingScroll) view.scrollTo(pendingScroll.x, pendingScroll.y);
    pendingScroll = null;
    drawBoxes();
  }

  function idOf(node) {
    const el = node && typeof node.closest === 'function' ? node.closest('[data-fbo-el]') : null;
    const id = el ? el.getAttribute('data-fbo-el') : null;
    return id && ID_RE.test(id) && state.elements.has(id) ? id : null;
  }

  function idAt(event) {
    const doc = frameDoc();
    if (!doc) return null;
    const r = hit.getBoundingClientRect();
    return idOf(doc.elementFromPoint(event.clientX - r.left, event.clientY - r.top));
  }

  /**
   * Số thứ tự `{!biến}` dưới con trỏ. Bản vẽ bọc mỗi biến trong `<span data-fbo-tok>` (kể cả khi
   * đã thay bằng nhãn), nên chỗ người dùng nhìn thấy "Số phiếu" vẫn trỏ về `{!h_so_ct}` trong XML.
   *
   * Ô rộng (`width:300px`) chỉ bọc chữ nhãn — bấm padding/vùng trống của `<td>` thì
   * `elementFromPoint` trúng thẻ, không trúng span. Thẻ sở hữu token thì vẫn ưu tiên token:
   * một token → lấy nó; nhiều token trong cùng thẻ → lấy cái gần điểm bấm nhất. Token nằm trong
   * thẻ con `data-fbo-el` khác không tính (bấm `<tr>` không kéo về token của từng `<td>`).
   */
  function tokenAt(event) {
    const doc = frameDoc();
    if (!doc) return null;
    const r = hit.getBoundingClientRect();
    let node = doc.elementFromPoint(event.clientX - r.left, event.clientY - r.top);
    while (node && node.getAttribute) {
      const tok = node.getAttribute('data-fbo-tok');
      if (tok !== null) return Number(tok);
      if (node.getAttribute('data-fbo-el') !== null) break;
      node = node.parentElement;
    }
    const owner = node && typeof node.closest === 'function'
      ? (node.getAttribute('data-fbo-el') !== null ? node : node.closest('[data-fbo-el]'))
      : null;
    if (!owner) return null;

    const owned = [];
    for (const span of owner.querySelectorAll('[data-fbo-tok]')) {
      if (span.closest('[data-fbo-el]') === owner) owned.push(span);
    }
    if (owned.length === 0) return null;
    if (owned.length === 1) return Number(owned[0].getAttribute('data-fbo-tok'));

    // Nhiều token cùng thẻ: khoảng cách tới hộp chữ (tọa độ cửa sổ cha, cùng hệ với clientX/Y).
    const x = event.clientX;
    const y = event.clientY;
    let best = null;
    let bestDist = Infinity;
    for (const span of owned) {
      const b = span.getBoundingClientRect();
      const cx = Math.min(Math.max(x, b.left), b.right);
      const cy = Math.min(Math.max(y, b.top), b.bottom);
      const dist = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = span;
      }
    }
    return best ? Number(best.getAttribute('data-fbo-tok')) : null;
  }

  function nodeOf(id) {
    const doc = frameDoc();
    return id && doc && ID_RE.test(id) ? doc.querySelector(`[data-fbo-el="${id}"]`) : null;
  }

  function place(box, id) {
    const node = nodeOf(id);
    if (!node) { box.hidden = true; return; }
    const r = node.getBoundingClientRect();
    box.hidden = false;
    // Phần tử sát mép trên khung nhìn: nhãn đặt phía trên sẽ bị `overflow:hidden` cắt mất — kéo vào trong.
    box.classList.toggle('md-tag-inside', r.top < 18);
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${Math.max(r.width, 2)}px`;
    box.style.height = `${Math.max(r.height, 2)}px`;
    const el = state.elements.get(id);
    box.querySelector('.md-tag').textContent = el ? `<${el.tag}> ${el.id}` : id;
  }

  function drawBoxes() {
    place(hoverBox, state.hoverId && state.hoverId !== state.selectedId ? state.hoverId : null);
    place(selectedBox, state.selectedId);
  }

  hit.addEventListener('mousemove', (e) => {
    const id = idAt(e);
    if (id !== state.hoverId) { state.hoverId = id; drawBoxes(); }
    const el = id && id === state.selectedId ? state.elements.get(id) : null;
    hit.classList.toggle('md-can-drag', !!el && el.caps.moveElement === true);
  });
  hit.addEventListener('mouseleave', () => { state.hoverId = null; drawBoxes(); });
  hit.addEventListener('click', (e) => {
    // `click` nổ ra sau `mouseup` của một lần KÉO — thao tác vừa rồi không phải bấm chọn.
    if (suppressClick) { suppressClick = false; return; }
    select(idAt(e), { reveal: e.ctrlKey || e.metaKey, tokenIndex: tokenAt(e) });
  });
  hit.addEventListener('dblclick', (e) => { const id = idAt(e); if (id) select(id, { reveal: true, tokenIndex: tokenAt(e) }); });
  // Lớp phủ nuốt bánh xe — cuộn hộ iframe rồi vẽ lại khung chọn cho khớp.
  hit.addEventListener('wheel', (e) => {
    const doc = frameDoc();
    if (!doc) return;
    e.preventDefault();
    (doc.scrollingElement || doc.documentElement).scrollBy(e.deltaX, e.deltaY);
    drawBoxes();
  }, { passive: false });
  window.addEventListener('resize', drawBoxes);

  function select(id, { reveal = false, tokenIndex = null } = {}) {
    state.selectedId = id && state.elements.has(id) ? id : null;
    drawBoxes();
    renderProps();
    if (state.selectedId) {
      post({
        type: 'select', rev: state.rev, elementId: state.selectedId, reveal, tokenIndex,
      });
    }
  }

  // ─── Bảng thuộc tính ──────────────────────────────────────────────────────────────────────

  function styleGroupOf(el) {
    if (el.tag === 'img') return 'image';
    if (el.tag === 'a') return 'button';
    if (['table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'div', 'center'].includes(el.tag)) return 'container';
    return 'text';
  }

  function allStyleProperties() {
    const all = new Set();
    for (const list of Object.values(state.styleProperties)) for (const p of list) all.add(p);
    return all;
  }

  const EMPTY_HINT = $('md-props-empty').innerHTML;

  function renderProps() {
    const el = state.selectedId ? state.elements.get(state.selectedId) : null;
    if (state.fullPreview) $('md-props-empty').textContent = 'Đang xem trước theo dữ liệu mẫu (chỉ đọc) — dòng mẫu nhân theo số dòng của dữ liệu mẫu. Chọn «Biến: nhãn» hoặc «Biến: {!tên}» để sửa.';
    else $('md-props-empty').innerHTML = EMPTY_HINT;
    $('md-props-empty').hidden = !!el;
    $('md-props-body').hidden = !el;
    if (!el) return;

    const crumbs = $('md-crumbs');
    crumbs.textContent = '';
    const chain = [];
    for (let cur = el; cur; cur = cur.parentId ? state.elements.get(cur.parentId) : null) chain.unshift(cur);
    for (const node of chain) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = node.tag;
      b.title = `<${node.tag}> ${node.id}`;
      if (node.id === el.id) b.className = 'md-current';
      b.addEventListener('click', () => select(node.id));
      crumbs.appendChild(b);
    }
    $('md-el-tag').textContent = `<${el.tag}>`;
    const panel = panelOf(el);
    $('md-el-meta').textContent = `${panel ? panel.label : el.kind} · ${ROLE_LABEL[el.role] || el.role} · ${el.part} · ${el.id}`;

    renderAttrFields(el);
    renderStyleFields(el);
  }

  function showReason(node, reason) {
    node.hidden = !reason;
    node.textContent = reason || '';
  }

  function panelOf(el) {
    return state.componentPanels[el.kind] || null;
  }

  /**
   * Một hàng ô nhập — dùng chung cho style và thuộc tính HTML. Chỉ gửi khi giá trị THẬT SỰ đổi
   * (Enter, rời ô, hoặc chọn xong), và không gửi lại cùng một giá trị hai lần: Enter rồi Tab là hai
   * sự kiện cho một ý định. Esc trả lại giá trị cũ. `options` → ô chọn; `color` → kèm ô chọn màu.
   */
  function fieldRow({
    label, value, disabled, title, options, color, onCommit,
  }) {
    const row = document.createElement('div');
    row.className = 'md-style-row';
    const labelNode = document.createElement('label');
    labelNode.textContent = label;
    labelNode.title = label;

    let input;
    if (options) {
      input = document.createElement('select');
      const values = ['', ...options];
      if (value && !options.includes(value)) values.push(value);
      for (const v of values) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v === '' ? '—' : v;
        input.appendChild(opt);
      }
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '—';
    }
    input.value = value;
    input.disabled = !!disabled;
    if (title) input.title = title;

    let sent = value;
    const commit = () => {
      const next = input.value.trim();
      row.classList.remove('md-changed');
      if (next === sent) return;
      sent = next;
      onCommit(next);
    };
    if (!options) {
      input.addEventListener('input', () => row.classList.toggle('md-changed', input.value.trim() !== value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { input.value = value; row.classList.remove('md-changed'); }
      });
    }
    input.addEventListener('change', commit);
    row.append(labelNode, input);

    if (color) {
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.disabled = input.disabled;
      if (/^#[0-9a-f]{6}$/i.test(value)) picker.value = value;
      picker.addEventListener('change', () => { input.value = picker.value; commit(); });
      row.appendChild(picker);
    } else {
      row.appendChild(document.createElement('span'));
    }
    return row;
  }

  function renderStyleFields(el) {
    const box = $('md-style-fields');
    box.textContent = '';
    const styleOk = el.caps.setStyle === true;
    showReason($('md-style-reason'), styleOk ? null : el.caps.setStyle);

    const current = new Map();
    for (const [prop, value] of el.style) current.set(prop, value); // khai báo sau đè khai báo trước
    const allowed = allStyleProperties();
    const panel = panelOf(el);
    const props = [...(panel ? panel.styles : (state.styleProperties[styleGroupOf(el)] || []))];
    for (const prop of current.keys()) if (allowed.has(prop) && !props.includes(prop)) props.push(prop);

    for (const prop of props) {
      const value = current.get(prop) ?? '';
      const hasToken = value.includes('{!');
      box.appendChild(fieldRow({
        label: prop,
        value,
        disabled: !styleOk || hasToken,
        title: hasToken ? 'Giá trị mang {!token} (logic runtime của mẫu) — sửa trong XML' : '',
        color: COLOR_PROPS.has(prop),
        onCommit: (next) => post({
          type: 'edit', op: 'setStyle', rev: state.rev, elementId: el.id, property: prop, value: next,
        }),
      }));
    }
    $('md-style-caption').hidden = props.length === 0;
  }

  /**
   * Thuộc tính HTML theo loại component. Hai ô mượn THẺ CHA, vì trong mail thật chỗ khai nằm ở đó:
   * link của ảnh là `href` của `<a>` bao ngoài; căn lề của nút là `align` của khối chứa nó.
   */
  function renderAttrFields(el) {
    const box = $('md-attr-fields');
    box.textContent = '';
    const panel = panelOf(el) || { attrs: el.attrNames };
    const parent = el.parentId ? state.elements.get(el.parentId) : null;

    const rows = [];
    if (el.caps.setAttr === true) {
      for (const name of panel.attrs) if (el.attrNames.includes(name)) rows.push({ target: el, name, label: name });
    }
    let note = el.caps.setAttr === true || el.attrNames.length === 0 ? null : el.caps.setAttr;
    if (panel.parentLink) {
      if (parent && parent.tag === 'a') rows.push({ target: parent, name: 'href', label: 'liên kết (<a> bao ngoài)' });
      else note = note || 'Ảnh chưa bọc liên kết — thêm liên kết cần chèn phần tử, chưa hỗ trợ ở bản này.';
    }
    if (panel.parentAlign && parent && parent.attrNames.includes('align')) {
      rows.push({ target: parent, name: 'align', label: `căn lề (<${parent.tag}> chứa)` });
    }

    showReason($('md-attr-reason'), note);
    $('md-attr-caption').hidden = rows.length === 0;
    for (const { target, name, label } of rows) {
      const lock = target.caps.setAttr !== true ? target.caps.setAttr : (target.attrLocks[name] || null);
      box.appendChild(fieldRow({
        label,
        value: target.attrs[name] ?? '',
        disabled: !!lock,
        title: lock || '',
        options: state.attributeEnums[name],
        color: name === 'bgcolor' || name === 'color',
        // Chỉ thuộc tính mà bộ kiểm nhận `{!tên}` — width/height kiểm theo số, chèn token vào đó là bị chặn.
        onCommit: (next) => post({
          type: 'edit', op: 'setAttr', rev: state.rev, elementId: target.id, name, value: next,
        }),
      }));
    }
  }

  // ─── Di chuyển phần tử bằng kéo thả (Phase 5) ───────────────────────────────────────────────
  //
  // Webview không tự quyết chỗ nào hợp lệ: vạch thả đọc `caps`, `moveTargets`, `insertPositions` do
  // core tính. Host kiểm lại lần nữa trên văn bản hiện tại trước khi ghi.

  const POSITION_LABEL = { before: 'trước', after: 'sau', append: 'vào cuối' };
  const GROUP_LABEL = { content: 'Nội dung', layout: 'Bố cục', dynamic: 'Động' };
  let press = null;         // nhấn giữ trên phần tử đang chọn: { id, x, y, dragging, drop }
  let suppressClick = false;

  const selected = () => (state.selectedId ? state.elements.get(state.selectedId) : null);

  function editSelected(fields) {
    const el = selected();
    if (el) post({ type: 'edit', rev: state.rev, elementId: el.id, ...fields });
  }

  function removeSelected() {
    const el = selected();
    if (el && el.caps.removeElement === true) editSelected({ op: 'removeElement' });
  }

  function isInside(el, ancestor) {
    for (let cur = el; cur; cur = cur.parentId ? state.elements.get(cur.parentId) : null) if (cur.id === ancestor.id) return true;
    return false;
  }

  /**
   * Chỗ thả dưới con trỏ. Từ phần tử dưới chuột đi NGƯỢC lên cha cho tới khi gặp một vị trí core
   * cho phép: nửa trên → trước, nửa dưới → sau, dải giữa của khung chứa → vào cuối. Kéo một phần tử
   * thì bỏ qua chính nó và con của nó, và không nhận đích ở part khác.
   */
  function dropAt(event, movingId) {
    const doc = frameDoc();
    if (!doc) return null;
    const hr = hit.getBoundingClientRect();
    const y = event.clientY - hr.top;
    const moving = movingId ? state.elements.get(movingId) : null;
    let id = idOf(doc.elementFromPoint(event.clientX - hr.left, y));
    while (id) {
      const el = state.elements.get(id);
      const node = nodeOf(id);
      if (!el || !node) return null;
      if (moving && isInside(el, moving)) return null;
      const rect = node.getBoundingClientRect();
      const rel = (y - rect.top) / Math.max(rect.height, 1);
      const order = [];
      if (rel > 0.25 && rel < 0.75) order.push('append');
      order.push(rel < 0.5 ? 'before' : 'after', rel < 0.5 ? 'after' : 'before', 'append');
      if (!moving || el.part === moving.part) {
        const position = order.find((p) => el.insertPositions[p] === true);
        if (position) return { targetId: el.id, position, rect };
      }
      id = el.parentId;
    }
    return null;
  }

  function showDrop(drop) {
    const box = $('md-drop');
    if (!drop) { box.hidden = true; return; }
    const r = drop.rect;
    const el = state.elements.get(drop.targetId);
    box.hidden = false;
    box.className = `md-drop ${drop.position === 'append' ? 'md-inside' : 'md-line'}`;
    box.style.left = `${r.left}px`;
    box.style.width = `${Math.max(r.width, 20)}px`;
    box.style.top = `${drop.position === 'after' ? r.bottom : r.top}px`;
    box.style.height = drop.position === 'append' ? `${Math.max(r.height, 4)}px` : '0px';
    box.querySelector('.md-tag').textContent = `${POSITION_LABEL[drop.position]} <${el.tag}> ${el.id}`;
  }

  // Kéo phần tử ĐANG CHỌN để di chuyển — nhấn giữ trên nó rồi rê quá 5px.
  hit.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const id = idAt(e);
    const el = id && id === state.selectedId ? state.elements.get(id) : null;
    if (el && el.caps.moveElement === true) {
      press = {
        id, x: e.clientX, y: e.clientY, dragging: false, drop: null,
      };
    }
  });
  window.addEventListener('mousemove', (e) => {
    if (!press) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    press.dragging = true;
    document.body.classList.add('md-dragging');
    press.drop = dropAt(e, press.id);
    showDrop(press.drop);
  });
  window.addEventListener('mouseup', () => {
    if (!press) return;
    const p = press;
    press = null;
    document.body.classList.remove('md-dragging');
    showDrop(null);
    if (!p.dragging) return;
    suppressClick = true;
    if (p.drop) {
      post({
        type: 'edit', op: 'moveElement', rev: state.rev, elementId: p.id, targetId: p.drop.targetId, position: p.drop.position,
      });
    }
  });

  // ─── Biến và dữ liệu mẫu (Phase 6) ──────────────────────────────────────────────────────────
  //
  // Chế độ hiện biến và dữ liệu mẫu chỉ đổi BẢN VẼ — host vẽ lại, không có phép sửa nào đi ra.

  $('md-preview').addEventListener('change', (e) => post({ type: 'setPreview', mode: e.target.value }));

  const sampleArea = $('md-sample');
  sampleArea.addEventListener('input', () => { state.sampleDirty = true; });
  $('md-sample-apply').addEventListener('click', () => {
    state.sampleDirty = false;
    post({ type: 'setSampleData', text: sampleArea.value });
  });
  $('md-sample-load').addEventListener('click', () => {
    const stt_rec = $('md-sample-stt-rec').value.trim();
    const contactID = $('md-sample-contact-id').value.trim();
    if (!stt_rec) {
      showSampleError('Nhập stt_rec của chứng từ cần xem trước khi lấy dữ liệu.');
      return;
    }
    post({ type: 'loadMailSample', stt_rec, contactID });
  });
  $('md-sample-skeleton').addEventListener('click', () => {
    let current = {};
    try {
      current = sampleArea.value.trim() ? JSON.parse(sampleArea.value) : {};
    } catch {
      showSampleError('JSON đang gõ không hợp lệ — sửa trước rồi mới ghép khung được.');
      return;
    }
    const skeleton = JSON.parse(state.skeleton || '{}');
    const merged = { ...skeleton, ...current };
    if (Array.isArray(skeleton.detail)) {
      const rows = Array.isArray(current.detail) && current.detail.length ? current.detail : skeleton.detail;
      merged.detail = rows.map((row) => ({ ...skeleton.detail[0], ...row }));
    }
    sampleArea.value = JSON.stringify(merged, null, 2);
    state.sampleDirty = true;
  });

  function showSampleError(reason) {
    const node = $('md-sample-error');
    node.hidden = false;
    node.textContent = reason;
    $('md-sample-group').open = true;
    state.sampleDirty = true;
  }

  // ─── Code ↔ Designer (Phase 7) ──────────────────────────────────────────────────────────────

  /**
   * Con trỏ XML vừa vào phần tử này (host gửi khi «Bám XML» bật). Chọn nó và cuộn tới — nhưng KHÔNG gửi
   * `select` ngược lại: host đã biết, và gửi lại là kéo con trỏ XML đi theo chính nó, mở màn một vòng lặp.
   */
  function onReveal(msg) {
    if (msg.rev !== state.rev || !state.elements.has(msg.elementId)) return;
    state.selectedId = msg.elementId;
    const node = nodeOf(msg.elementId);
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    drawBoxes();
    renderProps();
  }

  $('md-follow').addEventListener('change', (e) => post({ type: 'setFollow', on: e.target.checked }));

  // ─── Hoàn thiện (Phase 8) ───────────────────────────────────────────────────────────────────

  // Lỗi JS của webview không hiện ở đâu cả nếu không gửi về — ghi vào Output «FBO Designer».
  window.addEventListener('error', (e) => post({ type: 'log', text: `webview lỗi: ${e.message} (${e.filename || ''}:${e.lineno || ''})` }));
  window.addEventListener('unhandledrejection', (e) => post({ type: 'log', text: `webview lỗi promise: ${e.reason && e.reason.message ? e.reason.message : e.reason}` }));

  /** Bề rộng khung xem — mail máy tính (600px), điện thoại (375px). Nhớ theo webview, không qua host. */
  function applyWidth(value) {
    const wrap = $('md-frame-wrap');
    wrap.classList.toggle('md-fixed', Boolean(value));
    wrap.style.setProperty('--md-w', value ? `${value}px` : '');
    $('md-width').value = value || '';
    requestAnimationFrame(drawBoxes);
  }
  applyWidth((vscode.getState() || {}).width || '');
  $('md-width').addEventListener('change', (e) => {
    vscode.setState({ ...(vscode.getState() || {}), width: e.target.value });
    applyWidth(e.target.value);
  });

  const SEVERITY_LABEL = { error: 'Lỗi', warning: 'Cảnh báo', info: 'Gợi ý' };

  /** Bảng «Kiểm tra mẫu» — bấm một vấn đề là chọn phần tử nó trỏ tới và cuộn tới đó. */
  function renderIssues() {
    const box = $('md-issues');
    box.textContent = '';
    const errors = state.issues.filter((i) => i.severity === 'error').length;
    const badge = $('md-issues-badge');
    badge.textContent = state.issues.length ? `⚠ ${state.issues.length}` : '✓ 0';
    badge.classList.toggle('md-has-error', errors > 0);
    $('md-issues-count').textContent = state.issues.length ? `(${state.issues.length})` : '';
    if (state.issues.length === 0) {
      const none = document.createElement('p');
      none.className = 'md-hint';
      none.textContent = 'Không thấy vấn đề nào theo luật mail client.';
      box.appendChild(none);
      return;
    }
    for (const issue of state.issues) {
      const el = issue.elementId ? state.elements.get(issue.elementId) : null;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `md-issue md-issue-${issue.severity}`;
      const level = document.createElement('b');
      level.textContent = SEVERITY_LABEL[issue.severity] || issue.severity;
      const text = document.createElement('span');
      text.textContent = el ? `<${el.tag}> ${issue.message}` : issue.message;
      item.append(level, text);
      item.disabled = !el;
      item.title = el ? 'Bấm để chọn phần tử' : issue.code;
      item.addEventListener('click', () => {
        if (!el) return;
        select(el.id);
        const node = nodeOf(el.id);
        if (node) node.scrollIntoView({ block: 'nearest' });
        drawBoxes();
      });
      box.appendChild(item);
    }
  }
  $('md-issues-badge').addEventListener('click', () => $('md-issues-group').scrollIntoView({ block: 'nearest' }));

  // ─── Thanh công cụ ────────────────────────────────────────────────────────────────────────

  let visible = [];
  let activeIndex = -1;

  function currentAction() {
    return state.actions.find((a) => state.template && a.id === state.template.actionId) || null;
  }

  function renderToolbar() {
    const action = currentAction();
    if (action && document.activeElement !== actionInput) actionInput.value = action.label;
    bodySelect.textContent = '';
    for (const b of action ? action.bodies : []) {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = `<${b}>`;
      bodySelect.appendChild(opt);
    }
    bodySelect.value = state.template ? state.template.body : '';
    bodySelect.disabled = !action || action.bodies.length <= 1;
    langButton.textContent = state.template && state.template.lang === 'en' ? 'Nhãn: EN' : 'Nhãn: VI';
  }

  function choose(actionId, body, lang) {
    if (!state.template) return;
    post({
      type: 'selection', actionId, body, lang: lang || state.template.lang,
    });
  }

  function openList(all = false) {
    const q = all ? '' : actionInput.value.trim().toLowerCase();
    visible = state.actions.filter((a) => !q || a.label.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
    actionList.textContent = '';
    for (const a of visible.slice(0, 300)) {
      const item = document.createElement('div');
      item.className = 'md-combo-item';
      item.textContent = a.label;
      const small = document.createElement('small');
      small.textContent = `${a.id} · ${a.bodies.length} biến thể`;
      item.appendChild(small);
      // mousedown: nổ ra TRƯỚC blur của ô nhập, danh sách chưa kịp đóng.
      item.addEventListener('mousedown', (e) => { e.preventDefault(); pick(a); });
      actionList.appendChild(item);
    }
    actionList.hidden = visible.length === 0;
    activeIndex = -1;
  }
  function closeList() { actionList.hidden = true; activeIndex = -1; }
  function pick(a) {
    closeList();
    actionInput.blur();
    choose(a.id, a.bodies[0]);
  }
  function highlight(i) {
    const items = actionList.querySelectorAll('.md-combo-item');
    items.forEach((node, k) => node.classList.toggle('md-active', k === i));
    if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
    activeIndex = i;
  }

  actionInput.addEventListener('focus', () => { actionInput.select(); openList(); });
  // mousedown: giữ focus ở ô nhập, nếu không blur đóng danh sách ngay trước khi click kịp mở.
  dropButton.addEventListener('mousedown', (e) => e.preventDefault());
  dropButton.addEventListener('click', () => {
    if (!actionList.hidden) { closeList(); return; }
    actionInput.focus();
    actionInput.select();
    openList(true);
  });
  actionInput.addEventListener('input', () => openList());
  actionInput.addEventListener('blur', () => { closeList(); renderToolbar(); });
  actionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeList(); actionInput.blur(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(activeIndex + 1, visible.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(activeIndex - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const a = visible[activeIndex] || visible[0];
      if (a) pick(a);
    }
  });

  bodySelect.addEventListener('change', () => { if (state.template) choose(state.template.actionId, bodySelect.value); });
  langButton.addEventListener('click', () => {
    if (!state.template) return;
    choose(state.template.actionId, state.template.body, state.template.lang === 'en' ? 'vi' : 'en');
  });
  // ─── Phím tắt ─────────────────────────────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (e.key === 'Escape' && !typing) { select(null); return; }
    if (e.key === 'Delete' && !typing) { e.preventDefault(); removeSelected(); return; }
    if (!typing && e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const el = selected();
      const direction = e.key === 'ArrowUp' ? 'up' : 'down';
      if (el && el.moveTargets[direction]) editSelected({ op: 'moveElement', direction });
      return;
    }
    if (!typing && (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const el = selected();
      if (!el) return;
      const next = e.key === 'ArrowUp' ? el.parentId : ([...state.elements.values()].find((x) => x.parentId === el.id) || {}).id;
      if (next) select(next);
      return;
    }
    if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); post({ type: 'undo' }); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); post({ type: 'redo' }); }
  });

  post({ type: 'ready' });
}());

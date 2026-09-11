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
  const bodySelect = $('md-body');
  const langButton = $('md-lang');
  const textArea = $('md-text');
  const textApply = $('md-text-apply');

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
    components: [],
    variables: [],
    skeleton: '{}',
    lastField: null,      // ô chữ/thuộc tính nhận `{!tên}` được focus gần nhất
    sampleDirty: false,   // ô dữ liệu mẫu đang gõ dở — bản vẽ mới không được đè lên
    selectedId: null,
    hoverId: null,
    templateKey: '',
  };
  let pendingScroll = null;

  const post = (msg) => vscode.postMessage(msg);

  // ─── Thông điệp từ host ───────────────────────────────────────────────────────────────────

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'render') onRender(msg);
    else if (msg.type === 'idle' || msg.type === 'error') showMessage(msg.message, msg.type === 'error');
    // Delete do host bắt (VS Code nuốt phím trước webview) — xem `designer-webview.js`.
    else if (msg.type === 'hotkey' && (msg.key === 'Delete' || msg.key === 'Del')) onDeleteHotkey();
    else if (msg.type === 'sampleError') showSampleError(msg.reason);
    else if (msg.type === 'reveal') onReveal(msg);
  });

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
    state.components = msg.components || [];
    renderPalette();
    state.variables = msg.variables || [];
    renderVariables();
    $('md-preview').value = (msg.preview && msg.preview.mode) || 'label';
    $('md-follow').checked = msg.follow !== false;
    state.skeleton = (msg.sample && msg.sample.skeleton) || '{}';
    if (!state.sampleDirty) {
      $('md-sample').value = (msg.sample && msg.sample.text) || '';
      $('md-sample-error').hidden = true;
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
    select(idAt(e), { reveal: e.ctrlKey || e.metaKey });
  });
  hit.addEventListener('dblclick', (e) => { const id = idAt(e); if (id) select(id, { reveal: true }); });
  // Lớp phủ nuốt bánh xe — cuộn hộ iframe rồi vẽ lại khung chọn cho khớp.
  hit.addEventListener('wheel', (e) => {
    const doc = frameDoc();
    if (!doc) return;
    e.preventDefault();
    (doc.scrollingElement || doc.documentElement).scrollBy(e.deltaX, e.deltaY);
    drawBoxes();
  }, { passive: false });
  window.addEventListener('resize', drawBoxes);

  function select(id, { reveal = false } = {}) {
    state.selectedId = id && state.elements.has(id) ? id : null;
    drawBoxes();
    renderProps();
    if (state.selectedId) post({ type: 'select', rev: state.rev, elementId: state.selectedId, reveal });
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

  function renderProps() {
    const el = state.selectedId ? state.elements.get(state.selectedId) : null;
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

    const textOk = el.caps.setText === true;
    textArea.value = textOk ? el.text : '';
    textArea.disabled = !textOk;
    textApply.disabled = !textOk;
    showReason($('md-text-reason'), textOk ? null : el.caps.setText);

    renderStructure(el);
    renderTable(el);
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
    label, value, disabled, title, options, color, onCommit, acceptsToken = false,
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
    if (acceptsToken && !options) input.dataset.acceptsToken = '1';

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
  }

  /**
   * Thuộc tính HTML theo loại component. Hai ô mượn THẺ CHA, vì trong mail thật chỗ khai nằm ở đó:
   * link của ảnh là `href` của `<a>` bao ngoài; căn lề của nút là `align` của khối chứa nó.
   */
  function renderAttrFields(el) {
    const group = $('md-attr-group');
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

    group.hidden = rows.length === 0 && !note;
    showReason($('md-attr-reason'), note);
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
        acceptsToken: ['href', 'src', 'alt', 'title'].includes(name),
        onCommit: (next) => post({
          type: 'edit', op: 'setAttr', rev: state.rev, elementId: target.id, name, value: next,
        }),
      }));
    }
  }

  // ─── Cấu trúc: xoá / di chuyển / chèn / bọc liên kết (Phase 5) ──────────────────────────────
  //
  // Webview không tự quyết chỗ nào hợp lệ: mọi nút/ô chọn/vạch thả đọc `caps`, `moveTargets`,
  // `insertPositions` do core tính. Host kiểm lại lần nữa trên văn bản hiện tại trước khi ghi.

  const POSITION_LABEL = { before: 'trước', after: 'sau', append: 'vào cuối' };
  const GROUP_LABEL = { content: 'Nội dung', layout: 'Bố cục', dynamic: 'Động' };
  let drag = null;          // kéo từ palette: { component }
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

  function renderStructure(el) {
    const up = $('md-move-up');
    const down = $('md-move-down');
    up.disabled = !el.moveTargets.up;
    down.disabled = !el.moveTargets.down;
    up.title = el.moveTargets.up ? 'Đổi chỗ với phần tử liền trên' : 'Không có phần tử anh em phía trên đổi chỗ được';
    down.title = el.moveTargets.down ? 'Đổi chỗ với phần tử liền dưới' : 'Không có phần tử anh em phía dưới đổi chỗ được';
    $('md-remove').disabled = el.caps.removeElement !== true;
    $('md-wrap-row').hidden = el.caps.wrapLink !== true;

    const pos = $('md-insert-pos');
    for (const opt of pos.options) {
      const cap = el.insertPositions[opt.value];
      opt.disabled = cap !== true;
      opt.title = cap === true ? '' : cap;
    }
    if (pos.selectedOptions[0] && pos.selectedOptions[0].disabled) {
      const firstOk = [...pos.options].find((o) => !o.disabled);
      if (firstOk) pos.value = firstOk.value;
    }
    const canInsert = el.caps.insertComponent === true;
    $('md-insert-kind').disabled = !canInsert;
    pos.disabled = !canInsert;
    $('md-insert-apply').disabled = !canInsert;

    const reasons = [el.caps.removeElement, canInsert ? true : el.caps.insertComponent].filter((r) => r !== true);
    showReason($('md-struct-reason'), reasons.length ? reasons.join(' · ') : null);
  }

  $('md-move-up').addEventListener('click', () => editSelected({ op: 'moveElement', direction: 'up' }));
  $('md-move-down').addEventListener('click', () => editSelected({ op: 'moveElement', direction: 'down' }));
  $('md-remove').addEventListener('click', removeSelected);
  $('md-wrap-apply').addEventListener('click', () => {
    const href = $('md-wrap-href').value.trim();
    if (href) editSelected({ op: 'wrapLink', href });
  });
  $('md-insert-apply').addEventListener('click', () => editSelected({
    op: 'insertComponent', position: $('md-insert-pos').value, component: $('md-insert-kind').value,
  }));

  /** Palette + ô chọn component — dựng MỘT lần từ danh sách host gửi (core quyết loại nào có bộ sinh). */
  function renderPalette() {
    const box = $('md-palette-items');
    if (box.childElementCount > 0 || state.components.length === 0) return;
    const kindSelect = $('md-insert-kind');
    let group = null;
    for (const c of state.components) {
      if (c.group !== group) {
        group = c.group;
        const head = document.createElement('div');
        head.className = 'md-palette-group';
        head.textContent = GROUP_LABEL[group] || group;
        box.appendChild(head);
      }
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'md-palette-item';
      item.textContent = c.label;
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        drag = { component: c.kind };
        e.dataTransfer.setData('text/plain', c.kind);
        e.dataTransfer.effectAllowed = 'copy';
      });
      item.addEventListener('dragend', () => { drag = null; showDrop(null); });
      item.addEventListener('click', () => insertNearSelection(c.kind));
      box.appendChild(item);

      const opt = document.createElement('option');
      opt.value = c.kind;
      opt.textContent = c.label;
      kindSelect.appendChild(opt);
    }
  }

  /** Bấm palette: chèn sau phần tử đang chọn; ô chứa thì chèn vào cuối; không thì trước. */
  function insertNearSelection(component) {
    const el = selected();
    if (!el) { showMessageBriefly('Chọn một phần tử trên mẫu trước, rồi bấm component để chèn cạnh nó — hoặc kéo component thả vào mẫu.'); return; }
    const position = ['after', 'append', 'before'].find((p) => el.insertPositions[p] === true);
    if (!position) { showMessageBriefly(`<${el.tag}>: ${el.caps.insertComponent}`); return; }
    editSelected({ op: 'insertComponent', position, component });
  }

  function showMessageBriefly(text) {
    const status = $('md-status');
    const original = status.dataset.original || status.innerHTML;
    status.dataset.original = original;
    status.textContent = text;
    clearTimeout(showMessageBriefly.timer);
    showMessageBriefly.timer = setTimeout(() => { status.innerHTML = original; }, 4000);
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

  // Kéo từ palette (HTML5 drag & drop — palette và lớp phủ cùng một trang).
  hit.addEventListener('dragover', (e) => {
    if (!drag) return;
    const d = dropAt(e, null);
    showDrop(d);
    if (d) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  hit.addEventListener('dragleave', () => showDrop(null));
  hit.addEventListener('drop', (e) => {
    if (!drag) return;
    e.preventDefault();
    const d = dropAt(e, null);
    const { component } = drag;
    drag = null;
    showDrop(null);
    if (d) {
      post({
        type: 'edit', op: 'insertComponent', rev: state.rev, elementId: d.targetId, position: d.position, component,
      });
    }
  });

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
  // Chèn biến là việc của ô đang soạn: nó chỉ gõ `{!tên}` vào ô, ghi vẫn đi qua «Ghi chữ»/setAttr.

  function renderVariables() {
    const box = $('md-vars');
    box.textContent = '';
    $('md-vars-count').textContent = state.variables.length ? `(${state.variables.length})` : '';
    if (state.variables.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'md-hint';
      empty.textContent = 'Mẫu này chưa có biến {!tên} nào.';
      box.appendChild(empty);
      return;
    }
    for (const v of state.variables) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `md-var md-var-${v.kind}`;
      const code = document.createElement('code');
      code.textContent = `{!${v.name}}`;
      const info = document.createElement('span');
      info.textContent = v.label ? (v.label.v || v.label.e) : `dữ liệu · ${v.parts.join('/')}`;
      item.append(code, info);
      item.title = `${v.kind === 'label' ? 'Nhãn khai trong <fields>' : 'Dữ liệu lúc gửi (cột của câu query)'} · ${v.count} lần · ${v.contexts.join(', ')}`;
      // mousedown không lấy focus → ô đang soạn giữ nguyên con trỏ và vùng chọn.
      item.addEventListener('mousedown', (e) => e.preventDefault());
      item.addEventListener('click', () => insertToken(v.name));
      box.appendChild(item);
    }
  }

  const acceptsToken = (node) => (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) && node.dataset.acceptsToken === '1';

  document.addEventListener('focusin', (e) => {
    if (acceptsToken(e.target)) state.lastField = e.target;
  });

  /**
   * Ô nhận `{!tên}`: ô ĐANG focus trước (nút biến chặn mousedown nên focus không rời ô), rồi mới tới ô
   * focus gần nhất (người dùng Tab sang nút biến). Không dựa riêng vào `focusin`: khi khung webview
   * chưa có focus hệ thống, trình duyệt không bắn sự kiện focus dù `activeElement` đã đổi.
   */
  function insertToken(name) {
    const field = acceptsToken(document.activeElement) ? document.activeElement : state.lastField;
    if (!field || !field.isConnected || field.disabled) {
      showMessageBriefly('Đặt con trỏ vào ô Chữ (hoặc href/src/alt/title) của phần tử đang chọn, rồi bấm biến để chèn.');
      return;
    }
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(`{!${name}}`, start, end, 'end');
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  $('md-preview').addEventListener('change', (e) => post({ type: 'setPreview', mode: e.target.value }));

  const sampleArea = $('md-sample');
  sampleArea.addEventListener('input', () => { state.sampleDirty = true; });
  $('md-sample-apply').addEventListener('click', () => {
    state.sampleDirty = false;
    post({ type: 'setSampleData', text: sampleArea.value });
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

  /**
   * Mục «Bảng»: phép cột/dòng có sẵn của «Xem mail», nối qua `table` host tính (`mailTableContext`).
   * Ô chọn trong hàng nhân bản được thì dùng vai trò dòng của thẻ `<tr>` cha.
   */
  function renderTable(el) {
    const parent = el.parentId ? state.elements.get(el.parentId) : null;
    const column = el.table && el.table.column;
    const row = (el.table && el.table.row) || (parent && parent.table && parent.table.row) || null;
    $('md-table-group').hidden = !column && !row;

    $('md-col-row').hidden = !column;
    if (column) {
      const input = $('md-col-width');
      $('md-col-label').textContent = `Cột ${column.index + 1}${column.header ? '' : ' (dòng mẫu)'}`;
      input.value = column.width === null ? '' : String(column.width);
      input.disabled = column.width === null;
      input.title = column.width === null
        ? 'Cột không khai width:Npx ngay trên ô tiêu đề (dùng class chung) — đổi an toàn không được, sửa trong XML'
        : 'Bề rộng cột (px) — ghi vào width:Npx của ô tiêu đề';
      input.dataset.columnIndex = String(column.index);
      input.dataset.original = input.value;
      $('md-col-add').dataset.columnIndex = String(column.index);
    }

    $('md-row-row').hidden = !row;
    if (row) {
      $('md-row-label').textContent = `Dòng ${row.rowIndex + 1} (${row.part})`;
      $('md-row-add').dataset.part = row.part;
      $('md-row-add').dataset.rowIndex = String(row.rowIndex);
    }
  }

  const columnWidth = $('md-col-width');
  function commitColumnWidth() {
    if (columnWidth.disabled || columnWidth.value === columnWidth.dataset.original) return;
    const width = Number(columnWidth.value);
    if (!Number.isInteger(width) || width < 10 || width > 2000) {
      showMessageBriefly('Bề rộng cột phải là số nguyên trong khoảng 10–2000px.');
      columnWidth.value = columnWidth.dataset.original;
      return;
    }
    columnWidth.dataset.original = columnWidth.value; // Enter rồi rời ô là hai sự kiện cho một ý định
    post({
      type: 'edit', op: 'resizeColumn', rev: state.rev, columnIndex: Number(columnWidth.dataset.columnIndex), width,
    });
  }
  columnWidth.addEventListener('change', commitColumnWidth);
  columnWidth.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitColumnWidth(); } });
  $('md-col-add').addEventListener('click', (e) => post({
    type: 'edit', op: 'addColumn', rev: state.rev, columnIndex: Number(e.currentTarget.dataset.columnIndex),
  }));
  $('md-row-add').addEventListener('click', (e) => post({
    type: 'edit', op: 'addRow', rev: state.rev, part: e.currentTarget.dataset.part, rowIndex: Number(e.currentTarget.dataset.rowIndex),
  }));

  function applyText() {
    const el = state.selectedId ? state.elements.get(state.selectedId) : null;
    if (!el || el.caps.setText !== true || textArea.value === el.text) return;
    post({
      type: 'edit', op: 'setText', rev: state.rev, elementId: el.id, value: textArea.value,
    });
  }
  textApply.addEventListener('click', applyText);
  textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); applyText(); }
  });

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

  function openList() {
    const q = actionInput.value.trim().toLowerCase();
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
  actionInput.addEventListener('input', openList);
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
  $('md-undo').addEventListener('click', () => post({ type: 'undo' }));
  $('md-redo').addEventListener('click', () => post({ type: 'redo' }));
  $('md-goto').addEventListener('change', (e) => {
    const section = e.target.value;
    e.target.value = '';
    if (section) post({ type: 'gotoSource', section });
  });

  // ─── Phím tắt ─────────────────────────────────────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
    if (e.key === 'Escape' && !typing) { select(null); return; }
    if (e.key === 'Delete' && !typing) { e.preventDefault(); removeSelected(); return; }
    if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); post({ type: 'undo' }); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); post({ type: 'redo' }); }
  });

  post({ type: 'ready' });
}());

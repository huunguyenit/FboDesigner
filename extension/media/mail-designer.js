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
    // `hotkey` (Delete) có nghĩa khi có phép xoá — Phase 5.
  });

  function onRender(msg) {
    message.hidden = true;
    state.rev = msg.rev;
    state.template = msg.template;
    state.actions = msg.actions || [];
    state.elements = new Map((msg.elements || []).map((e) => [e.id, e]));
    state.styleProperties = msg.styleProperties || {};
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
  });
  hit.addEventListener('mouseleave', () => { state.hoverId = null; drawBoxes(); });
  hit.addEventListener('click', (e) => select(idAt(e), { reveal: e.ctrlKey || e.metaKey }));
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
    $('md-el-meta').textContent = `${ROLE_LABEL[el.role] || el.role} · ${el.part} · ${el.id}`;

    const textOk = el.caps.setText === true;
    textArea.value = textOk ? el.text : '';
    textArea.disabled = !textOk;
    textApply.disabled = !textOk;
    showReason($('md-text-reason'), textOk ? null : el.caps.setText);

    renderStyleFields(el);
  }

  function showReason(node, reason) {
    node.hidden = !reason;
    node.textContent = reason || '';
  }

  function renderStyleFields(el) {
    const box = $('md-style-fields');
    box.textContent = '';
    const styleOk = el.caps.setStyle === true;
    showReason($('md-style-reason'), styleOk ? null : el.caps.setStyle);

    const current = new Map();
    for (const [prop, value] of el.style) current.set(prop, value); // khai báo sau đè khai báo trước
    const allowed = allStyleProperties();
    const props = [...(state.styleProperties[styleGroupOf(el)] || [])];
    for (const prop of current.keys()) if (allowed.has(prop) && !props.includes(prop)) props.push(prop);

    for (const prop of props) {
      const value = current.get(prop) ?? '';
      const row = document.createElement('div');
      row.className = 'md-style-row';
      const label = document.createElement('label');
      label.textContent = prop;
      label.title = prop;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.placeholder = '—';
      const hasToken = value.includes('{!');
      input.disabled = !styleOk || hasToken;
      if (hasToken) input.title = 'Giá trị mang {!token} (logic runtime của mẫu) — sửa trong XML';
      const commit = () => {
        const next = input.value.trim();
        if (next === value) { row.classList.remove('md-changed'); return; }
        post({
          type: 'edit', op: 'setStyle', rev: state.rev, elementId: el.id, property: prop, value: next,
        });
      };
      input.addEventListener('input', () => row.classList.toggle('md-changed', input.value.trim() !== value));
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { input.value = value; row.classList.remove('md-changed'); }
      });
      row.append(label, input);

      if (COLOR_PROPS.has(prop)) {
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.disabled = input.disabled;
        if (/^#[0-9a-f]{6}$/i.test(value)) picker.value = value;
        picker.addEventListener('change', () => { input.value = picker.value; commit(); });
        row.appendChild(picker);
      } else {
        row.appendChild(document.createElement('span'));
      }
      box.appendChild(row);
    }
  }

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
    if (typing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); post({ type: 'undo' }); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); post({ type: 'redo' }); }
  });

  post({ type: 'ready' });
}());

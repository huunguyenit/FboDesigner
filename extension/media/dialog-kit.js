// dialog-kit.js — dựng hộp thoại overlay dùng chung giữa media/designer.js và media/mail-designer.js.
//
// Webview nạp qua <script nonce> thuần (không type=module), nên export qua namespace toàn cục
// `window.FboDialogKit` thay vì import/export ESM. `createDialogKit(opts)` là factory — mỗi
// webview tự gọi một lần và giữ `dialogOpen` RIÊNG cho mình (hai webview không chia sẻ state,
// dù cùng nạp file này), qua các hook tuỳ chọn nới hành vi mà không đụng vào phần dùng chung:
//   - post(msg)            gửi kết quả hộp thoại về host (mặc định no-op)
//   - extraBlock(item)     thêm loại khối thân hộp thoại ngoài 'text'/'highlight'
//   - canConfirm(root)     chặn nút confirm khi thiếu ô bắt buộc (mặc định luôn cho qua)
//   - readValues(root)     gom giá trị các ô nhập trước khi đóng (mặc định null)
//   - onModeToggle(root,m) áp `mode-toggle` — chỉ designer.js dùng
//   - extraHotkeys(event,open) thêm phím tắt ngoài Escape (Enter/Tab-trap của designer.js);
//     trả `true` nếu đã xử lý (bỏ qua `stopPropagation` cuối, giống Escape/Enter/Tab gốc)

(function () {
  const DIALOG_GLYPH = { info: 'i', success: '✓', warning: '!', error: '×' };

  function dialogEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }

  /** Khối thân hộp thoại dùng chung: 'text' và 'highlight'. Loại khác trả null — gọi `extraBlock`. */
  function baseDialogBlock(item) {
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

    if (item.type === 'highlight') {
      const box = dialogEl('div', 'fbo-dlg-block');
      box.appendChild(dialogEl('span', `fbo-dlg-tag ${item.kind || 'info'}`, item.content ?? ''));
      return box;
    }

    return null;
  }

  function createDialogKit(opts = {}) {
    const post = typeof opts.post === 'function' ? opts.post : () => {};
    const extraBlock = typeof opts.extraBlock === 'function' ? opts.extraBlock : () => null;
    const canConfirm = typeof opts.canConfirm === 'function' ? opts.canConfirm : () => true;
    const readValues = typeof opts.readValues === 'function' ? opts.readValues : () => null;
    const onModeToggle = typeof opts.onModeToggle === 'function' ? opts.onModeToggle : null;
    const extraHotkeys = typeof opts.extraHotkeys === 'function' ? opts.extraHotkeys : null;

    let dialogOpen = null; // { id, root, lastFocus, primary }

    function dialogBlock(item) {
      const base = baseDialogBlock(item);
      return base !== null ? base : extraBlock(item);
    }

    function closeDialog(action, buttonId, values) {
      if (!dialogOpen) return;
      const { id, root, lastFocus } = dialogOpen;
      dialogOpen = null;
      root.remove();
      // Trả tiêu điểm về chỗ cũ: người dùng vừa bấm Del trên một ô, trả lời xong phải còn đứng ở
      // đúng ô đó — không thì mỗi câu hỏi lại làm mất chỗ đang làm việc.
      if (lastFocus && document.contains(lastFocus)) {
        try { lastFocus.focus(); } catch (e) { /* ô đã biến mất cùng control vừa xoá */ }
      }
      post({
        type: 'dialog-result',
        id,
        action,
        buttonId,
        values: values && typeof values === 'object' ? values : null,
      });
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
        el.addEventListener('click', () => {
          const action = button.action || 'confirm';
          const confirming = action !== 'cancel' && action !== 'close';
          if (confirming && !canConfirm(root)) return;
          closeDialog(action, button.id, confirming ? readValues(root) : null);
        });
        if (!primary && (button.variant === 'primary' || button.variant === 'danger')) primary = el;
        foot.appendChild(el);
      }
      card.appendChild(foot);

      root.appendChild(card);
      document.body.appendChild(root);
      dialogOpen = { id, root, lastFocus: document.activeElement, primary };

      if (onModeToggle) {
        for (const btn of root.querySelectorAll('.fbo-dlg-mode-btn')) {
          btn.addEventListener('click', () => onModeToggle(root, btn.dataset.dlgMode || 'basic'));
        }
        if (root.querySelector('.fbo-dlg-mode-toggle')) {
          onModeToggle(root, root.querySelector('.fbo-dlg-mode-toggle').dataset.modeValue || 'basic');
        }
      }

      // Bấm ra ngoài thẻ = đóng, nhưng CHỈ khi cú bấm bắt đầu trên nền: bôi đen chữ trong hộp rồi
      // nhả chuột ngoài nền cũng bắn `click` lên nền, mà lúc ấy người dùng đang đọc chứ không huỷ.
      root.addEventListener('mousedown', (e) => { if (e.target === root) root.dataset.armed = '1'; });
      root.addEventListener('click', (e) => {
        if (e.target === root && root.dataset.armed === '1' && opt.canClose !== false) closeDialog('close', null);
        delete root.dataset.armed;
      });

      // Form hỏi: focus ô nhập đầu tiên (nhóm đang hiện). Confirm-only: focus nút chính như trước.
      const firstField = root.querySelector('.fbo-dlg-group:not([hidden]) .fbo-dlg-input, .fbo-dlg-body > .fbo-dlg-field .fbo-dlg-input, .fbo-dlg-input');
      (firstField || primary || foot.querySelector('.fbo-dlg-btn') || card).focus();
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

      if (extraHotkeys && extraHotkeys(event, dialogOpen)) return;

      event.stopPropagation();
    }, true);

    return {
      dialogEl, dialogBlock, closeDialog, showDialog,
    };
  }

  window.FboDialogKit = { dialogEl, dialogBlock: baseDialogBlock, createDialogKit };
}());

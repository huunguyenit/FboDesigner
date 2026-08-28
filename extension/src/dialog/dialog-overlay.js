// dialog-overlay.js — hộp thoại vẽ NGAY TRONG webview designer, không mở tab riêng.
//
// Vì sao không dùng `DialogPanel`: nó gọi `createWebviewPanel`, tức mỗi câu hỏi đẻ ra một TAB
// mới nằm cạnh tab designer. Người dùng đang nhìn cái form, bấm Delete, rồi bị nhấc sang một
// tab khác để trả lời — cái form biến mất đúng lúc họ cần nhìn nó để quyết định.
//
// Ở đây chỉ có một cầu thông điệp: host gửi `dialog-show` kèm options đã chuẩn hoá, client
// (`extension/media/designer.js`) vẽ lớp phủ lên trên form và gửi lại `dialog-result`. Không
// có webview nào được tạo thêm.
//
// RANH GIỚI: host KHÔNG gửi HTML thô sang client. Options đi qua `normalizeDialogOptions`, và
// khối `html`/`custom` được `sanitizeHtml` ngay tại đây — client chỉ dựng DOM, không phải tin
// vào chuỗi nào cả.

const { normalizeDialogOptions, sanitizeHtml, buttonIdOf } = require('./dialog-types');

let nextId = 1;

/** Làm sạch những khối mang HTML trước khi qua cầu. Các khối khác là dữ liệu thuần, client tự dựng DOM. */
function sanitizeBody(body) {
  return (body || []).map((item) => (item && (item.type === 'html' || item.type === 'custom')
    ? { ...item, content: sanitizeHtml(item.content || '') }
    : item));
}

class OverlayDialogs {
  /** @param webview webview của chính panel designer đang hỏi */
  constructor(webview) {
    this.webview = webview;
    this.pending = new Map(); // id → resolve
  }

  show(options = {}) {
    const normalized = normalizeDialogOptions(options);
    normalized.body = sanitizeBody(normalized.body);

    const id = `dlg-${nextId++}`;
    const done = new Promise((resolve) => this.pending.set(id, resolve));

    /*
     * `postMessage` trả về Thenable<boolean>, và `false` là ca THẬT chứ không phải lý thuyết:
     * webview đã dispose, hoặc đang ẩn mà panel không giữ context. Không ai vẽ hộp thoại thì
     * cũng không ai bấm nút — coi như đóng, nếu không `await` treo vĩnh viễn và cờ `editing`
     * của designer kẹt ở `true`, tức preview đứng hình mà không có gì giải thích tại sao.
     */
    Promise.resolve(this.webview.postMessage({ type: 'dialog-show', id, options: normalized }))
      .then((ok) => { if (!ok) this.settle(id, { action: 'close' }); })
      .catch(() => this.settle(id, { action: 'close' }));

    return done;
  }

  /** Xem `DialogService.ask` — cùng ngữ nghĩa, cùng hàm quy đổi kết quả. */
  async ask(options = {}) {
    return buttonIdOf(await this.show(options));
  }

  info(options = {}) { return this.show({ ...options, type: 'info' }); }
  success(options = {}) { return this.show({ ...options, type: 'success' }); }
  warning(options = {}) { return this.show({ ...options, type: 'warning' }); }
  error(options = {}) { return this.show({ ...options, type: 'error' }); }

  /**
   * Cho chỗ nhận thông điệp của panel gọi vào.
   * @returns {boolean} đã nuốt thông điệp này chưa — `false` thì panel xử lý tiếp như thường.
   */
  handleMessage(msg) {
    if (!msg || msg.type !== 'dialog-result') return false;
    this.settle(msg.id, { action: msg.action, buttonId: msg.buttonId });
    return true;
  }

  settle(id, result) {
    const resolve = this.pending.get(id);
    if (!resolve) return; // đến muộn sau khi đã ngã ngũ — bỏ qua, không resolve hai lần
    this.pending.delete(id);
    resolve(result);
  }

  /**
   * Panel chết trong lúc còn hộp thoại đang chờ.
   *
   * Phải thả HẾT: một `await` không bao giờ trả về sẽ giữ luôn cờ `editing` của designer, và
   * triệu chứng người dùng thấy là preview ngừng cập nhật vĩnh viễn — không cách nào nối được
   * với việc họ vừa đóng một tab.
   */
  dispose() {
    for (const id of [...this.pending.keys()]) this.settle(id, { action: 'close' });
  }
}

module.exports = { OverlayDialogs };

const { AsyncLocalStorage } = require('node:async_hooks');

const { DialogPanel } = require('./dialog-panel');
const { DIALOG_TYPES, normalizeDialogOptions, buttonIdOf } = require('./dialog-types');

class DialogService {
  constructor(context) {
    this.context = context;
  }

  async show(options = {}) {
    const normalized = normalizeDialogOptions(options);
    const panel = new DialogPanel(this.context, normalized);
    return panel.show();
  }

  info(options = {}) {
    return this.show({ ...options, type: 'info' });
  }

  success(options = {}) {
    return this.show({ ...options, type: 'success' });
  }

  warning(options = {}) {
    return this.show({ ...options, type: 'warning' });
  }

  error(options = {}) {
    return this.show({ ...options, type: 'error' });
  }

  confirm(options = {}) {
    return this.show({
      ...options,
      type: options.type || 'warning',
      buttons: options.buttons || [
        { id: 'cancel', label: 'Hủy', variant: 'secondary', action: 'cancel' },
        { id: 'confirm', label: 'Xác nhận', variant: 'primary', action: 'confirm' },
      ],
    });
  }

  /**
   * Hỏi một câu CÓ NÚT và trả về id nút đã bấm — thay cho `showWarningMessage(msg, {modal:true}, …)`.
   *
   * Trả `null` khi người dùng từ chối, và gộp cả ba đường từ chối làm một: bấm nút có
   * `action: 'cancel'`, bấm dấu ×, hay bấm Esc. Chỗ gọi chỉ cần hỏi «có id không», không phải
   * nhớ ba trạng thái — đúng như `showWarningMessage` trả `undefined` cho cả Esc lẫn Cancel.
   *
   * Nút đồng ý phải mang id RIÊNG chứ đừng dựa vào `action`: `normalizeButtons` cho mọi nút
   * không khai action thành 'confirm', nên hai nút đồng ý khác nghĩa sẽ lẫn vào nhau.
   *
   * @returns {Promise<string|null>} id nút đã bấm, hoặc null nếu huỷ/đóng
   */
  async ask(options = {}) {
    return buttonIdOf(await this.show(options));
  }

  demo() {
    return this.show({
      type: 'warning',
      title: 'Cảnh báo thao tác',
      subtitle: 'Thao tác này có thể ảnh hưởng đến dữ liệu hiện tại',
      size: 'small',
      body: [
        { type: 'text', content: 'Bạn sắp thực hiện một thao tác nguy hiểm. Kiểm tra kỹ trước khi tiếp tục.' },
        { type: 'details', rows: [
          { key: 'Error Code', value: 'E_XML_1001' },
          { key: 'Node', value: '<field name="ma_vt">' },
        ] },
      ],
      buttons: [
        { id: 'cancel', label: 'Hủy bỏ', variant: 'secondary', action: 'cancel' },
        { id: 'confirm', label: 'Tiếp tục', variant: 'primary', action: 'confirm' },
      ],
    });
  }
}

/*
 * Hộp thoại hiện ở ĐÂU: overlay trong designer nếu có, webview riêng nếu không.
 *
 * `AsyncLocalStorage` chứ không phải một biến toàn cục gán đi gán lại. Hai panel designer mở
 * cùng lúc là ca thật (`supportsMultipleEditorsPerDocument: true`), và mỗi phép sửa là một
 * chuỗi `await` dài — `handleEdit` → `removeControl` → `applySplice` → `confirmForeign`. Với
 * một biến toàn cục, panel B bắt đầu sửa giữa chừng sẽ đổi đích ngay dưới chân panel A, và câu
 * hỏi của A hiện lên trên form của B. ALS gắn theo CHUỖI GỌI nên mỗi phép sửa giữ đúng webview
 * đã mở nó, bao nhiêu panel cũng vậy.
 *
 * Lệnh chạy ngoài designer (`fboDesigner.declareFilter` bấm từ chuột phải trên file XML) không
 * có store nào — chúng rơi về `shared`, tức webview riêng. Vẫn là giao diện custom, chỉ khác
 * chỗ đặt; không có đường nào quay lại hộp thoại native.
 */
const bound = new AsyncLocalStorage();

/** Chạy `fn` với mọi `dialogs()` bên trong nó trỏ vào overlay của panel này. */
function runWithDialogs(host, fn) {
  return bound.run(host, fn);
}

/*
 * Một instance dùng chung cho cả extension.
 *
 * Vì sao singleton chứ không truyền `context` xuống từng hàm: các chỗ HỎI nằm rải trong
 * `edit-host.js` và `filter-host.js`, sâu dưới bốn năm tầng gọi (`handleEdit` → `removeControl`
 * → …). Nối `context` qua từng chữ ký chỉ để tầng cuối mở được hộp thoại là bắt mọi hàm ở giữa
 * mang theo một tham số chúng không dùng. `config()` của `render-host.js` đã là kiểu truy cập
 * này rồi; giữ cho giống nhau.
 *
 * `activate()` chạy trước mọi thao tác người dùng, nên `dialogs()` luôn có sẵn instance. Gọi
 * trước khi init là lỗi lập trình chứ không phải ca vận hành — ném lỗi để thấy ngay, thay vì
 * lặng lẽ rơi về hộp thoại native và không ai biết.
 */
let shared = null;

function initDialogs(context) {
  shared = new DialogService(context);
  return shared;
}

function dialogs() {
  const overlay = bound.getStore();
  if (overlay) return overlay;
  if (!shared) throw new Error('DialogService chưa được init — activate() phải gọi initDialogs(context) trước.');
  return shared;
}

module.exports = { DialogService, DIALOG_TYPES, initDialogs, dialogs, runWithDialogs };

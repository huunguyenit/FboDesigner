/*
 * `escapeHtml` / `sanitizeHtml` nằm ở đây chứ không ở `dialog-panel.js` vì cả HAI lối hiển thị
 * đều cần chúng: panel webview riêng dựng HTML phía host, còn overlay trong designer gửi nội
 * dung qua `postMessage` và phải làm sạch TRƯỚC khi gửi — client không được nhận HTML thô.
 */
function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHtml(rawHtml = '') {
  if (!rawHtml) return '';

  let safe = String(rawHtml)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, '');

  const allowedTags = ['strong', 'b', 'em', 'i', 'u', 'mark', 'span', 'a', 'p', 'div', 'br', 'ul', 'ol', 'li', 'code', 'pre', 'small', 'h1', 'h2', 'h3', 'blockquote'];
  /*
   * Dấu `/` của thẻ đóng phải được BẮT và trả lại.
   *
   * Bản trước khớp `<\/?…>` nhưng không nhóm dấu gạch, rồi dựng lại thẻ bằng `<${tên}…>` —
   * nên `</b>` ra `<b>`. Mọi khối `html` vì thế mở thẻ hai lần và không đóng lần nào: chữ đậm
   * tràn xuống hết phần còn lại của hộp thoại, và `</p>` biến mỗi đoạn thành một đoạn lồng.
   * Thẻ đóng cũng không mang thuộc tính, nên trả về thẳng, không đi qua bộ lọc attribute.
   */
  const tagPattern = /<(\/?)([a-z0-9]+)(\s[^>]*)?>/gi;
  safe = safe.replace(tagPattern, (match, closing, tagName, attributes = '') => {
    const lower = tagName.toLowerCase();
    if (!allowedTags.includes(lower)) {
      return '';
    }
    if (closing) return `</${lower}>`;

    const cleanedAttributes = attributes.replace(/\s+(href|title|target|rel|class)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, (attrMatch, attrName, value) => {
      const normalizedValue = value.replace(/^['"]|['"]$/g, '');
      if (attrName === 'href') {
        const safeHref = /^https?:\/\//i.test(normalizedValue) || /^mailto:/i.test(normalizedValue) || /^#\//i.test(normalizedValue) || /^\//i.test(normalizedValue) || /^#/i.test(normalizedValue);
        return safeHref ? attrMatch : '';
      }
      if (attrName === 'target') return normalizedValue === '_blank' ? ` target="_blank"` : '';
      if (attrName === 'rel') return ` rel="noopener noreferrer"`;
      return attrMatch;
    });

    return `<${lower}${cleanedAttributes}>`;
  });

  return safe;
}

/**
 * Kết quả hộp thoại → id nút đã bấm, `null` cho MỌI đường từ chối (nút cancel, dấu ×, Esc,
 * panel chết). Dùng chung để overlay và panel riêng không trôi ra hai ngữ nghĩa khác nhau.
 */
function buttonIdOf(result) {
  if (!result) return null;
  if (result.action === 'close' || result.action === 'cancel') return null;
  return result.buttonId || result.action;
}

const DIALOG_TYPES = {
  info: {
    icon: 'info',
    title: 'Thông tin',
    accent: 'var(--vscode-textLink-foreground)',
    accentSoft: 'var(--vscode-textLink-foreground)',
    className: 'info',
  },
  success: {
    icon: 'check',
    title: 'Thành công',
    accent: 'var(--vscode-testing-iconPassed)',
    accentSoft: 'var(--vscode-testing-iconPassed)',
    className: 'success',
  },
  warning: {
    icon: 'warning',
    title: 'Cảnh báo',
    accent: 'var(--vscode-editorWarning-foreground)',
    accentSoft: 'var(--vscode-editorWarning-foreground)',
    className: 'warning',
  },
  error: {
    icon: 'error',
    title: 'Lỗi',
    accent: 'var(--vscode-editorError-foreground)',
    accentSoft: 'var(--vscode-editorError-foreground)',
    className: 'error',
  },
};

const DEFAULT_BUTTONS = {
  info: [
    { id: 'cancel', label: 'Hủy', variant: 'secondary', action: 'cancel' },
    { id: 'confirm', label: 'OK', variant: 'primary', action: 'confirm' },
  ],
  success: [
    { id: 'close', label: 'Đóng', variant: 'secondary', action: 'close' },
    { id: 'confirm', label: 'Xem chi tiết', variant: 'primary', action: 'confirm' },
  ],
  warning: [
    { id: 'cancel', label: 'Hủy bỏ', variant: 'secondary', action: 'cancel' },
    { id: 'confirm', label: 'Tiếp tục', variant: 'primary', action: 'confirm' },
  ],
  error: [
    { id: 'close', label: 'Đóng', variant: 'secondary', action: 'close' },
    { id: 'retry', label: 'Thử lại', variant: 'primary', action: 'retry' },
  ],
};

function normalizeButtons(type, buttons) {
  if (Array.isArray(buttons) && buttons.length > 0) {
    return buttons.map((button, index) => ({
      id: button.id || `button-${index}`,
      label: button.label || 'OK',
      variant: button.variant || 'secondary',
      action: button.action || 'confirm',
      disabled: Boolean(button.disabled),
      ariaLabel: button.ariaLabel || button.label,
    }));
  }

  return [...DEFAULT_BUTTONS[type]];
}

function normalizeDialogOptions(options = {}) {
  const type = DIALOG_TYPES[options.type] ? options.type : 'info';
  const body = Array.isArray(options.body) ? options.body.slice() : [];

  if (options.message && body.length === 0) {
    body.push({ type: 'text', content: options.message });
  }

  return {
    type,
    title: options.title || DIALOG_TYPES[type].title,
    subtitle: options.subtitle || '',
    message: options.message || '',
    body,
    buttons: normalizeButtons(type, options.buttons),
    size: ['small', 'medium', 'large'].includes(options.size) ? options.size : 'medium',
    canClose: options.canClose !== false,
    defaultButton: options.defaultButton || null,
    showCloseButton: options.showCloseButton !== false,
    model: options.model || null,
  };
}

module.exports = {
  DIALOG_TYPES,
  DEFAULT_BUTTONS,
  normalizeButtons,
  normalizeDialogOptions,
  escapeHtml,
  sanitizeHtml,
  buttonIdOf,
};

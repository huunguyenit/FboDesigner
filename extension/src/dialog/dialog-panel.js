const vscode = require('vscode');
const {
  DIALOG_TYPES, normalizeDialogOptions, escapeHtml, sanitizeHtml,
} = require('./dialog-types');

function buildTextContent(value) {
  return escapeHtml(String(value ?? '')).replace(/\n/g, '<br>');
}

function buildBodyContent(body) {
  if (!Array.isArray(body) || body.length === 0) return '';

  return body.map((item) => {
    if (!item || typeof item !== 'object') return '';

    switch (item.type) {
      case 'text': {
        const cssClass = item.className ? ` class="${escapeHtml(item.className)}"` : '';
        return `<div class="block text-block${cssClass}">${buildTextContent(item.content)}</div>`;
      }
      case 'html': {
        return `<div class="block rich-text">${sanitizeHtml(item.content || '')}</div>`;
      }
      case 'list': {
        const ordered = item.ordered ? 'ol' : 'ul';
        const items = (item.items || []).map((entry) => `<li>${escapeHtml(String(entry ?? ''))}</li>`).join('');
        return `<div class="block list-block"><${ordered}>${items}</${ordered}></div>`;
      }
      case 'code': {
        const language = escapeHtml(item.language || 'text');
        const content = item.content || '';
        const lines = content.split('\n');
        const numbered = lines.map((line, index) => `<div class="code-line"><span class="line-no">${index + 1}</span><span class="line-text">${escapeHtml(line || ' ')}</span></div>`).join('');
        const highlighted = Array.isArray(item.highlightLines) && item.highlightLines.length ? `data-highlight-lines="${item.highlightLines.join(',')}"` : '';
        return `
          <div class="block code-block" ${highlighted}>
            <div class="code-toolbar">
              <span class="code-language">${language}</span>
              <button type="button" class="copy-button" data-copy="${escapeHtml(content).replace(/\n/g, '\\n')}" aria-label="Copy code">Copy</button>
            </div>
            <pre class="code-pre"><code>${numbered}</code></pre>
          </div>`;
      }
      case 'details': {
        const rows = (item.rows || []).map((row) => `
          <div class="detail-row">
            <div class="detail-key">${escapeHtml(row.key || '')}</div>
            <div class="detail-value">${escapeHtml(row.value || '')}</div>
          </div>
        `).join('');
        return `<div class="block details-block">${rows}</div>`;
      }
      case 'highlight': {
        const kind = item.kind || 'info';
        return `<div class="block highlight-block"><span class="semantic ${kind}">${escapeHtml(String(item.content || ''))}</span></div>`;
      }
      case 'custom': {
        return `<div class="block custom-block">${sanitizeHtml(item.content || '')}</div>`;
      }
      default:
        return '';
    }
  }).join('');
}

class DialogPanel {
  constructor(context, options) {
    this.context = context;
    this.options = normalizeDialogOptions(options);
    this.panel = undefined;
    this.resolve = null;
    this.reject = null;
    this.closePromise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  show() {
    this.panel = vscode.window.createWebviewPanel(
      'fboDesigner.dialog',
      this.options.title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.html = this.renderHtml();

    this.panel.onDidDispose(() => {
      if (this.resolve) {
        this.resolve({ action: 'close' });
      }
    }, null, this.context.subscriptions);

    this.panel.webview.onDidReceiveMessage((message) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'dialog-action') {
        const result = { action: message.action, buttonId: message.buttonId || message.action };
        this.resolve(result);
        this.panel.dispose();
      }

      if (message.type === 'dialog-close') {
        this.resolve({ action: 'close' });
        this.panel.dispose();
      }

      if (message.type === 'dialog-copy') {
        const copyText = message.text || '';
        if (!copyText) return;
        void vscode.env.clipboard.writeText(copyText).catch(() => undefined);
      }
    }, undefined, this.context.subscriptions);

    return this.closePromise;
  }

  renderHtml() {
    const typeInfo = DIALOG_TYPES[this.options.type] || DIALOG_TYPES.info;
    const sizeMap = { small: '340px', medium: '460px', large: '600px' };
    const width = sizeMap[this.options.size] || sizeMap.medium;
    const accent = typeInfo.accent || 'var(--vscode-textLink-foreground)';
    const buttonsHtml = this.options.buttons.map((button) => {
      const variant = button.variant || 'secondary';
      const disabled = button.disabled ? 'disabled' : '';
      return `
        <button
          type="button"
          class="action-button ${variant}"
          data-action="${escapeHtml(button.action)}"
          data-button-id="${escapeHtml(button.id)}"
          aria-label="${escapeHtml(button.ariaLabel || button.label)}"
          ${disabled}
        >${escapeHtml(button.label)}</button>
      `;
    }).join('');

    const titleBlock = this.options.subtitle
      ? `<div class="dialog-subtitle">${escapeHtml(this.options.subtitle)}</div>`
      : '';

    /*
     * Glyph thật, KHÔNG phải `$(info)`.
     *
     * `$(tên)` là cú pháp codicon của VS Code, và nó chỉ được diễn giải trong UI của chính
     * workbench — QuickPick, TreeItem, StatusBarItem. Webview là một trang HTML bình thường:
     * nó in ra đúng bảy ký tự `$(info)`, và đó chính là cái đang nằm trong header hộp thoại.
     */
    const headerIcon = {
      info: 'i',
      success: '✓',
      warning: '!',
      error: '×',
    }[this.options.type] || 'i';

    const nonce = Math.random().toString(36).slice(2, 12);
    const bodyMarkup = buildBodyContent(this.options.body);

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel ? this.panel.webview.cspSource : 'vscode-resource:'} data:; style-src ${this.panel ? this.panel.webview.cspSource : 'vscode-resource:'} 'unsafe-inline'; font-src ${this.panel ? this.panel.webview.cspSource : 'vscode-resource:'}; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(this.options.title)}</title>
        <style>
          :root {
            --dialog-accent: ${accent};
            --dialog-accent-soft: color-mix(in srgb, ${accent} 18%, transparent);
            --dialog-border: var(--vscode-widget-border);
            --dialog-background: var(--vscode-editor-background);
            --dialog-header-background: var(--vscode-editorWidget-background);
            --dialog-body-background: var(--vscode-editor-background);
            --dialog-foreground: var(--vscode-editor-foreground);
            --dialog-muted: var(--vscode-descriptionForeground);
            --dialog-button-primary: var(--vscode-button-background);
            --dialog-button-primary-foreground: var(--vscode-button-foreground);
            --dialog-button-secondary: var(--vscode-button-secondaryBackground);
            --dialog-button-secondary-foreground: var(--vscode-button-secondaryForeground);
            --dialog-button-danger: var(--vscode-errorForeground);
            --dialog-button-danger-foreground: var(--vscode-button-foreground);
            --dialog-shadow: rgba(0, 0, 0, 0.18);
          }

          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }

          body {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px;
          }

          .dialog-root {
            display: flex;
            flex-direction: column;
            width: ${width};
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 48px);
            border: 1px solid var(--dialog-border);
            border-radius: 10px;
            background: var(--dialog-background);
            box-shadow: 0 12px 28px var(--dialog-shadow);
            overflow: hidden;
            border-top: 3px solid var(--dialog-accent);
          }

          .dialog-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            min-height: 44px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--dialog-border);
            background: var(--dialog-header-background);
          }

          .dialog-title-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            flex: 1;
          }

          .dialog-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border-radius: 6px;
            background: var(--dialog-accent-soft);
            color: var(--dialog-accent);
            font-weight: 700;
            flex-shrink: 0;
            line-height: 1;
          }

          .dialog-title {
            display: flex;
            flex-direction: column;
            min-width: 0;
            gap: 2px;
          }

          .dialog-main-title {
            font-size: 14px;
            font-weight: 600;
            line-height: 1.3;
            color: var(--vscode-editor-foreground);
          }

          .dialog-subtitle {
            font-size: 11px;
            color: var(--dialog-muted);
            line-height: 1.3;
          }

          .dialog-close {
            border: 1px solid transparent;
            background: transparent;
            color: var(--vscode-foreground);
            width: 28px;
            height: 28px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
          }

          .dialog-close:hover,
          .dialog-close:focus-visible {
            background: var(--vscode-toolbar-hoverBackground);
            outline: 1px solid var(--dialog-accent);
          }

          .dialog-body {
            overflow: auto;
            padding: 12px;
            background: var(--dialog-body-background);
            max-height: min(45vh, 400px);
          }

          .block {
            margin: 0 0 12px;
          }

          .block:last-child { margin-bottom: 0; }

          .text-block,
          .rich-text,
          .list-block,
          .details-block,
          .highlight-block,
          .custom-block {
            line-height: 1.6;
            font-size: 13px;
            color: var(--vscode-editor-foreground);
          }

          .text-block p,
          .rich-text p,
          .custom-block p {
            margin: 0 0 8px;
          }

          .text-block strong,
          .rich-text strong,
          .custom-block strong { font-weight: 700; }
          .text-block em,
          .rich-text em,
          .custom-block em { font-style: italic; }
          .text-block u,
          .rich-text u,
          .custom-block u { text-decoration: underline; }
          .text-block mark,
          .rich-text mark,
          .custom-block mark {
            background: var(--vscode-editor-findMatchHighlightBackground);
            color: inherit;
            border-radius: 3px;
            padding: 0 2px;
          }

          .semantic {
            display: inline-flex;
            align-items: center;
            padding: 4px 8px;
            border-radius: 999px;
            border: 1px solid var(--dialog-border);
            font-weight: 600;
            background: var(--dialog-accent-soft);
            color: var(--dialog-accent);
          }

          .list-block ul,
          .list-block ol {
            margin: 0;
            padding-left: 20px;
          }

          .list-block li + li { margin-top: 4px; }

          .code-block {
            border: 1px solid var(--dialog-border);
            border-radius: 8px;
            overflow: hidden;
            background: var(--vscode-textCodeBlock-background);
          }

          .code-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 8px 10px;
            border-bottom: 1px solid var(--dialog-border);
            background: rgba(255,255,255,0.03);
          }

          .code-language {
            font-size: 11px;
            color: var(--dialog-muted);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          .copy-button,
          .action-button {
            border: 1px solid var(--dialog-border);
            background: transparent;
            color: var(--vscode-editor-foreground);
            border-radius: 6px;
            cursor: pointer;
            transition: filter 0.15s ease, background 0.15s ease;
            font-family: var(--vscode-font-family);
          }

          .copy-button {
            padding: 4px 8px;
            font-size: 11px;
          }

          .copy-button:hover,
          .action-button:hover,
          .copy-button:focus-visible,
          .action-button:focus-visible {
            filter: brightness(1.05);
            outline: 1px solid var(--dialog-accent);
          }

          .code-pre {
            margin: 0;
            padding: 10px 12px;
            overflow: auto;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            line-height: 1.5;
            white-space: pre;
          }

          .code-line {
            display: grid;
            grid-template-columns: 28px minmax(0, 1fr);
            gap: 10px;
            min-height: 20px;
          }

          .line-no {
            color: var(--dialog-muted);
            user-select: none;
            text-align: right;
          }

          .line-text {
            white-space: pre;
          }

          .details-block {
            border: 1px solid var(--dialog-border);
            border-radius: 8px;
            background: var(--vscode-input-background);
            overflow: hidden;
          }

          .detail-row {
            display: grid;
            grid-template-columns: 110px minmax(0, 1fr);
            gap: 12px;
            padding: 8px 10px;
            border-bottom: 1px solid var(--dialog-border);
          }

          .detail-row:last-child { border-bottom: none; }

          .detail-key {
            font-weight: 600;
            color: var(--dialog-muted);
          }

          .detail-value {
            white-space: pre-wrap;
            word-break: break-word;
          }

          .dialog-footer {
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-top: 1px solid var(--dialog-border);
            background: var(--dialog-header-background);
          }

          .action-button {
            min-width: 76px;
            padding: 6px 10px;
            font-size: 12px;
            font-weight: 600;
          }

          .action-button.primary {
            background: var(--dialog-button-primary);
            color: var(--dialog-button-primary-foreground);
            border-color: transparent;
          }

          .action-button.secondary {
            background: var(--dialog-button-secondary);
            color: var(--dialog-button-secondary-foreground);
          }

          .action-button.danger {
            background: var(--vscode-button-hoverBackground);
            color: var(--dialog-button-danger-foreground);
          }

          .action-button.ghost {
            background: transparent;
            color: var(--vscode-editor-foreground);
          }

          .action-button[disabled] {
            opacity: 0.5;
            cursor: not-allowed;
          }

          @media (max-width: 480px) {
            body { padding: 10px; }
            .dialog-root { width: min(100%, 340px); }
            .dialog-header { padding: 8px 10px; }
            .dialog-body { padding: 10px; }
            .dialog-footer { padding: 8px 10px; }
            .detail-row { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="dialog-root" role="dialog" aria-modal="true" aria-labelledby="dialog-title" data-type="${escapeHtml(this.options.type)}" data-size="${escapeHtml(this.options.size)}">
          <header class="dialog-header">
            <div class="dialog-title-wrap">
              <div class="dialog-icon" aria-hidden="true">${headerIcon}</div>
              <div class="dialog-title" id="dialog-title">
                <div class="dialog-main-title">${escapeHtml(this.options.title)}</div>
                ${titleBlock}
              </div>
            </div>
            <button type="button" class="dialog-close" data-close="true" aria-label="Đóng" title="Đóng">×</button>
          </header>

          <main class="dialog-body" tabindex="0">
            ${bodyMarkup}
          </main>

          <footer class="dialog-footer">
            ${buttonsHtml}
          </footer>
        </div>

        <script nonce="${nonce}">
          (function() {
            const vscode = acquireVsCodeApi();
            const root = document.querySelector('.dialog-root');
            const closeButton = document.querySelector('[data-close]');
            const actionButtons = [...document.querySelectorAll('[data-action]')];
            const copyButtons = [...document.querySelectorAll('[data-copy]')];

            const post = (type, payload) => vscode.postMessage({ type, ...payload });

            const setCopyState = (button, text) => {
              const previous = button.textContent;
              button.textContent = '✓ Copied';
              button.disabled = true;
              window.setTimeout(() => {
                button.textContent = text || previous;
                button.disabled = false;
              }, 1500);
            };

            closeButton && closeButton.addEventListener('click', () => post('dialog-close', {}));

            actionButtons.forEach((button) => {
              const action = button.getAttribute('data-action');
              const buttonId = button.getAttribute('data-button-id');
              button.addEventListener('click', () => post('dialog-action', { action, buttonId }));
            });

            copyButtons.forEach((button) => {
              button.addEventListener('click', async () => {
                const text = button.getAttribute('data-copy') || '';
                // Số backslash ở dòng dưới CỐ Ý gấp đôi: đoạn script này còn đi qua một tầng
                // template literal của renderHtml() nữa, tầng đó ăn mất một lớp escape. Viết một
                // lớp thì HTML sinh ra có string chưa đóng, IIFE không parse được, và MỌI nút bấm
                // chết câm — đúng lỗi đã gặp. Đừng viết ký tự escape nào vào comment này.
                const decoded = text.replace(/\\\\n/g, '\\n');
                try {
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(decoded);
                  } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = decoded;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                  }
                  setCopyState(button, 'Copy');
                } catch (error) {
                  button.textContent = 'Copy failed';
                  window.setTimeout(() => { button.textContent = 'Copy'; }, 1200);
                }
              });
            });

            document.addEventListener('keydown', (event) => {
              if (event.key === 'Escape') {
                post('dialog-close', {});
              }

              if (event.key === 'Enter' && document.activeElement && document.activeElement.tagName === 'BODY') {
                const primary = document.querySelector('.action-button.primary');
                if (primary) {
                  primary.click();
                }
              }
            });

            if (root) {
              root.setAttribute('tabindex', '-1');
            }
          })();
        </script>
      </body>
      </html>`;
  }
}

module.exports = { DialogPanel };

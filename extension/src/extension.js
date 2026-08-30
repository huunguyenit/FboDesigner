// extension.js — vỏ VS Code. Mỏng có chủ đích: mọi thứ biết về FBO nằm ở `core/`.
//
// Vì sao CommonJS mà core lại là ESM: VS Code nạp extension bằng `require`, còn core cố ý
// giữ `.mjs` zero-dep để hub 4AI import lại được (ADR-0002). Cầu nối là `import()` động
// trong `activate` — không cần bundler, không cần npm install, F5 là chạy.

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { FboDesignerProvider } = require('./designer-editor');
const { PreviewPanel } = require('./preview-panel');
const { isControllerDocument, config, panelColumn } = require('./render-host');
const { declareFilter } = require('./filter-host');
const { addColumns } = require('./add-column-host');
const { initDialogs } = require('./dialog/dialog-service');
const { postToActiveDesigner } = require('./designer-webview');
const { toast } = require('./locale');

/**
 * Core nằm ở hai chỗ khác nhau tuỳ cách chạy, và đó là chuyện cố ý:
 *   - chạy F5 từ repo: `core/` là package anh em, nằm ngoài thư mục extension;
 *   - cài từ .vsix:    `core/` đã được `tools/package-vsix.mjs` chép vào trong gói.
 * Thử bản đóng gói trước — bản cài đặt là bản chạy trên máy người khác.
 */
async function loadCore() {
  const candidates = [
    path.join(__dirname, '..', 'core', 'index.mjs'),
    path.join(__dirname, '..', '..', 'core', 'src', 'index.mjs'),
  ];
  const entry = candidates.find((p) => fs.existsSync(p));
  if (!entry) throw new Error(`không tìm thấy fbo-core, đã thử:\n${candidates.join('\n')}`);
  return import(pathToFileURL(entry).href);
}

async function activate(context) {
  let core;
  try {
    core = await loadCore();
  } catch (err) {
    vscode.window.showErrorMessage(toast('extension.core_load_fail', { message: err.message }));
    throw err;
  }

  const output = vscode.window.createOutputChannel('FBO Designer');
  context.subscriptions.push(output);

  // Phải đứng TRƯỚC mọi registerCommand: `edit-host.js` và `filter-host.js` lấy hộp thoại qua
  // `dialogs()`, và chúng chạy được ngay khi người dùng bấm lệnh đầu tiên.
  const dialogService = initDialogs(context);

  context.subscriptions.push(FboDesignerProvider.register(context, core, output));

  // Lệnh mặc định mở PANEL bám theo file đang gõ, không mở custom editor. Đó là cái người ta
  // muốn 9/10 lần: sửa XML bên trái, nhìn form bên phải, tab sang file khác thì form đi theo.
  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.open', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc && !isControllerDocument(doc)) {
        vscode.window.showWarningMessage(toast('extension.only_controllers'));
      }
      PreviewPanel.reveal(context, core, output);
    }),
  );

  // Panel đã được VS Code khôi phục từ phiên trước vẫn cần nối lại event của extension,
  // nếu không webview còn hình cũ nhưng không nhận render/edit mới.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer('fboDesigner.preview', {
      async deserializeWebviewPanel(webviewPanel) {
        PreviewPanel.revive(context, core, output, webviewPanel);
      },
    }),
  );

  // Lọc nhanh đứng RIÊNG một lệnh, không nằm trong menu chuột phải của designer: nó vừa sửa XML
  // vừa sinh script chạy trên database của khách, tức nặng hơn hẳn mọi thao tác kéo thả khác.
  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.declareFilter', () => declareFilter(core, output)),
  );

  // Thêm cột đứng RIÊNG một lệnh, cùng lý do với lọc nhanh: nó sinh script chạy trên database
  // của khách, tức nặng hơn hẳn mọi thao tác kéo thả khác. Khác lọc nhanh ở chỗ KHÔNG sửa XML.
  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.addColumns', () => addColumns(core, output)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.showDialogDemo', async () => {
      const result = await dialogService.demo();
      output.appendLine(`Dialog demo result: ${JSON.stringify(result)}`);
    }),
  );

  // Delete không tới document của webview — host bắt phím rồi gửi hotkey sang webview đang active.
  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.deleteSelection', (args) => {
      const shiftKey = !!(args && args.shift);
      postToActiveDesigner({ type: 'hotkey', key: 'Delete', shiftKey });
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

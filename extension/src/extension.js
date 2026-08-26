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
const { probeEncodingRoundTrip } = require('./probe-encoding');

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
    vscode.window.showErrorMessage(`FBO Designer: không nạp được fbo-core — ${err.message}`);
    throw err;
  }

  const output = vscode.window.createOutputChannel('FBO Designer');
  context.subscriptions.push(output);

  context.subscriptions.push(FboDesignerProvider.register(context, core, output));

  // Lệnh mặc định mở PANEL bám theo file đang gõ, không mở custom editor. Đó là cái người ta
  // muốn 9/10 lần: sửa XML bên trái, nhìn form bên phải, tab sang file khác thì form đi theo.
  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.open', () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (doc && !isControllerDocument(doc)) {
        vscode.window.showWarningMessage(
          'FBO Designer: chỉ file trong App_Data\\Controllers\\{Dir,Filter,Grid} mới vẽ ra màn hình. Panel vẫn mở và sẽ vẽ khi bạn chuyển sang một file như vậy.',
        );
      }
      PreviewPanel.reveal(context, core, output);
    }),
  );

  // Muốn gắn cứng vào một file (để sửa, để undo/redo) thì mở bằng lệnh này.
  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.openEditor', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        vscode.window.showWarningMessage('FBO Designer: chưa mở file nào.');
        return;
      }
      // Cùng luật vị trí với panel (`fboDesigner.panelPosition`) — hai lối mở mà rơi vào hai
      // chỗ khác nhau thì người dùng đổi setting xong vẫn thấy designer mọc chỗ cũ.
      await vscode.commands.executeCommand('vscode.openWith', uri, 'fboDesigner.form', panelColumn(config()));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fboDesigner.probeEncodingRoundTrip', () => probeEncodingRoundTrip(core, output)),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

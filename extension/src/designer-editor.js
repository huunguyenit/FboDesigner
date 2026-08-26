// designer-editor.js — CustomTextEditorProvider cho Dir / Filter / Grid.
//
// Vì sao là CustomTextEditor chứ không phải webview panel rời: file XML CHÍNH LÀ TextDocument
// của VS Code. Đổi lấy được ba thứ mà DevWorkFlow phải tự viết bằng WPF — undo/redo, dirty
// state + save, và split view XML ↔ designer cùng sửa một document.
//
// Đổi lại phải chấp nhận VS Code nắm quyền decode/encode file. Đó chính là câu hỏi P0 số 1;
// `probe-encoding.js` trả lời nó bằng thực nghiệm, không bằng suy đoán.
//
// Editor này gắn cứng vào MỘT document — đó vừa là điểm mạnh (sửa được, undo được) vừa là
// điểm yếu (không bám theo file đang gõ). Chỗ nào cần bám theo thì dùng `PreviewPanel`; mọi
// thứ còn lại hai bên xài chung `render-host.js` để không nói hai chuyện khác nhau.

const vscode = require('vscode');

const {
  config,
  programAssets,
  buildPayload,
  shellHtml,
  revealSource,
} = require('./render-host');

const VIEW_TYPE = 'fboDesigner.form';

class FboDesignerProvider {
  constructor(context, core, output) {
    this.context = context;
    this.core = core;
    this.output = output;
  }

  static register(context, core, output) {
    return vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new FboDesignerProvider(context, core, output),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true },
    );
  }

  resolveCustomTextEditor(document, panel) {
    const cfg = config();
    const { paths, stylesheets } = programAssets(this.core, document.uri.fsPath, cfg, this.output);

    // Một gốc là đủ: Css, Images, ClientScript đều nằm trong program. Khai gốc program cũng là
    // điều kiện để `url(../Images/…)` trong CSS thật phân giải được sang webview URI.
    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media')];
    if (paths) roots.push(vscode.Uri.file(paths.programRoot));

    let bust = 0;
    const buildShell = () => {
      panel.webview.options = { enableScripts: true, localResourceRoots: roots };
      panel.webview.html = shellHtml(this.context, panel.webview, stylesheets, this.output, bust);
    };
    buildShell();

    if (paths) this.output.appendLine(`program: ${paths.programRoot} · ${stylesheets.length} css`);

    const render = () => {
      let payload;
      try {
        payload = buildPayload(this.core, document, {
          cfg, paths, output: this.output, webview: panel.webview,
        });
      } catch (err) {
        payload = { type: 'error', message: err.message, stack: String(err.stack || '') };
        this.output.appendLine(`render lỗi: ${err.stack || err.message}`);
      }
      panel.webview.postMessage(payload);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) render();
    });
    panel.onDidDispose(() => changeSub.dispose());

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'ready') return render();
      if (msg.type === 'select') return revealSource(msg, document, this.output);

      if (msg.type === 'reloadAssets') {
        bust += 1;
        this.output.appendLine(`nạp lại tài nguyên (bust=${bust})`);
        return buildShell(); // shell mới chạy lại script → script tự gửi `ready` → render()
      }

      if (msg.type === 'assets') {
        this.output.appendLine(`[P0 câu hỏi 2] CSS khai ${msg.declared}, webview nạp được ${msg.loaded}, hỏng ${msg.failed}`);
        for (const href of msg.failedHrefs || []) this.output.appendLine(`  không nạp được: ${href}`);
        return;
      }

      if (msg.type === 'log') this.output.appendLine(String(msg.text));
    });
  }
}

module.exports = { FboDesignerProvider, VIEW_TYPE };

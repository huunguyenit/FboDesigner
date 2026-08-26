// preview-panel.js — một panel duy nhất, BÁM THEO file đang active.
//
// Vì sao cần cái này bên cạnh custom editor: `CustomTextEditorProvider` gắn cứng vào một
// document. Mở ba controller là ba tab designer, và tab nào cũng vẽ file của riêng nó kể cả
// khi người dùng đã chuyển sang sửa file khác — nhìn xuống thấy form của file cũ, tin nó, sửa
// nhầm. Panel này chỉ có MỘT, và nó luôn vẽ đúng cái file đang gõ. Tab sang file không phải
// controller thì nó nói thẳng là không có gì để vẽ, thay vì giữ lại form cũ.
//
// Cùng lối với Markdown Preview của VS Code, và cũng cùng lý do.

const vscode = require('vscode');
const path = require('node:path');

const {
  config,
  panelColumn,
  isControllerDocument,
  programAssets,
  buildPayload,
  shellHtml,
  revealSource,
  samePath,
} = require('./render-host');
const { handleEdit } = require('./edit-host');

const VIEW_TYPE = 'fboDesigner.preview';

class PreviewPanel {
  constructor(context, core, output, panel) {
    this.context = context;
    this.core = core;
    this.output = output;
    this.panel = panel;

    this.document = null;      // TextDocument đang vẽ
    this.programKey = null;    // chỉ dựng lại shell khi ĐỔI program, không phải mỗi lần đổi file
    this.paths = null;
    this.ready = false;
    this.pending = null;
    this.sourceFiles = null;   // file đã góp nội dung vào bản vẽ hiện tại (controller + Include)
    this.bust = 0;             // tăng khi người dùng đòi nạp lại tài nguyên (debug mode)
    this.localEdit = null;     // { item, cell } khi lần render tới chỉ cần vá MỘT hàng

    this.disposables = [
      panel.onDidDispose(() => this.dispose()),

      // Chỉ phản ứng khi thật sự có một text editor được active. Bấm vào chính panel này thì
      // `activeTextEditor` là undefined — coi đó là "đổi file" sẽ làm panel tự xoá trắng ngay
      // khi người dùng chạm vào nó.
      // Chỉ file thật trên đĩa mới tính. Kênh Output, panel Debug Console, diff ảo… cũng là
      // TextEditor và cũng làm sự kiện này bắn — coi chúng là "đổi file" thì chỉ cần liếc qua
      // Output là preview tự xoá trắng.
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.uri.scheme === 'file') this.track(editor.document);
      }),

      // Sửa Include cũng phải vẽ lại: hàng của nó nằm ngay trên form đang mở, và người dùng
      // vừa được đưa sang đó để sửa. Chỉ nghe mỗi controller thì họ gõ vào Include mà form
      // đứng im — nhìn ra thành "designer không cập nhật".
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.document) return;
        if (e.document.uri.toString() === this.document.uri.toString()) return this.render();
        if (e.document.uri.scheme === 'file' && this.contributes(e.document.uri.fsPath)) this.render();
      }),

      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.document && doc.uri.toString() === this.document.uri.toString()) this.track(null);
      }),
    ];

    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), null, this.disposables);
  }

  static reveal(context, core, output) {
    const column = panelColumn(config());

    if (PreviewPanel.current) {
      PreviewPanel.current.panel.reveal(column, true);
      PreviewPanel.current.track(vscode.window.activeTextEditor?.document ?? null);
      return PreviewPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'FBO Designer', {
      viewColumn: column,
      preserveFocus: true,
    }, { enableScripts: true, retainContextWhenHidden: true });

    PreviewPanel.current = new PreviewPanel(context, core, output, panel);
    PreviewPanel.current.track(vscode.window.activeTextEditor?.document ?? null);
    return PreviewPanel.current;
  }

  /**
   * Đổi file đang vẽ.
   *
   * Ba trường hợp, và trường hợp giữa mới là cái khó thấy:
   *   - controller khác     → vẽ file đó
   *   - **Include của chính controller đang vẽ** → GIỮ NGUYÊN bản vẽ, chỉ đổi nhãn
   *   - file không liên quan → nói không có gì để vẽ
   *
   * Vì sao phải có nhánh giữa: bấm vào một ô là designer nhảy tới file Include khai ra hàng đó.
   * Nếu cú nhảy ấy tính là "đổi sang file không vẽ được" thì form tự xoá trắng đúng vào lúc
   * người dùng vừa mở nó ra để đối chiếu — họ thấy panel chớp một cái rồi trống trơn.
   */
  track(document) {
    if (document && !isControllerDocument(document)) {
      if (this.contributes(document.uri.fsPath)) {
        this.panel.title = `Designer · ${path.basename(this.document.uri.fsPath)}`;
        return;
      }
      this.document = null;
      this.panel.title = 'FBO Designer';
      return this.post({
        type: 'idle',
        file: path.basename(document.uri.fsPath),
        message: `${path.basename(document.uri.fsPath)} không nằm trong App_Data\\Controllers\\{Dir,Filter,Grid} — không có view nào để vẽ.`,
      });
    }
    if (!document) {
      this.document = null;
      this.panel.title = 'FBO Designer';
      return this.post({ type: 'idle', file: '', message: 'Mở một file trong App_Data\\Controllers để xem.' });
    }
    if (this.document && samePath(this.document.uri.fsPath, document.uri.fsPath)) return;

    this.document = document;
    this.panel.title = `Designer · ${path.basename(document.uri.fsPath)}`;
    this.render();
  }

  /**
   * Shell mang `<link>` CSS của program và `localResourceRoots` của program — đổi program là
   * phải dựng lại. Đổi file trong CÙNG program thì không: nạp lại shell là webview khởi động
   * lại, mất luôn trạng thái blueprint và vị trí cuộn.
   */
  ensureShell(cfg, force = false) {
    const { paths, stylesheets } = programAssets(this.core, this.document.uri.fsPath, cfg, this.output);
    const key = `${paths?.programRoot ?? ''}|${stylesheets.join('|')}`;
    this.paths = paths;

    if (key === this.programKey && !force) return;
    this.programKey = key;
    this.ready = false;

    const roots = [vscode.Uri.joinPath(this.context.extensionUri, 'media')];
    if (paths) roots.push(vscode.Uri.file(paths.programRoot));

    this.panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    this.panel.webview.html = shellHtml(this.context, this.panel.webview, stylesheets, this.output, this.bust);

    if (paths) this.output.appendLine(`program: ${paths.programRoot} · ${stylesheets.length} css`);
  }

  /**
   * File này có góp nội dung vào bản vẽ hiện tại không.
   *
   * Danh sách lấy từ chính lần render vừa rồi (`payload.sourceFiles`) chứ không đoán theo thư
   * mục: một Include chỉ "thuộc về" controller khi nó thật sự được `&Name;` kéo vào, và bộ
   * Include của mỗi controller mỗi khác.
   */
  contributes(fsPath) {
    return this.document !== null
      && this.sourceFiles !== null
      && this.sourceFiles.some((f) => samePath(f, fsPath));
  }

  /** Model tươi từ văn bản hiện tại — tầng edit hỏi qua đây. */
  buildNow() {
    try {
      return buildPayload(this.core, this.document, { cfg: config(), paths: this.paths, output: this.output });
    } catch (err) {
      this.output.appendLine(`dựng model để sửa lỗi: ${err.message}`);
      return null;
    }
  }

  render(forceShell = false) {
    if (!this.document) return;
    const cfg = config();
    this.ensureShell(cfg, forceShell);

    let payload;
    try {
      payload = buildPayload(this.core, this.document, {
        cfg,
        paths: this.paths,
        output: this.output,
        // Cần webview để quy `url(../Images/…)` trong CSS của controller về URI hợp lệ.
        webview: this.panel.webview,
        bust: this.bust,
      });
    } catch (err) {
      payload = { type: 'error', message: err.message, stack: String(err.stack || '') };
      this.output.appendLine(`render lỗi: ${err.stack || err.message}`);
    }
    if (payload.sourceFiles) this.sourceFiles = payload.sourceFiles;

    /*
     * RENDER CỤC BỘ — chỉ cho gộp/tách ô.
     *
     * Gộp/tách đổi đúng phần pattern của MỘT `<item value>`, nên đúng một `<tr>` đổi theo. Dựng
     * lại cả form cho chuyện đó là ném đi vị trí cuộn, tab đang mở và ô đang chọn — ba thứ người
     * dùng vừa đặt vào đúng chỗ, và là ba thứ họ cần giữ nhất khi đang kéo cho vừa một hàng.
     *
     * Chiều đi của dữ liệu KHÔNG đổi: vẫn là văn bản → core dựng lại model → HTML → webview.
     * Cái rút ngắn chỉ là PHẦN HTML gửi đi. Cho webview tự sửa DOM rồi báo sau mới là chỗ
     * designer và file XML bắt đầu nói hai chuyện khác nhau, và đó thì vẫn cấm.
     *
     * Mọi phép sửa khác vẫn vẽ lại toàn bộ, vì chúng đổi nhiều hơn một hàng:
     *   thêm/xoá control → số hàng đổi, `data-fbo-item` của mọi hàng phía sau chạy hết
     *   chiều cao        → panel của tab đổi, lưới bên trong tính lại
     *   bề rộng          → list px của cả vùng đổi, mọi hàng trong vùng vẽ lại
     */
    const local = this.localEdit;
    this.localEdit = null;
    if (local !== null && local !== undefined && payload.type === 'render') {
      const html = this.core.renderRowHtml(payload.model, local.item);
      if (html) {
        return this.post({
          type: 'patchRow',
          item: local.item,
          cell: local.cell,
          html,
          warnings: payload.warnings,
        });
      }
      this.output.appendLine(`vá cục bộ không được (hàng ${local.item} không còn) — vẽ lại toàn bộ`);
    }

    this.post(payload);
  }

  /**
   * Shell vừa dựng lại thì script chưa chạy — giữ lại payload, gửi khi nó báo `ready`.
   *
   * `model` bị bóc ra trước khi gửi: nó chứa Map và hàm getter nên `postMessage` (structured
   * clone) sẽ NÉM. Model là của phía host, webview không cần và không được cầm nó.
   */
  post(payload) {
    const { model, ...wire } = payload;
    if (!this.ready) { this.pending = wire; return; }
    this.panel.webview.postMessage(wire);
  }

  onMessage(msg) {
    if (msg.type === 'ready') {
      this.ready = true;
      if (this.pending) { this.panel.webview.postMessage(this.pending); this.pending = null; }
      else this.render();
      return;
    }
    if (msg.type === 'select') return revealSource(msg, this.document, this.output);

    // Sửa: dựng lại model từ VĂN BẢN HIỆN TẠI mỗi lần, không dùng lại model của lần render
    // trước — người dùng có thể vừa gõ tay vào XML, và offset cũ đã lệch.
    if (msg.type === 'edit') {
      if (!this.document) return;
      // Đánh dấu TRƯỚC khi sửa: `WorkspaceEdit` làm `onDidChangeTextDocument` bắn, và chính
      // `render()` chạy từ đó mới là chỗ đọc cờ này. Đặt sau là muộn mất một nhịp.
      // Chỉ `resize` (gộp/tách) mới được vá cục bộ — xem `render()`.
      this.localEdit = msg.op === 'resize' ? { item: msg.item, cell: msg.cell } : null;
      // Sửa bị TỪ CHỐI thì không có `onDidChangeTextDocument` nào bắn, và cờ ở lại. Lần render
      // sau — rất có thể do người dùng gõ tay vào XML — sẽ bị gửi đi dưới dạng bản vá một hàng,
      // tức nuốt mất mọi thay đổi khác. Dọn cờ ngay khi biết phép sửa không thành.
      return Promise.resolve(handleEdit(msg, this.core, this.document, () => this.buildNow(), this.output))
        .then((applied) => { if (!applied) this.localEdit = null; })
        .catch((err) => {
          this.localEdit = null;
          this.output.appendLine(`sửa lỗi: ${err.stack || err.message}`);
        });
    }

    // Dựng lại shell với dấu phiên bản mới trên MỌI url — lối thoát khi webview còn giữ bản cũ
    // mà mtime của file không đổi (chép bằng công cụ giữ nguyên timestamp chẳng hạn).
    if (msg.type === 'reloadAssets') {
      this.bust += 1;
      this.output.appendLine(`nạp lại tài nguyên (bust=${this.bust})`);
      return this.render(true);
    }

    if (msg.type === 'assets') {
      this.output.appendLine(`[P0 câu hỏi 2] CSS khai ${msg.declared}, webview nạp được ${msg.loaded}, hỏng ${msg.failed}`);
      for (const href of msg.failedHrefs || []) this.output.appendLine(`  không nạp được: ${href}`);
      return;
    }
    if (msg.type === 'log') this.output.appendLine(String(msg.text));
  }

  dispose() {
    PreviewPanel.current = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

PreviewPanel.current = undefined;

module.exports = { PreviewPanel, VIEW_TYPE };

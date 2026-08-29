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
const { history } = require('./edit-history');
const { OverlayDialogs } = require('./dialog/dialog-overlay');
const { runWithDialogs } = require('./dialog/dialog-service');

const VIEW_TYPE = 'fboDesigner.preview';

/** Xem `renderSoon`. Đủ để gộp cả chùm nhịp của một thao tác, dưới ngưỡng mắt thấy được. */
const RENDER_DEBOUNCE_MS = 40;

class PreviewPanel {
  constructor(context, core, output, panel) {
    this.context = context;
    this.core = core;
    this.output = output;
    this.panel = panel;
    // Hộp thoại của panel NÀY vẽ vào chính webview này, không mở tab riêng — xem `dialog-overlay.js`.
    this.dialogs = new OverlayDialogs(panel.webview);

    this.document = null;      // TextDocument đang vẽ
    this.programKey = null;    // chỉ dựng lại shell khi ĐỔI program, không phải mỗi lần đổi file
    this.paths = null;
    this.ready = false;
    this.pending = null;
    this.sourceFiles = null;   // file đã góp nội dung vào bản vẽ hiện tại (controller + Include)
    this.bust = 0;             // tăng khi người dùng đòi nạp lại tài nguyên (debug mode)
    this.localEdit = null;     // { item, cell } khi lần render tới chỉ cần vá MỘT hàng
    this.renderTimer = null;   // gộp các nhịp đổi văn bản dồn dập — xem `renderSoon`
    this.editing = false;      // đang chạy một phép sửa: hoãn mọi lượt vẽ tới khi nó ngã ngũ
    this.renderPending = false; // có nhịp nào bị hoãn trong lúc ấy không

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
        if (e.document.uri.toString() === this.document.uri.toString()) return this.renderSoon();
        if (e.document.uri.scheme === 'file' && this.contributes(e.document.uri.fsPath)) this.renderSoon();
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
   * VS Code khôi phục panel sau khi mở lại: nối lại event + lifecycle cho webview đã có sẵn.
   */
  static revive(context, core, output, panel) {
    if (PreviewPanel.current) PreviewPanel.current.dispose();
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
    this.panel.webview.html = shellHtml(this.context, this.core, this.panel.webview, stylesheets, this.output, this.bust);

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
      return buildPayload(this.core, this.document, {
        cfg: config(), paths: this.paths, output: this.output, skipHtml: true,
      });
    } catch (err) {
      this.output.appendLine(`dựng model để sửa lỗi: ${err.message}`);
      return null;
    }
  }

  /**
   * GỘP các lần vẽ lại dồn dập vào một — thứ gánh phần lớn cảm giác «render chậm sau khi sửa».
   *
   * Một thao tác của designer làm `onDidChangeTextDocument` bắn NHIỀU LẦN, không phải một:
   * `applyEdit` bắn một nhịp cho mỗi file bị đụng (xoá control kèm khai báo `<field>` là hai),
   * rồi `save()` bắn tiếp nếu VS Code cắt khoảng trắng cuối dòng hay thêm dòng trắng cuối file.
   * Mỗi nhịp trước đây kéo theo một lượt bung entity + dựng lại toàn bộ HTML, và ba lượt như
   * thế thì lượt cuối — lượt duy nhất người dùng nhìn thấy — phải xếp hàng sau hai lượt vô ích.
   *
   * Gõ tay trong XML cũng vậy: từng phím một lượt dựng lại cả form.
   *
   * 40ms là đủ để nuốt cả chùm nhịp của một thao tác mà mắt không nhận ra độ trễ (ngưỡng thấy
   * được của mắt quanh 100ms). Bấm giờ được ĐẶT LẠI mỗi nhịp, nên chùm dài bao nhiêu cũng chỉ
   * ra một lượt vẽ.
   *
   * NHƯNG bấm giờ một mình chỉ là cái lưới thưa: nó gộp được những nhịp rơi GẦN nhau, mà
   * `applyEdit` với `save()` là hai lượt chạm đĩa — chúng có thể cách nhau hơn 40ms trên máy
   * đang bận, và khi ấy lại ra hai lượt vẽ. Nên trong lúc một phép sửa đang chạy, mọi yêu cầu
   * vẽ chỉ được GHI NHẬN chứ không hẹn giờ; `finishEdit` thả ra đúng một lượt sau khi phép sửa
   * đã ngã ngũ. Đó là chốt chắc chắn, không phụ thuộc vào việc đoán đúng con số mili giây.
   *
   * Việc gõ tay trong XML lúc một hộp thoại đang mở cũng bị hoãn theo — đúng chứ không phải tác
   * dụng phụ: vẽ lại giữa chừng một phép sửa là vẽ ra trạng thái nửa vời.
   */
  renderSoon() {
    if (this.editing) { this.renderPending = true; return; }
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, RENDER_DEBOUNCE_MS);
  }

  /**
   * Phép sửa đã ngã ngũ (ghi xong, bị từ chối, hay người dùng bấm Esc) — thả cái vẽ bị hoãn.
   *
   * Không có nhịp nào bị hoãn nghĩa là KHÔNG có gì đổi: phép sửa bị từ chối thì không
   * `onDidChangeTextDocument` nào bắn. Vẽ lại khi ấy là dựng lại y nguyên cái đang có, và
   * dựng lại `innerHTML` thì mất vị trí cuộn với tab đang mở — trả giá cho một thao tác
   * không xảy ra.
   */
  finishEdit() {
    this.editing = false;
    if (!this.renderPending) return;
    this.renderPending = false;
    this.renderSoon();
  }

  render(forceShell = false) {
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
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
          col: local.col,
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
    // `expanded` cũng bị bóc như `model`: nó là bản đã bung cộng bản đồ đoạn, chỉ tầng edit
    // phía host cần. Gửi sang webview là chép cả file qua `postMessage` mỗi lần vẽ, không ai đọc.
    const { model, expanded, ...wire } = payload;
    if (!this.ready) { this.pending = wire; return; }
    this.panel.webview.postMessage(wire);
  }

  onMessage(msg) {
    // Trả lời hộp thoại đi trước mọi thứ: nó là cái đang có một `await` chờ ở đầu kia.
    if (this.dialogs.handleMessage(msg)) return;
    if (msg.type === 'ready') {
      this.ready = true;
      if (this.pending) { this.panel.webview.postMessage(this.pending); this.pending = null; }
      else this.render();
      return;
    }
    if (msg.type === 'select') return revealSource(msg, this.document, this.output);

    /*
     * Ctrl+Z / Ctrl+Y bấm TRONG webview.
     *
     * Undo của VS Code bám vào editor đang active, mà lúc này editor active chính là cái webview
     * — không phải TextEditor nào cả — nên phím tắt của workbench không có gì để bám. Designer
     * giữ chồng hoàn tác riêng cho những phép sửa do chính nó gây ra; xem `edit-history.js`.
     */
    // Cùng chốt `editing` với phép sửa: hoàn tác cũng là `applyEdit` + `save()`, tức cũng đẻ ra
    // nhiều nhịp cho một thao tác — và nó còn chạm NHIỀU FILE hơn, vì nó lùi cả cụm splice.
    if (msg.type === 'undo' || msg.type === 'redo') {
      this.editing = true;
      const stack = history(this.output);
      return runWithDialogs(this.dialogs, () => Promise.resolve(msg.type === 'undo' ? stack.undo() : stack.redo()))
        .catch((err) => this.output.appendLine(`${msg.type} lỗi: ${err.stack || err.message}`))
        .finally(() => this.finishEdit());
    }

    // Sửa: dựng lại model từ VĂN BẢN HIỆN TẠI mỗi lần, không dùng lại model của lần render
    // trước — người dùng có thể vừa gõ tay vào XML, và offset cũ đã lệch.
    if (msg.type === 'edit') {
      if (!this.document) return;
      // Đánh dấu TRƯỚC khi sửa: `WorkspaceEdit` làm `onDidChangeTextDocument` bắn, và chính
      // `render()` chạy từ đó mới là chỗ đọc cờ này. Đặt sau là muộn mất một nhịp.
      // Chỉ `resize` (gộp/tách) mới được vá cục bộ — xem `render()`.
      /*
       * BỐN phép sửa chỉ đụng ĐÚNG MỘT hàng, nên cả bốn vá cục bộ được — không riêng `resize`.
       *
       * `move`, `insert`, `remove` đều chỉ ghi lại `value` của một thẻ `<item>`. Bắt chúng đi
       * đường vẽ lại TOÀN BỘ là nguyên nhân của cái giật: `formLayer.innerHTML = …` dựng lại cả
       * form, nên control còn nằm ở chỗ cũ suốt vòng gửi–ghi–lưu–vẽ rồi mới nhảy sang chỗ mới,
       * kéo theo mất tab đang mở và mất vị trí cuộn.
       *
       * `addRow` thì KHÔNG: nó thêm hẳn một hàng mới, không có hàng cũ nào để mà vá.
       *
       * `col` chỉ có ở `move` — sau khi dời, control nằm ở CỘT khác, nên chọn lại theo cột mới
       * chứ không theo chỉ số ô cũ (chỉ số ô đổi khi ô trống bị ăn mất). `swap` không cần: đổi
       * chỗ giữ nguyên pattern nên mọi chỉ số ô đứng yên.
       */
      /*
       * Shift+Delete thì KHÔNG vá cục bộ, dù `remove` vốn nằm trong danh sách.
       *
       * Nó kéo theo cả cụm: `[x].Label` cùng hàng, nhưng `[x].Description` và `[x].Footer`
       * thường ở HÀNG KHÁC — có khi ở file khác. Vá một hàng khi ba hàng vừa đổi là để lại
       * trên màn hình hai cái nhãn của một control đã không còn tồn tại, và chúng chỉ biến mất
       * ở lần vẽ lại sau đó. Cứ vẽ lại toàn bộ: đằng nào cũng nhiều hàng đổi.
       *
       * (Xoá thường vẫn vá được — hàng biến mất hẳn thì `renderRowHtml` trả null và `render()`
       * tự rơi về vẽ lại toàn bộ.)
       */
      const PATCHABLE = new Set(['resize', 'move', 'swap', 'insert', 'remove']);
      const sameRowMove = msg.op === 'move' || msg.op === 'swap'
        ? !Number.isFinite(Number(msg.toItem)) || Number(msg.toItem) === Number(msg.item)
        : true;
      const patchable = PATCHABLE.has(msg.op)
        && !(msg.op === 'remove' && msg.withField === true)
        && sameRowMove;
      /*
       * `swap` chọn lại ô `other`, KHÔNG phải ô `cell`.
       *
       * Đổi chỗ không đụng tới pattern, nên chỉ số ô của cả hàng y nguyên — chọn theo `cell` là
       * chọn đúng cái slot cũ, và trong slot ấy giờ là control KIA. Người dùng vừa kéo control
       * của họ sang chỗ mới; ô đang chọn phải đi theo nó, không đứng lại chờ.
       */
      this.localEdit = patchable
        ? {
          item: msg.item,
          cell: msg.op === 'swap' ? msg.other : msg.cell,
          col: msg.op === 'move' ? msg.col : undefined,
        }
        : null;
      // Sửa bị TỪ CHỐI thì không có `onDidChangeTextDocument` nào bắn, và cờ ở lại. Lần render
      // sau — rất có thể do người dùng gõ tay vào XML — sẽ bị gửi đi dưới dạng bản vá một hàng,
      // tức nuốt mất mọi thay đổi khác. Dọn cờ ngay khi biết phép sửa không thành.
      //
      // `editing` giữ mọi nhịp vẽ lại cho tới khi phép sửa ngã ngũ — xem `renderSoon`. Một phép
      // sửa chạm hai file là `applyEdit` bắn hai nhịp rồi `save()` bắn tiếp; không có chốt này
      // thì ba lượt dựng lại toàn bộ HTML xếp hàng trước lượt duy nhất người dùng nhìn thấy.
      this.editing = true;
      return runWithDialogs(this.dialogs, () => Promise.resolve(handleEdit(msg, this.core, this.document, () => this.buildNow(), this.output)))
        .then((applied) => { if (!applied) this.localEdit = null; })
        .catch((err) => {
          this.localEdit = null;
          this.output.appendLine(`sửa lỗi: ${err.stack || err.message}`);
        })
        // `finally`: hộp thoại bị Esc, phép sửa bị từ chối, hay handler ném — cả ba đều phải
        // thả chốt ra. Kẹt `editing` ở `true` là preview đứng hình vĩnh viễn, và người dùng
        // không có cách nào nối chuyện đó với cái hộp thoại họ vừa bấm Esc.
        .finally(() => this.finishEdit());
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
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    // Còn hộp thoại đang chờ mà panel chết: thả hết, không thì `await` treo và cờ `editing` kẹt.
    this.dialogs.dispose();
    PreviewPanel.current = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

PreviewPanel.current = undefined;

module.exports = { PreviewPanel, VIEW_TYPE };

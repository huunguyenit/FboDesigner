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
const { handleEdit } = require('./edit-host');
const { history } = require('./edit-history');
const { OverlayDialogs } = require('./dialog/dialog-overlay');
const { runWithDialogs } = require('./dialog/dialog-service');

const VIEW_TYPE = 'fboDesigner.form';

/** Cùng lý do và cùng con số với `PreviewPanel.renderSoon` — xem chú thích ở đó. */
const RENDER_DEBOUNCE_MS = 40;

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
      panel.webview.html = shellHtml(this.context, this.core, panel.webview, stylesheets, this.output, bust);
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
      /*
       * `model` và `expanded` PHẢI bị bóc ra trước khi gửi.
       *
       * `postMessage` của webview đi qua structured clone, mà `model` mang `Map` và cả hàm
       * getter — clone nó là NÉM ngay, và cả bản vẽ không bao giờ tới nơi. Panel đã bóc từ đầu
       * (`PreviewPanel.post`); ở đây thì chưa, nên custom editor gửi đi một payload không clone
       * được. `expanded` thì clone được nhưng vô ích: nó là bản đã bung cộng bản đồ đoạn, chỉ
       * tầng edit phía host cần, và chép cả file qua cầu mỗi lần vẽ là phí thật.
       */
      const local = pendingLocalEdit;
      pendingLocalEdit = null;
      if (local && payload.type === 'render' && payload.model) {
        const rowHtml = this.core.renderRowHtml(payload.model, local.item);
        if (rowHtml) {
          panel.webview.postMessage({
            type: 'patchRow',
            item: local.item,
            cell: local.cell,
            col: local.col,
            html: rowHtml,
            warnings: payload.warnings,
          });
          return;
        }
        this.output.appendLine(`vá cục bộ không được (hàng ${local.item} không còn) — vẽ lại toàn bộ`);
      }

      const { model, expanded, ...wire } = payload;
      panel.webview.postMessage(wire);
    };

    /*
     * Gộp các nhịp đổi văn bản dồn dập vào một lượt vẽ — xem `PreviewPanel.renderSoon` để biết
     * vì sao một thao tác lại đẻ ra nhiều nhịp, và vì sao bấm giờ một mình chưa đủ.
     *
     * `editing` là chốt chắc chắn: trong lúc một phép sửa đang chạy, nhịp vẽ chỉ được GHI NHẬN.
     * `applyEdit` và `save()` là hai lượt chạm đĩa, có thể cách nhau hơn 40ms trên máy đang bận
     * — và khi ấy bấm giờ lại thả ra hai lượt dựng lại toàn bộ HTML.
     */
    let renderTimer = null;
    let editing = false;
    let renderPending = false;
    let pendingLocalEdit = null;
    const renderSoon = () => {
      if (editing) { renderPending = true; return; }
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(() => { renderTimer = null; render(); }, RENDER_DEBOUNCE_MS);
    };
    // Không nhịp nào bị hoãn nghĩa là KHÔNG có gì đổi (phép sửa bị từ chối thì không sự kiện
    // nào bắn) — vẽ lại khi ấy là dựng lại y nguyên cái đang có.
    const finishEdit = () => {
      editing = false;
      if (!renderPending) return;
      renderPending = false;
      renderSoon();
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) renderSoon();
    });
    panel.onDidDispose(() => {
      if (renderTimer) clearTimeout(renderTimer);
      changeSub.dispose();
    });

    // Hộp thoại của panel NÀY vẽ vào chính webview này. Xem `dialog-overlay.js`.
    const overlay = new OverlayDialogs(panel.webview);
    panel.onDidDispose(() => overlay.dispose());

    panel.webview.onDidReceiveMessage(async (msg) => {
      // Trả lời hộp thoại đi trước mọi thứ: nó là cái đang có một `await` chờ ở đầu kia.
      if (overlay.handleMessage(msg)) return;
      if (msg.type === 'ready') return render();
      if (msg.type === 'select') return revealSource(msg, document, this.output);

      // Ctrl+Z / Ctrl+Y bấm trong webview — undo của VS Code không với tới đây. Xem
      // `edit-history.js`; chồng hoàn tác dùng chung với panel, nên hai lối mở không đá nhau.
      //
      // Cùng chốt `editing` với phép sửa: hoàn tác cũng là `applyEdit` + `save()`, và nó còn
      // chạm nhiều file hơn vì nó lùi cả cụm splice một lượt.
      if (msg.type === 'undo' || msg.type === 'redo') {
        editing = true;
        try {
          await runWithDialogs(overlay, () => (msg.type === 'undo'
            ? history(this.output).undo()
            : history(this.output).redo()));
        } catch (err) {
          this.output.appendLine(`${msg.type} lỗi: ${err.stack || err.message}`);
        } finally {
          finishEdit();
        }
        return;
      }

      /*
       * SỬA — nhánh này trước đây KHÔNG có, nên designer gắn cứng vào file chỉ xem được, không
       * kéo thả được: webview vẫn gửi `edit`, còn ở đây không ai nghe.
       *
       * Dựng lại model từ VĂN BẢN HIỆN TẠI mỗi lần, không dùng lại model của lần render trước —
       * người dùng có thể vừa gõ tay vào XML và offset cũ đã lệch. Cùng giao kèo với
       * `PreviewPanel.onMessage`; `handleEdit` là chỗ duy nhất biết luật sửa, hai lối mở chỉ
       * khác nhau ở câu hỏi "document nào".
       *
       * Phép sửa một hàng (resize/move/swap/…) vá cục bộ qua `patchRow` giống panel — giữ
       * scroll/tab; `addRow` và các op đụng nhiều hàng vẫn vẽ lại toàn bộ.
       */
      if (msg.type === 'edit') {
        // rebuild cho plan chỉ cần model — không dựng HTML (~renderHtmlMs trong log perf).
        const rebuild = () => buildPayload(this.core, document, {
          cfg, paths, output: this.output, webview: panel.webview, skipHtml: true,
        });
        /*
         * Vá cục bộ giống PreviewPanel: resize/move/swap/insert/remove cùng hàng không cần
         * thay cả formLayer.innerHTML — giữ scroll/tab và giảm giật sau thả.
         */
        const PATCHABLE = new Set(['resize', 'move', 'swap', 'insert', 'remove']);
        const sameRowMove = msg.op === 'move' || msg.op === 'swap'
          ? !Number.isFinite(Number(msg.toItem)) || Number(msg.toItem) === Number(msg.item)
          : true;
        const patchable = PATCHABLE.has(msg.op)
          && !(msg.op === 'remove' && msg.withField === true)
          && sameRowMove;
        let localEdit = patchable
          ? {
            item: msg.item,
            cell: msg.op === 'swap' ? msg.other : msg.cell,
            col: msg.op === 'move' ? msg.col : undefined,
          }
          : null;

        editing = true;
        try {
          const applied = await runWithDialogs(overlay, () => handleEdit(msg, this.core, document, rebuild, this.output));
          if (!applied) localEdit = null;
          // Gắn localEdit vào render sắp tới qua closure trên renderSoon path:
          if (localEdit) pendingLocalEdit = localEdit;
        } catch (err) {
          localEdit = null;
          pendingLocalEdit = null;
          this.output.appendLine(`sửa lỗi: ${err.stack || err.message}`);
        } finally {
          // Hộp thoại bị Esc, phép sửa bị từ chối, hay handler ném — cả ba đều phải thả chốt.
          // Kẹt `editing` ở `true` là preview đứng hình vĩnh viễn.
          finishEdit();
        }
        return;
      }

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

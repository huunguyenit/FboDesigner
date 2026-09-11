// mail-designer-editor.js — Email Designer: CustomTextEditorProvider `fboDesigner.mail` cho
// `App_Data\Controllers\Options\Message.xml`.
//
// Cùng khuôn `designer-editor.js`, và cùng lý do: file XML CHÍNH LÀ TextDocument, nên dirty state,
// lưu, split view XML ↔ designer là của VS Code. Kiến trúc: `docs/EMAIL-DESIGNER.md`.
//
// Giao kèo với webview (`media/mail-designer.js`), gói trong `core/src/mail-design-contract.mjs`:
//   - webview chỉ gửi Ý ĐỊNH (`edit {op, rev, elementId, …}`), không bao giờ gửi toạ độ;
//   - host dựng lại chỉ mục từ VĂN BẢN HIỆN TẠI mỗi lần sửa, so `rev` + dấu vân tay, rồi mới
//     lập kế hoạch → `applySplice` (một phép = một mục hoàn tác);
//   - đổi document chỉ dẫn tới VẼ LẠI, không bao giờ dẫn tới ghi — nên không có vòng lặp.

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const {
  cachedReadFile, samePath, nonce, assetUri,
} = require('./render-host');
const { applySplice } = require('./edit-host');
const { history } = require('./edit-history');
const { trackDesignerWebview } = require('./designer-webview');
const { toSourcePlan, revealSpan } = require('./mail-apply');
const { ensureLicense, lockedWebviewHtml } = require('./license');
const { t, toast } = require('./locale');

const VIEW_TYPE = 'fboDesigner.mail';

/** Cùng con số và cùng lý do với `PreviewPanel.renderSoon`. */
const RENDER_DEBOUNCE_MS = 40;

const NOT_MAIL = 'Email Designer chỉ mở file khai <message xmlns="urn:schemas-fast-com:data-message">'
  + ' — thường là App_Data\\Controllers\\Options\\Message.xml.';

/**
 * Lựa chọn (action, body, ngôn ngữ) gần nhất THEO FILE — sống suốt phiên, không ghi đĩa. Khác
 * `lastSelection` toàn cục của «Xem mail»: hai chương trình khách mở cạnh nhau không giẫm lên
 * lựa chọn của nhau.
 */
const lastSelection = new Map();

/**
 * Shell riêng: KHÔNG nạp CSS form FBO (base pack, CSS program) như `render-host.js#shellHtml` — mẫu
 * mail tự mang `<style>` của nó và vẽ trong iframe cô lập. CSP: script chỉ theo nonce; ảnh
 * https/http/data vì mẫu thật trỏ logo ra ngoài; iframe srcdoc kế thừa đúng CSP này.
 */
function mailShellHtml(context, webview) {
  const n = nonce();
  const media = path.join(context.extensionUri.fsPath, 'media');
  const css = assetUri(webview, path.join(media, 'mail-designer.css'));
  const js = assetUri(webview, path.join(media, 'mail-designer.js'));
  const body = fs.readFileSync(path.join(media, 'mail-shell.html'), 'utf8');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: http: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${n}'; frame-src 'self'; child-src 'self';">
<link rel="stylesheet" href="${css}">
</head>
<body>
${body}
<script nonce="${n}" src="${js}"></script>
</body>
</html>`;
}

/**
 * Đọc Include ưu tiên bản ĐANG MỞ trong VS Code. `applySplice` lưu nền SAU khi vẽ lại, nên đọc
 * đĩa ngay lúc ấy là đọc bản cũ của file Include vừa sửa — designer vẽ lại y như chưa sửa.
 */
function liveReadFile(core) {
  const disk = cachedReadFile(core);
  return (abs) => {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, abs));
    return open ? open.getText() : disk(abs);
  };
}

const warn = (reason) => vscode.window.showWarningMessage(`FBO Designer: ${reason}`);

class MailDesignSession {
  constructor(core, output, document, panel) {
    this.core = core;
    this.output = output;
    this.document = document;
    this.panel = panel;
    this.key = document.uri.fsPath.toLowerCase();
    this.selection = lastSelection.get(this.key) ?? { actionId: null, body: null, lang: 'vi' };
    this.rev = 0;
    this.rendered = null;       // { rev, fingerprints: Map<id, fingerprint> } của lần vẽ gần nhất
    this.sourceFiles = [];      // mọi file góp nội dung vào lần vẽ gần nhất (Message.xml + Include)
    this.selectAfter = null;    // id webview nên chọn lại sau phép sửa đang chạy
    this.renderTimer = null;
    this.editing = false;
    this.renderPending = false;
    this.disposed = false;

    this.disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        const p = e.document.uri.fsPath;
        if (samePath(p, document.uri.fsPath) || this.sourceFiles.some((f) => samePath(f, p))) this.renderSoon();
      }),
    ];
    panel.onDidDispose(() => this.dispose());
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
  }

  /** Dựng lại mọi thứ từ VĂN BẢN HIỆN TẠI — vẽ và sửa cùng đi qua đây, không giữ model cũ. */
  build() {
    const text = this.document.getText();
    if (!this.core.isMailTemplateDoc(text)) return { ok: false, idle: NOT_MAIL };

    const expanded = this.core.expandEntities(text, { filePath: this.document.uri.fsPath, readFile: liveReadFile(this.core) });
    const actions = this.core.scanMailActions(expanded.clearText);
    if (actions.length === 0) return { ok: false, idle: 'Không có mẫu mail nào trong <mail><template> của file này.' };

    // Lựa chọn cũ có thể đã hết hợp lệ (file đổi) — rơi về action/body đầu, không báo lỗi.
    const action = actions.find((a) => a.id === this.selection.actionId) ?? actions[0];
    const body = action.bodies.includes(this.selection.body) ? this.selection.body : action.bodies[0];
    this.selection = { actionId: action.id, body, lang: this.selection.lang === 'en' ? 'en' : 'vi' };
    lastSelection.set(this.key, this.selection);

    const view = this.core.buildMailView(expanded.clearText, expanded.segments, { actionId: action.id, body });
    if (!view.ok) return { ok: false, error: view.reason };
    return {
      ok: true, expanded, actions, view, index: this.core.indexMailElements(view),
    };
  }

  render() {
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    if (this.disposed) return;
    let built;
    try {
      built = this.build();
    } catch (err) {
      this.output.appendLine(`email designer: dựng lỗi — ${err.stack || err.message}`);
      this.post({ type: 'error', message: err.message });
      return;
    }
    if (!built.ok) {
      this.rendered = null;
      this.post(built.idle ? { type: 'idle', message: built.idle } : { type: 'error', message: built.error });
      return;
    }

    const {
      expanded, actions, view, index,
    } = built;
    this.sourceFiles = [...new Set(expanded.segments.map((s) => s.file))];
    this.rev += 1;
    this.rendered = { rev: this.rev, fingerprints: new Map(index.elements.map((e) => [e.id, e.fingerprint])) };
    for (const w of index.warnings) this.output.appendLine(`email designer: ${w}`);

    const selectId = this.selectAfter;
    this.selectAfter = null;
    const labels = this.core.mailActionLabels(expanded.clearText, view.actionId);
    this.post({
      type: 'render',
      rev: this.rev,
      file: path.basename(this.document.uri.fsPath),
      template: { ...this.selection },
      actions: actions.map((a) => ({ id: a.id, label: a.v || a.e || a.id, bodies: a.bodies })),
      html: this.core.renderMailDesign(view, index, { labels, vi: this.selection.lang !== 'en' }),
      elements: this.core.wireMailElements(view, index),
      // Danh sách thuộc tính cho sửa đi KÈM bản vẽ — webview không chép lại whitelist của hợp đồng.
      styleProperties: this.core.STYLE_PROPERTIES,
      selectId,
      warnings: index.warnings,
    });
  }

  post(msg) {
    Promise.resolve(this.panel.webview.postMessage(msg)).catch(() => {});
  }

  /** Gộp các nhịp đổi văn bản dồn dập — xem `PreviewPanel.renderSoon`. */
  renderSoon() {
    if (this.editing) { this.renderPending = true; return; }
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.render(); }, RENDER_DEBOUNCE_MS);
  }

  finishEdit() {
    this.editing = false;
    if (!this.renderPending) return;
    this.renderPending = false;
    this.renderSoon();
  }

  /** Mọi phép chạm file (sửa, hoàn tác) đi trong chốt — hộp thoại bị Esc hay handler ném cũng phải thả. */
  async runEdit(fn) {
    this.editing = true;
    try {
      return await fn();
    } catch (err) {
      this.output.appendLine(`email designer: sửa lỗi — ${err.stack || err.message}`);
      return false;
    } finally {
      this.finishEdit();
    }
  }

  async onMessage(raw) {
    const checked = this.core.validateMailMessage(raw);
    if (!checked.ok) {
      this.output.appendLine(`email designer: bỏ thông điệp — ${checked.reason}`);
      return undefined;
    }
    const msg = checked.message;
    switch (msg.type) {
      case 'ready':
        return this.render();
      case 'log':
        return this.output.appendLine(`email designer (webview): ${msg.text}`);
      case 'selection':
        this.selection = { actionId: msg.actionId, body: msg.body, lang: msg.lang };
        lastSelection.set(this.key, this.selection);
        return this.render();
      case 'gotoSource':
        return this.revealSection(msg.section);
      case 'select':
        return msg.reveal ? this.revealElement(msg) : undefined;
      case 'undo':
      case 'redo':
        // Ctrl+Z trong webview — undo của VS Code không với tới đây. Chồng dùng chung với designer form.
        return this.runEdit(() => history(this.output)[msg.type]());
      case 'edit':
        return this.runEdit(() => this.applyEdit(msg));
      default:
        return undefined;
    }
  }

  async applyEdit(msg) {
    if (!this.rendered || msg.rev !== this.rendered.rev) {
      warn('bản vẽ đã cũ so với file — đã vẽ lại, thao tác lại giúp.');
      this.renderPending = true;
      return false;
    }
    const planner = { setText: this.core.planMailText, setStyle: this.core.planMailStyle }[msg.op];
    if (!planner) {
      warn(`"${msg.op}" chưa hỗ trợ ở bản này của Email Designer.`);
      return false;
    }

    const built = this.build();
    if (!built.ok) { warn(built.idle || built.error); return false; }

    const fingerprint = this.rendered.fingerprints.get(msg.elementId) ?? '';
    const plan = planner(built.view, built.index, { ...msg, fingerprint });
    if (!plan.ok) {
      if (!plan.noop) { warn(plan.reason); this.renderPending = true; }
      return false;
    }
    const mapped = toSourcePlan(this.core, built.expanded.segments, plan, this.document.uri.fsPath);
    if (!mapped.ok) { warn(mapped.reason); return false; }

    this.selectAfter = msg.elementId;
    const wrote = await applySplice({ edits: mapped.edits, warning: mapped.foreignFile }, this.document, this.output, plan.label);
    if (!wrote) this.selectAfter = null;
    return wrote;
  }

  async revealElement(msg) {
    if (!this.rendered || msg.rev !== this.rendered.rev) return;
    const built = this.build();
    if (!built.ok) return;
    const r = this.core.resolveMailElement(built.index, msg.elementId, this.rendered.fingerprints.get(msg.elementId));
    if (!r.ok) { warn(r.reason); return; }
    const range = this.core.mailElementClearRange(built.view, r.element);
    const src = range && this.core.sourceRange(built.expanded.segments, range.start, range.end);
    if (!src) return;
    await this.reveal(src);
  }

  async revealSection(section) {
    const built = this.build();
    if (!built.ok) return;
    const { actionId, body } = this.selection;
    const loc = this.core.locateMailSection(built.expanded.clearText, { actionId, body, section });
    if (!loc) { warn(`"${actionId}" · <${body}> không có <${section}>.`); return; }
    const src = this.core.sourceRange(built.expanded.segments, loc.start, loc.end);
    if (src) await this.reveal(src);
  }

  async reveal(src) {
    try {
      await revealSpan(src.file, src.start, src.end);
    } catch (err) {
      this.output.appendLine(`email designer: đi tới XML lỗi — ${err.message}`);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

class MailDesignerProvider {
  constructor(context, core, output) {
    this.context = context;
    this.core = core;
    this.output = output;
  }

  static register(context, core, output) {
    return vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new MailDesignerProvider(context, core, output),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true },
    );
  }

  /** Trả về session — chỉ test đọc giá trị này; VS Code bỏ qua. */
  async resolveCustomTextEditor(document, panel) {
    const status = await ensureLicense(this.context, { silent: true });
    if (!status) {
      panel.webview.options = { enableScripts: false };
      panel.webview.html = lockedWebviewHtml(t('extension.license_locked_html'));
      return null;
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionUri.fsPath, 'media'))],
    };
    trackDesignerWebview(panel.webview, panel);
    const session = new MailDesignSession(this.core, this.output, document, panel);
    panel.webview.html = mailShellHtml(this.context, panel.webview);
    return session;
  }
}

/** Lệnh «Mở Email Designer» — mở file đang active bằng editor này, bên cạnh XML. */
async function openMailDesigner(core) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) {
    vscode.window.showWarningMessage(toast('extension.no_file'));
    return;
  }
  if (!core.isMailTemplateDoc(document.getText())) {
    warn(NOT_MAIL);
    return;
  }
  await vscode.commands.executeCommand('vscode.openWith', document.uri, VIEW_TYPE, vscode.ViewColumn.Beside);
}

/** Chỉ dùng cho test: mỗi kịch bản bắt đầu từ "chưa nhớ lựa chọn nào". */
function resetForTests() {
  lastSelection.clear();
}

module.exports = {
  MailDesignerProvider, MailDesignSession, openMailDesigner, VIEW_TYPE, resetForTests,
};

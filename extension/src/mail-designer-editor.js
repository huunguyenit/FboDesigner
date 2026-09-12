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
  cachedReadFile, samePath, nonce, assetUri, config,
} = require('./render-host');
const { applySplice } = require('./edit-host');
const { dialogs, runWithDialogs } = require('./dialog/dialog-service');
const { OverlayDialogs } = require('./dialog/dialog-overlay');
const { history } = require('./edit-history');
const { trackDesignerWebview } = require('./designer-webview');
const { toSourcePlan, revealSpan } = require('./mail-apply');
const { ensureLicense, lockedWebviewHtml } = require('./license');
const { t, toast } = require('./locale');
const { loadMailSample } = require('./mail-sample-host');

const VIEW_TYPE = 'fboDesigner.mail';

/** Cùng con số và cùng lý do với `PreviewPanel.renderSoon`. */
const RENDER_DEBOUNCE_MS = 40;

/** Gộp nhịp đổi vùng chọn XML (gõ phím, kéo chuột) trước khi đồng bộ sang designer. */
const SELECTION_DEBOUNCE_MS = 80;

/** Một lượt vẽ lâu hơn ngưỡng này thì ghi ra Output — đủ để thấy mẫu nào nặng mà không làm rối log thường. */
const SLOW_RENDER_MS = 300;

const NOT_MAIL = 'Email Designer chỉ mở file khai <message xmlns="urn:schemas-fast-com:data-message">'
  + ' — thường là App_Data\\Controllers\\Options\\Message.xml.';

/**
 * Lựa chọn (action, body, ngôn ngữ) gần nhất THEO FILE — sống suốt phiên, không ghi đĩa. Khác
 * `lastSelection` toàn cục của «Xem mail»: hai chương trình khách mở cạnh nhau không giẫm lên
 * lựa chọn của nhau.
 */
const lastSelection = new Map();

/** Chế độ hiện biến (`PREVIEW_MODES`) gần nhất THEO FILE — sống suốt phiên. */
const lastPreview = new Map();

/** «Bám XML» bật/tắt THEO FILE — sống suốt phiên, mặc định bật. */
const lastFollow = new Map();

/**
 * Dữ liệu mẫu khi không có `workspaceState` (chạy test). Bản thật sống ở workspace state của VS Code:
 * theo workspace, không vào repo, và TUYỆT ĐỐI không vào Message.xml — dữ liệu mẫu chỉ để xem.
 */
const memorySamples = new Map();

/** `stt_rec` / `contactID` gần nhất THEO FILE × ACTION — nhớ để lần sau khỏi gõ lại. */
const memorySampleKeys = new Map();

/**
 * Shell riêng: KHÔNG nạp CSS form FBO (base pack, CSS program) như `render-host.js#shellHtml` — mẫu
 * mail tự mang `<style>` của nó và vẽ trong iframe cô lập. CSP: script chỉ theo nonce; ảnh
 * https/http/data vì mẫu thật trỏ logo ra ngoài; iframe srcdoc kế thừa đúng CSP này.
 */
function mailShellHtml(context, webview) {
  const n = nonce();
  const media = path.join(context.extensionUri.fsPath, 'media');
  const css = assetUri(webview, path.join(media, 'mail-designer.css'));
  const dialogKitJs = assetUri(webview, path.join(media, 'dialog-kit.js'));
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
<script nonce="${n}" src="${dialogKitJs}"></script>
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

/** Dải clearText của thẻ mở một phần tử trên bản vẽ gần nhất. */
const elementRange = (core, built, elementId) => {
  const el = built.index.byId.get(elementId);
  return el ? core.mailElementClearRange(built.view, el) : null;
};

class MailDesignSession {
  constructor(core, output, document, panel, store = null) {
    this.core = core;
    this.output = output;
    this.document = document;
    this.panel = panel;
    this.store = store && typeof store.get === 'function' && typeof store.update === 'function' ? store : null;
    this.key = document.uri.fsPath.toLowerCase();
    this.selection = lastSelection.get(this.key) ?? { actionId: null, body: null, lang: 'vi' };
    this.previewMode = lastPreview.get(this.key) ?? 'label';
    this.rev = 0;
    this.rendered = null;       // { rev, fingerprints: Map<id, fingerprint> } của lần vẽ gần nhất
    this.sourceFiles = [];      // mọi file góp nội dung vào lần vẽ gần nhất (Message.xml + Include)
    this.selectAfter = null;    // id webview nên chọn lại sau phép sửa đang chạy
    this.renderTimer = null;
    this.editing = false;
    this.renderPending = false;
    this.disposed = false;
    this.follow = lastFollow.get(this.key) ?? true;
    this.selectedId = null;      // phần tử webview đang chọn — đồng bộ trúng chính nó thì không gửi gì
    this.lastBuilt = null;       // { view, index, segments, version } của lần vẽ gần nhất — cho «Bám XML»
    this.syncingEditor = false;  // đang đặt vùng chọn XML hộ designer → bỏ sự kiện đổi vùng chọn nó sinh ra
    this.selectionTimer = null;
    this.watchers = [];          // watcher trên đĩa cho file Include (xem `watchSources`)
    this.watchKey = '';
    this.fullPreview = false;    // bản xem trước đầy đủ, chỉ đọc (Phase 8)
    this.expandCache = null;     // { text, stamp, expanded } — xem `expandCached`
    // Hộp thoại vẽ trong CHÍNH webview này — không mở tab DialogPanel riêng.
    this.dialogs = new OverlayDialogs(panel.webview);

    this.disposables = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        const p = e.document.uri.fsPath;
        if (samePath(p, document.uri.fsPath) || this.sourceFiles.some((f) => samePath(f, p))) this.renderSoon();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => this.onEditorSelectionSoon(e)),
    ];
    panel.onDidDispose(() => this.dispose());
    panel.webview.onDidReceiveMessage((msg) => {
      if (this.dialogs.handleMessage(msg)) return undefined;
      return this.onMessage(msg);
    });
  }

  /** Dựng lại mọi thứ từ VĂN BẢN HIỆN TẠI — vẽ và sửa cùng đi qua đây, không giữ model cũ. */
  build() {
    const text = this.document.getText();
    if (!this.core.isMailTemplateDoc(text)) return { ok: false, idle: NOT_MAIL };

    const expanded = this.expandCached(text);
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

  /**
   * Bung entity có NHỚ. Phần lớn lượt vẽ không đổi văn bản nào — đổi chế độ hiện biến, đổi biến thể, bật
   * xem trước, chọn lại sau phép sửa bị từ chối — mà bung lại Message.xml (hàng trăm KB) cùng cây Include
   * mỗi lần là phí thật. Khoá = văn bản Message.xml + dấu của mọi file Include lần bung trước đã đọc
   * (đang mở: version; trên đĩa: mtime + size) — đổi bất cứ file nào góp nội dung là bung lại.
   */
  expandCached(text) {
    if (this.expandCache && this.expandCache.text === text && this.expandCache.stamp === this.sourceStamp(this.expandCache.expanded)) {
      return this.expandCache.expanded;
    }
    const expanded = this.core.expandEntities(text, { filePath: this.document.uri.fsPath, readFile: liveReadFile(this.core) });
    this.expandCache = { text, expanded, stamp: this.sourceStamp(expanded) };
    return expanded;
  }

  sourceStamp(expanded) {
    const files = [...new Set(expanded.segments.map((s) => s.file))].filter((f) => !samePath(f, this.document.uri.fsPath));
    return files.map((file) => {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, file));
      if (open) return `${file}#v${open.version}`;
      try {
        const st = fs.statSync(file);
        return `${file}#${st.mtimeMs}:${st.size}`;
      } catch {
        return `${file}#missing`;
      }
    }).join('|');
  }

  /**
   * Vẽ, không bao giờ ném: lượt vẽ còn chạy từ bộ hẹn giờ (`renderSoon`) và từ watcher — lỗi ở đó không có
   * ai bắt, và một lỗi lọt ra là designer đứng hình không một lời giải thích. Lỗi → khung báo lỗi + Output.
   */
  render() {
    const started = Date.now();
    try {
      this.renderUnsafe();
    } catch (err) {
      this.output.appendLine(`email designer: vẽ lỗi — ${err.stack || err.message}`);
      this.post({ type: 'error', message: `Không vẽ được mẫu: ${err.message}` });
    }
    const ms = Date.now() - started;
    if (ms > SLOW_RENDER_MS) this.output.appendLine(`email designer: vẽ chậm ${ms}ms — ${this.document.uri.fsPath}`);
  }

  renderUnsafe() {
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
    this.watchSources();
    this.rev += 1;
    this.rendered = { rev: this.rev, fingerprints: new Map(index.elements.map((e) => [e.id, e.fingerprint])) };
    this.lastBuilt = {
      view, index, segments: expanded.segments, clearText: expanded.clearText, version: this.document.version,
    };
    for (const w of index.warnings) this.output.appendLine(`email designer: ${w}`);

    const selectId = this.selectAfter;
    this.selectAfter = null;
    const labels = this.core.mailActionLabels(expanded.clearText, view.actionId);
    const variables = this.core.mailVariables(view, index, labels);
    const tables = this.core.mailTableContext(view, index, expanded.clearText, { actionId: view.actionId, body: view.body });
    const sampleText = this.readSampleText(view.actionId);
    const parsedSample = this.core.parseMailSample(sampleText);
    this.post({
      type: 'render',
      rev: this.rev,
      file: path.basename(this.document.uri.fsPath),
      template: { ...this.selection },
      actions: actions.map((a) => ({ id: a.id, label: a.v || a.e || a.id, bodies: a.bodies })),
      html: (this.fullPreview ? this.core.renderMailFullPreview : this.core.renderMailDesign)(view, index, {
        labels,
        vi: this.selection.lang !== 'en',
        mode: this.previewMode,
        sample: parsedSample.ok ? parsedSample.data : null,
      }),
      // Xem trước là CHỈ ĐỌC: không gửi phần tử nào — webview không có gì để chọn, kéo hay sửa.
      elements: this.fullPreview ? [] : this.core.wireMailElements(view, index).map((w) => ({ ...w, table: tables[w.id] ?? null })),
      fullPreview: this.fullPreview,
      issues: this.core.lintMailHtml(view, index),
      // Danh sách thuộc tính cho sửa đi KÈM bản vẽ — webview không chép lại whitelist của hợp đồng.
      styleProperties: this.core.STYLE_PROPERTIES,
      componentPanels: this.core.COMPONENT_PANELS,
      attributeEnums: this.core.ATTRIBUTE_ENUMS,
      components: this.core.INSERTABLE_COMPONENTS,
      preview: { mode: this.previewMode },
      variables,
      sample: {
        text: sampleText,
        skeleton: JSON.stringify(this.core.sampleSkeleton(variables), null, 2),
        keys: this.readSampleKeys(view.actionId),
      },
      follow: this.follow,
      selectId,
      warnings: index.warnings,
    });
  }

  post(msg) {
    Promise.resolve(this.panel.webview.postMessage(msg)).catch(() => {});
  }

  /** Khoá dữ liệu mẫu: theo FILE × ACTION — mỗi mẫu mail có bộ cột dữ liệu riêng. */
  sampleKey(actionId) {
    return `fboDesigner.mailSample:${this.key}:${actionId}`;
  }

  sampleKeysKey(actionId) {
    return `fboDesigner.mailSampleKeys:${this.key}:${actionId}`;
  }

  readSampleText(actionId) {
    const key = this.sampleKey(actionId);
    const value = this.store ? this.store.get(key) : memorySamples.get(key);
    return typeof value === 'string' ? value : '';
  }

  async writeSampleText(actionId, text) {
    const key = this.sampleKey(actionId);
    if (this.store) await this.store.update(key, text === '' ? undefined : text);
    else if (text === '') memorySamples.delete(key);
    else memorySamples.set(key, text);
  }

  readSampleKeys(actionId) {
    const key = this.sampleKeysKey(actionId);
    const value = this.store ? this.store.get(key) : memorySampleKeys.get(key);
    if (!value || typeof value !== 'object') return { stt_rec: '', contactID: '' };
    return {
      stt_rec: typeof value.stt_rec === 'string' ? value.stt_rec : '',
      contactID: typeof value.contactID === 'string' ? value.contactID : '',
    };
  }

  async writeSampleKeys(actionId, keys) {
    const key = this.sampleKeysKey(actionId);
    const next = {
      stt_rec: String(keys?.stt_rec ?? ''),
      contactID: String(keys?.contactID ?? ''),
    };
    if (this.store) await this.store.update(key, next);
    else memorySampleKeys.set(key, next);
  }

  /**
   * Dữ liệu mẫu người dùng gõ: kiểm hình dạng ở core, lưu dạng JSON đã chuẩn hoá, bật chế độ xem dữ liệu
   * mẫu và vẽ lại. Sai thì trả lý do về webview (không toast — người dùng đang nhìn đúng ô nhập ấy).
   */
  async applySample(text) {
    const parsed = this.core.parseMailSample(text);
    if (!parsed.ok) {
      this.post({ type: 'sampleError', reason: parsed.reason });
      return false;
    }
    const { actionId } = this.selection;
    if (!actionId) return false;
    const normalized = Object.keys(parsed.data).length === 0 ? '' : JSON.stringify(parsed.data, null, 2);
    await this.writeSampleText(actionId, normalized);
    if (normalized !== '') {
      this.previewMode = 'sample';
      lastPreview.set(this.key, 'sample');
      this.fullPreview = true;
      this.selectedId = null;
    }
    this.render();
    return true;
  }

  /**
   * Lấy dữ liệu mẫu THẬT từ DB theo `stt_rec` + `contactID` — hỏi xác nhận, chạy SQL, đổ vào
   * cùng kho JSON mẫu rồi bật xem trước.
   */
  async loadSampleFromDb(msg) {
    const { actionId } = this.selection;
    if (!actionId) {
      this.post({ type: 'sampleError', reason: 'chưa chọn mẫu mail (action)' });
      return false;
    }
    await this.writeSampleKeys(actionId, { stt_rec: msg.stt_rec, contactID: msg.contactID });

    const built = this.build();
    if (!built.ok) {
      this.post({ type: 'sampleError', reason: built.error || built.idle || 'không đọc được mẫu mail' });
      return false;
    }

    const result = await loadMailSample(this.core, this.output, this.document, {
      actionId,
      stt_rec: msg.stt_rec,
      contactID: msg.contactID,
      clearText: built.expanded.clearText,
    });
    if (!result.ok) {
      if (!result.cancelled) this.post({ type: 'sampleError', reason: result.reason });
      return false;
    }
    return this.applySample(JSON.stringify(result.data, null, 2));
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
    try {
      // Mọi dialogs() trong chuỗi này (xoá phần tử, lấy dữ liệu mẫu…) dùng overlay của panel này.
      return await runWithDialogs(this.dialogs, () => this.dispatch(msg));
    } catch (err) {
      // Một thao tác hỏng không được làm designer im lặng: ghi đủ ra Output, báo người dùng chỗ xem.
      this.output.appendLine(`email designer: xử lý "${msg.type}${msg.op ? `/${msg.op}` : ''}" lỗi — ${err.stack || err.message}`);
      warn('thao tác không thực hiện được do lỗi nội bộ — chi tiết ở Output «FBO Designer».');
      return undefined;
    }
  }

  async dispatch(msg) {
    switch (msg.type) {
      case 'ready':
        return this.render();
      case 'log':
        return this.output.appendLine(`email designer (webview): ${msg.text}`);
      case 'selection': {
        const before = this.selection.actionId;
        this.selection = { actionId: msg.actionId, body: msg.body, lang: msg.lang };
        lastSelection.set(this.key, this.selection);
        if (before !== msg.actionId) this.selectedId = null;
        this.render();
        // Đổi MẪU trên designer thì XML đang mở nhảy tới đúng `<action id>` ấy — cùng cử chỉ «Bám XML»
        // như chọn phần tử: không mở tab, không giành focus.
        if (before !== msg.actionId) await this.followActionInEditor(msg.actionId);
        return undefined;
      }
      case 'gotoSource':
        return this.revealSection(msg.section);
      case 'setPreview':
        this.previewMode = msg.mode;
        lastPreview.set(this.key, msg.mode);
        // "Dữ liệu mẫu" = xem mẫu như thư thật: nhân dòng detail, bỏ dấu phần tử, chỉ đọc.
        this.fullPreview = msg.mode === 'sample';
        if (this.fullPreview) this.selectedId = null;
        return this.render();
      case 'setSampleData':
        return this.applySample(msg.text);
      case 'loadMailSample':
        return this.loadSampleFromDb(msg);
      case 'select':
        this.selectedId = msg.elementId;
        return msg.reveal ? await this.revealElement(msg) : await this.followInEditor(msg);
      case 'setFollow':
        this.follow = msg.on;
        lastFollow.set(this.key, msg.on);
        return undefined;
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
    // Bản xem trước không mang phần tử — một phép sửa lọt tới đây là trỏ vào id của bản vẽ trước đó.
    if (this.fullPreview) {
      warn('đang xem trước theo dữ liệu mẫu (chỉ đọc) — chọn «Biến: nhãn» hoặc «Biến: {!tên}» để sửa.');
      return false;
    }
    if (!this.rendered || msg.rev !== this.rendered.rev) {
      warn('bản vẽ đã cũ so với file — đã vẽ lại, thao tác lại giúp.');
      this.renderPending = true;
      return false;
    }
    const built = this.build();
    if (!built.ok) { warn(built.idle || built.error); return false; }

    // Phép bảng của «Xem mail» nhận (action, body) + SỐ THỨ TỰ cột/dòng, không nhận phần tử — bọc lại cho
    // cùng hình dạng với các kế hoạch khác và gắn nhãn hoàn tác. Luật cột/dòng vẫn của `mail-template.mjs`.
    const { actionId, body } = this.selection;
    const { clearText } = built.expanded;
    const labelled = (plan, label) => (plan.ok ? { ...plan, label } : plan);
    const planner = {
      setText: this.core.planMailText,
      setStyle: this.core.planMailStyle,
      setAttr: this.core.planMailAttr,
      removeElement: this.core.planMailRemove,
      moveElement: this.core.planMailMove,
      insertComponent: this.core.planMailInsert,
      wrapLink: this.core.planMailWrapLink,
      resizeColumn: (_view, _index, m) => labelled(
        this.core.planResizeMailColumn(clearText, {
          actionId, body, columnIndex: m.columnIndex, width: m.width,
        }),
        `mail: bề rộng cột ${m.columnIndex + 1} → ${m.width}px`,
      ),
      addColumn: (_view, _index, m) => labelled(
        this.core.planAddMailColumn(clearText, { actionId, body, columnIndex: m.columnIndex }),
        `mail: nhân bản cột ${m.columnIndex + 1}`,
      ),
      addRow: (_view, _index, m) => labelled(
        this.core.planAddMailRow(clearText, {
          actionId, body, section: m.part, rowIndex: m.rowIndex,
        }),
        `mail: nhân bản dòng ${m.rowIndex + 1} <${m.part}>`,
      ),
    }[msg.op];
    if (!planner) {
      warn(`"${msg.op}" chưa hỗ trợ ở bản này của Email Designer.`);
      return false;
    }

    // Kéo thả chạm HAI phần tử — đích cũng phải đúng là cái webview đã thấy, không riêng phần tử kéo.
    if (msg.targetId) {
      const expected = this.rendered.fingerprints.get(msg.targetId);
      if (!expected || built.index.byId.get(msg.targetId)?.fingerprint !== expected) {
        warn(`không còn phần tử đích ${msg.targetId} như lúc vẽ — thả lại giúp.`);
        this.renderPending = true;
        return false;
      }
    }

    const fingerprint = this.rendered.fingerprints.get(msg.elementId) ?? '';
    const plan = planner(built.view, built.index, { ...msg, fingerprint });
    if (!plan.ok) {
      if (!plan.noop) { warn(plan.reason); this.renderPending = true; }
      return false;
    }
    const mapped = toSourcePlan(this.core, built.expanded.segments, plan, this.document.uri.fsPath);
    if (!mapped.ok) { warn(mapped.reason); return false; }

    // Cùng thiết lập và cùng hình dạng hộp thoại với phép xoá control của designer form (`edit-host.js`).
    if (msg.op === 'removeElement' && config().confirmDelete) {
      const answer = await dialogs().ask({
        type: 'warning',
        title: `Xoá ${plan.label.replace(/^mail: xoá /, '')}?`,
        size: 'small',
        body: [{ type: 'text', content: 'Xoá cả phần tử lẫn mọi thứ nằm bên trong nó. Ctrl+Z trong designer để hoàn tác.' }],
        buttons: [
          { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
          { id: 'delete', label: t('dialog.btn.delete'), variant: 'danger', action: 'confirm' },
        ],
      });
      if (answer !== 'delete') return false;
    }

    // Phép cấu trúc làm dồn số id — plan tính sẵn id MỚI của phần tử người dùng đang cầm.
    // Phép bảng không mang phần tử: id của thứ đang chọn (ô/dòng gốc) không dồn số — webview giữ lựa chọn.
    this.selectAfter = plan.selectId !== undefined ? plan.selectId : (msg.elementId ?? null);
    const wrote = await applySplice({ edits: mapped.edits, warning: mapped.foreignFile }, this.document, this.output, plan.label);
    if (!wrote) this.selectAfter = null;
    // Việc người dùng phải tự kiểm sau khi ghi (vd footer không có colspan để tự tăng theo cột mới).
    if (wrote) for (const note of plan.notes ?? []) vscode.window.showInformationMessage(`FBO Designer: ${note}`);
    return wrote;
  }

  /** Gộp nhịp đổi vùng chọn XML dồn dập vào một lần đồng bộ. */
  onEditorSelectionSoon(e) {
    if (!this.follow || this.syncingEditor || this.disposed) return;
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => { this.selectionTimer = null; this.onEditorSelection(e); }, SELECTION_DEBOUNCE_MS);
  }

  /**
   * Code → Designer: con trỏ XML vào một phần tử thì designer chọn nó.
   *
   * Chống vòng lặp bằng hai chốt độc lập: webview chọn theo `reveal` mà KHÔNG gửi `select` ngược lại; và
   * con trỏ rơi đúng phần tử đang chọn thì không gửi gì. Văn bản đã đổi mà chưa kịp vẽ lại → toạ độ của
   * lần vẽ cũ không còn đúng, bỏ qua — lượt vẽ tới đang tới.
   */
  onEditorSelection(e) {
    const built = this.lastBuilt;
    if (!this.follow || this.syncingEditor || !built || !this.rendered || this.disposed) return;
    const doc = e.textEditor && e.textEditor.document;
    if (!doc || doc.uri.scheme !== 'file') return;
    const file = doc.uri.fsPath;
    const isHost = samePath(file, this.document.uri.fsPath);
    if (!isHost && !this.sourceFiles.some((f) => samePath(f, file))) return;
    if (isHost && doc.version !== built.version) return;
    const selection = e.selections && e.selections[0];
    if (!selection) return;
    const offset = doc.offsetAt(selection.active);

    // Con trỏ nhảy sang mẫu/biến thể KHÁC: đổi mẫu đang vẽ theo XML rồi mới chọn phần tử trên bản vẽ
    // mới. Bản vẽ cũ không có phần tử nào ứng với vị trí ấy, nên không đổi mẫu là không đồng bộ được.
    const loc = this.core.mailLocationAtSource(built.clearText, built.segments, file, offset);
    if (loc && (loc.actionId !== this.selection.actionId || loc.body !== this.selection.body)) {
      this.selection = { ...this.selection, actionId: loc.actionId, body: loc.body };
      lastSelection.set(this.key, this.selection);
      this.selectedId = null;
      this.render();
      const now = this.lastBuilt;
      const moved = now && this.core.mailElementAtSource(now.view, now.index, now.segments, file, offset);
      if (moved) {
        this.selectedId = moved;
        this.post({ type: 'reveal', rev: this.rendered.rev, elementId: moved });
      }
      return;
    }

    const id = this.core.mailElementAtSource(built.view, built.index, built.segments, file, offset);
    if (!id || id === this.selectedId) return;
    this.selectedId = id;
    this.post({ type: 'reveal', rev: this.rendered.rev, elementId: id });
  }

  /**
   * Designer → Code: chọn phần tử thì XML ĐANG MỞ, nhìn thấy được, đi theo — không mở tab mới, không lấy
   * focus khỏi designer. Sự kiện đổi vùng chọn do chính phép đặt này sinh ra tới SAU (bất đồng bộ), nên
   * cờ `syncingEditor` giữ qua hết nhịp debounce của nó.
   */
  async followInEditor(msg) {
    const built = this.lastBuilt;
    if (!this.follow || !built || !this.rendered || msg.rev !== this.rendered.rev) return;
    // Bấm trúng một `{!biến}` trên bản vẽ: con trỏ XML vào ĐÚNG token đó, không phải thẻ chứa nó —
    // chữ "Số phiếu" người dùng thấy là {!h_so_ct}, chỗ họ muốn sửa cũng là nó.
    const range = msg.tokenIndex !== null && msg.tokenIndex !== undefined
      ? this.core.mailTokenClearRange(built.view, built.index, msg.tokenIndex)
      : elementRange(this.core, built, msg.elementId);
    const src = range && this.core.sourceRange(built.segments, range.start, range.end);
    this.moveEditorTo(src);
  }

  /** Đặt vùng chọn của XML ĐANG MỞ, nhìn thấy được — không mở tab, không lấy focus khỏi designer. */
  moveEditorTo(src) {
    if (!src) return;
    const editor = vscode.window.visibleTextEditors.find((ed) => ed.document.uri.scheme === 'file' && samePath(ed.document.uri.fsPath, src.file));
    if (!editor) return;
    const target = new vscode.Range(editor.document.positionAt(src.start), editor.document.positionAt(src.end));
    this.syncingEditor = true;
    try {
      editor.selection = new vscode.Selection(target.start, target.end);
      editor.revealRange(target, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } finally {
      setTimeout(() => { this.syncingEditor = false; }, SELECTION_DEBOUNCE_MS * 2);
    }
  }

  /** Thẻ mở `<action id="…">` của mẫu vừa chọn trên designer. */
  async followActionInEditor(actionId) {
    const built = this.lastBuilt;
    if (!this.follow || !built) return;
    const action = this.core.scanMailActions(built.clearText).find((a) => a.id === actionId);
    if (!action) return;
    const openEnd = built.clearText.indexOf('>', action.start);
    const end = openEnd === -1 ? action.start : openEnd + 1;
    this.moveEditorTo(this.core.sourceRange(built.segments, action.start, end));
  }

  /**
   * File Include KHÔNG mở trong VS Code mà bị đổi trên đĩa (công cụ khác, git checkout) thì không có
   * `onDidChangeTextDocument` nào báo — theo dõi thẳng file. File ĐANG mở thì bỏ qua watcher: thay đổi của
   * nó đã tới qua document, vẽ hai lần là thừa. Message.xml không cần watcher — nó là document của editor.
   */
  watchSources() {
    const foreign = this.sourceFiles.filter((f) => !samePath(f, this.document.uri.fsPath));
    const key = foreign.map((f) => f.toLowerCase()).sort().join('|');
    if (key === this.watchKey) return;
    this.watchKey = key;
    for (const w of this.watchers) w.dispose();
    this.watchers = foreign.map((file) => {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(file), path.basename(file)));
      const onDisk = () => {
        if (vscode.workspace.textDocuments.some((d) => d.uri.scheme === 'file' && samePath(d.uri.fsPath, file))) return;
        this.renderSoon();
      };
      watcher.onDidChange(onDisk);
      watcher.onDidCreate(onDisk);
      watcher.onDidDelete(onDisk);
      return watcher;
    });
  }

  async revealElement(msg) {
    if (!this.rendered || msg.rev !== this.rendered.rev) return;
    const built = this.build();
    if (!built.ok) return;
    const r = this.core.resolveMailElement(built.index, msg.elementId, this.rendered.fingerprints.get(msg.elementId));
    if (!r.ok) { warn(r.reason); return; }
    const range = msg.tokenIndex !== null && msg.tokenIndex !== undefined
      ? this.core.mailTokenClearRange(built.view, built.index, msg.tokenIndex)
      : this.core.mailElementClearRange(built.view, r.element);
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
    if (this.dialogs) this.dialogs.dispose();
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    if (this.selectionTimer) { clearTimeout(this.selectionTimer); this.selectionTimer = null; }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
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
    const session = new MailDesignSession(this.core, this.output, document, panel, this.context.workspaceState);
    panel.webview.html = mailShellHtml(this.context, panel.webview);
    return session;
  }
}

/**
 * Nhánh mail của `fboDesigner.open` (và *Open With…*): mở file đang active bằng editor này,
 * bên cạnh XML. Caller đã nhận diện `Message.xml`; hàm này còn kiểm schema trước khi mở.
 */
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
  lastPreview.clear();
  lastFollow.clear();
  memorySamples.clear();
  memorySampleKeys.clear();
}

module.exports = {
  MailDesignerProvider, MailDesignSession, openMailDesigner, VIEW_TYPE, resetForTests,
};

// fake-vscode.mjs — đủ nhiều `vscode` để nạp và chạy `diagnostic-host.js` bằng node trần.
//
// Không phải để giả lập VS Code. Chỉ để kiểm PHẦN LOGIC của file ấy — gộp chẩn đoán của nhiều
// controller trên một file Include, bỏ trùng, dọn khi controller đóng, và quy offset ra
// dòng/cột. Toàn bộ những thứ đó không cần một cửa sổ editor nào, mà lại là chỗ dễ sai nhất.
//
// `DiagnosticCollection` ở đây ghi lại trạng thái thật (`store`) để test đọc ra và so — đó là
// điểm quan sát duy nhất chứng minh được rằng controller sau KHÔNG xoá mất chẩn đoán của
// controller trước.

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

export class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

export class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) {
      this.start = a;
      this.end = b;
    } else {
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
  }
}

export class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
    this.source = undefined;
    this.code = undefined;
  }
}

/**
 * `Uri` giả PHẢI phân biệt `path` với `fsPath`, không được coi hai cái là một.
 *
 * `Uri.file(p)` chuẩn hoá gạch chéo và thêm `/` dẫn đầu vào `path` (`D:\a\b.xml` → `/D:/a/b.xml`),
 * rồi `.fsPath` dựng ngược lại đường dẫn HỆ ĐIỀU HÀNH từ đó. Bản giả gộp hai khoá làm một thì phép
 * quay vòng ấy vẫn «chạy» trên máy này và gãy trên máy khác — đúng loại lỗi mà bản giả sinh ra để
 * chặn (`samePath` ở `render-host.js` so thẳng chuỗi `fsPath`, chỉ bỏ qua HOA/thường).
 */
const WIN = process.platform === 'win32';

class FakeUri {
  /** @param {string} p dạng `path` của uri: gạch chéo xuôi, có `/` dẫn đầu, chữ ổ đĩa thường hoá */
  constructor(scheme, p) {
    this.scheme = scheme;
    this.path = p;
  }

  /**
   * Quy về đường dẫn của HỆ ĐIỀU HÀNH — gạch chéo ngược trên Windows, bỏ `/` dẫn đầu của ổ đĩa.
   * Đúng phép của `vscode.Uri.fsPath`, và đây mới là chỗ chế độ soi cần nó khớp: `samePath`
   * (`render-host.js`) so chuỗi, chỉ bỏ qua HOA/thường chứ không bỏ qua kiểu gạch.
   */
  get fsPath() {
    const drive = /^\/[A-Za-z]:/.test(this.path);
    const raw = drive ? this.path.slice(1) : this.path;
    return WIN ? raw.replace(/\//g, '\\') : raw;
  }

  with({ scheme = this.scheme } = {}) {
    return new FakeUri(scheme, this.path);
  }

  toString() {
    return `${this.scheme}:${this.path}`;
  }
}

/**
 * `D:\a\b.xml` → `/D:/a/b.xml`.
 *
 * KHÔNG thường hoá chữ ổ đĩa, khác `vscode.Uri.file` thật. Cố ý: mọi phép so đường dẫn trong mã
 * sản phẩm đều đi qua `samePath` (`render-host.js`), vốn bỏ qua HOA/thường, nên chênh lệch này
 * không giấu được lỗi nào — trong khi giữ nguyên chữ ổ đĩa lại cho các test anh em (`chẩn đoán`,
 * `F12`) so thẳng chuỗi đường dẫn, thứ đọc ra ý định rõ hơn hẳn một phép so đã thường hoá.
 *
 * Phần THẬT SỰ phải mô phỏng cho đúng là kiểu GẠCH CHÉO: `samePath` không bỏ qua nó.
 */
function toUriPath(p) {
  return `/${String(p).replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

export const Uri = {
  file(p) {
    return new FakeUri('file', toUriPath(p));
  },
  parse(s) {
    const i = String(s).indexOf(':');
    const scheme = String(s).slice(0, i);
    const rest = String(s).slice(i + 1);
    return new FakeUri(scheme, rest.startsWith('/') ? rest : `/${rest}`);
  },
};

/**
 * Khoá của một file trong bảng giả: bỏ qua HOA/thường VÀ kiểu gạch chéo.
 *
 * Bỏ qua kiểu gạch là chuyện của riêng bản giả, không phải của VS Code. Lý do: test viết đường
 * dẫn bằng gạch xuôi cho dễ đọc (`'C:/P/App_Data/…'`), còn `Uri.fsPath` thật thì trả về gạch
 * ngược trên Windows. Không quy về một mối thì mọi phép tra trong test hụt, và cái hụt ấy không
 * nói gì về mã sản phẩm — nơi hai đầu đều là `fsPath` thật.
 */
const fileKey = (p) => String(p).toLowerCase().split('\\').join('/');

class FakeCollection {
  constructor() {
    /** khoá thường hoá → { path, items } — mô phỏng đúng ngữ nghĩa "một uri một danh sách". */
    this.store = new Map();
    this.disposed = false;
  }

  set(uri, items) {
    this.store.set(fileKey(uri.fsPath), { path: uri.fsPath, items });
  }

  delete(uri) {
    this.store.delete(fileKey(uri.fsPath));
  }

  dispose() {
    this.disposed = true;
    this.store.clear();
  }

  /** Tiện cho test: danh sách chẩn đoán đang treo trên một file, hoặc `[]`. */
  get(p) {
    return this.store.get(fileKey(p))?.items ?? [];
  }
}

export const languages = {
  lastCollection: null,
  /** Trả một disposable như thật — test đếm số đăng ký để bắt ca đăng ký hai lần. */
  registerDocumentSymbolProvider() {
    return { dispose() {} };
  },
  registerDefinitionProvider() {
    return { dispose() {} };
  },
  registerHoverProvider() {
    return { dispose() {} };
  },
  registerCompletionItemProvider() {
    return { dispose() {} };
  },
  /** Bản clear text mang tên file gốc, nên ngôn ngữ phải khai bằng API chứ không theo đuôi. */
  async setTextDocumentLanguage(document, languageId) {
    document.languageId = languageId;
    return document;
  },
  createDiagnosticCollection(name) {
    const c = new FakeCollection();
    c.name = name;
    languages.lastCollection = c;
    return c;
  },
};

/**
 * Nội dung «trên đĩa» cho `workspace.openTextDocument` của scheme `file:`.
 *
 * Khoá qua `fileKey` như mọi bảng đường dẫn khác của bản giả — test viết gạch xuôi, `Uri.fsPath`
 * trả gạch ngược trên Windows.
 */
const fakeDisk = new Map();

/** Test nạp nội dung file vào bảng trên. */
export function seedDisk(fsPath, text) {
  fakeDisk.set(fileKey(fsPath), text);
}

/**
 * Tài liệu văn bản giả có ĐỦ ba phép quy mà provider định nghĩa dùng: `lineAt`, `offsetAt`,
 * `positionAt` — và cả ba tính trên CHÍNH chuỗi này, không phải trên «dòng 0» như editor giả.
 *
 * Phải tính thật, vì `Ctrl+click` trên bản clear text quy dòng → offset → file nguồn: một bản
 * giả trả về hằng số sẽ xanh với mọi dòng và không kiểm được gì.
 */
export function textDocument(uri, text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return {
    uri,
    version: 1,
    isDirty: false,
    getText: () => text,
    lineCount: starts.length,
    positionAt(offset) {
      const at = Math.max(0, Math.min(offset, text.length));
      let line = 0;
      while (line + 1 < starts.length && starts[line + 1] <= at) line++;
      return new Position(line, at - starts[line]);
    },
    offsetAt(pos) {
      const base = starts[Math.max(0, Math.min(pos.line, starts.length - 1))];
      return base + pos.character;
    },
    lineAt(line) {
      const from = starts[Math.max(0, Math.min(line, starts.length - 1))];
      const to = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
      return {
        lineNumber: line,
        text: text.slice(from, to),
        range: new Range(new Position(line, 0), new Position(line, to - from)),
      };
    },
  };
}

/**
 * Cấu hình. Mặc định RỖNG — `render-host.config()` chỉ đọc vài khoá và có sẵn giá trị rơi về,
 * nên `undefined` là hình dạng đúng của "người dùng chưa khai gì".
 *
 * `settings` ghi đè được: test của lượt tự nạp phải bật/tắt được
 * `fboDesigner.autoLoadSampleData`, mà đó là một khoá có mặc định BẬT — không tắt được thì
 * không kiểm được nhánh tắt.
 */
export const workspace = {
  textDocuments: [],
  asRelativePath: (p) => String(p),
  settings: {},
  getConfiguration(section) {
    const prefix = section ? `${section}.` : '';
    return { get: (key) => workspace.settings[`${prefix}${key}`] };
  },
  onDidOpenTextDocument: () => ({ dispose() {} }),
  onDidChangeTextDocument: () => ({ dispose() {} }),
  onDidSaveTextDocument: () => ({ dispose() {} }),
  onDidCloseTextDocument: () => ({ dispose() {} }),
  onDidChangeConfiguration: () => ({ dispose() {} }),

  /** Nhà cung cấp nội dung cho scheme ảo — test lấy ra để gọi thẳng `provideTextDocumentContent`. */
  contentProviders: new Map(),
  registerTextDocumentContentProvider(scheme, provider) {
    workspace.contentProviders.set(scheme, provider);
    return { dispose() { workspace.contentProviders.delete(scheme); } };
  },

  /**
   * Dựng tài liệu từ chính provider đã đăng ký — không phải trả một vật rỗng.
   *
   * Phải THÀNH CÔNG chứ không được ném: `openClearText` bắt lỗi rồi bắn cảnh báo cho người dùng,
   * và một cảnh báo bắn ra ở một lượt async lạc lối sẽ rơi vào giữa test khác.
   */
  async openTextDocument(uri) {
    const provider = workspace.contentProviders.get(uri.scheme);
    const text = provider
      ? await provider.provideTextDocumentContent(uri)
      : fakeDisk.get(fileKey(uri.fsPath)) ?? '';
    return textDocument(uri, text);
  },
};

/** Sự kiện tối giản — đủ cho `onDidChange` của một content provider. */
export class EventEmitter {
  constructor() {
    this.listeners = [];
    this.fired = [];
    this.event = (fn) => {
      this.listeners.push(fn);
      return { dispose: () => { this.listeners = this.listeners.filter((f) => f !== fn); } };
    };
  }

  fire(value) {
    this.fired.push(value);
    for (const fn of this.listeners) fn(value);
  }

  dispose() {
    this.listeners = [];
  }
}

/**
 * `window` của bản giả là một BÀN ĐIỀU KHIỂN, không chỉ là mấy hàm rỗng.
 *
 * `sample-host` hỏi người dùng bằng `showQuickPick`/`showInputBox`/`showWarningMessage` — muốn
 * kiểm luồng hỏi-tham-số-báo-cáo thì test phải VÀO VAI người dùng. Nên mỗi hàm hỏi đọc câu trả
 * lời từ hàng đợi `answers.*` và ghi lại lời mời vào `asked.*`: test xếp sẵn câu trả lời trước,
 * rồi đọc `asked` sau để khẳng định người dùng đã được hỏi ĐÚNG những gì.
 *
 * Hàng đợi cạn thì trả `undefined` — đúng ngữ nghĩa VS Code khi người dùng bấm Esc, và cũng là
 * cách một test quên xếp câu trả lời sẽ thất bại ở nhánh «đã huỷ» thay vì treo.
 */
/**
 * Kiểu trang trí GIỮ LẠI thứ đã vẽ lên nó.
 *
 * Đây là điểm quan sát duy nhất của chế độ soi: nó không trả về gì, không ghi file, không gửi
 * message — nó CHỈ gọi `setDecorations`. Một bản giả trả về hàm rỗng thì test chỉ khẳng định
 * được «chạy không nổ», tức là không khẳng định gì cả.
 */
let decorationSeq = 0;

export class FakeDecorationType {
  constructor(options) {
    this.key = `deco${decorationSeq++}`;
    this.options = options;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

export const DecorationRangeBehavior = {
  OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3,
};

export const StatusBarAlignment = { Left: 1, Right: 2 };

export const OverviewRulerLane = {
  Left: 1, Center: 2, Right: 4, Full: 7,
};

export const TextEditorRevealType = {
  Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3,
};

/** `Selection` là `Range` cộng hướng — chế độ soi chỉ cần phần `Range`. */
export class Selection extends Range {
  constructor(a, b, c, d) {
    super(a, b, c, d);
    this.anchor = this.start;
    this.active = a instanceof Position ? b : new Position(c, d);
  }
}

/**
 * `setContext` là cách extension nói với `package.json` (mục lệnh, phím tắt). Ghi lại để test
 * đọc — một tính năng ẩn mà quên bật khoá ngữ cảnh thì hiện tên lệnh cho người không có nó.
 */
export const commands = {
  registered: new Map(),
  context: {},
  registerCommand(id, fn) {
    commands.registered.set(id, fn);
    return { dispose() { commands.registered.delete(id); } };
  },
  executed: [],
  executeCommand(id, ...args) {
    commands.executed.push({ id, args });
    if (id === 'setContext') {
      const [key, value] = args;
      commands.context[key] = value;
      return Promise.resolve();
    }
    const fn = commands.registered.get(id);
    return Promise.resolve(fn ? fn(...args) : undefined);
  },
  reset() {
    commands.registered.clear();
    commands.context = {};
    commands.executed = [];
  },
};

export const window = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
  createOutputChannel: () => ({ appendLine() {} }),

  createTextEditorDecorationType(options) {
    return new FakeDecorationType(options);
  },

  statusBar: [],
  createStatusBarItem(alignment, priority) {
    const item = {
      alignment, priority, text: '', tooltip: '', command: undefined, visible: false,
      show() { item.visible = true; },
      hide() { item.visible = false; },
      dispose() { item.visible = false; },
    };
    window.statusBar.push(item);
    return item;
  },

  statusMessages: [],
  setStatusBarMessage(message) {
    window.statusMessages.push(message);
    return { dispose() {} };
  },

  /**
   * Panel giả GIỮ LẠI `html` đã gán — điểm quan sát duy nhất của chế độ soi ở bản này.
   *
   * Một bản giả trả về vật rỗng thì test chỉ khẳng định được «gọi mà không nổ». Cái phải kiểm là
   * NỘI DUNG: bung đủ dòng, tô đúng vùng, tooltip đúng file.
   */
  /**
   * Nhóm tab giả — điểm quan sát của câu «panel CHIẾM CHỖ tab văn bản, không cộng thêm».
   *
   * Không có nó thì test chỉ đếm được panel, mà panel thì lúc nào cũng đúng một cái; cái sai
   * nằm ở TAB CÒN LẠI bên dưới, và chỉ bảng này nhìn thấy.
   */
  tabGroups: {
    all: [],
    closed: [],
    async close(tabs) {
      const list = Array.isArray(tabs) ? tabs : [tabs];
      window.tabGroups.closed.push(...list);
      for (const g of window.tabGroups.all) g.tabs = g.tabs.filter((t) => !list.includes(t));
      return true;
    },
    /** Tiện cho test: dựng một nhóm có sẵn tab văn bản của một file. */
    seed(viewColumn, fsPath) {
      const tab = { input: { uri: Uri.file(fsPath) } };
      window.tabGroups.all.push({ viewColumn, tabs: [tab] });
      return tab;
    },
    reset() {
      window.tabGroups.all = [];
      window.tabGroups.closed = [];
    },
  },

  panels: [],
  createWebviewPanel(viewType, title, showOptions, options) {
    const panel = {
      viewType,
      title,
      viewColumn: showOptions && showOptions.viewColumn,
      options,
      disposed: false,
      revealed: 0,
      /*
       * `onDidReceiveMessage` GIỮ LẠI handler thay vì bỏ qua — điểm quan sát duy nhất cho kênh
       * webview → host (`mail-preview-host.js` dùng nó để nhớ lựa chọn và «đi tới định nghĩa»).
       * `postMessageFromWebview` là lối vào TEST dùng để giả một tin nhắn từ phía webview gửi
       * lên, không phải API thật của VS Code.
       */
      webview: {
        html: '',
        messageHandler: null,
        onDidReceiveMessage(fn) {
          this.messageHandler = fn;
          return { dispose() { panel.webview.messageHandler = null; } };
        },
        postMessageFromWebview(msg) {
          return this.messageHandler ? this.messageHandler(msg) : undefined;
        },
      },
      onDidDispose(fn) {
        panel.disposeHandler = fn;
        return { dispose() {} };
      },
      reveal() {
        panel.revealed++;
      },
      dispose() {
        panel.disposed = true;
        if (panel.disposeHandler) panel.disposeHandler();
      },
    };
    window.panels.push(panel);
    return panel;
  },

  shown: [],
  /**
   * Trả một editor GHI LẠI decoration, không phải một vật rỗng.
   *
   * `openInsight` vẽ ngay lên editor vừa mở, nên nếu bản giả trả về hàm rỗng thì phép vẽ trên
   * bản clear text — nửa quan trọng của tính năng — không có điểm quan sát nào.
   */
  async showTextDocument(document, options) {
    const painted = new Map();
    const editor = {
      document,
      painted,
      viewColumn: options && options.viewColumn,
      selection: null,
      revealed: [],
      revealRange(range, type) { editor.revealed.push({ range, type }); },
      setDecorations(type, items) { painted.set(type.key, items); },
    };
    window.shown.push({ uri: document.uri, options, editor });
    return editor;
  },

  onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
  onDidChangeTextEditorSelection: () => ({ dispose() {} }),

  asked: { quickPick: [], inputBox: [], warning: [], info: [] },
  answers: { quickPick: [], inputBox: [], warning: [] },

  reset() {
    window.asked = { quickPick: [], inputBox: [], warning: [], info: [] };
    window.answers = { quickPick: [], inputBox: [], warning: [] };
    window.statusBar = [];
    window.statusMessages = [];
    window.shown = [];
    window.panels = [];
    workspace.settings = {};
  },

  async showQuickPick(items, options) {
    window.asked.quickPick.push({ items: await items, options });
    return window.answers.quickPick.shift();
  },
  async showInputBox(options) {
    window.asked.inputBox.push(options);
    return window.answers.inputBox.shift();
  },
  showWarningMessage(message, ...rest) {
    window.asked.warning.push(message);
    // Hộp thoại modal (`{modal:true}, ...actions`) chờ một lựa chọn; toast một dòng thì không.
    return rest.length > 0 ? window.answers.warning.shift() : undefined;
  },
  showInformationMessage(message) {
    window.asked.info.push(message);
  },
  showErrorMessage(message) {
    window.asked.info.push(message);
  },
  withProgress(_options, task) {
    return task();
  },
};

export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };

/**
 * Đủ dùng cho outline. `Null` phải là một giá trị THẬT chứ không phải `undefined`: cả điểm của
 * `kindOf` là một loại lạ rơi vào một icon nhìn ra được, và test khẳng định điều đó.
 */
export const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7,
  Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14,
  Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22,
  Event: 23, Operator: 24, TypeParameter: 25,
};

/** Đích của một cú nhảy: file + dải. */
export class Location {
  constructor(uri, range) {
    this.uri = uri;
    this.range = range;
  }
}

/** Gom markdown vào `.value` như thật — test đọc thẳng chuỗi ấy. */
export class MarkdownString {
  constructor(value = '') {
    this.value = value;
  }

  appendMarkdown(v) {
    this.value += v;
    return this;
  }
}

export class Hover {
  constructor(contents, range) {
    this.contents = contents;
    this.range = range;
  }
}

export const CompletionItemKind = { Field: 4, Reference: 17 };

export class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

export class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
}

export const ViewColumn = { One: 1, Beside: -2 };

/** `buildPayload` đọc `document.eol` để báo CRLF/LF trong payload. */
export const EndOfLine = { LF: 1, CRLF: 2 };

/** Giá trị THẬT của vscode.d.ts — `context.extensionMode` trả về một trong ba số này. */
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };

/** `env.clipboard` — nút copy trên hộp thoại (`dialog-panel.js`) đi qua đây. */
export const env = {
  clipboard: {
    written: [],
    async writeText(text) {
      env.clipboard.written.push(text);
    },
  },
};

export default {
  DiagnosticSeverity, Position, Range, Diagnostic, Uri, languages, workspace, window, ViewColumn,
  EndOfLine, SymbolKind, DocumentSymbol, Location,
  MarkdownString, Hover, CompletionItem, CompletionItemKind,
  ExtensionMode, commands, DecorationRangeBehavior, StatusBarAlignment, FakeDecorationType,
  EventEmitter, TextEditorRevealType, Selection, OverviewRulerLane, env,
};

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

export const Uri = {
  file(p) {
    return { scheme: 'file', fsPath: p, toString: () => `file:${p}` };
  },
};

class FakeCollection {
  constructor() {
    /** khoá thường hoá → { path, items } — mô phỏng đúng ngữ nghĩa "một uri một danh sách". */
    this.store = new Map();
    this.disposed = false;
  }

  set(uri, items) {
    this.store.set(uri.fsPath.toLowerCase(), { path: uri.fsPath, items });
  }

  delete(uri) {
    this.store.delete(uri.fsPath.toLowerCase());
  }

  dispose() {
    this.disposed = true;
    this.store.clear();
  }

  /** Tiện cho test: danh sách chẩn đoán đang treo trên một file, hoặc `[]`. */
  get(p) {
    return this.store.get(String(p).toLowerCase())?.items ?? [];
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
  createDiagnosticCollection(name) {
    const c = new FakeCollection();
    c.name = name;
    languages.lastCollection = c;
    return c;
  },
};

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
};

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
export const window = {
  activeTextEditor: undefined,
  createOutputChannel: () => ({ appendLine() {} }),

  asked: { quickPick: [], inputBox: [], warning: [], info: [] },
  answers: { quickPick: [], inputBox: [], warning: [] },

  reset() {
    window.asked = { quickPick: [], inputBox: [], warning: [], info: [] };
    window.answers = { quickPick: [], inputBox: [], warning: [] };
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

/** Giá trị THẬT của vscode.d.ts — `dev-features.js` so sánh trực tiếp với các hằng này. */
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 };

export default {
  DiagnosticSeverity, Position, Range, Diagnostic, Uri, languages, workspace, window, ViewColumn,
  EndOfLine, SymbolKind, DocumentSymbol, Location,
  MarkdownString, Hover, CompletionItem, CompletionItemKind,
  ExtensionMode,
};

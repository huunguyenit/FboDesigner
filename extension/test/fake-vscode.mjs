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
  createDiagnosticCollection(name) {
    const c = new FakeCollection();
    c.name = name;
    languages.lastCollection = c;
    return c;
  },
};

/** Cấu hình mặc định — `render-host.config()` chỉ đọc vài khoá và có sẵn giá trị rơi về. */
export const workspace = {
  textDocuments: [],
  getConfiguration() {
    return { get: () => undefined };
  },
  onDidOpenTextDocument: () => ({ dispose() {} }),
  onDidChangeTextDocument: () => ({ dispose() {} }),
  onDidSaveTextDocument: () => ({ dispose() {} }),
  onDidCloseTextDocument: () => ({ dispose() {} }),
};

export const window = {
  activeTextEditor: undefined,
  createOutputChannel: () => ({ appendLine() {} }),
  showWarningMessage() {},
  showErrorMessage() {},
};

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

export default {
  DiagnosticSeverity, Position, Range, Diagnostic, Uri, languages, workspace, window, ViewColumn,
  EndOfLine, SymbolKind, DocumentSymbol,
};

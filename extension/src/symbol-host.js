// symbol-host.js — `Ctrl+Shift+O` (Go to Symbol) và Outline view cho file controller FBO.
//
// Vỏ MỎNG quanh `core/src/outline.mjs`: core dựng cây và trả offset, file này chỉ đổi offset ra
// `vscode.Range` và tên loại ra `vscode.SymbolKind`. Không có luật FBO nào ở đây.
//
// PHẠM VI RỘNG HƠN designer, có chủ ý. Designer chỉ vẽ `Dir` / `Filter` / `Grid` vì chỉ ba thư
// mục đó ra được một màn hình. Mục lục thì không cần vẽ gì — một file `Include\*.ent` khai bốn
// chục `<field>` vẫn có mục lục hữu ích, và đó lại đúng là loại file dài nhất, khó cuộn nhất.
// Nên bộ chọn ở đây bắt MỌI file dưới `App_Data\Controllers`.
//
// Trả `undefined` (không phải `[]`) khi không tìm thấy gì: `[]` là câu trả lời «tôi phụ trách
// file này và nó rỗng», nó CHIẾM CHỖ và làm outline của XML built-in không hiện nữa. `undefined`
// là «không phải việc của tôi» và nhường lại.

const vscode = require('vscode');

/**
 * Tên loại của core → `SymbolKind`. Bảng này là chỗ DUY NHẤT biết về `vscode` trong cả tính
 * năng; core cố tình chỉ trả chuỗi để test được mà không cần giả lập editor.
 *
 * Chọn icon theo thứ người ta quen thấy trong outline của ngôn ngữ khác, không theo nghĩa đen:
 * một `<view>` gần với một `class` hơn là với bất cứ thứ gì khác trong danh sách VS Code có.
 */
const KIND = {
  namespace: vscode.SymbolKind.Namespace,  // nhóm gộp: fields, categories, toolbar
  field: vscode.SymbolKind.Field,          // <field> và cột của lưới
  class: vscode.SymbolKind.Class,          // <view>
  object: vscode.SymbolKind.Object,        // <category> — một tab
  struct: vscode.SymbolKind.Struct,        // một hàng control
  array: vscode.SymbolKind.Array,          // list px
  event: vscode.SymbolKind.Event,          // nút toolbar
  reference: vscode.SymbolKind.Variable,   // &Name; — hàng đến từ file khác
};

/** Loại lạ không được âm thầm thành một icon gần giống: hiện `Null` để nhìn là biết còn thiếu. */
const kindOf = (name) => KIND[name] ?? vscode.SymbolKind.Null;

function toSymbol(document, n) {
  const range = new vscode.Range(document.positionAt(n.start), document.positionAt(n.end));
  const selection = new vscode.Range(
    document.positionAt(n.selectionStart),
    document.positionAt(n.selectionEnd),
  );
  const symbol = new vscode.DocumentSymbol(n.name, n.detail, kindOf(n.kind), range, selection);
  symbol.children = (n.children ?? []).map((c) => toSymbol(document, c));
  return symbol;
}

/**
 * Mọi file dưới `App_Data\Controllers`, cả `.xml` lẫn `.f`.
 *
 * Chọn theo ĐƯỜNG DẪN chứ không theo `language`: VS Code không biết `.f` là ngôn ngữ gì, nên một
 * bộ chọn theo language sẽ bỏ qua đúng nửa số file của dự án (`Dir/X.f` là bản chuẩn sản phẩm).
 */
const SELECTOR = [
  { scheme: 'file', pattern: '**/App_Data/Controllers/**/*.xml' },
  { scheme: 'file', pattern: '**/App_Data/Controllers/**/*.f' },
];

function registerSymbols(context, core, output) {
  const provider = {
    provideDocumentSymbols(document) {
      let tree;
      try {
        // VĂN BẢN THÔ, không bung entity — xem đầu `core/src/outline.mjs`. Đây cũng là lý do
        // provider này rẻ: không đọc đĩa, không đụng Include, chạy trên đúng chuỗi đang mở.
        tree = core.buildOutline(document.getText());
      } catch (err) {
        // Gõ dở một thẻ là chuyện thường của file đang sửa. Nhường lại thay vì để VS Code hiện
        // một lỗi provider mỗi lần gõ.
        output.appendLine(`outline bỏ qua ${document.uri.fsPath}: ${err && err.message}`);
        return undefined;
      }
      if (tree.length === 0) return undefined;
      return tree.map((n) => toSymbol(document, n));
    },
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, provider, {
      label: 'FBO Designer',
    }),
  );
  return provider;
}

module.exports = { registerSymbols, KIND, kindOf, SELECTOR };

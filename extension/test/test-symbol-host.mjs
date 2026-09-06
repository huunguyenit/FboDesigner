// test-symbol-host.mjs — vỏ đổi cây outline của core thành `DocumentSymbol` của VS Code.
//
// Vỏ này mỏng, nên chỉ có ba thứ đáng kiểm — và cả ba đều là chỗ hỏng KHÔNG ném ra lỗi nào:
//
//   1. Mọi tên loại core trả về đều có ánh xạ. Thiếu một cái thì nút ấy hiện icon `Null` và
//      trông như một lỗi dữ liệu, chứ không ai nghĩ tới bảng ánh xạ.
//   2. Cây con giữ nguyên hình dạng. Làm phẳng nhầm thì outline mất hết thứ bậc mà vẫn đủ mục.
//   3. Không tìm thấy gì thì trả `undefined`, KHÔNG phải `[]` — `[]` chiếm chỗ và đuổi mất
//      outline của provider khác.

import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, ...rest);
};

const { registerSymbols, KIND, kindOf, SELECTOR } = require_('../src/symbol-host.js');
const core = await import('../../core/src/index.mjs');

const NL = '\r\n';
const XML = [
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="Mã KH" e="Code"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60"/>',
  '    <item value="11: [ma_kh].Label, [ma_kh]"/>',
  '    <categories><category index="1"><header v="Chi tiết" e="Detail"/></category></categories>',
  '  </view>',
  '  <toolbar><button command="New"><title v="Thêm" e="New"/></button></toolbar>',
  '</dir>',
].join(NL);

/** Document giả với `positionAt` tính đúng như VS Code (đếm theo LF). */
function docOf(text, fsPath = 'C:/P/App_Data/Controllers/Dir/K.xml') {
  return {
    uri: { scheme: 'file', fsPath },
    getText: () => text,
    positionAt(offset) {
      const at = Math.max(0, Math.min(offset, text.length));
      const before = text.slice(0, at);
      const line = before.split('\n').length - 1;
      return new fakeVscode.Position(line, at - (before.lastIndexOf('\n') + 1));
    },
  };
}

const subs = [];
const provider = registerSymbols({ subscriptions: subs }, core, { appendLine() {} });
const flat = (ss) => ss.flatMap((s) => [s, ...flat(s.children ?? [])]);

section('symbol-host — đăng ký đúng một provider, bắt cả .xml lẫn .f');
eq('có đăng ký một disposable', subs.length, 1);
/*
 * Bộ chọn theo ĐƯỜNG DẪN chứ không theo `language`: VS Code không biết `.f` là ngôn ngữ gì, nên
 * một bộ chọn theo language sẽ bỏ qua đúng nửa số file của dự án (`Dir/X.f` là bản chuẩn sản
 * phẩm mà người ta phải đọc thường xuyên nhất).
 */
eq('hai mẫu đường dẫn', SELECTOR.length, 2);
ok('bắt .f', SELECTOR.some((s) => s.pattern.endsWith('.f')));
ok('phạm vi là cả Controllers, không chỉ Dir/Filter/Grid',
  SELECTOR.every((s) => s.pattern.includes('App_Data/Controllers/**')));

section('symbol-host — mọi loại core trả về đều có ánh xạ');
/*
 * Quét TOÀN BỘ cây của một file có đủ mọi loại nút, rồi khẳng định không nút nào rơi vào
 * `SymbolKind.Null`. Đây là phép kiểm duy nhất bắt được ca «core thêm một loại mới mà quên bảng
 * ánh xạ» — ca ấy không ném, chỉ hiện sai icon.
 */
const symbols = provider.provideDocumentSymbols(docOf(XML));
ok('có cây', Array.isArray(symbols) && symbols.length > 0);
const all = flat(symbols);
ok('không nút nào rơi vào Null', all.every((s) => s.kind !== fakeVscode.SymbolKind.Null));

// Và ngược lại: mọi khoá trong bảng phải là một loại core THẬT SỰ dùng, không phải khoá chết.
const kindsUsed = new Set(core.buildOutline(XML).flatMap(function walk(n) {
  return [n.kind, ...(n.children ?? []).flatMap(walk)];
}));
for (const k of kindsUsed) ok(`loại "${k}" có ánh xạ`, KIND[k] !== undefined);
eq('loại lạ ra Null chứ không đoán bừa', kindOf('chua_bao_gio_co'), fakeVscode.SymbolKind.Null);

section('symbol-host — cây con giữ nguyên thứ bậc');
eq('ba mục ở tầng đầu', symbols.map((s) => s.name), ['fields (1)', 'view "Dir"', 'toolbar (1)']);
eq('fields có con', symbols[0].children.map((s) => s.name), ['ma_kh']);
const view = symbols[1];
ok('view có cả hàng lẫn nhóm categories',
  view.children.some((s) => s.name === 'categories (1)')
  && view.children.some((s) => s.name.includes('[ma_kh]')));
// Ba tầng: view → categories → tab. Làm phẳng nhầm thì vẫn đủ mục mà mất hết thứ bậc.
const cats = view.children.find((s) => s.name.startsWith('categories'));
eq('tab nằm dưới categories', cats.children.map((s) => s.name), ['tab 1 — Chi tiết']);

section('symbol-host — dải quy ra dòng/cột đúng chỗ');
const field = symbols[0].children[0];
const lines = XML.split(NL);
eq('field nằm ở dòng 3 (0-based 2)', field.range.start.line, 2);
eq('dải CHỌN cắt ra đúng tên field',
  lines[field.selectionRange.start.line]
    .slice(field.selectionRange.start.character, field.selectionRange.end.character),
  'ma_kh');
// Bất biến của VS Code, kiểm lại ở tầng vỏ sau khi đã đổi sang Position: chọn phải nằm trong
// phần tử, nếu không thì VS Code ném và mất CẢ cây.
for (const s of all) {
  const inside = s.selectionRange.start.line > s.range.start.line
    || (s.selectionRange.start.line === s.range.start.line
      && s.selectionRange.start.character >= s.range.start.character);
  ok(`"${s.name}": chọn bắt đầu trong phần tử`, inside);
}

section('symbol-host — không có gì thì NHƯỜNG, không chiếm chỗ');
/*
 * `[]` nghĩa là «tôi phụ trách file này và nó rỗng» — nó chiếm chỗ và outline built-in của XML
 * không hiện nữa. `undefined` là «không phải việc của tôi».
 */
for (const junk of ['', 'không phải xml', '<html><body>x</body></html>']) {
  eq(`"${junk.slice(0, 14)}" → undefined`, provider.provideDocumentSymbols(docOf(junk)), undefined);
}

section('symbol-host — core ném thì nhường, không để VS Code hiện lỗi provider');
// Gõ dở một thẻ là chuyện thường của file đang sửa; một hộp lỗi mỗi lần gõ thì tệ hơn hẳn việc
// outline lặng lẽ giữ bản cũ.
let ghiLog = 0;
const noisy = registerSymbols({ subscriptions: [] }, {
  buildOutline() { throw new Error('vỡ giữa chừng'); },
}, { appendLine() { ghiLog += 1; } });
eq('không ném ra ngoài', noisy.provideDocumentSymbols(docOf(XML)), undefined);
eq('nhưng có ghi lại để còn lần ra', ghiLog, 1);

Module._load = originalLoad;

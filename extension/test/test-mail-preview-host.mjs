// test-mail-preview-host.mjs — lệnh «Xem mail», từ lúc bấm phím tới lúc panel hiện đúng HTML.
//
// Core đã kiểm phần DỰNG HTML và định vị section (`core/test/test-mail-template.mjs`). Cái chưa
// ai kiểm là LUỒNG của tầng vỏ: file không phải mail template thì có nói đúng không, không hỏi
// gì qua QuickPick nữa (điều hướng nằm hẳn trong panel), MỌI action/body/ngôn ngữ đều được dựng
// sẵn, mẫu ĐẦU TIÊN được chọn khi chưa có gì để nhớ, gọi lại lệnh dùng LẠI panel cũ, panel NHỚ
// đúng lựa chọn gần nhất qua các lần mở lệnh (rơi về mẫu đầu khi lựa chọn cũ hết hợp lệ), và
// «đi tới định nghĩa» mở đúng file/vị trí XML tương ứng.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

/*
 * Hộp thoại xác nhận (`dialog-service`) và cơ chế ghi thật (`edit-host#applySplice`) bị THAY —
 * cùng ranh giới `test-sample-host.mjs` đã vạch cho `sql-host`: `applySplice` là hạ tầng CHUNG
 * đã phục vụ Dir/Grid từ trước (không có test riêng ở tầng vỏ cho chính nó, xem `edit-host.js`),
 * việc của bộ test này là XÁC NHẬN `mail-preview-host.js` GỌI nó đúng cách — đúng danh sách
 * splice (đã quy về file nguồn), đúng nội dung hộp thoại, có dựng lại panel sau khi ghi xong hay
 * không — không phải test lại `applySplice` tự ghi file thế nào.
 */
const fakeDialog = {
  shown: [],
  answer: 'go',
  reset() { fakeDialog.shown = []; fakeDialog.answer = 'go'; },
  async ask(options) { fakeDialog.shown.push(options); return fakeDialog.answer; },
};

const fakeEditHost = {
  calls: [],
  result: true,
  reset() { fakeEditHost.calls = []; fakeEditHost.result = true; },
  async applySplice(plan, hostDocument, output, label) {
    fakeEditHost.calls.push({ plan, hostDocument, label });
    return fakeEditHost.result;
  },
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  if (request === './dialog/dialog-service') return { dialogs: () => fakeDialog };
  if (request === './edit-host') return fakeEditHost;
  return originalLoad.call(this, request, ...rest);
};

const { viewMail, resetForTests } = require_('../src/mail-preview-host.js');
const core = await import('../../core/src/index.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-mail-preview-'));

const NL = '\r\n';
const write = (rel, lines) => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join(NL), 'utf8');
  return file;
};

const MESSAGE_XML = write('App_Data/Controllers/Options/Message.xml', [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<message xmlns="urn:schemas-fast-com:data-message">',
  '  <mail>',
  '    <template>',
  '      <action id="OneBody" table="t1" v="Một biến thể" e="One variant">',
  '        <fields>',
  '          <field name="h_so_ct"><header v="Số phiếu" e="Number"/></field>',
  '        </fields>',
  '        <body>',
  '          <header><text><![CDATA[<html><body>{!h_so_ct} {!so_ct}]]></text></header>',
  '          <footer><text><![CDATA[</body></html>]]></text></footer>',
  '        </body>',
  '      </action>',
  '      <action id="TwoBodies" table="t2" v="Hai biến thể" e="Two variants">',
  '        <fields>',
  '          <field name="h_so_ct"><header v="Số phiếu 2" e="Number 2"/></field>',
  '        </fields>',
  '        <body>',
  '          <header><text><![CDATA[<html><body>bien the 1: {!h_so_ct}]]></text></header>',
  '          <footer><text><![CDATA[</body></html>]]></text></footer>',
  '        </body>',
  '        <body2>',
  '          <header><text><![CDATA[<html><body>bien the 2: {!h_so_ct}]]></text></header>',
  '          <footer><text><![CDATA[</body></html>]]></text></footer>',
  '        </body2>',
  '      </action>',
  '    </template>',
  '  </mail>',
  '</message>',
]);

const OTHER_XML = write('App_Data/Controllers/Options/Other.xml', [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<message xmlns="urn:schemas-fast-com:data-message">',
  '  <mail>',
  '    <template>',
  '      <action id="OnlyOne" table="t3" v="Chỉ một mẫu" e="Only one">',
  '        <fields/>',
  '        <body>',
  '          <header><text><![CDATA[<html><body>only one]]></text></header>',
  '          <footer><text><![CDATA[</body></html>]]></text></footer>',
  '        </body>',
  '      </action>',
  '    </template>',
  '  </mail>',
  '</message>',
]);

const TABLE_XML = write('App_Data/Controllers/Options/Table.xml', [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<message xmlns="urn:schemas-fast-com:data-message">',
  '  <mail>',
  '    <template>',
  '      <action id="PQApproval" table="m92$000000" v="Đề nghị báo giá" e="Price quote">',
  '        <fields>',
  '          <field name="h_ma_vt"><header v="Mã hàng" e="Item"/></field>',
  '          <field name="h_ten_vt"><header v="Tên hàng" e="Name"/></field>',
  '        </fields>',
  '        <body>',
  '          <header>',
  '            <text><![CDATA[<html><body>',
  '<table><tr><td style="width:100px;">{!h_ma_vt}</td><td style="width:200px;">{!h_ten_vt}</td></tr>',
  ']]></text>',
  '          </header>',
  '          <detail>',
  '            <text><![CDATA[<tr><td>{!ma_vt}</td><td>{!ten_vt}</td></tr>]]></text>',
  '          </detail>',
  '          <footer>',
  '            <text><![CDATA[<tr><td colspan="2">{!h_t_tien}</td></tr></table></body></html>]]></text>',
  '          </footer>',
  '        </body>',
  '      </action>',
  '    </template>',
  '  </mail>',
  '</message>',
]);

const NOT_MAIL_XML = write('App_Data/Controllers/Dir/Customer.xml', [
  '<dir id="1" xmlns="urn:schemas-fast-com:data-dir"><views/></dir>',
]);

const EMPTY_MAIL_XML = write('App_Data/Controllers/Options/Empty.xml', [
  '<message xmlns="urn:schemas-fast-com:data-message"><mail><template></template></mail></message>',
]);

function open(file) {
  const text = fs.readFileSync(file, 'utf8');
  fakeVscode.seedDisk(file, text); // cho «đi tới định nghĩa» mở lại được đúng nội dung
  fakeVscode.window.activeTextEditor = {
    document: {
      uri: { scheme: 'file', fsPath: file },
      fileName: file,
      languageId: 'xml',
      getText: () => text,
    },
  };
}

const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const run = () => viewMail(core, output);
function reset() {
  fakeVscode.window.reset();
  fakeVscode.window.activeTextEditor = undefined;
  output.lines = [];
  resetForTests();
  fakeDialog.reset();
  fakeEditHost.reset();
}

section('xem mail — không có file đang mở');
{
  reset();
  await run();
  eq('cảnh báo "chưa mở file"', fakeVscode.window.asked.warning.length, 1);
  eq('không panel nào', fakeVscode.window.panels.length, 0);
}

section('xem mail — file không phải mail template');
{
  reset();
  open(NOT_MAIL_XML);
  await run();
  eq('cảnh báo đúng loại file', fakeVscode.window.asked.warning.length, 1);
  ok('nói rõ cần <message xmlns=…>', /urn:schemas-fast-com:data-message/.test(fakeVscode.window.asked.warning[0]));
  eq('không panel nào', fakeVscode.window.panels.length, 0);
}

section('xem mail — <mail><template> rỗng');
{
  reset();
  open(EMPTY_MAIL_XML);
  await run();
  eq('báo không có mẫu mail nào', fakeVscode.window.asked.info.length, 1);
  eq('không panel nào', fakeVscode.window.panels.length, 0);
}

section('xem mail — mở panel: KHÔNG hỏi gì qua QuickPick, điều hướng nằm trong panel');
{
  reset();
  open(MESSAGE_XML);
  await run();

  eq('không QuickPick nào — panel tự có combobox điều hướng', fakeVscode.window.asked.quickPick.length, 0);
  eq('đúng một panel', fakeVscode.window.panels.length, 1);
  const html = fakeVscode.window.panels[0].webview.html;

  ok('nhúng đủ danh sách action (cả hai id)', html.includes('"OneBody"') && html.includes('"TwoBodies"'));
  ok('nhúng nhãn hiện của action', html.includes('Một biến thể') && html.includes('Hai biến thể'));
  ok('chưa nhớ gì → mặc định action ĐẦU TIÊN trong file', html.includes('"actionId":"OneBody"'));
  ok('có control combobox tìm mẫu mail', html.includes('id="fboActionInput"'));
  ok('có control chọn biến thể', html.includes('id="fboBodySelect"'));
  ok('có nút so sánh biến thể', html.includes('id="fboMailCompare"'));
  ok('có cụm nút đi tới định nghĩa cho cả ba phần', ['fboGotoHeader', 'fboGotoDetail', 'fboGotoFooter'].every((id) => html.includes(`id="${id}"`)));
}

section('xem mail — nhúng SẴN mọi action × body × ngôn ngữ, không chỉ một cặp');
{
  reset();
  open(MESSAGE_XML);
  await run();
  const html = fakeVscode.window.panels[0].webview.html;

  ok('OneBody: nhãn field tiếng Việt đã thay', html.includes('Số phiếu'));
  ok('OneBody: nhãn field tiếng Anh cũng có sẵn (đổi ngôn ngữ không cần render lại)', html.includes('Number'));
  ok('OneBody: token dữ liệu thật giữ nguyên', html.includes('{!so_ct}'));
  ok('TwoBodies: cả hai biến thể đều có sẵn cùng lúc', html.includes('bien the 1') && html.includes('bien the 2'));
}

section('xem mail — gọi lại lệnh dùng LẠI panel cũ, không cộng tab');
{
  reset();
  open(MESSAGE_XML);
  await run();
  eq('một panel sau lần đầu', fakeVscode.window.panels.length, 1);

  await run();
  eq('VẪN một panel sau lần hai — dùng lại, không mở thêm', fakeVscode.window.panels.length, 1);
  ok('panel cũ được reveal lại', fakeVscode.window.panels[0].revealed > 0);
}

section('xem mail — nhớ lựa chọn gần nhất qua các lần mở lệnh');
{
  reset();
  open(MESSAGE_XML);
  await run();

  // Mô phỏng người dùng đổi mẫu/biến thể/ngôn ngữ TRONG panel — webview tự báo về host mỗi lần
  // đổi (xem `notifySelection` trong `panelHtml`), test gọi thẳng handler thay vì cần DOM thật.
  fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'selection', actionId: 'TwoBodies', body: 'body2', lang: 'en',
  });

  await run(); // gọi lại lệnh — vẫn dùng lại panel cũ, nhưng phải dựng lại theo lựa chọn VỪA nhớ
  const html = fakeVscode.window.panels[0].webview.html;
  ok('nhớ đúng action', html.includes('"actionId":"TwoBodies"'));
  ok('nhớ đúng biến thể', html.includes('"body":"body2"'));
  ok('nhớ đúng ngôn ngữ', html.includes('"lang":"en"'));
}

section('xem mail — lựa chọn cũ hết hợp lệ (mở file khác) thì rơi về mẫu đầu tiên của file MỚI');
{
  // Tiếp nối kịch bản trên — KHÔNG reset() lựa chọn đã nhớ ("TwoBodies"), vì đây đúng là ca cần
  // kiểm: người dùng đang xem file A rồi mở file B, "TwoBodies" không tồn tại ở B.
  open(OTHER_XML);
  await run();
  const html = fakeVscode.window.panels[0].webview.html;
  ok('rơi về "OnlyOne" — id cũ không có trong danh sách mới', html.includes('"actionId":"OnlyOne"'));
}

section('xem mail — đi tới định nghĩa: mở đúng vị trí <header>/<footer> trong file nguồn');
{
  reset();
  open(MESSAGE_XML);
  await run();
  const rawText = fs.readFileSync(MESSAGE_XML, 'utf8');

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'gotoSource', actionId: 'OneBody', body: 'body', section: 'header',
  });
  eq('mở đúng một editor', fakeVscode.window.shown.length, 1);
  const shownHeader = fakeVscode.window.shown[0];
  eq('đúng file', shownHeader.uri.fsPath, MESSAGE_XML);
  const hStart = shownHeader.editor.document.offsetAt(shownHeader.options.selection.start);
  const hEnd = shownHeader.editor.document.offsetAt(shownHeader.options.selection.end);
  const headerPicked = rawText.slice(hStart, hEnd);
  ok('chọn trọn <header>…</header>, đúng nội dung', headerPicked.startsWith('<header>') && headerPicked.endsWith('</header>') && headerPicked.includes('{!h_so_ct}'));

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'gotoSource', actionId: 'TwoBodies', body: 'body2', section: 'footer',
  });
  eq('mở thêm một editor cho lượt goto thứ hai', fakeVscode.window.shown.length, 2);
  const shownFooter = fakeVscode.window.shown[1];
  const fStart = shownFooter.editor.document.offsetAt(shownFooter.options.selection.start);
  const fEnd = shownFooter.editor.document.offsetAt(shownFooter.options.selection.end);
  const footerPicked = rawText.slice(fStart, fEnd);
  ok('đúng footer của body2, không lẫn body', footerPicked.startsWith('<footer>') && footerPicked.endsWith('</footer>'));
}

section('xem mail — đi tới định nghĩa: phần không tồn tại thì cảnh báo, không mở gì cả');
{
  reset();
  open(MESSAGE_XML);
  await run();

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'gotoSource', actionId: 'OneBody', body: 'body', section: 'detail',
  });
  eq('không mở editor nào — OneBody/body không có <detail>', fakeVscode.window.shown.length, 0);
  eq('có cảnh báo', fakeVscode.window.asked.warning.length, 1);
  ok('cảnh báo nói rõ thiếu gì', /detail/.test(fakeVscode.window.asked.warning[0]));
}

section('xem mail — panel nhúng sẵn phân tích cột/dòng cho mẫu có bảng');
{
  reset();
  open(TABLE_XML);
  await run();
  const html = fakeVscode.window.panels[0].webview.html;
  ok('nhúng bề rộng cột 1 (100)', html.includes('"width":100'));
  ok('nhúng bề rộng cột 2 (200)', html.includes('"width":200'));
  ok('có control bật/tắt sửa cấu trúc', html.includes('id="fboMailEdit"'));
  ok('có nút thêm dòng', html.includes('id="fboAddRowBtn"'));
}

section('xem mail — kéo giãn cột: đúng plan, đúng nội dung hộp thoại, gọi applySplice đúng splice');
{
  reset();
  open(TABLE_XML);
  await run();

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'resizeColumn', actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 150,
  });

  eq('đúng một hộp thoại xác nhận', fakeDialog.shown.length, 1);
  ok('hộp thoại nói rõ cột nào, rộng bao nhiêu', /cột 1.*150px/.test(JSON.stringify(fakeDialog.shown[0].body)));
  eq('đúng một lượt gọi applySplice', fakeEditHost.calls.length, 1);
  const { plan } = fakeEditHost.calls[0];
  eq('đúng một splice', plan.edits.length, 1);
  eq('splice đúng file', plan.edits[0].file, TABLE_XML);
  eq('splice ghi đúng số mới', plan.edits[0].text, '150');
  eq('KHÔNG nhờ applySplice hỏi lại (đã tự hỏi ở trên)', plan.warning, null);

  const raw = fs.readFileSync(TABLE_XML, 'utf8');
  eq('splice trỏ đúng dải chữ số "100" gốc', raw.slice(plan.edits[0].start, plan.edits[0].end), '100');
}

section('xem mail — kéo giãn cột: huỷ ở hộp thoại thì KHÔNG ghi gì');
{
  reset();
  open(TABLE_XML);
  await run();
  fakeDialog.answer = 'cancel';

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'resizeColumn', actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 150,
  });
  eq('có hỏi', fakeDialog.shown.length, 1);
  eq('nhưng không ghi', fakeEditHost.calls.length, 0);
}

section('xem mail — kéo giãn cột: cột không có width riêng (hoặc số vô lý) thì cảnh báo, KHÔNG hỏi, KHÔNG ghi');
{
  reset();
  open(TABLE_XML);
  await run();

  // Chỉ có 2 cột (0 và 1) — cột số 5 không tồn tại.
  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'resizeColumn', actionId: 'PQApproval', body: 'body', columnIndex: 5, width: 150,
  });
  eq('cảnh báo, không hỏi', fakeVscode.window.asked.warning.length, 1);
  eq('không có hộp thoại xác nhận nào', fakeDialog.shown.length, 0);
  eq('không ghi', fakeEditHost.calls.length, 0);
}

section('xem mail — thêm cột: nhân bản header + detail, tự tăng colspan footer, đúng 3 splice');
{
  reset();
  open(TABLE_XML);
  await run();

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'addColumn', actionId: 'PQApproval', body: 'body', columnIndex: 0,
  });
  eq('đúng một lượt gọi applySplice', fakeEditHost.calls.length, 1);
  const { plan } = fakeEditHost.calls[0];
  eq('ba splice: header + detail + colspan', plan.edits.length, 3);
  ok('cả ba đều cùng file (không có Include ở fixture này)', plan.edits.every((e) => e.file === TABLE_XML));
}

section('xem mail — thêm dòng: hỏi qua QuickPick rồi mới hỏi xác nhận ghi');
{
  reset();
  open(TABLE_XML);
  await run();

  fakeVscode.window.answers.quickPick = [{ row: { section: 'header', rowIndex: 0, preview: 'x' } }];
  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'requestAddRow', actionId: 'PQApproval', body: 'body',
  });

  eq('đúng một QuickPick', fakeVscode.window.asked.quickPick.length, 1);
  const items = fakeVscode.window.asked.quickPick[0].items;
  ok('liệt kê dòng header', items.some((i) => i.label.startsWith('<header>')));
  ok('liệt kê dòng footer', items.some((i) => i.label.startsWith('<footer>')));
  ok('KHÔNG liệt kê dòng nào từ detail', !items.some((i) => i.label.startsWith('<detail>')));

  eq('rồi mới hỏi xác nhận ghi', fakeDialog.shown.length, 1);
  eq('và ghi đúng một splice (nhân bản một dòng)', fakeEditHost.calls[0].plan.edits.length, 1);
}

section('xem mail — thêm dòng: huỷ ở QuickPick thì không hỏi ghi, không ghi');
{
  reset();
  open(TABLE_XML);
  await run();

  fakeVscode.window.answers.quickPick = [undefined];
  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'requestAddRow', actionId: 'PQApproval', body: 'body',
  });
  eq('không hỏi xác nhận ghi', fakeDialog.shown.length, 0);
  eq('không ghi', fakeEditHost.calls.length, 0);
}

section('xem mail — sửa cấu trúc: file dùng chung (Include) được nêu rõ trong hộp thoại, applySplice tự lo cảnh báo riêng của nó');
{
  reset();
  const includeFile = write('App_Data/Controllers/Include/PQHeader.ent', [
    '<header><text><![CDATA[<html><body>',
    '<table><tr><td style="width:100px;">{!h_ma_vt}</td><td style="width:200px;">{!h_ten_vt}</td></tr>',
    ']]></text></header>',
  ]);
  const withIncludeXml = write('App_Data/Controllers/Options/WithInclude.xml', [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!DOCTYPE message [',
    `  <!ENTITY IncludedHeader SYSTEM "${path.relative(path.dirname(path.join(tmp, 'App_Data/Controllers/Options/WithInclude.xml')), includeFile).split(path.sep).join('/')}">`,
    ']>',
    '<message xmlns="urn:schemas-fast-com:data-message">',
    '  <mail><template>',
    '    <action id="PQApproval" table="m92$000000" v="Đề nghị báo giá" e="Price quote">',
    '      <fields/>',
    '      <body>',
    '        &IncludedHeader;',
    '        <detail><text><![CDATA[<tr><td>{!ma_vt}</td><td>{!ten_vt}</td></tr>]]></text></detail>',
    '        <footer><text><![CDATA[</table></body></html>]]></text></footer>',
    '      </body>',
    '    </action>',
    '  </template></mail>',
    '</message>',
  ]);
  open(withIncludeXml);
  await run();

  await fakeVscode.window.panels[0].webview.postMessageFromWebview({
    type: 'resizeColumn', actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 150,
  });
  eq('vẫn ghi được', fakeEditHost.calls.length, 1);
  eq('splice trỏ đúng file Include, không phải Message.xml', fakeEditHost.calls[0].plan.edits[0].file, includeFile);
  const bodyText = JSON.stringify(fakeDialog.shown[0].body);
  ok('hộp thoại của TA nêu rõ tên file dùng chung', bodyText.includes(path.basename(includeFile)));
}

fs.rmSync(tmp, { recursive: true, force: true });

// test-insight-host.mjs — chế độ soi ở TẦNG VỎ.
//
// Core đã trả lời «`&Name;` này bung ra cái gì, từ file nào» (xem `core/test/test-insight.mjs`).
// File này hỏi nốt phần vỏ — không hover, không mục lục, không F12 (extension khác đảm nhận):
//
//   1. Mở một file controller thì có vẽ NGAY không, không cần bấm gì?
//   2. Chú giải một dòng có neo ĐÚNG NGAY SAU `&Name;` không — kể cả khi dòng đó còn thứ khác
//      (`]]>&Name;<![CDATA[`) — chứ không phải ở CUỐI DÒNG, nơi nó trông như thuộc về cả dòng?
//   3. Không có gì khác bị mở ra — không tab, không webview, không hover nào cả?
//   4. `fboDesigner.showInsight = false` có tắt hẳn được không, và bật lại có vẽ lại không?
//   5. Gõ chữ / lưu file có vẽ lại đúng lúc không?
//
// ═══ VÌ SAO FILE NÀY DÙNG MỘT `vscode` RIÊNG ═══
//
// `run.mjs` nạp cả chục file test bằng ESM, và ESM cho các module ANH EM chạy XEN KẼ nhau tại
// mỗi điểm `await`: `test-sample-host.mjs` dừng ở một `await` của nó thì module này chạy tiếp.
// Cả hai lại cùng ghi vào một `fakeVscode.window` — nên một `await` ở đây là `activeTextEditor`
// của file kia bị thay ngay giữa lượt của nó, và nó hỏng ở một chỗ chẳng liên quan gì tới chế độ
// soi. Đã đo được đúng một lần như vậy. Cô lập `window`/`workspace` thì `await` bao nhiêu cũng
// không ai đụng vào ai.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as base from './fake-vscode.mjs';

const vs = {
  ...base,
  window: { ...base.window, panels: [], shown: [] },
  workspace: { ...base.workspace, textDocuments: [], settings: {} },
  commands: { ...base.commands, registered: new Map(), context: {}, executed: [] },
  languages: { ...base.languages },
};
vs.window.asked = { quickPick: [], inputBox: [], warning: [], info: [] };
vs.window.showWarningMessage = (m) => { vs.window.asked.warning.push(m); return undefined; };
vs.window.setStatusBarMessage = () => ({ dispose() {} });
vs.window.statusBar = [];
vs.window.createStatusBarItem = base.window.createStatusBarItem.bind(base.window);
vs.commands.executeCommand = (id, ...args) => {
  vs.commands.executed.push({ id, args });
  if (id === 'setContext') {
    const [key, value] = args;
    vs.commands.context[key] = value;
  }
  return Promise.resolve();
};
vs.commands.registerCommand = (id, fn) => {
  vs.commands.registered.set(id, fn);
  return { dispose() {} };
};
/*
 * `getConfiguration` phải viết LẠI ở đây, không `spread` được — bản của `base.workspace` đóng
 * (closure) trên chính `workspace` của MODULE fake-vscode.mjs, không phải trên `vs.workspace` đã
 * nhân bản. Spread chỉ chép được tham chiếu HÀM, không đổi được chỗ nó đọc `settings`.
 */
vs.workspace.getConfiguration = (section) => {
  const prefix = section ? `${section}.` : '';
  return { get: (key) => vs.workspace.settings[`${prefix}${key}`] };
};

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return vs;
  return originalLoad.call(this, request, ...rest);
};

const { registerInsight, isInsightDocument } = require_('../src/insight-host.js');
const core = await import('../../core/src/index.mjs');

/* ─── Bộ file thật trên đĩa tạm ────────────────────────────────────────────────────────────── */

const NL = '\r\n';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-insight-'));
const dirDir = path.join(tmp, 'App_Data', 'Controllers', 'Dir');
const incDir = path.join(tmp, 'App_Data', 'Controllers', 'Include');
fs.mkdirSync(dirDir, { recursive: true });
fs.mkdirSync(incDir, { recursive: true });

// Ba dòng — đủ để bắt ca «bản bung nhiều dòng vẫn phải ra MỘT DÒNG chú giải, cắt ngắn».
const ROWS = [
  '<item value="11: [ma_vung].Label, [ma_vung]"/>',
  '<item value="12: [ma_kho].Label, [ma_kho]"/>',
  '<item value="13: [ma_bp].Label, [ma_bp]"/>',
].join('\n');
const rowsEnt = path.join(incDir, 'Rows.ent');
fs.writeFileSync(rowsEnt, ROWS, 'utf8');
fs.writeFileSync(path.join(incDir, 'Extra.ent'), '<item value="20: [x].Label, [x]"/>', 'utf8');

const XML = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Nhan "Mã khách">',
  '  <!ENTITY Rows SYSTEM "../Include/Rows.ent">',
  '  <!ENTITY Extra SYSTEM "../Include/Extra.ent">',
  '  <!ENTITY Off "">',
  ']>',
  '<dir>',
  '  <h>&Nhan;</h>',
  '  <rows>&Rows;</rows>',
  '  <off>&Off;</off>',
  '  <chua>&Chua;</chua>',
  // Ca thật của FBO: đóng CDATA, chèn Include, mở CDATA lại — TẤT CẢ trên MỘT dòng. Chú giải
  // phải neo NGAY SAU `&Extra;`, không phải cuối dòng (nơi nó trông như thuộc về `<![CDATA[after`).
  '  <case>]]>&Extra;<![CDATA[after</case>',
  '</dir>',
].join(NL);

const file = path.join(dirDir, 'Site.xml');
fs.writeFileSync(file, XML, 'utf8');
base.seedDisk(file, XML);
base.seedDisk(rowsEnt, ROWS);

/** Editor giả của file XML — `setDecorations` là điểm quan sát. */
function fakeEditor(fsPath, text, column = 1) {
  const painted = new Map();
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return {
    painted,
    viewColumn: column,
    selection: new base.Selection(2, 4, 2, 4),
    document: {
      uri: base.Uri.file(fsPath),
      version: 1,
      isDirty: false,
      getText: () => text,
      positionAt(offset) {
        const at = Math.max(0, Math.min(offset, text.length));
        let line = 0;
        while (line + 1 < starts.length && starts[line + 1] <= at) line++;
        return new base.Position(line, at - starts[line]);
      },
      offsetAt: (pos) => starts[Math.min(pos.line, starts.length - 1)] + pos.character,
      lineAt(line) {
        const from = starts[Math.max(0, Math.min(line, starts.length - 1))];
        const to = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
        return { lineNumber: line, range: new base.Range(line, 0, line, to - from) };
      },
    },
    setDecorations(type, items) { painted.set(type.key, items); },
  };
}

const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const context = { subscriptions: [] };

const editor = fakeEditor(file, XML);
vs.window.visibleTextEditors = [editor];
vs.window.activeTextEditor = editor;
vs.workspace.textDocuments = [editor.document];

const host = registerInsight(context, core, output);

const allPainted = (ed) => [...ed.painted.entries()]
  .flatMap(([key, items]) => items.map((it) => ({ key, ...it })));

/* ─── Phạm vi ──────────────────────────────────────────────────────────────────────────────── */

section('phạm vi — rộng như provider ngôn ngữ, không như designer');
ok('nhận file trong Dir', isInsightDocument({ uri: { scheme: 'file', fsPath: file } }));
ok('nhận cả file trong Include',
  isInsightDocument({ uri: { scheme: 'file', fsPath: path.join(incDir, 'Rows.ent.xml') } }));
ok('không nhận file ngoài Controllers',
  !isInsightDocument({ uri: { scheme: 'file', fsPath: path.join(tmp, 'khac.xml') } }));

/* ─── Mặc định BẬT — vẽ ngay lúc đăng ký, không cần bấm gì ───────────────────────────────────── */

section('mặc định bật — vẽ NGAY lúc đăng ký, không có lệnh/tab/webview nào khác');
ok('KHÔNG có lệnh toggle nào còn sót lại',
  !vs.commands.registered.has('fboDesigner.toggleInsight'));
ok('KHÔNG có lệnh copy nào còn sót lại — hover đã bỏ, không còn chỗ để bấm',
  !vs.commands.registered.has('fboDesigner.insightCopy'));
eq('KHÔNG mở tài liệu / tab nào khác — chỉ vẽ đè lên editor đang có',
  vs.window.shown.length, 0);
eq('KHÔNG mở webview nào', vs.window.panels.length, 0);

const marks = allPainted(editor).filter((it) => it.range && !it.renderOptions);
eq('năm tham chiếu đều có vệt', marks.length, 5);
ok('vệt KHÔNG mang hover — extension khác đã đảm nhận hover',
  marks.every((it) => it.hoverMessage === undefined));

/* ─── Chú giải MỘT DÒNG, neo NGAY SAU `&Name;` ───────────────────────────────────────────────── */

section('chú giải một dòng — neo NGAY SAU `&Name;`, không phải cuối dòng, không tràn dòng');
const notes = allPainted(editor).filter((it) => it.renderOptions);
const noteText = (it) => it.renderOptions.dark.after.contentText;

eq('năm chú giải — đúng một cho mỗi tham chiếu', notes.length, 5);
ok('không mục nào có ký tự xuống dòng — LUÔN một dòng', notes.every((it) => !/[\r\n]/.test(noteText(it))));
ok('mỗi mục là một dải RỖNG — không tô lên chữ nào của file',
  notes.every((it) => it.range.start.line === it.range.end.line
    && it.range.start.character === it.range.end.character));

const rowsLine = XML.split(NL).findIndex((l) => l.includes('&Rows;'));
const rowsNote = notes.find((it) => it.range.start.line === rowsLine);
ok('có chú giải trên dòng của `&Rows;`', !!rowsNote);
eq('neo NGAY SAU `&Rows;` — KHÔNG phải cuối dòng',
  rowsNote.range.start.character, editor.document.getText().split(NL)[rowsLine].indexOf('&Rows;') + '&Rows;'.length);
ok('nội dung là bản MỘT DÒNG đã nuốt hết khoảng trắng/xuống dòng và cắt ngắn (`ref.inline`)',
  noteText(rowsNote).includes('[ma_vung]') && noteText(rowsNote).includes('…'),
  noteText(rowsNote));

const oneLine = notes.find((it) => noteText(it).includes('Mã khách'));
ok('entity một dòng hiện nguyên văn ngay sau nó', !!oneLine);
ok('bung ra rỗng thì nói là rỗng', notes.some((it) => noteText(it).includes('rỗng')));
ok('chưa khai thì nói bằng dấu cảnh báo', notes.some((it) => noteText(it).trim() === '⚠'));

section('ca thật FBO — `]]>&Name;<![CDATA[` trên cùng một dòng vẫn neo ĐÚNG vào entity');
const caseLine = XML.split(NL).findIndex((l) => l.includes(']]>&Extra;<![CDATA['));
const extraPos = editor.document.getText().split(NL)[caseLine].indexOf('&Extra;');
const extraNote = notes.find((it) => it.range.start.line === caseLine);
ok('có chú giải trên dòng ấy', !!extraNote);
eq('neo NGAY SAU `&Extra;` — TRƯỚC `<![CDATA[after`, KHÔNG phải ở cuối dòng',
  extraNote.range.start.character, extraPos + '&Extra;'.length);
ok('chú giải KHÔNG lẫn chữ `<![CDATA[after` của phần đuôi dòng vào nội dung',
  !noteText(extraNote).includes('CDATA'), noteText(extraNote));

/* ─── Cấu hình `fboDesigner.showInsight` ─────────────────────────────────────────────────────── */

section('`fboDesigner.showInsight = false` — tắt hẳn, không còn vệt nào');
vs.workspace.settings['fboDesigner.showInsight'] = false;
const offInsight = host.paint(editor);
eq('không trả về bản soi nào', offInsight, null);
eq('không có vệt nào được vẽ', allPainted(editor).length, 0);

section('bật lại — vẽ lại đúng như trước');
delete vs.workspace.settings['fboDesigner.showInsight'];
const onInsight = host.paint(editor);
ok('có bản soi trở lại', !!onInsight);
eq('lại đủ năm vệt', allPainted(editor).filter((it) => it.range && !it.renderOptions).length, 5);

vs.workspace.settings['fboDesigner.showInsight'] = true;
const explicitOn = host.paint(editor);
ok('khai tường minh `true` cũng vẽ bình thường', !!explicitOn);

/* ─── Vẽ lại một editor KHÁC của CÙNG file — `paint` không phụ thuộc editor cụ thể nào ────────── */

section('editor khác của cùng file cũng vẽ được — `paint` chỉ cần đúng `document`');
const editor2 = fakeEditor(file, XML);
host.paint(editor2);
ok('editor2 cũng có vệt', allPainted(editor2).filter((it) => it.range && !it.renderOptions).length > 0);

/* ─── file ngoài phạm vi ──────────────────────────────────────────────────────────────────────*/

section('file ngoài phạm vi — không vẽ gì, và không nổ');
const other = fakeEditor(path.join(tmp, 'khac.xml'), '<a>&Nhan;</a>');
const otherInsight = host.paint(other);
eq('không trả về bản soi nào', otherInsight, null);
eq('không có vệt nào được vẽ', allPainted(other).length, 0);

fs.rmSync(tmp, { recursive: true, force: true });
Module._load = originalLoad;

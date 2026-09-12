// test-mail-designer-editor.mjs — Email Designer ở tầng vỏ: giao kèo host ↔ webview.
//
// Core đã kiểm dựng/sửa khứ hồi (`core/test/test-mail-html.mjs`, `test-mail-edit.mjs`). Ở đây kiểm
// LUỒNG: host chỉ tin bản đã lọc của `validateMailMessage`, từ chối `rev` cũ, gọi `applySplice`
// (thay bằng bản giả — hạ tầng chung đã phục vụ Dir/Grid) đúng file/dải/nhãn, hoàn tác đi qua chồng
// chung, và document đổi thì vẽ lại ĐÚNG MỘT lần — không phải vòng lặp.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const fakeEditHost = {
  calls: [],
  result: true,
  reset() { fakeEditHost.calls = []; fakeEditHost.result = true; fakeEditHost.onApply = null; },
  onApply: null,
  async applySplice(plan, hostDocument, output, label) {
    fakeEditHost.calls.push({ plan, hostDocument, label });
    if (fakeEditHost.onApply) fakeEditHost.onApply(plan);
    return fakeEditHost.result;
  },
};
const fakeHistory = {
  calls: [],
  undo() { fakeHistory.calls.push('undo'); return true; },
  redo() { fakeHistory.calls.push('redo'); return true; },
};
const fakeDialog = {
  shown: [],
  answer: 'delete',
  reset() { fakeDialog.shown = []; fakeDialog.answer = 'delete'; },
  async ask(options) { fakeDialog.shown.push(options); return fakeDialog.answer; },
};
const fakeOverlay = class OverlayDialogs {
  constructor() { this.pending = new Map(); }
  handleMessage() { return false; }
  dispose() {}
  async ask(options) { return fakeDialog.ask(options); }
  async show(options) { return { action: 'confirm', buttonId: await fakeDialog.ask(options) }; }
};
const fakeLicense = {
  active: true,
  async ensureLicense() { return fakeLicense.active ? { active: true } : null; },
  lockedWebviewHtml: (m) => `<locked>${m}</locked>`,
};

const previousLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  if (request === './edit-host') return fakeEditHost;
  if (request === './edit-history') return { history: () => fakeHistory };
  if (request === './license') return fakeLicense;
  if (request === './dialog/dialog-service') {
    return {
      dialogs: () => fakeDialog,
      runWithDialogs: (_host, fn) => fn(),
    };
  }
  if (request === './dialog/dialog-overlay') return { OverlayDialogs: fakeOverlay };
  return previousLoad.call(this, request, ...rest);
};

const {
  MailDesignerProvider, openMailDesigner, VIEW_TYPE, resetForTests,
} = require_('../src/mail-designer-editor.js');
const core = await import('../../core/src/index.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-mail-designer-'));
const MESSAGE_XML = path.join(tmp, 'App_Data', 'Controllers', 'Options', 'Message.xml');
fs.mkdirSync(path.dirname(MESSAGE_XML), { recursive: true });
const SIGNATURE = path.join(path.dirname(MESSAGE_XML), 'Signature.inc');
fs.writeFileSync(SIGNATURE, '&lt;p&gt;Chân thư&lt;/p&gt;', 'utf8');
const SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE message [
  <!ENTITY HeaderColor "background-color:#edede2;">
  <!ENTITY Signature SYSTEM "Signature.inc">
]>
<message xmlns="urn:schemas-fast-com:data-message">
  <mail>
    <template>
      <action id="Order" v="Đơn hàng" e="Order">
        <fields><field name="h_so_ct"><header v="Số phiếu" e="Number"/></field></fields>
        <body>
          <header><text><![CDATA[<html><body>
<h2 style="color:#333;">Xin chào {!ten_kh}</h2>
<table><tr><td style="width:100px;]]>&HeaderColor;<![CDATA[">{!h_so_ct}</td></tr>
]]></text></header>
          <detail><text><![CDATA[<tr><td>x</td></tr>]]></text></detail>
          <footer><text><![CDATA[</table>]]>&Signature;<![CDATA[</body></html>]]></text></footer>
        </body>
        <body2>
          <header><text><![CDATA[<html><body><p>Biến thể 2</p></body></html>]]></text></header>
        </body2>
      </action>
      <action id="Alert" v="Cảnh báo" e="Alert">
        <fields/>
        <body>
          <header><text><![CDATA[<html><body><p>Cảnh báo tồn kho</p></body></html>]]></text></header>
        </body>
      </action>
    </template>
  </mail>
</message>
`;
fs.writeFileSync(MESSAGE_XML, SOURCE, 'utf8');
fakeVscode.seedDisk(MESSAGE_XML, SOURCE);

const context = { extensionUri: fakeVscode.Uri.file(path.resolve(HERE, '..')) };
const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function documentOf(file, text) {
  const doc = fakeVscode.textDocument(fakeVscode.Uri.file(file), text);
  doc.current = text;
  doc.getText = () => doc.current;
  return doc;
}

async function open(doc = documentOf(MESSAGE_XML, SOURCE), coreImpl = core) {
  const panel = fakeVscode.window.createWebviewPanel(VIEW_TYPE, 'Email Designer', {}, {});
  const provider = new MailDesignerProvider(context, coreImpl, output);
  const session = await provider.resolveCustomTextEditor(doc, panel);
  const send = (msg) => panel.webview.postMessageFromWebview(msg);
  const renders = () => panel.webview.posted.filter((m) => m.type === 'render');
  return {
    doc, panel, session, send, renders, last: () => renders().at(-1),
  };
}

function reset() {
  fakeVscode.window.reset();
  fakeVscode.workspace.changeListeners = [];
  fakeVscode.workspace.watchers = [];
  fakeVscode.workspace.textDocuments = [];
  fakeVscode.window.selectionListeners = [];
  fakeVscode.window.visibleTextEditors = [];
  fakeEditHost.reset();
  fakeHistory.calls = [];
  fakeDialog.reset();
  fakeLicense.active = true;
  output.lines = [];
  resetForTests();
}

const idOf = (render, tag, n = 0) => render.elements.filter((e) => e.tag === tag)[n].id;

section('email designer — chưa có license');
{
  reset();
  fakeLicense.active = false;
  const { panel, session } = await open();
  eq('không mở session', session, null);
  ok('webview khoá, không bật script', panel.webview.html.startsWith('<locked>') && panel.webview.options.enableScripts === false);
}

section('email designer — mở: shell + CSP, vẽ khi webview báo ready');
{
  reset();
  const t = await open();
  ok('shell nạp mail-designer.js theo nonce', /script-src 'nonce-[A-Za-z0-9]{32}'/.test(t.panel.webview.html) && t.panel.webview.html.includes('mail-designer.js'));
  ok('shell không nhúng nội dung mẫu mail', !t.panel.webview.html.includes('Xin chào'));
  ok('iframe sandbox không script', t.panel.webview.html.includes('sandbox="allow-same-origin"'));
  eq('chỉ một gốc tài nguyên (media)', t.panel.webview.options.localResourceRoots.length, 1);
  eq('chưa vẽ trước ready', t.renders().length, 0);

  await t.send({ type: 'ready' });
  const r = t.last();
  ok('vẽ sau ready', !!r);
  eq('rev bắt đầu từ 1', r.rev, 1);
  eq('mặc định action/body đầu, tiếng Việt', r.template, { actionId: 'Order', body: 'body', lang: 'vi' });
  ok('html mang data-fbo-el', r.html.includes('data-fbo-el="e1"'));
  ok('nhãn field đã thay', r.html.includes('Số phiếu'));
  ok('danh sách thuộc tính style đi kèm', r.styleProperties.text.includes('font-size'));
  eq('danh sách mẫu', r.actions.map((a) => [a.id, a.bodies]), [['Order', ['body', 'body2']], ['Alert', ['body']]]);
  t.panel.dispose();
  eq('dispose gỡ listener đổi document', fakeVscode.workspace.changeListeners.length, 0);
}

section('email designer — thông điệp không hợp lệ bị bỏ, không chạm file');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  await t.send({ type: 'edit', op: 'setText', rev: 1, elementId: 'e1"]', value: 'x' });
  await t.send({ type: 'edit', op: 'eval', rev: 1 });
  eq('không applySplice nào', fakeEditHost.calls.length, 0);
  ok('ghi lý do ra Output', output.lines.filter((l) => l.includes('bỏ thông điệp')).length === 2);
}

section('email designer — setText: rev cũ bị từ chối rồi vẽ lại; rev đúng thì ghi');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const h2 = idOf(t.last(), 'h2');

  await t.send({ type: 'edit', op: 'setText', rev: 0, elementId: h2, value: 'Chào bạn' });
  eq('rev cũ → không ghi', fakeEditHost.calls.length, 0);
  ok('rev cũ → báo người dùng', fakeVscode.window.asked.warning.some((w) => w.includes('bản vẽ đã cũ')));
  await sleep(80);
  eq('rev cũ → vẽ lại một lần', t.last().rev, 2);

  await t.send({
    type: 'edit', op: 'setText', rev: 2, elementId: h2, value: 'Chào bạn {!ten_kh}', start: 0, end: 10,
  });
  eq('rev đúng → applySplice đúng một lần', fakeEditHost.calls.length, 1);
  const call = fakeEditHost.calls[0];
  eq('nhãn hoàn tác', call.label, 'mail: sửa chữ <h2>');
  eq('không đụng file khác → không cảnh báo dùng chung', call.plan.warning, null);
  eq('một edit, vào đúng Message.xml', call.plan.edits.map((e) => path.basename(e.file)), ['Message.xml']);
  const e = call.plan.edits[0];
  const written = SOURCE.slice(0, e.start) + e.text + SOURCE.slice(e.end);
  ok('áp edit ra đúng chữ, token giữ nguyên, trường start/end của webview bị bỏ qua',
    written.includes('<h2 style="color:#333;">Chào bạn {!ten_kh}</h2>') && written.length === SOURCE.length + ('Chào bạn {!ten_kh}'.length - 'Xin chào {!ten_kh}'.length));
  eq('document là chính document của editor', call.hostDocument, t.doc);
}

section('email designer — từ chối có lý do, noop im lặng');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  const td = idOf(r, 'td');

  await t.send({
    type: 'edit', op: 'setStyle', rev: r.rev, elementId: td, property: 'color', value: 'red',
  });
  eq('style bị entity cắt → không ghi', fakeEditHost.calls.length, 0);
  ok('lý do nhắc tới entity', fakeVscode.window.asked.warning.some((w) => w.includes('entity')));

  const before = fakeVscode.window.asked.warning.length;
  await t.send({
    type: 'edit', op: 'setText', rev: t.last().rev, elementId: idOf(r, 'h2'), value: 'Xin chào {!ten_kh}',
  });
  eq('gõ lại y nguyên → không ghi', fakeEditHost.calls.length, 0);
  eq('gõ lại y nguyên → không cảnh báo', fakeVscode.window.asked.warning.length, before);


  await t.send({ type: 'undo' });
  await t.send({ type: 'redo' });
  eq('hoàn tác/làm lại đi qua chồng chung', fakeHistory.calls, ['undo', 'redo']);
}

section('email designer — setAttr và dữ liệu bảng thuộc tính (Phase 4)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  ok('render mang bảng panel theo loại + giá trị liệt kê', !!r.componentPanels.image && r.attributeEnums.align.includes('center'));
  const td = r.elements.find((e) => e.tag === 'td');
  eq('phần tử mang kind / attrNames / attrLocks', [td.kind, td.attrNames.includes('align'), td.attrLocks], ['container', true, {}]);

  await t.send({
    type: 'edit', op: 'setAttr', rev: r.rev, elementId: td.id, name: 'align', value: 'center',
  });
  eq('setAttr → applySplice đúng một lần', fakeEditHost.calls.length, 1);
  const call = fakeEditHost.calls[0];
  eq('nhãn hoàn tác', call.label, 'mail: align <td>');
  const e = call.plan.edits[0];
  const written = SOURCE.slice(0, e.start) + e.text + SOURCE.slice(e.end);
  ok('chèn align sau dấu nháy, vẫn trong CDATA sau entity', written.includes('<![CDATA[" align="center">{!h_so_ct}'));

  await t.send({
    type: 'edit', op: 'setAttr', rev: r.rev, elementId: td.id, name: 'align', value: 'middle',
  });
  eq('giá trị sai kiểu bị bộ kiểm chặn trước khi tới plan', fakeEditHost.calls.length, 1);
  ok('ghi lý do ra Output', output.lines.some((l) => l.includes('không hợp lệ')));

  const h2 = r.elements.find((x) => x.tag === 'h2');
  await t.send({
    type: 'edit', op: 'setAttr', rev: r.rev, elementId: h2.id, name: 'align', value: 'center',
  });
  ok('thẻ không có thuộc tính cho sửa → cảnh báo, không ghi',
    fakeEditHost.calls.length === 1 && fakeVscode.window.asked.warning.some((w) => w.includes('không có thuộc tính')));
}

section('email designer — xoá / chèn / di chuyển (Phase 5)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  ok('render mang danh sách component chèn được', r.components.some((c) => c.kind === 'button') && r.components.every((c) => c.label));
  const h2 = r.elements.find((e) => e.tag === 'h2');
  const body = r.elements.find((e) => e.tag === 'body');
  const td = r.elements.find((e) => e.tag === 'td');
  eq('phần tử mang moveTargets + insertPositions', [h2.moveTargets.up, h2.insertPositions.after], [null, true]);

  fakeDialog.answer = 'cancel';
  await t.send({
    type: 'edit', op: 'removeElement', rev: r.rev, elementId: h2.id,
  });
  ok('xoá → hỏi xác nhận, nêu tên thẻ', fakeDialog.shown.length === 1 && fakeDialog.shown[0].title.includes('<h2>'));
  eq('huỷ ở hộp thoại → không ghi', fakeEditHost.calls.length, 0);

  fakeDialog.answer = 'delete';
  await t.send({
    type: 'edit', op: 'removeElement', rev: r.rev, elementId: h2.id,
  });
  eq('đồng ý → ghi', fakeEditHost.calls.length, 1);
  eq('nhãn hoàn tác', fakeEditHost.calls[0].label, 'mail: xoá <h2>');
  eq('chọn lại theo selectId của plan (h2 là con đầu → cha <body>)', t.session.selectAfter, body.id);

  fakeVscode.workspace.settings['fboDesigner.confirmDelete'] = false;
  await t.send({
    type: 'edit', op: 'removeElement', rev: r.rev, elementId: h2.id,
  });
  eq('tắt fboDesigner.confirmDelete → không hỏi thêm', fakeDialog.shown.length, 2);
  eq('… và ghi ngay', fakeEditHost.calls.length, 2);

  await t.send({
    type: 'edit', op: 'insertComponent', rev: r.rev, elementId: h2.id, position: 'after', component: 'divider',
  });
  eq('chèn → ghi', fakeEditHost.calls.length, 3);
  const e = fakeEditHost.calls[2].plan.edits[0];
  ok('đường kẻ chèn ngay sau </h2>', (SOURCE.slice(0, e.start) + e.text + SOURCE.slice(e.end)).includes('</h2><hr style="border:0;'));
  eq('chọn phần tử vừa chèn (id mới)', t.session.selectAfter, 'e4');

  await t.send({
    type: 'edit', op: 'moveElement', rev: r.rev, elementId: h2.id, targetId: td.id, position: 'append',
  });
  eq('kéo thả h2 vào cuối ô → hai edit trong một lần ghi', [fakeEditHost.calls.length, fakeEditHost.calls[3].plan.edits.length], [4, 2]);

  await t.send({
    type: 'edit', op: 'moveElement', rev: r.rev, elementId: h2.id, targetId: 'e99', position: 'before',
  });
  ok('đích không còn như lúc vẽ → cảnh báo, không ghi', fakeEditHost.calls.length === 4 && fakeVscode.window.asked.warning.some((w) => w.includes('đích')));

  await t.send({
    type: 'edit', op: 'moveElement', rev: r.rev, elementId: h2.id, direction: 'up',
  });
  ok('không có anh em phía trên → cảnh báo, không ghi', fakeEditHost.calls.length === 4 && fakeVscode.window.asked.warning.some((w) => w.includes('phía trên')));
}

section('email designer — biến và dữ liệu mẫu (Phase 6)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  eq('mặc định hiện nhãn', r.preview.mode, 'label');
  eq('danh sách biến theo thứ tự xuất hiện', r.variables.map((v) => [v.name, v.kind]), [['ten_kh', 'data'], ['h_so_ct', 'label']]);
  ok('biến dữ liệu hiện thành chip', r.html.includes('data-fbo-var="ten_kh"'));
  const skeleton = JSON.parse(r.sample.skeleton);
  ok('khung dữ liệu mẫu chỉ gồm biến dữ liệu', skeleton.ten_kh === '' && !('h_so_ct' in skeleton));
  ok('render mang sample.keys (stt_rec/contactID)', r.sample.keys
    && r.sample.keys.stt_rec === '' && r.sample.keys.contactID === '');

  await t.send({ type: 'setPreview', mode: 'token' });
  ok('chế độ token: cả nhãn cũng thành chip', t.last().preview.mode === 'token' && t.last().html.includes('data-fbo-var="h_so_ct"'));

  const count = t.renders().length;
  await t.send({ type: 'setSampleData', text: '{ "ten_kh": 5 ' });
  const err = t.panel.webview.posted.at(-1);
  ok('JSON hỏng → sampleError kèm lý do, không vẽ lại', err.type === 'sampleError' && err.reason.includes('JSON') && t.renders().length === count);

  await t.send({ type: 'setSampleData', text: '{"ten_kh":"Nguyễn Văn <A>"}' });
  const s = t.last();
  eq('JSON đúng → chuyển sang xem dữ liệu mẫu', s.preview.mode, 'sample');
  ok('giá trị mẫu thay vào chữ, đã escape', s.html.includes('Xin chào Nguyễn Văn &lt;A&gt;'));
  ok('lưu dạng JSON đã chuẩn hoá', s.sample.text.includes('"ten_kh": "Nguyễn Văn <A>"'));
  eq('dữ liệu mẫu không đi qua phép ghi nào', fakeEditHost.calls.length, 0);
  t.panel.dispose();

  const again = await open();
  await again.send({ type: 'ready' });
  ok('mở lại cùng file → nhớ chế độ và dữ liệu mẫu', again.last().preview.mode === 'sample' && again.last().html.includes('Nguyễn Văn &lt;A&gt;'));
  await again.send({ type: 'setSampleData', text: '' });
  ok('xoá dữ liệu mẫu → biến trở lại chip', again.last().sample.text === '' && again.last().html.includes('data-fbo-var="ten_kh"'));
  await again.send({ type: 'setPreview', mode: 'bogus' });
  ok('mode lạ bị bỏ ở cửa vào', output.lines.some((l) => l.includes('setPreview')));
}

section('email designer — phép bảng trong designer (Phase 7)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  const headTd = r.elements.find((e) => e.tag === 'td');
  const headTr = r.elements.find((e) => e.tag === 'tr');
  eq('ô tiêu đề mang vai trò cột', headTd.table.column, { index: 0, width: 100, header: true });
  eq('hàng tiêu đề mang vai trò dòng', headTr.table.row, { part: 'header', rowIndex: 0 });
  eq('phần tử ngoài bảng: table = null', r.elements.find((e) => e.tag === 'h2').table, null);

  await t.send({
    type: 'edit', op: 'resizeColumn', rev: r.rev, columnIndex: 0, width: 140,
  });
  eq('đổi bề rộng → ghi', fakeEditHost.calls.length, 1);
  eq('nhãn hoàn tác', fakeEditHost.calls[0].label, 'mail: bề rộng cột 1 → 140px');
  const w = fakeEditHost.calls[0].plan.edits[0];
  ok('chỉ thay đúng chữ số của width:Npx', SOURCE.slice(w.start, w.end) === '100' && w.text === '140');

  await t.send({ type: 'edit', op: 'addColumn', rev: r.rev, columnIndex: 0 });
  eq('nhân bản cột → hai edit (ô tiêu đề + ô dòng mẫu)', fakeEditHost.calls[1].plan.edits.length, 2);
  ok('footer không có colspan → báo để tự kiểm', fakeVscode.window.asked.info.some((m) => m.includes('colspan')));

  await t.send({
    type: 'edit', op: 'addRow', rev: r.rev, part: 'header', rowIndex: 0,
  });
  eq('nhân bản dòng → ghi', [fakeEditHost.calls.length, fakeEditHost.calls[2].label], [3, 'mail: nhân bản dòng 1 <header>']);
  await t.send({
    type: 'edit', op: 'addRow', rev: r.rev, part: 'header', rowIndex: 5,
  });
  ok('dòng không có → cảnh báo, không ghi', fakeEditHost.calls.length === 3 && fakeVscode.window.asked.warning.some((m) => m.includes('dòng số 6')));
}

section('email designer — bám XML hai chiều, không dội vòng (Phase 7)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  const h2 = r.elements.find((e) => e.tag === 'h2');
  const td = r.elements.find((e) => e.tag === 'td');
  const editor = {
    document: t.doc, selection: null, revealed: [], revealRange(range, type) { editor.revealed.push({ range, type }); },
  };
  fakeVscode.window.visibleTextEditors = [editor];
  const cursorAt = (needle) => {
    const pos = t.doc.positionAt(SOURCE.indexOf(needle));
    fakeVscode.window.fireDidChangeTextEditorSelection({ textEditor: editor, selections: [new fakeVscode.Selection(pos, pos)] });
  };
  const reveals = () => t.panel.webview.posted.filter((m) => m.type === 'reveal');

  eq('mặc định bật', r.follow, true);
  cursorAt('Xin chào');
  await sleep(150);
  eq('con trỏ XML vào chữ h2 → designer chọn h2', reveals().map((m) => [m.elementId, m.rev]), [[h2.id, r.rev]]);
  cursorAt('Xin chào');
  await sleep(150);
  eq('con trỏ vẫn trong h2 → không gửi lại', reveals().length, 1);
  cursorAt('<header v="Số phiếu"');
  await sleep(150);
  eq('con trỏ vào <fields> → không đổi lựa chọn', reveals().length, 1);

  await t.send({ type: 'select', rev: r.rev, elementId: td.id });
  const at = t.doc.offsetAt(editor.selection.start);
  ok('designer chọn td → XML đặt vùng chọn vào thẻ mở <td>', SOURCE.slice(at, at + 3) === '<td' && editor.revealed.length === 1);
  fakeVscode.window.fireDidChangeTextEditorSelection({ textEditor: editor, selections: [editor.selection] });
  await sleep(200);
  eq('sự kiện đổi vùng chọn do chính designer đặt → không dội ngược', reveals().length, 1);
  cursorAt('{!ten_kh}');
  await sleep(150);
  eq('người dùng đưa con trỏ về h2 → designer chọn h2 lại', reveals().at(-1).elementId, h2.id);

  await t.send({ type: 'setFollow', on: false });
  cursorAt('{!h_so_ct}');
  await sleep(150);
  eq('tắt Bám XML → không gửi reveal', reveals().length, 2);
  const revealed = editor.revealed.length;
  await t.send({ type: 'select', rev: r.rev, elementId: h2.id });
  eq('tắt Bám XML → XML không bị kéo theo', editor.revealed.length, revealed);

  await t.send({ type: 'setFollow', on: true });
  t.doc.version = 2;
  cursorAt('{!h_so_ct}');
  await sleep(150);
  eq('văn bản đã đổi mà chưa vẽ lại → không đoán theo toạ độ cũ', reveals().length, 2);
}

section('email designer — Include đổi trên đĩa → vẽ lại một lần (Phase 7)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const watchers = fakeVscode.workspace.watchers.filter((w) => !w.disposed);
  eq('theo dõi đúng file Include góp nội dung', watchers.map((w) => w.pattern.pattern), ['Signature.inc']);
  ok('chữ từ Include có trên bản vẽ', t.last().html.includes('Chân thư'));

  const count = t.renders().length;
  watchers[0].fire('change');
  watchers[0].fire('change');
  await sleep(120);
  eq('đổi trên đĩa hai nhịp → vẽ lại một lần', t.renders().length, count + 1);

  fakeVscode.workspace.textDocuments = [documentOf(SIGNATURE, '&lt;p&gt;Chân thư&lt;/p&gt;')];
  watchers[0].fire('change');
  await sleep(120);
  eq('Include đang mở trong VS Code → bỏ qua watcher (thay đổi đã tới qua document)', t.renders().length, count + 1);
  fakeVscode.workspace.textDocuments = [];
  t.panel.dispose();
  ok('đóng editor → gỡ watcher', watchers.every((w) => w.disposed));
}

section('email designer — sửa từ designer: đổi document không thành vòng lặp (Phase 7)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  const h2 = r.elements.find((e) => e.tag === 'h2');
  // Giả đúng thứ VS Code làm: applyEdit bắn một nhịp đổi document, lưu bắn thêm một nhịp nữa.
  fakeEditHost.onApply = (plan) => {
    const e = plan.edits[0];
    t.doc.current = t.doc.current.slice(0, e.start) + e.text + t.doc.current.slice(e.end);
    fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
    fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  };
  const count = t.renders().length;
  await t.send({
    type: 'edit', op: 'setText', rev: r.rev, elementId: h2.id, value: 'Chào {!ten_kh}',
  });
  await sleep(120);
  eq('một phép sửa, hai nhịp đổi document → đúng một lượt vẽ lại', t.renders().length, count + 1);
  ok('bản vẽ theo văn bản mới và chọn lại h2', !t.last().html.includes('Xin chào') && t.last().selectId === h2.id);
  await sleep(250);
  eq('không lượt vẽ nào tự sinh thêm', t.renders().length, count + 1);
  eq('và không ghi thêm lần nào', fakeEditHost.calls.length, 1);
}

section('email designer — xem trước đầy đủ và kiểm mẫu (Phase 8)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  ok('render mang danh sách vấn đề', Array.isArray(r.issues));
  eq('fixture không có lỗi mail client', r.issues.filter((i) => i.severity === 'error'), []);
  eq('mặc định không xem trước', r.fullPreview, false);

  await t.send({ type: 'setSampleData', text: '{"detail":[{"x":1},{"x":2}]}' });
  const p = t.last();
  ok('gõ dữ liệu mẫu → vào thẳng chế độ xem trước, chỉ đọc',
    p.fullPreview === true && p.preview.mode === 'sample' && p.elements.length === 0 && !p.html.includes('data-fbo-el'));
  eq('xem trước: dòng mẫu detail nhân theo dữ liệu mẫu', (p.html.match(/<td>x<\/td>/g) ?? []).length, 2);
  await t.send({
    type: 'edit', op: 'setText', rev: p.rev, elementId: 'e3', value: 'y',
  });
  ok('xem trước: phép sửa bị từ chối kèm lý do', fakeEditHost.calls.length === 0 && fakeVscode.window.asked.warning.some((w) => w.includes('dữ liệu mẫu')));

  await t.send({ type: 'setPreview', mode: 'label' });
  ok('về "Biến: nhãn" → bản vẽ có phần tử trở lại', t.last().fullPreview === false && t.last().elements.length > 0);
  await t.send({ type: 'setPreview', mode: 'token' });
  eq('"Biến: {!tên}" cũng là bản vẽ sửa được', t.last().fullPreview, false);
  await t.send({ type: 'setPreview', mode: 'sample' });
  ok('chọn lại "Biến: dữ liệu mẫu" = xem trước', t.last().fullPreview === true && t.last().elements.length === 0);
}

section('email designer — bám XML: đổi MẪU theo con trỏ, và ngược lại');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  const editor = {
    document: t.doc, selection: null, revealed: [], revealRange(range) { editor.revealed.push(range); },
  };
  fakeVscode.window.visibleTextEditors = [editor];
  const cursorAt = (needle) => {
    const pos = t.doc.positionAt(t.doc.current.indexOf(needle));
    fakeVscode.window.fireDidChangeTextEditorSelection({ textEditor: editor, selections: [new fakeVscode.Selection(pos, pos)] });
  };
  const selectedText = () => {
    const from = t.doc.offsetAt(editor.selection.start);
    const to = t.doc.offsetAt(editor.selection.end);
    return t.doc.current.slice(from, to);
  };

  eq('đang vẽ mẫu đầu', r.template.actionId, 'Order');
  cursorAt('Cảnh báo tồn kho');
  await sleep(200);
  const after = t.last();
  eq('con trỏ XML sang mẫu khác → designer đổi mẫu theo', after.template, { actionId: 'Alert', body: 'body', lang: 'vi' });
  const reveal = t.panel.webview.posted.filter((m) => m.type === 'reveal').at(-1);
  ok('… và chọn đúng phần tử dưới con trỏ trên bản vẽ mới',
    !!reveal && reveal.rev === after.rev && after.elements.find((e) => e.id === reveal.elementId).tag === 'p');

  cursorAt('Biến thể 2');
  await sleep(200);
  eq('con trỏ sang BIẾN THỂ khác của mẫu khác → đổi cả hai', t.last().template.body, 'body2');
  eq('… và về đúng mẫu Order', t.last().template.actionId, 'Order');

  await t.send({
    type: 'selection', actionId: 'Alert', body: 'body', lang: 'vi',
  });
  eq('designer đổi mẫu → XML nhảy tới thẻ mở của action ấy', selectedText(), '<action id="Alert" v="Cảnh báo" e="Alert">');
  ok('… và cuộn tới đó', editor.revealed.length > 0);

  const before = editor.revealed.length;
  await t.send({
    type: 'selection', actionId: 'Alert', body: 'body', lang: 'en',
  });
  eq('chỉ đổi ngôn ngữ, cùng mẫu → không kéo XML đi đâu', editor.revealed.length, before);
}

section('email designer — bấm trúng {!biến} thì con trỏ XML vào đúng token');
{
  // Webview (`tokenAt`): thẻ sở hữu `data-fbo-tok` (kể cả bấm padding ô rộng) gửi `tokenIndex`.
  // Host chỉ nhận số đó — không tự đoán từ elementId.
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const r = t.last();
  const editor = {
    document: t.doc, selection: null, revealed: [], revealRange(range) { editor.revealed.push(range); },
  };
  fakeVscode.window.visibleTextEditors = [editor];
  const selectedText = () => t.doc.current.slice(t.doc.offsetAt(editor.selection.start), t.doc.offsetAt(editor.selection.end));
  const td = r.elements.find((e) => e.tag === 'td');

  ok('bản vẽ gắn số thứ tự token vào chữ đã thay', r.html.includes('data-fbo-tok="1"') && r.html.includes('>Số phiếu</span>'));
  await t.send({
    type: 'select', rev: r.rev, elementId: td.id, tokenIndex: 1,
  });
  eq('chọn token thứ 1 → XML đúng {!h_so_ct}, không phải thẻ <td>', selectedText(), '{!h_so_ct}');

  await t.send({ type: 'select', rev: r.rev, elementId: td.id });
  ok('không có tokenIndex → vẫn là thẻ mở <td>', selectedText().startsWith('<td'));

  await t.send({
    type: 'select', rev: r.rev, elementId: td.id, tokenIndex: 999, reveal: true,
  });
  ok('số thứ tự token không có thật → không ném, không kéo XML sai chỗ', selectedText().startsWith('<td'));
}

section('email designer — nhớ kết quả bung entity (Phase 8)');
{
  reset();
  const spy = { count: 0 };
  const spyCore = { ...core, expandEntities: (...args) => { spy.count++; return core.expandEntities(...args); } };
  const t = await open(undefined, spyCore);
  await t.send({ type: 'ready' });
  eq('vẽ lần đầu: bung một lần', spy.count, 1);
  await t.send({ type: 'setPreview', mode: 'token' });
  await t.send({
    type: 'selection', actionId: 'Order', body: 'body2', lang: 'vi',
  });
  await t.send({
    type: 'selection', actionId: 'Order', body: 'body', lang: 'vi',
  });
  await t.send({ type: 'setFullPreview', on: true });
  await t.send({ type: 'setFullPreview', on: false });
  eq('đổi chế độ / biến thể / xem trước — văn bản không đổi → không bung lại', spy.count, 1);

  t.doc.current = SOURCE.replace('Xin chào', 'Kính gửi');
  fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  await sleep(100);
  eq('Message.xml đổi → bung lại', spy.count, 2);

  const original = fs.readFileSync(SIGNATURE, 'utf8');
  fs.writeFileSync(SIGNATURE, '&lt;p&gt;Chân thư đã đổi&lt;/p&gt;', 'utf8');
  fs.utimesSync(SIGNATURE, new Date(), new Date(Date.now() + 5000));
  await t.send({ type: 'setPreview', mode: 'label' });
  eq('Include đổi trên đĩa → bung lại', spy.count, 3);
  ok('… và thấy nội dung mới của Include', t.last().html.includes('Chân thư đã đổi'));
  fs.writeFileSync(SIGNATURE, original, 'utf8');
}

section('email designer — lỗi nội bộ không làm designer đứng hình (Phase 8)');
{
  reset();
  const broken = { ...core, mailVariables: () => { throw new Error('nổ lúc vẽ'); } };
  const t = await open(undefined, broken);
  await t.send({ type: 'ready' });
  const err = t.panel.webview.posted.find((m) => m.type === 'error');
  ok('lỗi trong lúc vẽ → khung báo lỗi', !!err && err.message.includes('nổ lúc vẽ'));
  ok('… và ghi đủ ra Output', output.lines.some((l) => l.includes('vẽ lỗi') && l.includes('nổ lúc vẽ')));

  reset();
  const failing = { ...core, mailElementClearRange: () => { throw new Error('nổ lúc mở XML'); } };
  const u = await open(undefined, failing);
  await u.send({ type: 'ready' });
  const h2 = u.last().elements.find((e) => e.tag === 'h2');
  let threw = false;
  try {
    await u.send({
      type: 'select', rev: u.last().rev, elementId: h2.id, reveal: true,
    });
  } catch {
    threw = true;
  }
  ok('lỗi khi xử lý thông điệp không ném ra ngoài', !threw);
  ok('… báo người dùng xem Output, ghi lại loại thông điệp', fakeVscode.window.asked.warning.some((w) => w.includes('Output'))
    && output.lines.some((l) => l.includes('"select"') && l.includes('nổ lúc mở XML')));
}

section('email designer — đổi biến thể, nhớ lựa chọn theo file');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  await t.send({
    type: 'selection', actionId: 'Order', body: 'body2', lang: 'en',
  });
  eq('vẽ biến thể mới', t.last().template, { actionId: 'Order', body: 'body2', lang: 'en' });
  ok('html của body2', t.last().html.includes('Biến thể 2'));
  t.panel.dispose();

  const again = await open();
  await again.send({ type: 'ready' });
  eq('mở lại cùng file → nhớ biến thể', again.last().template.body, 'body2');
  await again.send({
    type: 'selection', actionId: 'Order', body: 'body9', lang: 'vi',
  });
  eq('body không còn → rơi về body đầu', again.last().template.body, 'body');
}

section('email designer — document đổi: vẽ lại đúng một lần, file lạ thì không');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const count = t.renders().length;

  t.doc.current = SOURCE.replace('Xin chào', 'Kính gửi');
  fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  await sleep(80);
  eq('hai nhịp đổi → một lượt vẽ', t.renders().length, count + 1);
  ok('bản vẽ theo văn bản mới', t.last().html.includes('Kính gửi'));

  fakeVscode.workspace.fireDidChangeTextDocument({ document: documentOf(path.join(tmp, 'Other.xml'), '<x/>') });
  await sleep(80);
  eq('file không góp nội dung → không vẽ', t.renders().length, count + 1);
}

section('email designer — mở XML');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  await t.send({
    type: 'select', rev: t.last().rev, elementId: idOf(t.last(), 'h2'), reveal: true,
  });
  eq('Ctrl+click mở đúng Message.xml', fakeVscode.window.shown.map((s) => path.basename(s.uri.fsPath)), ['Message.xml']);
  const opened = fakeVscode.window.shown[0].editor.revealed.length;
  ok('và cuộn tới phần tử', opened === 1);

  await t.send({ type: 'select', rev: t.last().rev, elementId: idOf(t.last(), 'h2') });
  eq('click thường không mở gì', fakeVscode.window.shown.length, 1);

  await t.send({ type: 'gotoSource', section: 'footer' });
  eq('đi tới part footer', fakeVscode.window.shown.length, 2);
}

section('email designer — file không phải mẫu mail');
{
  reset();
  const t = await open(documentOf(path.join(tmp, 'Dir.xml'), '<dir xmlns="urn:schemas-fast-com:data-dir"/>'));
  await t.send({ type: 'ready' });
  const idle = t.panel.webview.posted.find((m) => m.type === 'idle');
  ok('báo idle kèm hướng dẫn', !!idle && idle.message.includes('data-message'));
  eq('không vẽ mẫu nào', t.renders().length, 0);
}

section('email designer — đăng ký provider và nhánh mở từ Message.xml');
{
  reset();
  MailDesignerProvider.register(context, core, output);
  const reg = fakeVscode.window.customEditors.get('fboDesigner.mail');
  ok('đăng ký đúng viewType', !!reg);
  ok('nhiều editor trên một document + giữ context khi ẩn',
    reg.options.supportsMultipleEditorsPerDocument === true && reg.options.webviewOptions.retainContextWhenHidden === true);

  fakeVscode.commands.executed = [];
  fakeVscode.window.activeTextEditor = { document: documentOf(MESSAGE_XML, SOURCE) };
  await openMailDesigner(core);
  const openWith = fakeVscode.commands.executed.find((c) => c.id === 'vscode.openWith');
  ok('mẫu mail → vscode.openWith với fboDesigner.mail', !!openWith && openWith.args[1] === 'fboDesigner.mail');

  fakeVscode.commands.executed = [];
  fakeVscode.window.activeTextEditor = { document: documentOf(path.join(tmp, 'Dir.xml'), '<dir/>') };
  await openMailDesigner(core);
  ok('không phải mẫu mail → cảnh báo, không mở', fakeVscode.commands.executed.length === 0 && fakeVscode.window.asked.warning.some((w) => w.includes('Email Designer')));
  fakeVscode.window.activeTextEditor = undefined;
}

fs.rmSync(tmp, { recursive: true, force: true });

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
  reset() { fakeEditHost.calls = []; fakeEditHost.result = true; },
  async applySplice(plan, hostDocument, output, label) {
    fakeEditHost.calls.push({ plan, hostDocument, label });
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
  if (request === './dialog/dialog-service') return { dialogs: () => fakeDialog };
  return previousLoad.call(this, request, ...rest);
};

const {
  MailDesignerProvider, openMailDesigner, VIEW_TYPE, resetForTests,
} = require_('../src/mail-designer-editor.js');
const core = await import('../../core/src/index.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-mail-designer-'));
const MESSAGE_XML = path.join(tmp, 'App_Data', 'Controllers', 'Options', 'Message.xml');
fs.mkdirSync(path.dirname(MESSAGE_XML), { recursive: true });
const SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE message [
  <!ENTITY HeaderColor "background-color:#edede2;">
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
          <footer><text><![CDATA[</table></body></html>]]></text></footer>
        </body>
        <body2>
          <header><text><![CDATA[<html><body><p>Biến thể 2</p></body></html>]]></text></header>
        </body2>
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

async function open(doc = documentOf(MESSAGE_XML, SOURCE)) {
  const panel = fakeVscode.window.createWebviewPanel(VIEW_TYPE, 'Email Designer', {}, {});
  const provider = new MailDesignerProvider(context, core, output);
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
  eq('danh sách mẫu', r.actions.map((a) => [a.id, a.bodies]), [['Order', ['body', 'body2']]]);
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

  await t.send({
    type: 'edit', op: 'addColumn', rev: t.last().rev, columnIndex: 0,
  });
  ok('phép bảng của «Xem mail» chưa nối vào designer → báo chưa hỗ trợ', fakeVscode.window.asked.warning.some((w) => w.includes('chưa hỗ trợ')));
  eq('… và không ghi', fakeEditHost.calls.length, 0);

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

section('email designer — đăng ký provider và lệnh mở');
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

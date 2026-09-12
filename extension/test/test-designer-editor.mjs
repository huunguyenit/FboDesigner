// test-designer-editor.mjs — characterization test cho dispatch message của FboDesignerProvider
// (custom editor tab, `designer-editor.js`), TRƯỚC khi Phase 2 rút phần dispatch dùng chung với
// `preview-panel.js` ra `designer-session.js`. Mục tiêu: chốt lại hành vi HIỆN TẠI (ready/setLang/
// select/undo/redo/edit patchable-hay-không/reloadAssets/assets/log) để việc tách không đổi hành
// vi — không phải kiểm tra tính đúng đắn của `handleEdit`/`applySplice` (core đã có test riêng),
// nên hai thứ đó bị fake giống hệt cách `test-mail-designer-editor.mjs` fake `./edit-host`.

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
  onApply: null,
  reset() { fakeEditHost.calls = []; fakeEditHost.result = true; fakeEditHost.onApply = null; },
  async handleEdit(msg, core, hostDocument, rebuild, output) {
    fakeEditHost.calls.push({
      msg, hostDocument, rebuild, output,
    });
    if (fakeEditHost.onApply) fakeEditHost.onApply(msg, hostDocument);
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
  async ask(options) { fakeDialog.shown.push(options); return null; },
};
const fakeOverlay = class OverlayDialogs {
  constructor() { this.pending = new Map(); }

  handleMessage() { return false; }

  dispose() {}
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

const { FboDesignerProvider, VIEW_TYPE } = require_('../src/designer-editor.js');
const sampleStore = require_('../src/sample-store.js');
const core = await import('../../core/src/index.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-designer-editor-'));
const dirFolder = path.join(tmp, 'App_Data', 'Controllers', 'Dir');
fs.mkdirSync(dirFolder, { recursive: true });
const KHO_XML = path.join(dirFolder, 'Kho.xml');

const NL = '\r\n';
// Cùng fixture với core/test/test-edit.mjs — hàng `ten_kho` gộp/tách được (span 1 → 2), hàng
// `ma_kho` đã full nên `resize` trên nó bị TỪ CHỐI (không dùng ở đây, chỉ ten_kho).
const SOURCE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    <item value="11--: [ten_kho].Label, [ten_kho]"/>',
  '  </view>',
  '</dir>',
].join(NL);
fs.writeFileSync(KHO_XML, SOURCE, 'utf8');
fakeVscode.seedDisk(KHO_XML, SOURCE);

const context = { extensionUri: fakeVscode.Uri.file(path.resolve(HERE, '..')) };
const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function documentOf(file, text) {
  const doc = fakeVscode.textDocument(fakeVscode.Uri.file(file), text);
  doc.current = text;
  doc.getText = () => doc.current;
  return doc;
}

async function open(doc = documentOf(KHO_XML, SOURCE)) {
  const panel = fakeVscode.window.createWebviewPanel(VIEW_TYPE, 'FBO Designer', {}, {});
  const provider = new FboDesignerProvider(context, core, output);
  await provider.resolveCustomTextEditor(doc, panel);
  const send = (msg) => panel.webview.postMessageFromWebview(msg);
  const renders = () => panel.webview.posted.filter((m) => m.type === 'render');
  const patches = () => panel.webview.posted.filter((m) => m.type === 'patchRow');
  return {
    doc, panel, send, renders, patches, last: () => panel.webview.posted.at(-1),
  };
}

function reset() {
  fakeVscode.window.reset();
  fakeVscode.workspace.changeListeners = [];
  fakeVscode.workspace.watchers = [];
  fakeVscode.workspace.textDocuments = [];
  fakeVscode.window.selectionListeners = [];
  fakeVscode.window.visibleTextEditors = [];
  // Tắt tự nạp dữ liệu thật: không phải thứ dispatch test này quan tâm, và bật lên là một lượt
  // `sqlcmd` giả lập không kiểm soát được chạy ngầm mỗi lần mở panel.
  fakeVscode.workspace.settings['fboDesigner.autoLoadSampleData'] = false;
  fakeEditHost.reset();
  fakeHistory.calls = [];
  fakeDialog.shown = [];
  fakeLicense.active = true;
  output.lines = [];
  sampleStore.clearAll();
}

/*
 * Chỉ số hàng theo TÊN FIELD — tính ĐỘC LẬP với payload gửi qua webview, vì `render()` bóc
 * `model` ra khỏi payload trước khi `postMessage` (nó mang Map/getter, không clone được — xem
 * `designer-editor.js#render`). Dựng lại model y hệt `core/test/test-edit.mjs#build`.
 */
function rowIndexOf(field) {
  const ex = core.expandEntities(SOURCE, { filePath: KHO_XML, readFile: () => null });
  const r = core.renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: KHO_XML });
  return r.model.rows.find((row) => row.row.tokens.some((t) => t.field === field)).index;
}

section('designer-editor — chưa có license');
{
  reset();
  const t = await open();
  fakeLicense.active = false;
  const t2 = await open();
  ok('webview khoá, không bật script', t2.panel.webview.html.startsWith('<locked>') && t2.panel.webview.options.enableScripts === false);
  eq('chưa vẽ gì', t2.renders().length, 0);
  void t;
}

section('designer-editor — mở: vẽ khi ready, tôn trọng vi');
{
  reset();
  const t = await open();
  eq('chưa vẽ trước ready', t.renders().length, 0);
  await t.send({ type: 'ready', vi: false });
  const r = t.last();
  eq('vẽ sau ready', r.type, 'render');
  ok('nhãn field theo tiếng Anh (vi=false)', r.html.includes('Name'));
}

section('designer-editor — setLang vẽ lại theo ngôn ngữ mới');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  ok('mặc định tiếng Việt', t.last().html.includes('Tên kho'));
  await t.send({ type: 'setLang', vi: false });
  ok('setLang → vẽ lại tiếng Anh', t.last().html.includes('Name'));
}

section('designer-editor — select mở đúng file nguồn');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  await t.send({ type: 'select', file: KHO_XML, start: 0, end: 5 });
  eq('mở đúng Kho.xml', fakeVscode.window.shown.map((s) => path.basename(s.uri.fsPath)), ['Kho.xml']);
}

section('designer-editor — undo/redo đi qua chồng chung');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  await t.send({ type: 'undo' });
  await t.send({ type: 'redo' });
  eq('gọi đúng thứ tự', fakeHistory.calls, ['undo', 'redo']);
}

section('designer-editor — edit patchable: vá một hàng, không vẽ lại toàn bộ');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const item = rowIndexOf('ten_kho');
  const countBefore = t.renders().length;

  fakeEditHost.onApply = () => {
    // Mô phỏng đúng thứ VS Code làm khi `applySplice` ghi thật: bắn `onDidChangeTextDocument`.
    fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  };
  await t.send({
    type: 'edit', op: 'resize', item, cell: 1, span: 2,
  });
  await sleep(80);
  eq('gọi handleEdit đúng một lần', fakeEditHost.calls.length, 1);
  eq('vẫn đúng document', fakeEditHost.calls[0].hostDocument, t.doc);
  eq('không vẽ lại toàn bộ thêm', t.renders().length, countBefore);
  const patch = t.patches().at(-1);
  ok('vá cục bộ đúng hàng/ô', !!patch && patch.item === item && patch.cell === 1);
}

section('designer-editor — edit không-patchable (addRow): vẽ lại toàn bộ');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const countBefore = t.renders().length;

  fakeEditHost.onApply = () => {
    fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  };
  await t.send({ type: 'edit', op: 'addRow', item: 0 });
  await sleep(80);
  eq('vẽ lại toàn bộ (không patchRow)', t.renders().length, countBefore + 1);
  eq('không có patchRow nào cho lượt này', t.patches().length, 0);
}

section('designer-editor — edit bị từ chối: không vá, không vẽ lại (không gì đổi)');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const item = rowIndexOf('ten_kho');
  const countBefore = t.renders().length;

  fakeEditHost.result = false; // handleEdit trả false — không có onDidChangeTextDocument nào bắn
  await t.send({
    type: 'edit', op: 'resize', item, cell: 1, span: 2,
  });
  await sleep(80);
  eq('handleEdit vẫn được gọi', fakeEditHost.calls.length, 1);
  eq('không vẽ lại (không gì đổi)', t.renders().length, countBefore);
  eq('không patchRow nào', t.patches().length, 0);
}

section('designer-editor — edit ném lỗi: bắt lại, ghi Output, không kẹt editing');
{
  reset();
  const t = await open();
  await t.send({ type: 'ready' });
  const item = rowIndexOf('ten_kho');

  fakeEditHost.onApply = () => { throw new Error('nổ lúc sửa'); };
  let threw = false;
  try {
    await t.send({
      type: 'edit', op: 'resize', item, cell: 1, span: 2,
    });
  } catch { threw = true; }
  ok('lỗi không thoát ra ngoài dispatch', !threw);
  ok('ghi lỗi ra Output', output.lines.some((l) => l.includes('sửa lỗi') && l.includes('nổ lúc sửa')));

  // `editing` không được kẹt lại true: một phép sửa sau đó vẫn phải chạy được ngay, không phải
  // chờ một cờ đã kẹt từ lượt lỗi trước.
  fakeEditHost.onApply = () => fakeVscode.workspace.fireDidChangeTextDocument({ document: t.doc });
  await t.send({ type: 'edit', op: 'addRow', item: 0 });
  await sleep(80);
  eq('phép sửa kế tiếp vẫn chạy', fakeEditHost.calls.length, 2);
}

section('designer-editor — reloadAssets tăng bust và dựng lại shell');
{
  reset();
  const t = await open();
  const htmlBefore = t.panel.webview.html;
  await t.send({ type: 'reloadAssets' });
  ok('ghi log bust mới', output.lines.some((l) => l.includes('nạp lại tài nguyên')));
  ok('shell được dựng lại (html đổi)', t.panel.webview.html !== htmlBefore);
}

section('designer-editor — assets ghi báo cáo nạp CSS, log ghi nguyên văn');
{
  reset();
  const t = await open();
  await t.send({
    type: 'assets', declared: 3, loaded: 2, failed: 1, failedHrefs: ['x.css'],
  });
  ok('ghi số liệu CSS', output.lines.some((l) => l.includes('khai 3') && l.includes('nạp được 2')));
  ok('ghi tên file hỏng', output.lines.some((l) => l.includes('x.css')));

  await t.send({ type: 'log', text: 'chào từ webview' });
  ok('log ghi nguyên văn', output.lines.includes('chào từ webview'));
}

fs.rmSync(tmp, { recursive: true, force: true });
Module._load = previousLoad;

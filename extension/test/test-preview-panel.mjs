// test-preview-panel.mjs — characterization test cho `PreviewPanel` (panel bám theo file đang
// active, `preview-panel.js`), TRƯỚC khi Phase 2 rút phần dispatch dùng chung với
// `designer-editor.js` ra `designer-session.js`. Cùng giao kèo fake với
// `test-designer-editor.mjs`: `./edit-host`/`./edit-history`/`./dialog/*` bị fake để chỉ kiểm
// TẦNG DISPATCH (ready/setLang/select/undo/redo/edit/reloadAssets/assets/log), cộng phần CHỈ
// panel này có: `track`/`contributes`, `ensureShell` chỉ dựng lại khi đổi program, và hàng đợi
// `pending`/`ready` trước khi webview báo sẵn sàng.

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

const previousLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  if (request === './edit-host') return fakeEditHost;
  if (request === './edit-history') return { history: () => fakeHistory };
  if (request === './dialog/dialog-service') {
    return {
      dialogs: () => fakeDialog,
      runWithDialogs: (_host, fn) => fn(),
    };
  }
  if (request === './dialog/dialog-overlay') return { OverlayDialogs: fakeOverlay };
  return previousLoad.call(this, request, ...rest);
};

const { PreviewPanel, VIEW_TYPE } = require_('../src/preview-panel.js');
const sampleStore = require_('../src/sample-store.js');
const core = await import('../../core/src/index.mjs');

const NL = '\r\n';
function writeController(root, name, source) {
  const dir = path.join(root, 'App_Data', 'Controllers', 'Dir');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, 'utf8');
  fakeVscode.seedDisk(file, source);
  return file;
}

// Chương trình A: hai controller (Kho.xml góp thêm nội dung từ Extra.inc — dùng cho contributes()).
const progA = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-preview-a-'));
const KHO_SOURCE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Extra SYSTEM "Extra.inc">',
  ']>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    &Extra;',
  '  </view>',
  '</dir>',
].join(NL);
const KHO_XML = writeController(progA, 'Kho.xml', KHO_SOURCE);
const EXTRA_INC = path.join(path.dirname(KHO_XML), 'Extra.inc');
const EXTRA_SOURCE = '<item value="11--: [ten_kho].Label, [ten_kho]"/>';
fs.writeFileSync(EXTRA_INC, EXTRA_SOURCE, 'utf8');
fakeVscode.seedDisk(EXTRA_INC, EXTRA_SOURCE);

const SITE_SOURCE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmsite">',
  '  <fields><field name="ma_site"><header v="Mã" e="Code"/></field></fields>',
  '  <view id="Dir"><item value="100"/><item value="1: [ma_site].Label, [ma_site]"/></view>',
  '</dir>',
].join(NL);
const SITE_XML = writeController(progA, 'Site.xml', SITE_SOURCE);

// Chương trình B: program root KHÁC hẳn — dùng để kiểm `ensureShell` chỉ dựng lại khi đổi program.
const progB = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-preview-b-'));
const OTHER_SOURCE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkhac">',
  '  <fields><field name="ma"><header v="Mã" e="Code"/></field></fields>',
  '  <view id="Dir"><item value="100"/><item value="1: [ma].Label, [ma]"/></view>',
  '</dir>',
].join(NL);
const OTHER_XML = writeController(progB, 'Other.xml', OTHER_SOURCE);

const context = { extensionUri: fakeVscode.Uri.file(path.resolve(HERE, '..')) };
const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function documentOf(file, text) {
  const doc = fakeVscode.textDocument(fakeVscode.Uri.file(file), text);
  doc.current = text;
  doc.getText = () => doc.current;
  return doc;
}

function open() {
  const panel = fakeVscode.window.createWebviewPanel(VIEW_TYPE, 'FBO Designer', {}, {});
  const instance = new PreviewPanel(context, core, output, panel);
  const send = (msg) => panel.webview.postMessageFromWebview(msg);
  const renders = () => panel.webview.posted.filter((m) => m.type === 'render');
  const patches = () => panel.webview.posted.filter((m) => m.type === 'patchRow');
  const idles = () => panel.webview.posted.filter((m) => m.type === 'idle');
  return {
    panel, instance, send, renders, patches, idles, last: () => panel.webview.posted.at(-1),
  };
}

function reset() {
  fakeVscode.window.reset();
  fakeVscode.workspace.changeListeners = [];
  fakeVscode.workspace.watchers = [];
  fakeVscode.workspace.textDocuments = [];
  fakeVscode.window.selectionListeners = [];
  fakeVscode.window.visibleTextEditors = [];
  fakeVscode.workspace.settings['fboDesigner.autoLoadSampleData'] = false;
  fakeEditHost.reset();
  fakeHistory.calls = [];
  fakeDialog.shown = [];
  output.lines = [];
  sampleStore.clearAll();
}

function rowIndexOf(source, file, field) {
  const ex = core.expandEntities(source, {
    filePath: file,
    readFile: (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null),
  });
  const r = core.renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
  return r.model.rows.find((row) => row.row.tokens.some((t) => t.field === field)).index;
}

section('preview-panel — chưa track file nào: không vẽ, không panel title đổi');
{
  reset();
  const t = open();
  eq('không có render nào', t.renders().length, 0);
}

section('preview-panel — track một controller → vẽ ngay, ready sau đó chỉ flush hàng đợi');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  ok('track() đã vẽ nhưng post() hoãn lại (chưa ready)', t.instance.pending !== null && t.instance.ready === false);
  eq('chưa gửi thật ra webview (đang chờ ready)', t.panel.webview.posted.length, 0);

  await t.send({ type: 'ready' });
  eq('ready → flush đúng bản đã hoãn, không vẽ thêm lần hai', t.renders().length, 1);
  ok('tiêu đề mang tên file', t.panel.title.includes('Kho.xml'));
}

section('preview-panel — track Include của chính controller đang vẽ → giữ nguyên, chỉ đổi tiêu đề');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });
  const countBefore = t.renders().length;

  t.instance.track(documentOf(EXTRA_INC, EXTRA_SOURCE));
  ok('contributes() nhận ra Extra.inc thuộc Kho.xml', t.instance.contributes(EXTRA_INC));
  eq('không vẽ lại, không xoá trắng', t.renders().length, countBefore);
  // Hành vi HIỆN TẠI (đáng chú ý khi hợp nhất Phase 2, không phải điều Phase 2 tự ý "sửa"):
  // tiêu đề đọc `this.document` — vẫn là controller đang vẽ — KHÔNG phải tên Include vừa track.
  ok('tiêu đề vẫn mang tên controller đang vẽ, không đổi sang tên Include', t.panel.title.includes('Kho.xml'));
}

section('preview-panel — track file không liên quan → idle, xoá bản vẽ');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });

  const unrelated = path.join(progA, 'Khong-lien-quan.xml'); // ngoài App_Data/Controllers/{Dir,Filter,Grid}
  t.instance.track(documentOf(unrelated, '<x/>'));
  const idle = t.idles().at(-1);
  ok('post idle kèm tên file', !!idle && idle.file === 'Khong-lien-quan.xml');
}

section('preview-panel — track(null) → idle rỗng, không panel nào chỉ định');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });

  t.instance.track(null);
  const idle = t.idles().at(-1);
  ok('idle rỗng', !!idle && idle.file === '');
}

section('preview-panel — đổi FILE cùng program: không dựng lại shell');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });
  const htmlAfterFirst = t.panel.webview.html;

  t.instance.track(documentOf(SITE_XML, SITE_SOURCE));
  eq('cùng program → html KHÔNG đổi (ensureShell không dựng lại)', t.panel.webview.html, htmlAfterFirst);
}

section('preview-panel — đổi PROGRAM: dựng lại shell');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });
  const htmlAfterFirst = t.panel.webview.html;

  t.instance.track(documentOf(OTHER_XML, OTHER_SOURCE));
  ok('khác program → html đổi (shell dựng lại, ready reset)', t.panel.webview.html !== htmlAfterFirst);
  eq('shell mới chưa ready — vẽ tiếp bị hoãn', t.renders().length, 1);
  await t.send({ type: 'ready' });
  eq('ready lại → flush bản vẽ program mới', t.renders().length, 2);
}

section('preview-panel — setLang / select / undo / redo');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });
  ok('mặc định tiếng Việt', t.last().html.includes('Tên kho'));

  await t.send({ type: 'setLang', vi: false });
  ok('setLang → vẽ lại tiếng Anh', t.last().html.includes('Name'));

  await t.send({ type: 'select', file: KHO_XML, start: 0, end: 5 });
  eq('mở đúng Kho.xml', fakeVscode.window.shown.map((s) => path.basename(s.uri.fsPath)), ['Kho.xml']);

  await t.send({ type: 'undo' });
  await t.send({ type: 'redo' });
  eq('đi qua chồng chung', fakeHistory.calls, ['undo', 'redo']);
}

section('preview-panel — edit patchable: vá một hàng, không vẽ lại toàn bộ');
{
  reset();
  const t = open();
  const doc = documentOf(KHO_XML, KHO_SOURCE);
  t.instance.track(doc);
  await t.send({ type: 'ready' });
  const item = rowIndexOf(KHO_SOURCE, KHO_XML, 'ten_kho');
  const countBefore = t.renders().length;

  fakeEditHost.onApply = () => fakeVscode.workspace.fireDidChangeTextDocument({ document: doc });
  await t.send({
    type: 'edit', op: 'resize', item, cell: 1, span: 2,
  });
  await sleep(80);
  eq('không vẽ lại toàn bộ thêm', t.renders().length, countBefore);
  const patch = t.patches().at(-1);
  ok('vá đúng hàng/ô', !!patch && patch.item === item && patch.cell === 1);
}

section('preview-panel — edit không-patchable (addRow): vẽ lại toàn bộ');
{
  reset();
  const t = open();
  const doc = documentOf(KHO_XML, KHO_SOURCE);
  t.instance.track(doc);
  await t.send({ type: 'ready' });
  const countBefore = t.renders().length;

  fakeEditHost.onApply = () => fakeVscode.workspace.fireDidChangeTextDocument({ document: doc });
  await t.send({ type: 'edit', op: 'addRow', item: 0 });
  await sleep(80);
  eq('vẽ lại toàn bộ', t.renders().length, countBefore + 1);
  eq('không patchRow', t.patches().length, 0);
}

section('preview-panel — edit ném lỗi: bắt lại, không kẹt editing');
{
  reset();
  const t = open();
  const doc = documentOf(KHO_XML, KHO_SOURCE);
  t.instance.track(doc);
  await t.send({ type: 'ready' });
  const item = rowIndexOf(KHO_SOURCE, KHO_XML, 'ten_kho');

  fakeEditHost.onApply = () => { throw new Error('nổ lúc sửa'); };
  let threw = false;
  try {
    await t.send({
      type: 'edit', op: 'resize', item, cell: 1, span: 2,
    });
  } catch { threw = true; }
  ok('lỗi không thoát ra ngoài', !threw);
  ok('ghi Output', output.lines.some((l) => l.includes('sửa lỗi') && l.includes('nổ lúc sửa')));

  fakeEditHost.onApply = () => fakeVscode.workspace.fireDidChangeTextDocument({ document: doc });
  await t.send({ type: 'edit', op: 'addRow', item: 0 });
  await sleep(80);
  eq('phép sửa kế tiếp vẫn chạy', fakeEditHost.calls.length, 2);
}

section('preview-panel — reloadAssets dựng lại shell dù cùng program (force)');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });
  const htmlBefore = t.panel.webview.html;

  await t.send({ type: 'reloadAssets' });
  ok('ghi log bust mới', output.lines.some((l) => l.includes('nạp lại tài nguyên')));
  ok('shell dựng lại dù cùng program (force=true)', t.panel.webview.html !== htmlBefore);
}

section('preview-panel — assets ghi báo cáo nạp CSS, log ghi nguyên văn');
{
  reset();
  const t = open();
  t.instance.track(documentOf(KHO_XML, KHO_SOURCE));
  await t.send({ type: 'ready' });

  await t.send({
    type: 'assets', declared: 3, loaded: 2, failed: 1, failedHrefs: ['x.css'],
  });
  ok('ghi số liệu CSS', output.lines.some((l) => l.includes('khai 3') && l.includes('nạp được 2')));

  await t.send({ type: 'log', text: 'chào từ webview' });
  ok('log ghi nguyên văn', output.lines.includes('chào từ webview'));
}

fs.rmSync(progA, { recursive: true, force: true });
fs.rmSync(progB, { recursive: true, force: true });
Module._load = previousLoad;

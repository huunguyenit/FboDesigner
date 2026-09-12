// test-edit-host-gate.mjs — xác nhận cổng `validateFormEditMessage` (Phase 4) được NỐI ĐÚNG vào
// `handleEdit` THẬT (không fake `./edit-host` như các test khác — chúng cố tình fake để chỉ kiểm
// tầng dispatch, xem `test-designer-editor.mjs`). Hai việc:
//
//   1. `op` lạ → `handleEdit` trả `false` NGAY, kèm cảnh báo nêu tên op — không còn rơi qua
//      `else { return false; }` im lặng như trước Phase 4.
//   2. Message ĐÚNG HÌNH DẠNG cho một op thật (`resize`) không bị cổng chặn — nó đi tới đúng
//      nhánh cũ (ở đây dừng lại tại "row_unknown" vì `item` trỏ hàng không tồn tại, chứ không
//      phải bị cổng từ chối) — bằng chứng cổng không cản một message hợp lệ.
//
// KHÔNG kiểm đường ghi thật (`applySplice` cần `vscode.WorkspaceEdit`/`workspace.applyEdit` mà
// `fake-vscode.mjs` chưa có) — đó là khoảng trống test-coverage đã có TỪ TRƯỚC Phase 4 (không
// file test nào từng gọi `handleEdit` thật), không phải việc phase này phải gánh.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

const previousLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return previousLoad.call(this, request, ...rest);
};

const { handleEdit } = require_('../src/edit-host.js');
const core = await import('../../core/src/index.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-edit-host-gate-'));
const dirFolder = path.join(tmp, 'App_Data', 'Controllers', 'Dir');
fs.mkdirSync(dirFolder, { recursive: true });
const KHO_XML = path.join(dirFolder, 'Kho.xml');

const NL = '\r\n';
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

const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const document = fakeVscode.textDocument(fakeVscode.Uri.file(KHO_XML), SOURCE);
const rebuild = () => core.renderControllerHtml(
  core.expandEntities(SOURCE, { filePath: KHO_XML, readFile: () => null }).clearText,
  {
    segments: core.expandEntities(SOURCE, { filePath: KHO_XML, readFile: () => null }).segments,
    hostFile: KHO_XML,
  },
);

function reset() {
  fakeVscode.window.reset();
}

section('handleEdit — op lạ bị cổng chặn ngay, kèm cảnh báo nêu tên op (Phase 4)');
{
  reset();
  const applied = await handleEdit({ type: 'edit', op: 'renameTable', table: 'x' }, core, document, rebuild, output);
  eq('trả về false', applied, false);
  ok('cảnh báo nêu tên op lạ', fakeVscode.window.asked.warning.some((w) => w.includes('renameTable')));
}

section('handleEdit — op lạ khác (gõ nhầm tên) cũng bị chặn kèm lý do, không im lặng');
{
  reset();
  const applied = await handleEdit({ type: 'edit', op: 'resiez', item: 1, cell: 0, span: 2 }, core, document, rebuild, output);
  eq('trả về false', applied, false);
  ok('cảnh báo nêu tên op gõ nhầm', fakeVscode.window.asked.warning.some((w) => w.includes('resiez')));
}

section('handleEdit — resize ĐÚNG HÌNH DẠNG không bị cổng chặn (đi tới nhánh "row_unknown" cũ)');
{
  reset();
  // item: 999 không khớp hàng nào — nếu cổng CHẶN NHẦM message hợp lệ này, cảnh báo sẽ nêu tên
  // op ("op không hỗ trợ: resize") thay vì "row_unknown"; ràng buộc dưới đây phân biệt rõ hai ca.
  const applied = await handleEdit({
    type: 'edit', op: 'resize', item: 999, cell: 0, span: 2,
  }, core, document, rebuild, output);
  eq('trả về false (hàng không tồn tại — không liên quan tới cổng)', applied, false);
  ok('không có cảnh báo "op không hỗ trợ" nào — cổng đã cho message này đi qua',
    !fakeVscode.window.asked.warning.some((w) => w.includes('op không hỗ trợ')));
}

fs.rmSync(tmp, { recursive: true, force: true });
Module._load = previousLoad;

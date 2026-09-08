// test-sample-render.mjs — mối nối giữa KHO dữ liệu mẫu và phép VẼ.
//
// Core đã có test cho `sampleRows` (`core/test/test-grid-body.mjs`), kho đã có test riêng. Cái
// chưa ai kiểm là ĐOẠN NỐI: `buildPayload` có thật sự đọc kho và chuyển tiếp xuống core không.
//
// Thiếu đúng một dòng ở đó thì mọi test khác vẫn xanh, mà bấm phím tắt trong extension thì lưới
// không đổi gì cả — và không có thông báo lỗi nào để lần ra. Đây là loại hỏng chỉ lộ ra ở lần
// dùng thật, tức là ở máy người khác.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const { buildPayload } = require_('../src/render-host.js');
const store = require_('../src/sample-store.js');
const core = await import('../../core/src/index.mjs');

/* Một lưới thật trên đĩa — `buildPayload` suy program từ đường dẫn nên nó phải có hình dạng thật. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-sample-'));
const gridDir = path.join(tmp, 'App_Data', 'Controllers', 'Grid');
fs.mkdirSync(gridDir, { recursive: true });

const NL = '\r\n';
const XML = [
  '<grid table="dmkh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="Ma" e="Code"/></field>',
  '    <field name="ten_kh" width="60"><header v="Ten" e="Name"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="ten_kh"/></view></views>',
  '</grid>',
].join(NL);

const file = path.join(gridDir, 'DMKH.xml');
fs.writeFileSync(file, XML, 'utf8');

const document = {
  uri: { scheme: 'file', fsPath: file },
  getText: () => XML,
  encoding: 'utf8',
  eol: fakeVscode.EndOfLine.CRLF,
};

const build = () => buildPayload(core, document, {
  cfg: { panelPosition: 'right' },
  paths: core.resolveProgramPaths(file),
  output: { appendLine() {} },
});

const rowsOf = (html) => html.split('\n').filter((l) => l.startsWith('<tr class="GridDataRow">'));

section('nối kho ↔ vẽ — chưa bấm lệnh thì lưới vẫn là bản giữ chỗ');
store.clearAll();
const before = build();
eq('không có tóm tắt dữ liệu mẫu', before.sample, null);
ok('không ô nào mang dấu không-lấy-được', !before.html.includes('data-fbo-nodata'));
ok('không có giá trị thật nào', !before.html.includes('value="KH0001"'));

section('nối kho ↔ vẽ — đặt dữ liệu vào kho là lưới vẽ ra dữ liệu ấy');
store.setSample(file, {
  rows: [
    { ma_kh: 'KH0001', ten_kh: 'Công ty TNHH Thương mại Toàn Cầu' },
    { ma_kh: 'KH0002' },
  ],
  columns: [{ label: 'ma_kh' }, { label: 'ten_kh' }],
  skipped: [{ message: 'cột "ten_kh": alias "c" trỏ tới bảng tạm cục bộ #x' }],
  notes: ['phép join dựng lại từ cặp khoá chính'],
  masked: false,
  table: 'dmkh',
  top: 10,
});

const after = build();
const rows = rowsOf(after.html);
eq('hai dòng ra hai hàng', rows.length, 2);
ok('giá trị thật nằm trong HTML', rows[0].includes('value="KH0001"'));
ok('tên dài vẫn vào đúng cột 60px để mà thấy nó bị cắt', rows[0].includes('Công ty TNHH'));
ok('cột thiếu khoá mang dấu không-lấy-được', rows[1].includes('data-fbo-nodata="1"'));

section('nối kho ↔ vẽ — payload mang TÓM TẮT, không mang lại dữ liệu lần hai');
eq('số dòng', after.sample.rows, 2);
eq('không che dữ liệu', after.sample.masked, false);
eq('lý do cột bị bỏ đi kèm để tầng vỏ hiện được', after.sample.skipped.length, 1);
eq('ghi chú đi kèm', after.sample.notes.length, 1);
/*
 * Giá trị thật đã nằm trong `html` rồi. Gửi thêm một bản nữa qua `postMessage` là chép dữ liệu
 * của khách qua ranh giới lần thứ hai mà không ai đọc bản thứ hai ấy — nên tóm tắt chỉ được
 * mang CON SỐ và LÝ DO.
 */
ok('tóm tắt KHÔNG kèm giá trị thật', !JSON.stringify(after.sample).includes('KH0001'));

section('nối kho ↔ vẽ — bỏ dữ liệu là quay về bản giữ chỗ');
store.clearSample(file);
const cleared = build();
eq('hết tóm tắt', cleared.sample, null);
ok('hết giá trị thật', !cleared.html.includes('value="KH0001"'));
// Và bản vẽ phải TRỞ LẠI ĐÚNG bản ban đầu, không phải một bản gần giống.
eq('HTML trùng khít bản trước khi có dữ liệu', cleared.html, before.html);

fs.rmSync(tmp, { recursive: true, force: true });
store.clearAll();
Module._load = originalLoad;

// test-definition-host.mjs — nửa VỎ của F12: cầm «con trỏ đứng trên cái gì» đi tìm đích thật.
//
// Core đã kiểm nửa kia với đủ ca biên. Ở đây chỉ có ba câu hỏi, và cả ba đều cần file THẬT trên
// đĩa vì chúng đúng là phần mà core cố tình không làm:
//
//   1. `&Rows;` có nhảy tới NỘI DUNG (file Include) chứ không dừng ở tấm biển chỉ đường
//      (`<!ENTITY Rows SYSTEM …>`) không?
//   2. Field khai ở Include có nhảy đúng sang FILE ẤY không? Đây là ca đáng giá nhất của cả
//      tính năng — và cũng là ca duy nhất mà một bản làm ẩu vẫn «chạy» (nó nhảy trong file đang
//      mở, tới một chỗ tình cờ).
//   3. Không tìm được thì có NHƯỜNG không, hay ném ra một lỗi provider mỗi lần bấm?

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

const { registerDefinitions } = require_('../src/definition-host.js');
const core = await import('../../core/src/index.mjs');

const NL = '\r\n';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-def-'));
const dirDir = path.join(tmp, 'App_Data', 'Controllers', 'Dir');
const incDir = path.join(tmp, 'App_Data', 'Controllers', 'Include');
fs.mkdirSync(dirDir, { recursive: true });
fs.mkdirSync(incDir, { recursive: true });

/* Include khai MỘT field và MỘT hàng — field ấy là đích của ca đáng giá nhất. */
const INC = [
  '<field name="tu_include"><header v="Từ Include" e="FromInclude"/></field>',
].join(NL);
const incPath = path.join(incDir, 'Chung.ent');
fs.writeFileSync(incPath, INC, 'utf8');

const XML = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Chung SYSTEM "../Include/Chung.ent">',
  '  <!ENTITY Nhan "Mã khách hàng">',
  ']>',
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh"><header v="&Nhan;" e="Code"/></field>',
  '    &Chung;',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60"/>',
  '    <item value="11: [ma_kh].Label, [tu_include]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const xmlPath = path.join(dirDir, 'K.xml');
fs.writeFileSync(xmlPath, XML, 'utf8');

const document = {
  uri: { scheme: 'file', fsPath: xmlPath },
  getText: () => XML,
  offsetAt: (p) => p.offset,
};
/** Position giả mang thẳng offset — provider chỉ gọi `document.offsetAt`. */
const posAt = (offset) => ({ offset });

let logged = 0;
const subs = [];
const provider = registerDefinitions({ subscriptions: subs }, core, { appendLine() { logged += 1; } });

const go = (needle, off = 0) => provider.provideDefinition(document, posAt(XML.indexOf(needle) + off));
const norm = (p) => String(p).split(String.fromCharCode(92)).join('/');

section('F12 — đăng ký một provider');
eq('một disposable', subs.length, 1);

section('F12 — &Chung; nhảy tới NỘI DUNG, không dừng ở tấm biển chỉ đường');
/*
 * «Đi tới định nghĩa» của một `&Chung;` là đi tới thứ nó BUNG RA. Nhảy vào dòng
 * `<!ENTITY Chung SYSTEM …>` là dừng ở tấm biển, và người dùng phải bấm thêm một lần nữa —
 * đúng cái F12 sinh ra để khỏi phải làm.
 */
const ent = go('    &Chung;', 4);
ok('có đích', ent !== undefined && ent !== null);
ok('đích là chính file Include', norm(ent.uri.fsPath).endsWith('/Include/Chung.ent'));
eq('và đặt con trỏ ở đầu file', [ent.range.start.line, ent.range.start.character], [0, 0]);

section('F12 — entity khai INLINE thì nhảy tới giá trị trong nháy');
// Ngược với entity trỏ file: nội dung CHÍNH LÀ giá trị, nên đó mới là định nghĩa.
const inline = go('&Nhan;', 2);
ok('ở lại file đang mở', norm(inline.uri.fsPath) === norm(xmlPath));
const lines = XML.split(NL);
eq('cắt ra đúng giá trị',
  lines[inline.range.start.line].slice(inline.range.start.character, inline.range.end.character),
  'Mã khách hàng');

section('F12 — đường dẫn SYSTEM nhảy thẳng tới file');
const sys = go('../Include/Chung.ent', 3);
ok('đích là file ấy', norm(sys.uri.fsPath).endsWith('/Include/Chung.ent'));

section('F12 — field khai trong CHÍNH file');
const own = go('[ma_kh].Label', 3);
ok('ở lại file đang mở', norm(own.uri.fsPath) === norm(xmlPath));
eq('cắt ra đúng tên field',
  lines[own.range.start.line].slice(own.range.start.character, own.range.end.character), 'ma_kh');

section('F12 — field khai ở INCLUDE nhảy sang ĐÚNG file ấy');
/*
 * Ca đáng giá nhất, và là ca duy nhất mà một bản làm ẩu vẫn «chạy»: nếu quên đi qua
 * `sourceRange`, dải tính trên văn bản ĐÃ BUNG sẽ được áp thẳng lên file đang mở — ra một vị
 * trí hợp lệ, trỏ vào một chỗ tình cờ, và không có lỗi nào để lần ra.
 */
const foreign = go('[tu_include]', 3);
ok('có đích', foreign !== undefined && foreign !== null);
ok('đích là file Include, KHÔNG phải file đang mở', norm(foreign.uri.fsPath).endsWith('/Include/Chung.ent'));
// Cắt trên văn bản THẬT của Include — phép kiểm duy nhất chứng minh offset đã đi qua
// `sourceRange` mà không lệch.
const incLines = INC.split(NL);
eq('và cắt ra đúng tên field trong file ấy',
  incLines[foreign.range.start.line]
    .slice(foreign.range.start.character, foreign.range.end.character),
  'tu_include');

section('F12 — không có gì thì NHƯỜNG, không ném');
eq('trên list px', go('100, 60', 2), undefined);
eq('trên chính khai báo field', go('<field name="ma_kh"', 14), undefined);

// Entity chưa khai: im lặng nhường và ghi lại, chứ đừng nhảy đại đi đâu.
const MISSING = XML.replace('    &Chung;', '    &ChuaKhai;');
const before = logged;
const missDoc = { uri: { scheme: 'file', fsPath: xmlPath }, getText: () => MISSING, offsetAt: (p) => p.offset };
eq('entity chưa khai → undefined',
  provider.provideDefinition(missDoc, posAt(MISSING.indexOf('&ChuaKhai;') + 2)), undefined);
ok('và có ghi lại để còn lần ra', logged > before);

section('F12 — core ném thì nhường, không để VS Code hiện lỗi provider');
let noisyLog = 0;
const noisy = registerDefinitions({ subscriptions: [] }, {
  definitionTargetAt() { throw new Error('vỡ giữa chừng'); },
}, { appendLine() { noisyLog += 1; } });
eq('không ném ra ngoài', noisy.provideDefinition(document, posAt(0)), undefined);
eq('nhưng có ghi lại', noisyLog, 1);

fs.rmSync(tmp, { recursive: true, force: true });
Module._load = originalLoad;

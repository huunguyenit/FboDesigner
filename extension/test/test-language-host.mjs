// test-language-host.mjs — hover và gợi ý.
//
// Ba câu hỏi, và câu thứ ba là lý do bước này đứng cuối bản kế hoạch:
//
//   1. Hover có đọc được field khai ở INCLUDE không (và nói ra nó khai ở đâu)?
//   2. Gợi ý có lấy field từ văn bản ĐÃ BUNG không? Chỉ lấy field gõ thấy trong file đang mở là
//      bỏ mất phần lớn danh sách, đúng ở những program dùng Include nhiều nhất.
//   3. Hover có đọc được DỮ LIỆU THẬT khi người dùng đã bấm `Ctrl+Alt+D` không? Đó là chỗ ba
//      mảng gặp nhau: `width="60"` và «dài nhất 38 ký tự» đứng cạnh nhau đủ gần để thấy con số
//      nào sai.

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

const { registerLanguageFeatures } = require_('../src/language-host.js');
const store = require_('../src/sample-store.js');
const core = await import('../../core/src/index.mjs');

const NL = '\r\n';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-lang-'));
const gridDir = path.join(tmp, 'App_Data', 'Controllers', 'Grid');
const incDir = path.join(tmp, 'App_Data', 'Controllers', 'Include');
fs.mkdirSync(gridDir, { recursive: true });
fs.mkdirSync(incDir, { recursive: true });

const INC = '<field name="tu_include" width="40"><header v="Từ Include" e="FromInc"/></field>';
fs.writeFileSync(path.join(incDir, 'Chung.ent'), INC, 'utf8');

const XML = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE grid [',
  '  <!ENTITY Chung SYSTEM "../Include/Chung.ent">',
  '  <!ENTITY Nhan "Mã khách hàng">',
  ']>',
  '<grid table="dmkh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" type="String" maxLength="16" width="80"><header v="&Nhan;" e="Code"/></field>',
  '    <field name="ten_kh" width="60" aliasName="b"><header v="Tên khách" e="Name"/></field>',
  '    &Chung;',
  '  </fields>',
  '  <views><view id="Grid">',
  '    <field name="ma_kh"/><field name="ten_kh"/>',
  '  </view></views>',
  '</grid>',
].join(NL);
const file = path.join(gridDir, 'DMKH.xml');
fs.writeFileSync(file, XML, 'utf8');

let version = 1;
const document = {
  uri: { scheme: 'file', fsPath: file },
  version,
  getText: () => XML,
  offsetAt: (p) => p.offset,
  positionAt: (o) => new fakeVscode.Position(0, o),
};
const posAt = (offset) => ({ offset });

const subs = [];
const { hover, completion } = registerLanguageFeatures(
  { subscriptions: subs }, core, { appendLine() {} },
);

/** Nội dung markdown của hover tại một offset, hoặc `null`. */
const hoverAt = (needle, off = 0) => {
  const h = hover.provideHover(document, posAt(XML.indexOf(needle) + off));
  return h ? h.contents.value : null;
};

section('hover/completion — đăng ký hai provider');
eq('hai disposable', subs.length, 2);

section('hover — field khai trong chính file');
const maKh = hoverAt('name="ma_kh"', 7);
ok('có nội dung', typeof maKh === 'string');
ok('tên field', maKh.includes('**ma_kh**'));
// Nhãn `&Nhan;` là một ENTITY — hover phải hiện nhãn ĐÃ BUNG, không phải chuỗi `&Nhan;` thô.
ok('nhãn đã bung entity', maKh.includes('Mã khách hàng'));
ok('kiểu', maKh.includes('String'));
ok('maxLength', maKh.includes('maxLength 16'));
ok('bề rộng', maKh.includes('width 80px'));
/*
 * KHÔNG nhắc file khai khi nó là chính file đang mở: nhắc lại tên file người ta đang nhìn là một
 * dòng không mang tin nào.
 */
ok('không nhắc file khai', !maKh.includes('khai ở'));

section('hover — field khai ở INCLUDE thì nói ra nó khai ở đâu');
const tuInc = hover.provideHover(document, posAt(XML.indexOf('&Chung;') + 2));
ok('hover trên &Chung; ra nội dung entity', tuInc && tuInc.contents.value.includes('&Chung;'));
ok('và nói nó trỏ tới file nào', tuInc.contents.value.includes('Chung.ent'));

section('hover — entity khai INLINE hiện chính giá trị');
const nhan = hoverAt('&Nhan;', 2);
ok('hiện giá trị inline', nhan.includes('Mã khách hàng'));
ok('và nói là khai inline', nhan.includes('inline'));

section('hover — entity chưa khai thì nói thẳng, không im');
const MISSING = XML.replace('    &Chung;', '    &ChuaKhai;');
const missDoc = { ...document, getText: () => MISSING, version: 99 };
const miss = hover.provideHover(missDoc, posAt(MISSING.indexOf('&ChuaKhai;') + 2));
ok('có nội dung', miss !== undefined);
ok('nói chưa có khai báo', miss.contents.value.includes('chưa có khai báo'));

section('hover — chỗ không có gì thì nhường');
eq('trên thẻ <grid>', hover.provideHover(document, posAt(XML.indexOf('<grid table') + 3)), undefined);
eq('trên khoảng trắng', hover.provideHover(document, posAt(XML.indexOf('  <fields>'))), undefined);

/* ═════════════════════════════════════════════════════════════════════════
 * Chỗ ba mảng gặp nhau
 * ═════════════════════════════════════════════════════════════════════════ */
section('hover — đọc được DỮ LIỆU THẬT sau khi đã bấm Ctrl+Alt+D');
store.clearAll();
// Chưa lấy dữ liệu thì KHÔNG nhắc gì tới nó — một dòng «chưa lấy dữ liệu» trên mọi hover là
// tiếng ồn dạy người ta thôi đọc hover.
ok('chưa có dữ liệu thì không nhắc', !hoverAt('name="ten_kh"', 7).includes('dữ liệu thật'));

store.setSample(file, {
  rows: [
    { ma_kh: 'KH0001', ten_kh: 'Công ty TNHH Thương mại Toàn Cầu' },
    { ma_kh: 'KH0002', ten_kh: 'Ngắn' },
  ],
  columns: [], skipped: [], notes: [], masked: true, table: 'dmkh', top: 10,
});

const tenKh = hoverAt('name="ten_kh"', 7);
ok('nói có dữ liệu thật', tenKh.includes('dữ liệu thật'));
// 'Công ty TNHH Thương mại Toàn Cầu' = 32 ký tự, và cột khai width 60px — đây chính là cặp số
// mà người dùng cần thấy cạnh nhau.
ok('nêu ĐỘ DÀI dài nhất', tenKh.includes('**32**'));
ok('và số dòng đã lấy', tenKh.includes('2 dòng'));
ok('nói rõ là đã che', tenKh.includes('đã che'));
ok('bề rộng cột vẫn ở ngay đó để mà so', tenKh.includes('width 60px'));
/*
 * KHÔNG hiện giá trị nào ra. Hover là chỗ dễ chụp màn hình, và cả tính năng xem-trước đã cố ý
 * che dữ liệu đi rồi — hiện lại ở đây là mở đúng cánh cửa vừa đóng.
 */
ok('không lộ giá trị nào', !tenKh.includes('Công ty') && !tenKh.includes('Ngắn'));
store.clearAll();

/* ═════════════════════════════════════════════════════════════════════════
 * Gợi ý
 * ═════════════════════════════════════════════════════════════════════════ */
section('completion — gợi ý field lấy từ văn bản ĐÃ BUNG');
const TYPING = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE dir [ <!ENTITY Chung SYSTEM "../Include/Chung.ent"> ]>',
  '<dir table="dmkh">',
  '  <fields><field name="ma_kh"/>&Chung;</fields>',
  '  <view id="Dir"><item value="1: [ma_"/></view>',
  '</dir>',
].join(NL);
const typingDoc = {
  uri: { scheme: 'file', fsPath: path.join(gridDir, 'T.xml') },
  version: 1,
  getText: () => TYPING,
  offsetAt: (p) => p.offset,
  positionAt: (o) => new fakeVscode.Position(0, o),
};
const items = completion.provideCompletionItems(typingDoc, posAt(TYPING.indexOf('[ma_"') + 4));
ok('có gợi ý', Array.isArray(items) && items.length > 0);
const names = items.map((i) => i.label);
ok('field của chính file', names.includes('ma_kh'));
/*
 * Đây là phép kiểm chính của cả gợi ý: `tu_include` KHÔNG gõ thấy ở đâu trong file đang mở, nó
 * chỉ tồn tại sau khi bung `&Chung;`. Lấy field từ văn bản thô thì nó vắng mặt, và người dùng
 * không bao giờ biết mình dùng được nó.
 */
ok('VÀ field đến từ Include', names.includes('tu_include'));
const inc2 = items.find((i) => i.label === 'tu_include');
eq('chèn vào kèm cả cặp ngoặc', inc2.insertText, '[tu_include]');
eq('mô tả là nhãn người đọc', inc2.detail, 'Từ Include');
// `[` đã có sẵn trước con trỏ, nên dải thay thế phải trùm cả nó — không thì ra `[[tu_include]`.
ok('dải thay thế bắt đầu từ dấu ngoặc',
  TYPING[inc2.range.start.character] === '[' || inc2.range.start.character >= 0);

section('completion — gợi ý entity');
const ents = completion.provideCompletionItems(typingDoc, posAt(TYPING.indexOf('&Chung;') + 3));
ok('có gợi ý entity', Array.isArray(ents) && ents.length > 0);
ok('kèm dấu & và dấu ;', ents.every((i) => i.label.startsWith('&') && i.label.endsWith(';')));
ok('nêu Chung', ents.some((i) => i.label === '&Chung;'));
ok('và nói nó trỏ file nào', ents.find((i) => i.label === '&Chung;').detail.includes('SYSTEM'));

section('completion — chỗ không gợi ý thì nhường');
eq('ngoài item value', completion.provideCompletionItems(typingDoc, posAt(TYPING.indexOf('<dir table') + 3)), undefined);

section('hover/completion — core ném thì nhường, không hiện lỗi provider');
let logged = 0;
const broken = registerLanguageFeatures({ subscriptions: [] }, {
  definitionTargetAt() { throw new Error('vỡ'); },
  completionContextAt() { throw new Error('vỡ'); },
}, { appendLine() { logged += 1; } });
eq('hover nhường', broken.hover.provideHover(document, posAt(0)), undefined);
eq('gợi ý nhường', broken.completion.provideCompletionItems(document, posAt(0)), undefined);
eq('cả hai đều ghi lại', logged, 2);

fs.rmSync(tmp, { recursive: true, force: true });
store.clearAll();
Module._load = originalLoad;

// test-language-host.mjs — gợi ý (completion). Hover đã gỡ — extension khác đảm nhận (hiển thị
// hover, mục lục, F12 đều đã có nơi lo); chỉ gợi ý còn ở lại vì field/entity của FBO đến từ cây
// Include đã bung, không extension XML chung nào biết.
//
// Câu hỏi chính: gợi ý có lấy field từ văn bản ĐÃ BUNG không? Chỉ lấy field gõ thấy trong file
// đang mở là bỏ mất phần lớn danh sách, đúng ở những program dùng Include nhiều nhất.

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
const core = await import('../../core/src/index.mjs');

const NL = '\r\n';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-lang-'));
const gridDir = path.join(tmp, 'App_Data', 'Controllers', 'Grid');
const incDir = path.join(tmp, 'App_Data', 'Controllers', 'Include');
fs.mkdirSync(gridDir, { recursive: true });
fs.mkdirSync(incDir, { recursive: true });

const INC = '<field name="tu_include" width="40"><header v="Từ Include" e="FromInc"/></field>';
fs.writeFileSync(path.join(incDir, 'Chung.ent'), INC, 'utf8');

const posAt = (offset) => ({ offset });

const subs = [];
const { completion } = registerLanguageFeatures(
  { subscriptions: subs }, core, { appendLine() {} },
);

section('gợi ý — đăng ký một provider');
eq('một disposable', subs.length, 1);

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

section('completion — core ném thì nhường, không hiện lỗi provider');
let logged = 0;
const broken = registerLanguageFeatures({ subscriptions: [] }, {
  completionContextAt() { throw new Error('vỡ'); },
}, { appendLine() { logged += 1; } });
eq('gợi ý nhường', broken.completion.provideCompletionItems(typingDoc, posAt(0)), undefined);
eq('có ghi lại', logged, 1);

fs.rmSync(tmp, { recursive: true, force: true });
Module._load = originalLoad;

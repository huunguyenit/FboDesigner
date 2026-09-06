// test-diagnostic-host.mjs — tầng vỏ đưa cảnh báo của core vào Problems.
//
// Hai nhóm, và nhóm đầu là lý do file test này tồn tại:
//
//   1. GỘP nhiều controller trên MỘT file Include. `DiagnosticCollection.set(uri, …)` thay
//      TOÀN BỘ danh sách của uri, nên cách viết tự nhiên nhất — mỗi controller tự `set` lên
//      từng file nó chạm — làm controller chạy sau xoá sạch chẩn đoán của controller chạy
//      trước. Hỏng im lặng: không ném, không log, chỉ là một nửa số gạch đỏ không bao giờ hiện.
//      Include dùng chung là chuyện thường ngày của FBO, nên đây là ca THẬT, không phải ca biên.
//
//   2. Quy offset → dòng/cột. Sai ở đây thì mọi gạch đỏ lệch chỗ, và trên một file vài nghìn
//      dòng thì không ai nhìn ra bằng mắt.
//
// Chạy bằng node trần: `vscode` được thay bằng `fake-vscode.mjs` qua `Module._load`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

// Chặn TRƯỚC mọi `require` xuống `extension/src`: `render-host.js` gọi `require('vscode')` ngay
// ở tầng module, nên nạp nó trước khi chặn là ném ngay lúc import.
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, ...rest);
};

const {
  DiagnosticHost, SEVERITY, lineStarts, positionAt, wholeFirstLine,
} = require_('../src/diagnostic-host.js');

const core = await import('../../core/src/index.mjs');

const entryOf = (text) => ({ text, starts: lineStarts(text) });
const silent = { appendLine() {} };

/* ─────────────────────────────────────────────────────────────────────────
 * 1. Quy offset → dòng/cột
 * ───────────────────────────────────────────────────────────────────────── */
section('chẩn đoán — offset ra đúng dòng/cột, kể cả file CRLF');

const CRLF = ['<dir>', '  <view>', '    <item value="x"/>', '  </view>', '</dir>'].join('\r\n');
const eCrlf = entryOf(CRLF);
eq('5 dòng', eCrlf.starts.length, 5);

// Cột của một ký tự trên dòng 3: `\r` của dòng 2 nằm ở CUỐI dòng 2, không được cộng vào cột
// của dòng 3. Cộng nhầm là mọi cột trên file CRLF lệch đúng 1 — sai nhỏ, và vì thế khó thấy.
const atItem = CRLF.indexOf('<item');
const pItem = positionAt(eCrlf, atItem);
eq('dòng của <item> (0-based)', pItem.line, 2);
eq('cột của <item>, CR của dòng trước không cộng vào', pItem.character, 4);

// Cắt lại bằng chính dòng ấy — phép kiểm độc lập với cách tính ở trên.
const line2 = CRLF.split('\r\n')[2];
eq('cắt theo dòng/cột ra đúng chữ', line2.slice(pItem.character, pItem.character + 5), '<item');

eq('offset 0 → đầu file', [positionAt(eCrlf, 0).line, positionAt(eCrlf, 0).character], [0, 0]);
// Offset vượt biên bị kẹp lại, không ném và không trả một Position âm.
ok('offset vượt độ dài bị kẹp về cuối file', positionAt(eCrlf, 10 ** 6).line === 4);

// `range: null` → cả dòng đầu, và dòng đầu KHÔNG gồm ký tự CR.
const first = wholeFirstLine(eCrlf);
eq('dòng đầu bắt đầu ở (0,0)', [first.start.line, first.start.character], [0, 0]);
eq('và kết thúc trước CR, không nuốt sang dòng 2', [first.end.line, first.end.character], [0, 5]);

// File một dòng, không có xuống dòng nào: không được trượt ra ngoài độ dài.
const one = entryOf('<dir/>');
eq('file một dòng — dải phủ trọn dòng ấy', [wholeFirstLine(one).end.line, wholeFirstLine(one).end.character], [0, 6]);

section('chẩn đoán — mức `info` KHÔNG vào Problems');
/*
 * Chốt cứng quyết định 3 của `diagnostic-host.js`. Luật duy nhất ở mức ấy hiện nay —
 * `grid.no_base_css` — là lỗi NẠP TÀI NGUYÊN CỦA EXTENSION, không phải khiếm khuyết của file
 * người dùng đang mở; đặt nó vào Problems là chỉ tay vào một file không có gì sai.
 *
 * Nếu phép kiểm này gãy vì ai đó vừa thêm `info` vào bảng: hãy đọc lại quyết định 3 trước khi
 * sửa test — rất có thể luật mới thuộc về Output Channel chứ không phải Problems.
 */
eq('bảng mức chỉ có error và warning', Object.keys(SEVERITY).sort(), ['error', 'warning']);
ok('info không có đường vào Problems', SEVERITY.info === undefined);

/* ─────────────────────────────────────────────────────────────────────────
 * 2. Gộp nhiều controller trên một Include — chỗ dễ sai nhất
 * ───────────────────────────────────────────────────────────────────────── */
section('chẩn đoán — hai controller cùng kéo một Include thì KHÔNG xoá của nhau');

const INC = 'C:/P/App_Data/Controllers/Include/Chung.ent';
const CTRL_A = 'C:/P/App_Data/Controllers/Dir/A.xml';
const CTRL_B = 'C:/P/App_Data/Controllers/Dir/B.xml';

/** Dựng một Diagnostic tối giản — test này không quan tâm câu chữ, chỉ quan tâm nó còn hay mất. */
function diag(code, line, message) {
  const d = new fakeVscode.Diagnostic(
    new fakeVscode.Range(line, 0, line, 5),
    message ?? code,
    fakeVscode.DiagnosticSeverity.Error,
  );
  d.code = code;
  return d;
}

/** Đúng hình dạng mà `runFor` dựng ra: fileKey → {file, items}. */
function bucket(file, items) {
  return new Map([[file.toLowerCase(), { file, items }]]);
}

const host = new DiagnosticHost(core, silent);
// `paths` bình thường được `runFor` điền; ở đây gọi thẳng `publish` nên phải tự khai — không có
// nó thì `recompute` không dựng nổi Uri và im lặng bỏ qua.
host.paths.set(INC.toLowerCase(), INC);

host.publish(CTRL_A, bucket(INC, [diag('render.token_no_field', 3)]));
eq('A báo một lỗi trong Include', host.collection.get(INC).length, 1);

host.publish(CTRL_B, bucket(INC, [diag('item.invariant_broken', 7)]));
// Đây là phép kiểm chống hồi quy chính của cả file. Viết bằng `set` thẳng thì con số này là 1.
eq('B báo thêm một lỗi KHÁC — cả hai cùng còn, không cái nào bị xoá', host.collection.get(INC).length, 2);
eq('và đủ cả hai mã', host.collection.get(INC).map((d) => d.code).sort(),
  ['item.invariant_broken', 'render.token_no_field']);

section('chẩn đoán — cùng một khiếm khuyết thì hiện MỘT lần, dù mấy controller cùng thấy');
const host2 = new DiagnosticHost(core, silent);
host2.paths.set(INC.toLowerCase(), INC);
// Khiếm khuyết là của FILE. Năm controller kéo file ấy vào không làm nó thành năm khiếm khuyết.
host2.publish(CTRL_A, bucket(INC, [diag('render.token_no_field', 3)]));
host2.publish(CTRL_B, bucket(INC, [diag('render.token_no_field', 3)]));
eq('trùng hoàn toàn → gộp làm một', host2.collection.get(INC).length, 1);
// Nhưng cùng mã ở dòng KHÁC là hai khiếm khuyết khác nhau, không được gộp.
host2.publish(CTRL_B, bucket(INC, [diag('render.token_no_field', 9)]));
eq('cùng mã khác dòng → vẫn là hai', host2.collection.get(INC).length, 2);

section('chẩn đoán — sửa xong thì gạch biến mất, đóng controller thì phần của nó rút đi');
const host3 = new DiagnosticHost(core, silent);
host3.paths.set(INC.toLowerCase(), INC);
host3.publish(CTRL_A, bucket(INC, [diag('render.token_no_field', 3)]));
host3.publish(CTRL_B, bucket(INC, [diag('item.invariant_broken', 7)]));

// A sửa xong: lượt chạy mới của A không còn chạm file nào. Không dọn theo dấu vết lần TRƯỚC thì
// gạch của A nằm lại vĩnh viễn, vì lượt mới chẳng nhắc gì tới Include nữa.
host3.publish(CTRL_A, new Map());
eq('A hết lỗi → chỉ còn phần của B', host3.collection.get(INC).map((d) => d.code), ['item.invariant_broken']);

host3.drop(CTRL_B);
eq('B đóng lại → không còn gì, bỏ hẳn khỏi Problems', host3.collection.get(INC).length, 0);
ok('và uri được xoá chứ không để lại danh sách rỗng', !host3.collection.store.has(INC.toLowerCase()));

// Đóng một controller chưa từng chạy không được ném.
host3.drop('C:/P/App_Data/Controllers/Dir/ChuaChay.xml');
ok('đóng controller lạ thì im lặng bỏ qua', true);

section('chẩn đoán — sửa Include phải làm mới MỌI controller kéo nó vào');
const host4 = new DiagnosticHost(core, silent);
host4.sources.set(CTRL_A.toLowerCase(), new Set([CTRL_A.toLowerCase(), INC.toLowerCase()]));
host4.sources.set(CTRL_B.toLowerCase(), new Set([CTRL_B.toLowerCase(), INC.toLowerCase()]));
host4.sources.set('c:/p/app_data/controllers/dir/c.xml', new Set(['c:/p/app_data/controllers/dir/c.xml']));
eq('hai controller đọc Include ấy', host4.controllersReading(INC).sort(),
  [CTRL_A.toLowerCase(), CTRL_B.toLowerCase()]);
eq('controller không kéo nó vào thì không bị đụng', host4.controllersReading('C:/P/App_Data/Controllers/Include/Khac.ent'), []);
// Hoa/thường của đường dẫn Windows không được làm hỏng phép tra.
eq('so đường dẫn bỏ qua hoa thường', host4.controllersReading(INC.toUpperCase()).length, 2);

/* ─────────────────────────────────────────────────────────────────────────
 * 3. Cả đường: file thật trên đĩa → Problems
 * ───────────────────────────────────────────────────────────────────────── */
section('chẩn đoán — chạy hết đường trên file thật, lỗi rơi vào đúng file Include');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-diag-'));
const dirDir = path.join(tmp, 'App_Data', 'Controllers', 'Dir');
const incDir = path.join(tmp, 'App_Data', 'Controllers', 'Include');
fs.mkdirSync(dirDir, { recursive: true });
fs.mkdirSync(incDir, { recursive: true });

const incPath = path.join(incDir, 'Rows.ent');
// Dòng 2 của Include khai một token trỏ vào field không tồn tại — lỗi nằm ở ĐÂY, không nằm ở
// controller, và đó chính là điều cần chứng minh.
const incText = ['<item value="11--: [a].Label, [a]"/>', '<item value="11--: [a].Label, [khong_co]"/>'].join('\r\n');
fs.writeFileSync(incPath, incText, 'utf8');

const ctrlPath = path.join(dirDir, 'K.xml');
const ctrlText = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Rows SYSTEM "../Include/Rows.ent">',
  ']>',
  '<dir table="dmkh">',
  '  <fields><field name="a"><header v="A" e="A"/></field></fields>',
  '  <view id="Dir">',
  '    <item value="50, 50, 50, 50"/>',
  '    &Rows;',
  '  </view>',
  '</dir>',
].join('\r\n');
fs.writeFileSync(ctrlPath, ctrlText, 'utf8');

const doc = {
  uri: { scheme: 'file', fsPath: ctrlPath },
  getText: () => ctrlText,
};

const live = new DiagnosticHost(core, silent);
live.runFor(doc);

const incItems = live.collection.get(incPath);
ok('có chẩn đoán treo trên chính file Include', incItems.length >= 1);
const tokenD = incItems.find((d) => d.code === 'render.token_no_field');
ok('và đó là lỗi token trỏ field không khai', tokenD !== undefined);
eq('nguồn ghi rõ là extension này', tokenD.source, 'FBO Designer');
eq('mức ERROR — control biến mất khỏi form', tokenD.severity, fakeVscode.DiagnosticSeverity.Error);

// Phép kiểm đắt nhất của cả file: cắt dòng/cột trên văn bản THẬT của Include phải ra đúng token
// hỏng. Nó chứng minh cả chuỗi — core cho offset, `sourceRange` quy về file, vỏ đổi ra dòng/cột
// — khớp nhau từ đầu tới cuối. So `line`/`character` với số chép tay thì không chứng minh gì.
const incLines = incText.split('\r\n');
eq('gạch đỏ nằm ở dòng 2 của Include', tokenD.range.start.line, 1);
eq('và cắt ra đúng token hỏng',
  incLines[tokenD.range.start.line].slice(tokenD.range.start.character, tokenD.range.end.character),
  '[khong_co]');

// Controller tự nó không có lỗi nào — không được vơ lỗi của Include về mình.
eq('controller sạch, lỗi không bị quy nhầm về nó', live.collection.get(ctrlPath).length, 0);

fs.rmSync(tmp, { recursive: true, force: true });

Module._load = originalLoad;

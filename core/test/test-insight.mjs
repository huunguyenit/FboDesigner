// test-insight.mjs — chế độ soi: mỗi `&Name;` ở file chủ đi kèm ĐÚNG đoạn nó bung ra.
//
// Ba câu hỏi, và câu thứ hai là lý do file này tồn tại tách khỏi `test-entities.mjs`:
//
//   1. Đoạn chữ trả về có phải bản ĐÃ BUNG HẾT không (entity lồng entity), hay chỉ là chuỗi
//      trong nháy của khai báo?
//   2. Ba trạng thái «không có đoạn nào» có tách được ra không — bung-ra-rỗng (công tắc TẮT của
//      FBO), khai-mà-không-đọc-được, và chưa-khai? Trộn ba thứ ấy là nói dối đúng chỗ người
//      dùng bật chế độ soi để hỏi.
//   3. Chỗ KHÔNG được soi có bị bỏ qua không — tham chiếu trong comment, và tham chiếu nằm
//      trong internal subset (mẩu của một giá trị đang khai, không phải chỗ dùng)?

import { ok, eq, section } from './harness.mjs';
import { buildEntityInsight } from '../src/insight.mjs';
import { sourceRange } from '../src/entities.mjs';

const FILES = {
  'C:/P/App_Data/Controllers/Include/Rows.ent': [
    '<item value="11: [ma_vung].Label, [ma_vung]"/>',
    '<item value="12: [ma_kho].Label, [ma_kho]"/>',
    '<item value="13: [ma_bp].Label, [ma_bp]"/>',
  ].join('\n'),
  // Wrap kéo thêm HAI nguồn nữa vào cùng một lần bung: một entity inline khai ở file chủ, và
  // một entity trỏ sang Rows.ent. Đây là ca `from` phải liệt kê được nguồn thứ hai.
  'C:/P/App_Data/Controllers/Include/Wrap.ent': '<a>&Nhan;</a>&Rows;',
  'C:/P/App_Data/Controllers/Include/Extra.ent': '<item value="20: [x].Label, [x]"/>',
};

const readFile = (abs) => FILES[abs.replace(/\\/g, '/')] ?? null;
const HOST = 'C:/P/App_Data/Controllers/Dir/Site.xml';
const INC = 'C:/P/App_Data/Controllers/Include';

const SUBSET = [
  '  <!ENTITY Nhan "Mã khách">',
  '  <!ENTITY Rows SYSTEM "..\\Include\\Rows.ent">',
  '  <!ENTITY Extra SYSTEM "..\\Include\\Extra.ent">',
  '  <!ENTITY Wrap SYSTEM "..\\Include\\Wrap.ent">',
  '  <!ENTITY Off "">',
  '  <!ENTITY Gone SYSTEM "..\\Include\\NoSuch.ent">',
  // Tham chiếu NẰM TRONG một khai báo — không phải chỗ dùng, không được soi.
  '  <!ENTITY Lai "&Nhan; và nữa">',
].join('\n');

const BODY = [
  '<dir>',
  '  <h>&Nhan;</h>',
  '  <rows>&Rows;</rows>',
  '  <off>&Off;</off>',
  '  <gone>&Gone;</gone>',
  '  <chua>&Chua;</chua>',
  '  <wrap>&Wrap;</wrap>',
  '  <extra>&Extra;</extra>',
  '  <!-- &Extra; -->',
  '</dir>',
].join('\n');

const TEXT = `<?xml version="1.0"?>\n<!DOCTYPE dir [\n${SUBSET}\n]>\n${BODY}\n`;

const insight = buildEntityInsight(TEXT, { filePath: HOST, readFile });
const at = (name) => insight.refs.filter((r) => r.name === name);
const one = (name) => at(name)[0];

section('chỉ soi phần THÂN, và chỉ chỗ thật sự bung');
eq('đúng bảy tham chiếu', insight.refs.map((r) => r.name),
  ['Nhan', 'Rows', 'Off', 'Gone', 'Chua', 'Wrap', 'Extra']);
eq('`&Extra;` trong comment không được đếm', at('Extra').length, 1);
ok('`&Nhan;` trong khai báo `Lai` không được đếm', at('Nhan').length === 1);
ok('dải trỏ đúng vào `&Name;` trong file chủ',
  TEXT.slice(one('Rows').start, one('Rows').end) === '&Rows;',
  JSON.stringify(TEXT.slice(one('Rows').start, one('Rows').end)));

section('entity inline — hiện nguyên văn giá trị');
eq('phân giải được', one('Nhan').status, 'resolved');
eq('khai inline', one('Nhan').originKind, 'inline');
eq('nguồn là chính file chủ', one('Nhan').origin, HOST);
eq('giá trị', one('Nhan').value, 'Mã khách');
eq('một dòng', one('Nhan').lines, 1);
eq('bản một dòng bằng chính giá trị', one('Nhan').inline, 'Mã khách');
ok('không bị cắt', one('Nhan').truncated === false);

section('entity trỏ file — nguồn là ĐÍCH SYSTEM, không phải file khai');
eq('kiểu system', one('Rows').originKind, 'system');
eq('nguồn', one('Rows').origin, `${INC}/Rows.ent`);
eq('ba dòng', one('Rows').lines, 3);
ok('giá trị là NGUYÊN VĂN file, kể cả xuống dòng', one('Rows').value === FILES[`${INC}/Rows.ent`]);
ok('bản một dòng đã nuốt xuống dòng', !one('Rows').inline.includes('\n'), JSON.stringify(one('Rows').inline));

section('bung HẾT, không dừng ở chuỗi trong nháy');
// `&Wrap;` → `<a>&Nhan;</a>&Rows;` → phải ra `<a>Mã khách</a>` cộng cả ba dòng của Rows.ent.
ok('entity lồng đã bung tiếp', one('Wrap').value.startsWith('<a>Mã khách</a>'), JSON.stringify(one('Wrap').value.slice(0, 40)));
ok('kéo theo cả nội dung Rows.ent', one('Wrap').value.includes('[ma_bp]'));
eq('kể đủ nguồn đã góp chữ', one('Wrap').from, [`${INC}/Wrap.ent`, `${INC}/Rows.ent`]);
ok('KHÔNG kể file chủ vào `from`', !one('Wrap').from.includes(HOST));

section('ba kiểu "không có đoạn nào" phải tách được ra');
eq('bung ra rỗng = công tắc TẮT', one('Off').status, 'empty');
eq('rỗng vẫn giữ nguồn để nói ra', one('Off').originKind, 'inline');
eq('khai SYSTEM mà không đọc được', one('Gone').status, 'unresolved');
eq('… nhưng vẫn nói được đích', one('Gone').origin, `${INC}/NoSuch.ent`);
eq('chưa khai bao giờ', one('Chua').status, 'unresolved');
eq('… thì không có nguồn nào', one('Chua').origin, null);
eq('không khai thì không có kiểu', one('Chua').originKind, null);

section('nhóm màu — theo FILE NGUỒN, và chỉ nguồn có thật');
eq('bốn nguồn', insight.groups.map((g) => g.file), [HOST, `${INC}/Rows.ent`, `${INC}/Wrap.ent`, `${INC}/Extra.ent`]);
eq('`Nhan` và `Off` cùng khai ở file chủ → cùng nhóm', one('Off').group, one('Nhan').group);
eq('… và nhóm ấy đếm được hai', insight.groups[one('Nhan').group].refs, 2);
eq('nguồn khác thì nhóm khác', one('Rows').group !== one('Wrap').group, true);
eq('không phân giải được thì không chiếm màu', one('Chua').group, -1);
eq('… kể cả khi biết đích', one('Gone').group, -1);
ok('`NoSuch.ent` không lọt vào bảng màu', !insight.groups.some((g) => g.file.includes('NoSuch')));

section('clearText — bản bung của CẢ FILE, và dải của từng tham chiếu trong đó');
ok('không còn DOCTYPE', !insight.clearText.includes('<!ENTITY'));
eq('dải của `&Rows;` trong clearText đúng bằng giá trị nó đẻ ra',
  insight.clearText.slice(one('Rows').outStart, one('Rows').outEnd), one('Rows').value);
eq('dải của `&Wrap;` cũng vậy — kể cả phần do entity LỒNG sinh ra',
  insight.clearText.slice(one('Wrap').outStart, one('Wrap').outEnd), one('Wrap').value);
eq('bung ra rỗng thì không có dải nào', one('Off').outStart, null);
eq('không phân giải được thì cũng không', one('Chua').outStart, null);
ok('các dải không chồng lấn và tăng dần theo thứ tự tham chiếu',
  insight.refs.filter((r) => r.outStart !== null)
    .every((r, i, a) => i === 0 || a[i - 1].outEnd <= r.outStart));

section('firstLine — dòng ĐẦU của bản đã bung, không phải bản nuốt khoảng trắng');
eq('giá trị nhiều dòng lấy đúng dòng đầu',
  one('Rows').firstLine, '<item value="11: [ma_vung].Label, [ma_vung]"/>');
eq('giá trị một dòng thì firstLine bằng chính nó', one('Nhan').firstLine, 'Mã khách');
ok('không lẫn dòng thứ hai vào', !one('Rows').firstLine.includes('ma_kho'));

section('cắt bản một dòng theo inlineMax');
const short = buildEntityInsight(TEXT, { filePath: HOST, readFile, inlineMax: 20 });
const rows = short.refs.find((r) => r.name === 'Rows');
ok('bị cắt', rows.truncated === true);
eq('độ dài đúng bằng trần', rows.inline.length, 20);
ok('có dấu ba chấm ở cuối', rows.inline.endsWith('…'), JSON.stringify(rows.inline));
ok('giá trị đầy đủ KHÔNG bị cắt theo', rows.value === FILES[`${INC}/Rows.ent`]);

section('file không có DOCTYPE — mảnh Include tự đứng một mình');
const frag = buildEntityInsight('<a>&Nhan;</a>', { filePath: `${INC}/Piece.ent`, readFile });
eq('vẫn thấy tham chiếu', frag.refs.map((r) => r.name), ['Nhan']);
eq('nhưng nói thẳng là không phân giải được', frag.refs[0].status, 'unresolved');
eq('và không bịa ra nhóm màu nào', frag.groups, []);

section('segments — điều kiện để Ctrl+click trên bản đã bung mở đúng file');
ok('trả kèm bản đồ đoạn', Array.isArray(insight.segments) && insight.segments.length > 0);
const posOf = (needle) => insight.clearText.indexOf(needle);
eq('chữ đến từ Include quy về ĐÚNG file Include',
  sourceRange(insight.segments, posOf('[ma_kho]'), posOf('[ma_kho]') + 9).file, `${INC}/Rows.ent`);
eq('chữ của file chủ quy về file chủ',
  sourceRange(insight.segments, posOf('<gone>'), posOf('<gone>') + 6).file, HOST);
eq('chữ do entity LỒNG kéo vào cũng quy đúng — không dừng ở file trung gian',
  sourceRange(insight.segments, posOf('<a>Mã khách'), posOf('<a>Mã khách') + 3).file,
  `${INC}/Wrap.ent`);

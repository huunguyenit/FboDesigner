// test-entities.mjs — cơ chế lấy theo EntitySymbolBinder của DWF.
// Bộ file ảo dưới đây mô phỏng đúng cách FBO bật/tắt BI mode ở FBISP2421.

import { ok, eq, section } from './harness.mjs';
import { expandEntities, findInternalSubset, resolveSystemPath, mapToSource, hostRefAt, sourceRange } from '../src/entities.mjs';

const FILES = {
  'C:/P/App_Data/Controllers/Include/BIMode.txt': 'INCLUDE',
  'C:/P/App_Data/Controllers/Include/Off.txt': 'IGNORE',
  'C:/P/App_Data/Controllers/Include/BIMode.ent':
    '<!ENTITY % Cond SYSTEM "..\\Include\\BIMode.txt">\n',
  'C:/P/App_Data/Controllers/Include/BIMode.Site': [
    '<![%Cond;[',
    '  <!ENTITY Row SYSTEM "..\\Include\\XML\\Row.txt">',
    '  <!ENTITY Flag "bật">',
    ']]>',
    '<!ENTITY Flag "tắt">',
  ].join('\n'),
  'C:/P/App_Data/Controllers/Include/XML/Row.txt': '<item value="11: [ma_vung].Label, [ma_vung]"/>',
};

const readFile = (abs) => FILES[abs.replace(/\\/g, '/')] ?? null;

const HOST = 'C:/P/App_Data/Controllers/Dir/Site.xml';
const doc = (subset, body) => `<?xml version="1.0"?>\n<!DOCTYPE dir [\n${subset}\n]>\n<dir>${body}</dir>\n`;

section('resolveSystemPath — tương đối theo thư mục FILE KHAI BÁO');
eq('từ Dir/ ra Include/', resolveSystemPath('C:/P/App_Data/Controllers/Dir/Site.xml', '..\\Include\\A.ent'),
  'C:/P/App_Data/Controllers/Include/A.ent');
eq('từ Include/ vẫn ra Include/', resolveSystemPath('C:/P/App_Data/Controllers/Include/BIMode.Site', '..\\Include\\XML\\Row.txt'),
  'C:/P/App_Data/Controllers/Include/XML/Row.txt');
eq('giữ kiểu gạch UNC', resolveSystemPath(String.raw`\\srv\share\Dir\A.xml`, '..\\Include\\B.txt'),
  String.raw`\\srv\share\Include\B.txt`);

section('findInternalSubset — KHÔNG được dừng ở "]]>" của marked section');
const tricky = doc('<![INCLUDE[ <!ENTITY A "x"> ]]>', '&A;');
const sub = findInternalSubset(tricky);
ok('subset ôm trọn marked section', tricky.slice(sub.subsetStart, sub.subsetEnd).includes(']]>'));
ok('không có DOCTYPE nào sót lại phía sau', !tricky.slice(sub.doctypeEnd).includes('<!DOCTYPE'));

section('marked section INCLUDE — nhánh trong thắng nhờ first-wins');
const on = expandEntities(
  doc('<!ENTITY % BI SYSTEM "..\\Include\\BIMode.ent">\n%BI;\n<!ENTITY % S SYSTEM "..\\Include\\BIMode.Site">\n%S;', '&Flag;|&Row;'),
  { filePath: HOST, readFile },
);
eq('không lỗi', on.diagnostics, []);
// So NGUYÊN VĂN, không `includes`: bản trước lọt lưới vì giá trị nuốt cả dấu nháy đóng
// (`bật"`) mà `includes('bật')` vẫn xanh. Cả corpus mới lôi ra được.
ok('thân bung ra đúng từng ký tự',
  on.clearText.includes('<dir>bật|<item value="11: [ma_vung].Label, [ma_vung]"/></dir>'),
  JSON.stringify(on.clearText.slice(-90)));
ok('không lấy bản dự phòng', !on.clearText.includes('tắt'));
ok('DOCTYPE bị bỏ khỏi clearText', !on.clearText.includes('<!ENTITY'));

section('giá trị entity có dấu ">" không được cắt ngang');
// Giá trị dùng nháy đơn để bên trong còn dùng được nháy kép — đúng cách corpus FBO viết.
const markup = expandEntities(doc(`<!ENTITY M '<field name="a"><header v="A"/></field>'>`, '&M;'), { filePath: HOST, readFile });
ok('giữ nguyên toàn bộ markup', markup.clearText.includes('<field name="a"><header v="A"/></field>'),
  JSON.stringify(markup.clearText));
ok('không sót dấu nháy thừa', !markup.clearText.includes('</field>"'));

section('marked section IGNORE — cả nhánh biến mất, rơi về bản dự phòng');
const off = expandEntities(
  doc('<!ENTITY % Cond SYSTEM "..\\Include\\Off.txt">\n<!ENTITY % S SYSTEM "..\\Include\\BIMode.Site">\n%S;', '&Flag;'),
  { filePath: HOST, readFile },
);
ok('Flag rơi về bản ngoài section', off.clearText.includes('tắt'));
ok('không còn bản trong section', !off.clearText.includes('bật'));

section('công tắc UTF-16 — đọc sai là lộn ngược cả nhánh');
const utf16 = { ...FILES };
utf16['C:/P/App_Data/Controllers/Include/BIMode.txt'] = '\uFEFFINCLUDE';
const withBom = expandEntities(
  doc('<!ENTITY % BI SYSTEM "..\\Include\\BIMode.ent">\n%BI;\n<!ENTITY % S SYSTEM "..\\Include\\BIMode.Site">\n%S;', '&Flag;'),
  { filePath: HOST, readFile: (a) => utf16[a.replace(/\\/g, '/')] ?? null },
);
ok('BOM bị bỏ trước khi so INCLUDE', withBom.clearText.includes('bật'));

section('entity không khai báo — GIỮ NGUYÊN, không bịa rỗng');
const missing = expandEntities(doc('<!ENTITY A "x">', '&A;&KhongCo;'), { filePath: HOST, readFile });
ok('giữ nguyên văn', missing.clearText.includes('&KhongCo;'));
ok('có báo lỗi', missing.diagnostics.some((d) => d.severity === 'error' && d.message.includes('KhongCo')));
ok('entity biết thì vẫn bung', missing.clearText.includes('>x'));

section('entity dựng sẵn của XML không bị đụng tới');
const builtin = expandEntities(doc('<!ENTITY A "x">', '&amp;&lt;&gt;'), { filePath: HOST, readFile });
ok('&amp; &lt; &gt; nguyên vẹn', builtin.clearText.includes('&amp;&lt;&gt;'));

section('đệ quy thì dừng, không treo');
const cyclic = expandEntities(doc('<!ENTITY A "&B;">\n<!ENTITY B "&A;">', '&A;'), { filePath: HOST, readFile });
ok('có cảnh báo đệ quy', cyclic.diagnostics.some((d) => d.message.includes('đệ quy')));

section('provenance — hàng bung ra thuộc file Include, không thuộc controller');
const idx = on.clearText.indexOf('[ma_vung].Label');
const origin = mapToSource(on.segments, idx);
eq('chủ sở hữu là file Row.txt', origin.file.replace(/\\/g, '/'), 'C:/P/App_Data/Controllers/Include/XML/Row.txt');
ok('offset rơi trong file đó', origin.offset >= 0 && origin.offset < FILES['C:/P/App_Data/Controllers/Include/XML/Row.txt'].length);

const flagIdx = on.clearText.indexOf('<dir>');
eq('phần thân vẫn thuộc controller', mapToSource(on.segments, flagIdx).file, HOST);

section('hostRefAt — trỏ vào ĐÚNG `&Name;`, không vào khối DOCTYPE');
// Bẫy đã sập một lần: DTD kiểu `<!ENTITY k "ma_kh">` làm `&k;` bung ra chữ mà NGUỒN của chữ đó
// nằm trong chính khai báo. Đoạn ấy cũng "thuộc host", nên lối suy «lùi về đoạn host gần nhất»
// luôn dừng ở mẩu tí hon trong DOCTYPE — mọi hàng trỏ chung một chỗ giữa khối khai báo, và bấm
// field nào con trỏ cũng không nhúc nhích.
const withShorthand = expandEntities(
  doc('<!ENTITY k "ma_vung">\n<!ENTITY Row SYSTEM "..\\Include\\XML\\Row.txt">', '<f name="&k;"/>&Row;'),
  { filePath: HOST, readFile },
);
const rowIdx = withShorthand.clearText.indexOf('[ma_vung].Label');
const ref = hostRefAt(withShorthand.segments, rowIdx, HOST);
ok('có tham chiếu', ref !== null);
const raw = doc('<!ENTITY k "ma_vung">\n<!ENTITY Row SYSTEM "..\\Include\\XML\\Row.txt">', '<f name="&k;"/>&Row;');
eq('trỏ đúng vào `&Row;`', raw.slice(ref.start, ref.end), '&Row;');
ok('KHÔNG rơi vào khối DOCTYPE', ref.start > raw.indexOf(']>'));

// Chữ do `&k;` sinh ra thuộc về khai báo trong DOCTYPE — đó là provenance ĐÚNG, và chính nó là
// thứ từng làm lối suy cũ lạc đường. Giữ test này để không ai "sửa" nó thành host.
const kIdx = withShorthand.clearText.indexOf('ma_vung"');
eq('chữ của &k; vẫn quy về host', mapToSource(withShorthand.segments, kIdx).file, HOST);
eq('và không có tham chiếu ngoại lai', hostRefAt(withShorthand.segments, kIdx, HOST), null);

section('sourceRange — hàng có entity ở GIỮA vẫn quy về đúng một dòng');
// Ca thật từ FBISP2421, `Include\XML\BI.Form.View.Customer.txt`:
//   <item value="10100&Split;------: [doi_tac].Label, [doi_tac]&Tail;"/>
// Đầu hàng thuộc file Include, cuối hàng thuộc file mà `&Tail;` trỏ tới. Map riêng hai đầu rồi
// ghép là cộng hai hệ toạ độ khác nhau — ra một dải khổng lồ, và editor bôi đen mấy chục dòng.
const mixDoc = doc(
  '<!ENTITY Split "00000000">\n<!ENTITY Tail "ZZ">',
  '<item value="10100&Split;------: [doi_tac].Label, [doi_tac]&Tail;"/>',
);
const mix = expandEntities(mixDoc, { filePath: HOST, readFile });

const vStart = mix.clearText.indexOf('10100');
const vEnd = mix.clearText.indexOf('"/>', vStart);
const rng = sourceRange(mix.segments, vStart, vEnd);

eq('quy về file chủ', rng.file, HOST);
const picked = mixDoc.slice(rng.start, rng.end);
eq('bôi đen đúng MỘT dòng', picked.split('\n').length, 1);
ok('bắt đầu đúng đầu value', picked.startsWith('10100'));
// Phần `&Split;` nằm GIỮA nên vẫn phải lọt vào dải — trong file nguồn nó nằm đúng khoảng giữa.
ok('nuốt trọn entity nằm giữa', picked.includes('&Split;'));
ok('không tràn sang dòng khác', !picked.includes('<!ENTITY'));
// Dải phải nằm gọn trong dòng `<item …>` của file nguồn.
const lineStart = mixDoc.lastIndexOf('\n', rng.start) + 1;
const lineEnd = mixDoc.indexOf('\n', rng.start);
ok('nằm trong đúng dòng item', rng.start >= lineStart && rng.end <= (lineEnd === -1 ? mixDoc.length : lineEnd));

// Hàng thuần một file thì dải phải khớp CHÍNH XÁC, không nới ra.
const plainDoc = doc('<!ENTITY X "x">', '<item value="11: [a].Label, [a]"/>');
const plainEx = expandEntities(plainDoc, { filePath: HOST, readFile });
const ps = plainEx.clearText.indexOf('11: [a]');
const pr = sourceRange(plainEx.segments, ps, ps + '11: [a].Label, [a]'.length);
eq('hàng không entity: dải khớp đúng', plainDoc.slice(pr.start, pr.end), '11: [a].Label, [a]');

section('entity inline — provenance trỏ vào GIÁ TRỊ, không phải vào "<!ENTITY"');
/*
 * Gốc của một lỗi lan rất xa. `collect` từng ghi `valueStart: m.index` — offset của cả thẻ khai
 * — nên mọi đoạn văn bản do một entity inline bung ra đều khai nguồn là ba ký tự `<!E`. Hai hậu
 * quả, và cả hai đều nhìn ra ngoài thành thứ khác hẳn:
 *
 *   · Ctrl+bấm một hàng viết bằng `&k;` nhảy vào giữa khối DOCTYPE, không tới khai báo thật.
 *   · Mọi phép ghi ngược tự từ chối. `planNumericAttr` so nguyên văn dải sắp ghi đè với giá trị
 *     đang cầm; dải trỏ vào `<!E` thì không đời nào khớp `302`, và người dùng nhận câu «khai báo
 *     height trong file khác bản đã bung» cho một file chẳng có gì sai.
 *
 * Ca thật: `Dir/Customer.xml` viết `<view height="&BI.Dir.Height;">`.
 */
const INLINE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY H "302">',
  '  <!ENTITY k "ma_kho">',
  ']>',
  '<dir><view height="&H;"><item value="1: [&k;]"/></view></dir>',
].join('\r\n');

const inline = expandEntities(INLINE, { filePath: 'C:/P/Dir/A.xml', readFile: () => null });
ok('bung đúng giá trị', inline.clearText.includes('height="302"'));

// Dải của `302` trong clearText → phải quy về đúng ba ký tự `302` trong khai báo.
const at302 = inline.clearText.indexOf('height="302"') + 'height="'.length;
const r302 = sourceRange(inline.segments, at302, at302 + 3);
eq('cùng file (khai trong internal subset)', r302.file, 'C:/P/Dir/A.xml');
eq('trỏ đúng vào giá trị, không vào thẻ khai', INLINE.slice(r302.start, r302.end), '302');

// Cùng luật với một entity dùng làm TÊN FIELD, không chỉ với số.
const atName = inline.clearText.indexOf('[ma_kho]') + 1;
const rName = sourceRange(inline.segments, atName, atName + 'ma_kho'.length);
eq('entity tên field cũng trỏ vào giá trị', INLINE.slice(rName.start, rName.end), 'ma_kho');

// Nháy đơn, và giá trị chứa dấu `>` — phép đo không được dựa vào `\s*>` ở đuôi.
const QUOTED = [
  '<!DOCTYPE dir [',
  "  <!ENTITY W 'a > b'>",
  ']>',
  '<dir><item value="&W;"/></dir>',
].join('\r\n');
const quoted = expandEntities(QUOTED, { filePath: 'C:/P/Dir/B.xml', readFile: () => null });
const atW = quoted.clearText.indexOf('a > b');
const rW = sourceRange(quoted.segments, atW, atW + 5);
eq('nháy đơn + giá trị có ">"', QUOTED.slice(rW.start, rW.end), 'a > b');

// Entity RỖNG: không có gì bung ra nên không có đoạn nào để map — chỉ cần không nổ.
const EMPTY = ['<!DOCTYPE dir [', '  <!ENTITY E "">', ']>', '<dir><item value="x&E;y"/></dir>'].join('\r\n');
const empty = expandEntities(EMPTY, { filePath: 'C:/P/Dir/C.xml', readFile: () => null });
ok('entity rỗng không làm hỏng phép bung', empty.clearText.includes('value="xy"'));

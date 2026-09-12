// test-mail-html.mjs — dòng HTML, chỉ mục phần tử và bản vẽ của Email Designer.
//
// Fixture cố tình mang đủ những chỗ corpus thật làm khó: `&CssClass;` bung ra `<head><style>`
// thành nút chữ XML, `&HeaderColor;` chen GIỮA `style="…"` của một `<td>`, `<html>`/`<table>` mở ở
// header đóng ở footer, một action tiêm từ file Include qua `SYSTEM`, và nội dung độc hại
// (`onclick`, `<script>`, `data-fbo-el` giả) mà bản vẽ phải gỡ.

import { section, eq, ok } from './harness.mjs';
import { expandEntities } from '../src/entities.mjs';
import { mailActionLabels } from '../src/mail-template.mjs';
import {
  buildMailView, indexMailElements, renderMailDesign, wireMailElements, mapMailEdits, parseStyleDeclarations,
} from '../src/mail-html.mjs';

export const HOST = 'C:/P/App_Data/Controllers/Options/Message.xml';
export const SHARED = 'C:/P/App_Data/Controllers/Options/Shared.xml';

export const SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE message [
  <!ENTITY CssClass "&lt;head&gt;&lt;style&gt;.r1{width:50px}&lt;/style&gt;&lt;/head&gt;">
  <!ENTITY HeaderColor "background-color:#edede2;">
  <!ENTITY SharedAction SYSTEM "Shared.xml">
]>
<message xmlns="urn:schemas-fast-com:data-message">
  <mail>
    <template>
      &SharedAction;
      <action id="Order" v="Đơn hàng" e="Order">
        <fields>
          <field name="h_so_ct"><header v="Số phiếu" e="Number"/></field>
        </fields>
        <body>
          <header>
            <text><![CDATA[<html>]]>&CssClass;<![CDATA[<body>
<h2 class="title" style="color:#333;">
    Xin chào {!ten_kh}
</h2>
<p>Cảm ơn &amp; hẹn gặp lại</p>
<a href="{!alink}&n=1" style="display:{!slink};color:#003399;" onclick="steal()">Duyệt</a>
<img src="logo.png" data-fbo-el="e999"/>
<p><b>Đậm</b> thường</p>
<p></p>
<a href="https://fast.com.vn"><img src="banner.png" width=600 alt="Banner"></a>
<div align="center"><a href="{!order_url}" style="display:inline-block;padding:10px 20px;color:#ffffff;background-color:#1677ff;">Xem đơn hàng</a></div>
<hr style="border:0;border-top:1px solid #dddddd;">
<div style="height:20px;line-height:20px;font-size:0;">&#160;</div>
<script>alert(1)</script>
<table><tr><td style="width:100px;]]>&HeaderColor;<![CDATA[">{!h_so_ct}</td><td>{!so_ct}</td></tr>
]]></text>
          </header>
          <detail>
            <text><![CDATA[<tr><td>{!ma_vt}</td><td style='color:red'>{!ten_vt}</td></tr>]]></text>
          </detail>
          <footer>
            <text><![CDATA[</table></body></html>]]></text>
          </footer>
        </body>
      </action>
    </template>
  </mail>
</message>
`;

export const SHARED_SOURCE = `<action id="Shared" v="Dùng chung" e="Shared">
  <fields/>
  <body>
    <header><text><![CDATA[<html><body><p>Chung</p>]]></text></header>
    <footer><text><![CDATA[</body></html>]]></text></footer>
  </body>
</action>
`;

/** Dựng lại toàn bộ từ các văn bản nguồn — test sửa khứ hồi dùng lại với văn bản đã đổi. */
export function build(files = { [HOST]: SOURCE, [SHARED]: SHARED_SOURCE }, { actionId = 'Order', body = 'body' } = {}) {
  const expanded = expandEntities(files[HOST], { filePath: HOST, readFile: (abs) => files[abs] ?? null });
  const view = buildMailView(expanded.clearText, expanded.segments, { actionId, body });
  const index = view.ok ? indexMailElements(view) : null;
  return {
    files, expanded, view, index,
  };
}

/** Phần tử thứ `n` (từ 0) mang thẻ `tag`. */
export const nth = (index, tag, n = 0) => index.elements.filter((e) => e.tag === tag)[n];

section('mail html — dòng HTML từ ba part');
{
  const { view, expanded } = build();
  ok('dựng được', view.ok, view.reason);
  eq('đủ ba part theo thứ tự', view.parts.map((p) => p.part), ['header', 'detail', 'footer']);
  ok('entity trong nút chữ XML đã giải mã thành thẻ thật', view.html.includes('<head><style>.r1{width:50px}</style></head>'));
  ok('entity chen giữa style đã nằm liền trong dòng HTML', view.html.includes('<td style="width:100px;background-color:#edede2;">'));
  ok('có mảnh text do entity sinh ra', view.pieces.some((p) => p.kind === 'text' && p.fromEntity));
  ok('mảnh cdata khớp nguyên văn clearText',
    view.pieces.filter((p) => p.kind === 'cdata').every((p) => view.html.slice(p.htmlStart, p.htmlEnd) === expanded.clearText.slice(p.clearStart, p.clearEnd)));
  const miss = buildMailView(expanded.clearText, expanded.segments, { actionId: 'Order', body: 'body9' });
  ok('biến thể không có → từ chối kèm lý do', !miss.ok && miss.reason.includes('body9'));

  const shared = build(undefined, { actionId: 'Shared' });
  ok('action tiêm từ Include dựng được', shared.view.ok, shared.view.reason);
  ok('mảnh cdata của nó thuộc file Include', shared.view.pieces.filter((p) => p.kind === 'cdata').every((p) => p.file === SHARED));
}

section('mail html — chỉ mục phần tử và vai trò');
{
  const { index } = build();
  eq('id đánh số liền từ e1', index.elements.slice(0, 3).map((e) => e.id), ['e1', 'e2', 'e3']);
  eq('không cảnh báo tokenizer', index.warnings, []);
  eq('html mở header đóng footer = frame', nth(index, 'html').role, 'frame');
  eq('body = frame', nth(index, 'body').role, 'frame');
  eq('table mở header đóng footer = frame', nth(index, 'table').role, 'frame');
  eq('head sinh từ entity = frame', nth(index, 'head').role, 'frame');
  eq('h2 = block', nth(index, 'h2').role, 'block');
  eq('a = inline', nth(index, 'a').role, 'inline');
  eq('td = structure', nth(index, 'td').role, 'structure');
  eq('tr của detail thuộc part detail', nth(index, 'tr', 1).part, 'detail');
  eq('cha của tr detail là table mở từ header', nth(index, 'tr', 1).parentId, nth(index, 'table').id);
  ok('fingerprint mang part + thẻ mở nguyên văn', nth(index, 'h2').fingerprint === 'header|h2|<h2 class="title" style="color:#333;">');

  eq('h2 sửa chữ được', nth(index, 'h2').caps.setText, true);
  ok('p có phần tử con → lý do', String(nth(index, 'p', 1).caps.setText).includes('phần tử con'));
  eq('p rỗng sửa chữ được (điểm chèn)', nth(index, 'p', 2).caps.setText, true);
  ok('img không có chữ', nth(index, 'img').caps.setText !== true);
  eq('td chứa token sửa chữ được', nth(index, 'td').caps.setText, true);
  ok('td có style bị entity cắt → không sửa style', String(nth(index, 'td').caps.setStyle).includes('entity'));
  eq('h2 sửa style được', nth(index, 'h2').caps.setStyle, true);
  eq('img chưa có style vẫn sửa style được (chèn thuộc tính)', nth(index, 'img').caps.setStyle, true);
  ok('html (frame) không sửa style', nth(index, 'html').caps.setStyle !== true);
  eq('h2 xoá/di chuyển được (Phase 5)', [nth(index, 'h2').caps.removeElement, nth(index, 'h2').caps.moveElement], [true, true]);
  ok('ô bảng không xoá bằng phép phần tử', String(nth(index, 'td').caps.removeElement).includes('hàng/ô bảng'));
}

section('mail html — loại component và thuộc tính (Phase 4)');
{
  const { view, index } = build();
  eq('ảnh', nth(index, 'img', 1).kind, 'image');
  eq('a mang display:{!token} = liên kết', nth(index, 'a', 0).kind, 'link');
  eq('a có nền + đệm = nút', nth(index, 'a', 2).kind, 'button');
  eq('hr = đường kẻ', nth(index, 'hr').kind, 'divider');
  eq('div chỉ &#160; = khoảng trống', nth(index, 'div', 1).kind, 'spacer');
  eq('td có chữ = khung chứa', nth(index, 'td', 1).kind, 'container');
  eq('h2 = chữ', nth(index, 'h2').kind, 'text');
  eq('body = khung tài liệu', nth(index, 'body').kind, 'frame');

  eq('img sửa thuộc tính được', nth(index, 'img', 1).caps.setAttr, true);
  ok('h2 không có thuộc tính nào cho sửa', String(nth(index, 'h2').caps.setAttr).includes('không có thuộc tính'));
  ok('html (frame) không sửa thuộc tính', nth(index, 'html').caps.setAttr !== true);
  eq('td có style bị entity cắt: điểm chèn vẫn trong cdata → không khoá thuộc tính nào', nth(index, 'td', 0).attrLocks, {});

  const img = wireMailElements(view, index).find((w) => w.id === nth(index, 'img', 1).id);
  eq('wire mang kind + attrNames', [img.kind, img.attrNames], ['image', ['src', 'alt', 'width', 'height', 'align', 'border', 'title']]);
  eq('wire đọc được thuộc tính không nháy', img.attrs, { src: 'banner.png', width: '600', alt: 'Banner' });

  const locked = build({ [HOST]: SOURCE.replace('<td style="width:100px;]]>&HeaderColor;<![CDATA[">', '<td width="]]>&HeaderColor;<![CDATA[">'), [SHARED]: SHARED_SOURCE });
  const td = nth(locked.index, 'td', 0);
  ok('thuộc tính bị entity cắt → khoá kèm lý do', String(td.attrLocks.width).includes('entity'));
  ok('thuộc tính khác của cùng thẻ vẫn thêm được', !('align' in td.attrLocks));
}

section('mail html — bản vẽ: làm sạch, đánh dấu, thay nhãn');
{
  const { view, index, expanded } = build();
  const html = renderMailDesign(view, index, { labels: mailActionLabels(expanded.clearText, 'Order'), vi: true });
  const marks = html.match(/data-fbo-el="e\d+"/g) ?? [];
  eq('mỗi phần tử còn lại đúng một dấu (script bị gỡ)', marks.length, index.elements.length - 1);
  ok('id giả của mẫu bị gỡ', !html.includes('e999'));
  ok('onclick bị gỡ', !/onclick/i.test(html));
  ok('script bị gỡ cả nội dung', !/<script/i.test(html) && !html.includes('alert(1)'));
  ok('nhãn field thay vào {!h_so_ct}', html.includes('Số phiếu'));
  ok('token dữ liệu giữ nguyên', html.includes('{!so_ct}') && html.includes('{!ten_kh}'));
  ok('href mang token giữ nguyên', html.includes('href="{!alink}&n=1"'));
  ok('dấu gắn trước "/>" của thẻ tự đóng', html.includes('<img src="logo.png" data-fbo-el="'));
  const evil = build({ [HOST]: SOURCE.replace('href="{!alink}&n=1"', 'href="java&#x09;script:alert(1)"'), [SHARED]: SHARED_SOURCE });
  const evilHtml = renderMailDesign(evil.view, evil.index);
  ok('URL javascript: (kể cả lách bằng tham chiếu ký tự) thành #', evilHtml.includes('href="#"') && !/script:alert/i.test(evilHtml));
  ok('nguồn không đổi sau khi vẽ', expanded.clearText.includes('onclick="steal()"'));
}

section('mail html — dữ liệu gửi webview');
{
  const { view, index } = build();
  const wire = wireMailElements(view, index);
  const byTag = (tag, n = 0) => wire.filter((w) => w.tag === tag)[n];
  eq('chữ h2 bỏ thụt lề, giữ token', byTag('h2').text, 'Xin chào {!ten_kh}');
  eq('chữ p đã giải &amp;', byTag('p').text, 'Cảm ơn & hẹn gặp lại');
  eq('p có con → không gửi chữ', byTag('p', 1).text, null);
  eq('style a theo thứ tự nguồn', byTag('a').style, [['display', '{!slink}'], ['color', '#003399']]);
  eq('thuộc tính theo whitelist (onclick không đi)', byTag('a').attrs, { href: '{!alink}&n=1' });
  ok('không một mốc toạ độ nào đi sang webview', wire.every((w) => !('openStart' in w) && !('fingerprint' in w) && !('attrs' in w && 'start' in w.attrs)));
}

section('mail html — khai báo style và quy về nguồn');
{
  eq('tách ở ; ngoài ngoặc', parseStyleDeclarations('a:1; b : url(data:x;y) ;c:3').map((d) => [d.property, d.value]),
    [['a', '1'], ['b', 'url(data:x;y)'], ['c', '3']]);
  eq('chuỗi rỗng', parseStyleDeclarations(''), []);

  const { expanded } = build();
  const segs = expanded.segments;
  const hostSeg = segs.find((s) => s.file === HOST && s.end - s.start > 40);
  const inside = mapMailEdits(segs, [{ start: hostSeg.start + 2, end: hostSeg.start + 5, text: 'X' }]);
  ok('dải trong một đoạn quy được', inside.ok && inside.edits[0].file === HOST && inside.edits[0].end - inside.edits[0].start === 3);
  const across = mapMailEdits(segs, [{ start: hostSeg.end - 1, end: hostSeg.end + 1, text: 'X' }]);
  ok('dải đi qua ranh giới đoạn bị từ chối', !across.ok);
  const point = mapMailEdits(segs, [{ start: hostSeg.end, end: hostSeg.end, text: 'X', bias: 'left' }]);
  ok('điểm chèn bias left bám đoạn đứng trước', point.ok && point.edits[0].file === HOST && point.edits[0].start === hostSeg.sourceEnd);
}

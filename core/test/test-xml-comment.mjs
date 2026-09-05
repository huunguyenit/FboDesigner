// test-xml-comment.mjs — thẻ và khai báo nằm trong `<!-- … -->` thì KHÔNG tồn tại.
//
// Ca thật: `Dir/Customer.xml` của HOATP có `<!-- &BI.Form.View.Customer; -->` ngay sau `<views>`.
// Entity ấy bung ra 2970 byte chứa nguyên một `<view>` với 28 `<item>`. Trước bản sửa, cả cái
// view đã bị tắt ấy được chèn vào `clearText` rồi `scanViews` nhặt phải — designer vẽ nhầm view
// trong khi file thì rõ ràng đã comment.

import { ok, eq, section } from './harness.mjs';
import { commentRanges, inComment } from '../src/xml-comment.mjs';
import { scanViews, scanFields, scanToolbar } from '../src/spans.mjs';
import { expandEntities } from '../src/entities.mjs';

section('comment — nhận đúng vùng, CDATA thì đục');
eq('một comment', commentRanges('a<!--x-->b'), [{ start: 1, end: 9 }]);
eq('không có comment', commentRanges('<a/>'), []);
/*
 * CDATA phải ĐỤC: script và SQL của FBO đầy dấu so sánh, và một `<!--` trong đó mà bị đọc thành
 * comment là nuốt luôn phần văn bản thật phía sau nó.
 */
const cdata = '<![CDATA[ if a <!-- b ]]><!--thật-->';
eq('CDATA che được dấu mở comment', commentRanges(cdata), [{ start: cdata.indexOf('<!--thật'), end: cdata.length }]);
ok('và vùng nhận được đúng là comment thật', cdata.slice(...Object.values(commentRanges(cdata)[0])) === '<!--thật-->');
// Comment không đóng: coi hết file là comment. Đọc tiếp là chắc chắn đọc nhầm.
eq('comment không đóng thì nuốt tới hết file', commentRanges('a<!--x').at(-1).end, 6);
ok('inComment: trong', inComment([{ start: 1, end: 9 }], 3));
ok('inComment: ngoài', !inComment([{ start: 1, end: 9 }], 9));

section('comment — <item> và <field> bị comment không lọt vào model');
const XML = [
  '<dir xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <!-- <field name="da_bo"><header v="Bỏ" e="Dropped"/></field> -->',
  '  </fields>',
  '  <views><view id="Dir" columns="100,300">',
  '    <item value="100, 300"/>',
  '    <!-- <item value="1100: [da_bo].Label, [da_bo]"/> -->',
  '    <item value="1100: [ma_kh].Label, [ma_kh]"/>',
  '  </view></views>',
  '</dir>',
].join('\n');
eq('field bị comment không được khai', scanFields(XML).map((f) => f.name), ['ma_kh']);
eq('item bị comment không thành hàng', scanViews(XML)[0].items.length, 2);
ok('và item còn lại đúng là hai cái không bị comment',
  scanViews(XML)[0].items.every((i) => !String(i.value).includes('da_bo')));

section('comment — cả <view> bị comment cũng không lọt');
const TWOVIEW = [
  '<dir xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields><field name="a"><header v="A" e="A"/></field></fields>',
  '  <views>',
  '    <!-- <view id="Cu" columns="9"><item value="9"/></view> -->',
  '    <view id="Moi" columns="100"><item value="100"/></view>',
  '  </views>',
  '</dir>',
].join('\n');
eq('chỉ còn view không bị comment', scanViews(TWOVIEW).map((v) => v.attrs.id), ['Moi']);

section('comment — khai báo entity bị comment không được đăng ký');
/*
 * Nặng hơn vẻ ngoài vì luật FIRST-WINS: bản bị comment đứng trước sẽ THẮNG bản khai thật đứng
 * sau. Người viết file tưởng mình đã tắt một khai báo, designer vẫn dùng đúng cái đó.
 */
const DECL = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!-- <!ENTITY nhan "CŨ"> -->',
  '  <!ENTITY nhan "MỚI">',
  ']>',
  '<dir xmlns="urn:schemas-fast-com:data-dir"><title v="&nhan;" e="x"/></dir>',
].join('\n');
const decl = expandEntities(DECL, { filePath: 'C:/P/App_Data/Controllers/Dir/X.xml', readFile: () => null });
ok('bản khai THẬT thắng, không phải bản bị comment', decl.clearText.includes('v="MỚI"'));
ok('không còn dấu vết bản cũ', !decl.clearText.includes('v="CŨ"'));

section('comment — tham chiếu &Name; bị comment thì KHÔNG bung');
/*
 * Đây là vế nặng của lỗi HOATP: entity bung ra cả một khối `<view>`. Bung nó là chèn cả cái
 * view đã tắt vào clearText rồi `scanViews` nhặt phải.
 */
const REF = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY ViewCu "<view id=\'Cu\' columns=\'9\'><item value=\'9\'/></view>">',
  ']>',
  '<dir xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields><field name="a"><header v="A" e="A"/></field></fields>',
  '  <views>',
  '    <!-- &ViewCu; -->',
  '    <view id="Moi" columns="100"><item value="100"/></view>',
  '  </views>',
  '</dir>',
].join('\n');
const ref = expandEntities(REF, { filePath: 'C:/P/App_Data/Controllers/Dir/X.xml', readFile: () => null });
ok('tham chiếu giữ nguyên văn trong comment', ref.clearText.includes('<!-- &ViewCu; -->'));
ok('không chèn view đã tắt vào', !ref.clearText.includes("id='Cu'"));
eq('nên chỉ quét ra view thật', scanViews(ref.clearText).map((v) => v.attrs.id), ['Moi']);
// Entity vẫn được KHAI BÁO bình thường — chỉ chỗ dùng bị comment mới không bung.
ok('khai báo vẫn còn, không phải bị xoá', ref.declarations.has('ViewCu'));

section('comment — <category> bị comment không thành tab');
/*
 * Ca thật: `Dir/ZTHTran.xml` của FAHASAKHANHHOA comment cả khối
 * `<!--<category index="18">…</category>-->` mà tab «Khác» vẫn hiện. Nặng hơn một cái tab thừa:
 * `columns` của category là list px RIÊNG của vùng đó, nên vùng bị vẽ theo một bản khai đã tắt.
 */
const CAT = [
  '<dir xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields><field name="a" categoryIndex="18"><header v="A" e="A"/></field></fields>',
  '  <views><view id="Dir" columns="100,300">',
  '    <item value="100, 300"/>',
  '    <categories>',
  '      <category index="1" columns="400"><header v="Chi tiết" e="Detail"/></category>',
  '      <!--<category index="18" columns="100, 300">',
  '        <header v="Khác" e="Other"/>',
  '      </category>-->',
  '      <category index="-1" columns="400"><header v="" e=""/></category>',
  '    </categories>',
  '  </view></views>',
  '</dir>',
].join('\n');
eq('chỉ còn tab không bị comment', scanViews(CAT)[0].categories.map((c) => c.index), [1, -1]);
ok('không nhặt nhãn của bản đã tắt', scanViews(CAT)[0].categories.every((c) => c.header?.v !== 'Khác'));

section('comment — cả khối <categories> bị comment thì lấy khối THẬT đứng sau');
const CATS = [
  '<dir xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields><field name="a"><header v="A" e="A"/></field></fields>',
  '  <views><view id="Dir" columns="100">',
  '    <item value="100"/>',
  '    <!--<categories>',
  '      <category index="9" columns="100"><header v="Cũ" e="Old"/></category>',
  '    </categories>-->',
  '    <categories>',
  '      <category index="1" columns="100"><header v="Chi tiết" e="Detail"/></category>',
  '    </categories>',
  '  </view></views>',
  '</dir>',
].join('\n');
eq('khối bị comment không thắng khối thật', scanViews(CATS)[0].categories.map((c) => c.index), [1]);

section('comment — <button> bị comment không lên toolbar');
/*
 * 46 file trong `App_Data\Controllers` của FAHASAKHANHHOA tắt lệnh bằng cách comment cả thẻ
 * `<button>`. Vẽ chúng ra là designer bày lệnh mà runtime không có.
 */
const TB = [
  '<grid xmlns="urn:schemas-fast-com:data-grid">',
  '  <toolbar>',
  '    <button command="New"><title v="Mới" e="New"/></button>',
  '    <!--<button command="Delete"><title v="Xoá" e="Delete"/></button>-->',
  '    <button command="Edit"><title v="Sửa" e="Edit"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\n');
eq('chỉ còn nút không bị comment', scanToolbar(TB).map((b) => b.command), ['New', 'Edit']);

section('comment — cả khối <toolbar> bị comment thì lấy khối THẬT đứng sau');
const TB2 = [
  '<grid xmlns="urn:schemas-fast-com:data-grid">',
  '  <!--<toolbar>',
  '    <button command="Cu"><title v="Cũ" e="Old"/></button>',
  '  </toolbar>-->',
  '  <toolbar>',
  '    <button command="New"><title v="Mới" e="New"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\n');
eq('khối bị comment không thắng khối thật', scanToolbar(TB2).map((b) => b.command), ['New']);

section('comment — <menuItem> bị comment không thành mục xổ xuống');
/*
 * Nặng hơn một dòng menu thừa: `grid.mjs` quyết nút là «group» bằng ĐỘ DÀI mảng này, và group
 * đổi cả tên class lẫn bề rộng nút. Comment hết mục con là nút phải trở lại nút thường.
 */
const MENU = [
  '<grid xmlns="urn:schemas-fast-com:data-grid">',
  '  <toolbar>',
  '    <button command="Retrieve"><title v="Lấy dữ liệu" e="Retrieve"/>',
  '      <menuItems>',
  '        <menuItem commandArgument="10"><header v="Từ đơn hàng" e="From SO"/></menuItem>',
  '        <!--<menuItem commandArgument="20"><header v="Từ hợp đồng" e="From contract"/></menuItem>-->',
  '      </menuItems>',
  '    </button>',
  '    <button command="Compose"><title v="Gộp" e="Compose"/>',
  '      <!--<menuItems>',
  '        <menuItem commandArgument="30"><header v="Đã tắt" e="Off"/></menuItem>',
  '      </menuItems>-->',
  '    </button>',
  '  </toolbar>',
  '</grid>',
].join('\n');
const tb = scanToolbar(MENU);
eq('mục menu bị comment không lọt', tb[0].menu.map((i) => i.arg), ['10']);
eq('cả khối <menuItems> bị comment thì nút hết là group', tb[1].menu, []);
ok('nhãn của mục còn lại vẫn đọc đúng', tb[0].menu[0].v === 'Từ đơn hàng');

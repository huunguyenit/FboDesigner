// test-control.mjs — field thật lấy từ Dir/Site.xml của FBISP2421.
// Tên class là tên của runtime FBO, không phải tên ta đặt: đổi ở đây là tự cắt khỏi CSS thật.

import { ok, eq, section } from './harness.mjs';
import { scanFields } from '../src/spans.mjs';
import { renderControl } from '../src/control.mjs';

const XML = [
  '<dir>',
  '  <fields>',
  '    <field name="ma_dvcs" allowNulls="false">',
  '      <header v="Đơn vị" e="Unit"/>',
  '      <items style="AutoComplete" controller="Unit" reference="ten_dvcs%l"/>',
  '    </field>',
  '    <field name="ten_dvcs%l" readOnly="true" external="true" defaultValue="\'\'">',
  '      <header v="" e=""/>',
  '    </field>',
  '    <field name="dai_ly_yn" type="Boolean"><header v="Đại lý" e="Agent"/></field>',
  '    <field name="default_yn" type="Boolean" clientDefault="1"><header v="Mặc định" e="Default"/></field>',
  '    <field name="ghi_chu" rows="2"><header v="Ghi chú" e="Note"/></field>',
  '    <field name="status" clientDefault="1" align="right" inactivate="true">',
  '      <header v="Trạng thái" e="Status"/>',
  '      <footer v="1 - Còn sử dụng, 0 - Không còn sử dụng" e="1 - Active, 0 - Inactive"/>',
  '      <items style="Mask"/>',
  '    </field>',
  '    <field name="loai" ><header v="Loại" e="Type"/>',
  '      <items style="DropDownList">',
  '        <item value="0"><text v="Không tính" e="None"/></item>',
  '        <item value="1"><text v="Có tính" e="Yes"/></item>',
  '      </items>',
  '    </field>',
  '    <field name="ngay_ct" type="DateTime"><header v="Ngày" e="Date"/></field>',
  '  </fields>',
  '</dir>',
].join('\n');

const fields = new Map(scanFields(XML).map((f) => [f.name, f]));
const html = (name, opts) => renderControl(fields.get(name), opts);

section('scanFields đọc được footer và items');
eq('footer của status', fields.get('status').footer.v, '1 - Còn sử dụng, 0 - Không còn sử dụng');
eq('items style', fields.get('ma_dvcs').items.style, 'AutoComplete');
eq('hai lựa chọn của combo', fields.get('loai').options.map((o) => o.v), ['Không tính', 'Có tính']);

section('AutoComplete = Lookup: input + icon kính lúp');
const lookup = html('ma_dvcs');
ok('class runtime đúng', lookup.includes('class="FormInput FormTextInput FormTextInputLookup"'));
ok('chừa 23px cho icon', lookup.includes('width:calc(100% - 23px);'));
ok('có thẻ neo icon', lookup.includes('<a class="CellDivContainer"'));

// Icon là NỀN do `.CellImage` vẽ từ sprite, `src` chỉ là ảnh 1×1 trong suốt — đúng như runtime.
// Bản trước trỏ `src` vào `<program>\Images\Lookup.png`, một sprite 22×44 hai trạng thái, bị
// nén vào hộp 15×11 và vẽ đè lên sprite thật; `Calendar.png` thì program không có nên ô lịch
// ra ảnh vỡ. Nhìn ra thì tưởng trình duyệt cache hình cũ.
ok('src là ảnh 1×1 trong suốt', lookup.includes('src="data:image/gif;base64,'));
ok('KHÔNG trỏ vào ảnh của program', !/src="[^"]*(Lookup|Calendar)\.png/.test(lookup));
ok('icon lookup dùng class sprite', lookup.includes('class="CellImage CellImgLookup"'));

section('readOnly + external = không nhập được');
const ro = html('ten_dvcs%l');
ok('class disabled', ro.includes('FormInputDisabled'));
ok('thuộc tính readonly', ro.includes(' readonly'));
ok("defaultValue=\"''\" là chuỗi rỗng, không phải hai dấu nháy", ro.includes('value=""'));
ok('id bỏ hậu tố %l', ro.includes('id="fbo-field-ten_dvcs"'));

section('Boolean = checkbox');
// `title` là tooltip tên field của designer — runtime không có nó, và nó không đổi một px nào
// của bố cục. Xem `fieldHint`.
ok('dai_ly_yn không tích', html('dai_ly_yn') === '<input type="checkbox" id="fbo-field-dai_ly_yn" class="FormInput FormCheckInput" data-field-name="dai_ly_yn" title="dai_ly_yn">');
ok('clientDefault="1" thì tích', html('default_yn').includes(' checked'));

section('rows > 1 = textarea');
ok('ghi_chu ra textarea', html('ghi_chu').startsWith('<textarea'));
ok('giữ số dòng', html('ghi_chu').includes('rows="2"'));
ok('class runtime của textarea', html('ghi_chu').includes('class="FormTextArea FormTextInput"'));
ok('không cho kéo giãn, giống runtime', html('ghi_chu').includes('resize:none;'));

// Runtime của Dir/Site.xml cho ma_dvcs ra `style="width: 77px"` dù field KHÔNG khai @width:
// ô trải 3 cột 25+5+70 = 100, trừ 23px chỗ đeo icon. Lấy nhầm từ @width là ô lookup nào cũng
// rơi về calc(100%-23px) và hẹp hơn runtime đúng bằng padding của ô.
section('ô Lookup lấy bề rộng từ Ô, không từ @width');
eq('ô 100px → input 77px', /width:(\d+)px;/.exec(html('ma_dvcs', { cellWidth: 100 }))?.[1], '77');
ok('không có cellWidth thì mới rơi về calc', html('ma_dvcs').includes('width:calc(100% - 23px);'));

section('DropDownList = select');
const sel = html('loai');
ok('ra select', sel.startsWith('<select'));
ok('đủ hai option', (sel.match(/<option/g) || []).length === 2);
ok('nhãn tiếng Việt', sel.includes('>Không tính<'));
ok('tiếng Anh khi vi=false', html('loai', { vi: false }).includes('>None<'));

section('align và inactivate');
const st = html('status');
ok('căn phải', st.includes('text-align:right;'));
ok('inactivate cũng là không nhập được', st.includes('FormInputDisabled'));
ok('clientDefault ra value', st.includes('value="1"'));

section('DateTime = ô lịch');
ok('class calendar', html('ngay_ct').includes('FormTextInputCalendar'));
ok('icon lịch', html('ngay_ct').includes('class="CellImage CellImgCalendar"'));
ok('ô lịch cũng không trỏ vào ảnh program', !/src="[^"]*Calendar\.png/.test(html('ngay_ct')));

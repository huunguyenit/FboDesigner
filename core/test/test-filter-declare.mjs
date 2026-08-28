// test-filter-declare.mjs — khai báo lọc nhanh: đọc nguồn cột, sinh `sysfilterdeclares`, và
// vá XML.
//
// Fixture rút gọn từ `Grid/ARTran.xml` của FBISP24 — bản customize CÓ câu Finding văn bản
// thường, tức đúng loại file mà tính năng này nhắm tới. Mệnh đề join
// `'a left join dmkh b on a.ma_kh = b.ma_kh'` chép nguyên văn từ file ấy.

import { ok, eq, section } from './harness.mjs';
import { scanFields, applySplices } from '../src/spans.mjs';
import {
  scanPartition,
  scanFindingJoin,
  scanControllerName,
  scanSysDatabaseName,
  scanConnectionString,
  buildFilterDeclarations,
  renderFilterDeclareSql,
  planEnableFilter,
} from '../src/filter-declare.mjs';

const ARTRAN = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE grid [',
  '  <!ENTITY TransferID "ARTran">',
  '  <!ENTITY Controller "&TransferID;">',
  ']>',
  '<grid table="m21$000000" code="stt_rec" type="Voucher" id="HD1" xmlns="urn:schemas-fast-com:data-grid">',
  '  <title v="Hóa đơn dịch vụ" e="Service Invoice"></title>',
  '  <partition table="c21$000000" prime="m21$" inquiry="i21$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="ma_dvcs" width="100" aliasName="a" allowFilter="true">',
  '      <header v="Đơn vị" e="Unit"></header>',
  '      <query>insert into #filter select @@fieldName, @@type, @@conditional</query>',
  '    </field>',
  '    <field name="ngay_ct" type="DateTime" width="100" aliasName="a" allowFilter="true">',
  '      <header v="Ngày" e="Date"></header>',
  '      <query>insert into #filter select @@fieldName, @@type, @@conditional</query>',
  '    </field>',
  '    <field name="t_tt_nt" type="Decimal" width="120" aliasName="a" allowFilter="true">',
  '      <header v="Thanh toán" e="Payment"></header>',
  '      <query>insert into #filter select @@fieldName, @@type, @@conditional</query>',
  '    </field>',
  '    <field name="ten_kh%l" width="300" external="true" aliasName="b" allowFilter="true">',
  '      <header v="Tên khách" e="Customer Name"></header>',
  '      <query>insert into #filter select @@fieldName, @@type, @@conditional</query>',
  '    </field>',
  '    <field name="dien_giai" width="200" aliasName="z"><header v="Diễn giải" e="Description"/></field>',
  '  </fields>',
  '  <views><view id="Grid">',
  '    <field name="ma_dvcs"/><field name="ngay_ct"/><field name="ten_kh%l"/><field name="dien_giai"/>',
  '  </view></views>',
  '  <queries>',
  '    <query event="Finding">',
  '      <text>',
  '        <![CDATA[exec FastBusiness$App$Voucher$Finding',
  '@@id, @@master, @@prime, @@inquiry, @@partition, @@expression, @@increase,',
  "@@keyMaster, @@keyDetail, 'stt_rec', @@textList, @@textExternal,",
  "'a left join dmkh b on a.ma_kh = b.ma_kh', @@textOrderBy, @@admin, @@userID]]>",
  '      </text>',
  '    </query>',
  '  </queries>',
  '</grid>',
].join('\n');

const FIELDS = scanFields(ARTRAN);

section('lọc nhanh — <partition> nói ra bảng master của lưới chứng từ');
const part = scanPartition(ARTRAN);
eq('prime đọc được', part.prime, 'm21$');
// `%Partition` là chỗ giữ để runtime cắm hậu tố kỳ vào — không phải tên bảng có thật.
eq('bảng master mang hậu tố %Partition', part.primeTable, 'm21$%Partition');
eq('bảng chi tiết', part.table, 'c21$000000');
eq('không có <partition> thì null', scanPartition('<grid/>'), null);

section('lọc nhanh — mệnh đề join của câu Finding là nguồn DUY NHẤT nói alias là bảng nào');
const finding = scanFindingJoin(ARTRAN);
ok('đọc được', finding.ok);
eq('alias gốc', finding.base, 'a');
eq('đúng một join', finding.joins.length, 1);
eq('alias b là bảng dmkh', finding.joins[0].table, 'dmkh');
eq('kiểu join', finding.joins[0].kind, 'left');
eq('mệnh đề on giữ nguyên văn', finding.joins[0].on, 'a.ma_kh = b.ma_kh');
eq('khoá bên gốc', finding.joins[0].leftKey, 'ma_kh');
eq('khoá bên bảng tham chiếu', finding.joins[0].rightKey, 'ma_kh');

/*
 * 370/401 câu Finding trong `Grid/` của FBISP24 nằm trong `<Encrypted>`. Với chúng phải TỪ CHỐI
 * kèm lý do, không đoán: đoán ra một `xtable` sai thì lọc vẫn chạy và vẫn ra kết quả — chỉ là
 * sai dữ liệu, thứ người dùng không có cách nào nhìn ra.
 */
section('lọc nhanh — câu Finding mã hoá thì TỪ CHỐI, không đoán');
const enc = scanFindingJoin(
  '<queries><query event="Finding"><text><![CDATA[<Encrypted>abc==</Encrypted>]]></text></query></queries>',
);
ok('không ok', !enc.ok);
ok('nói rõ vì sao', enc.reason.includes('mã hoá'));
eq('không bịa join nào', enc.joins.length, 0);
ok('không có câu Finding cũng từ chối', !scanFindingJoin('<grid/>').ok);

section('lọc nhanh — tên controller đọc từ entity, không suy từ tên file');
eq('&Controller; trỏ &TransferID;', scanControllerName(ARTRAN, 'TenFileKhac'), 'ARTran');
eq('không khai gì thì rơi về tên file', scanControllerName('<grid/>', 'SOTran'), 'SOTran');

section('lọc nhanh — dựng dòng sysfilterdeclares');
const built = buildFilterDeclarations(ARTRAN, { fields: FIELDS });
eq('chỉ field allowFilter="true" mới có dòng', built.rows.map((r) => r.field),
  ['ma_dvcs', 'ngay_ct', 't_tt_nt', 'ten_kh%l']);
eq('controller', built.controller, 'ARTran');

const byField = new Map(built.rows.map((r) => [r.field, r]));

/*
 * Cột trên alias gốc: không cần join. Alias gốc của lưới Voucher CHÍNH LÀ bảng inquiry, và bảng
 * ấy có schema CỐ ĐỊNH trong cả sản phẩm — đo trên `i81$000000` của SEAVNFBO: đúng sáu cột
 * nghiệp vụ (`stt_rec, ngay_ct, so_ct, ma_dvcs, status, user_id0`) cộng bốn cột sổ sách
 * `c$ m$ d$ e$` mà không màn hình nào lọc theo.
 *
 * Nên với lưới Voucher thì KHÔNG phải hỏi database: sáu cột ấy để `xtable` trống, mọi cột gốc
 * còn lại lấy bảng master. Đọc từ `FastBusiness$System$GetDynamicFilter`: `#_f.datasource` nhận
 * `isnull(b.xtable, '')` và mọi phép dựng join đều lọc `datasource <> ''`, nên `xtable` trống
 * nghĩa là không join gì cả — cột đọc thẳng từ hàng gốc.
 */
const dvcs = byField.get('ma_dvcs');
eq('cột gốc: mức tin cậy base', dvcs.confidence, 'base');
eq('ma_dvcs nằm sẵn trên bảng inquiry → xtable TRỐNG', dvcs.xtable, null);
eq('ngay_ct cũng vậy', byField.get('ngay_ct').xtable, null);
eq('cột gốc: không bịa joinclause', dvcs.joinclause, null);
ok('cột gốc: có ghi chú bảo người đọc kiểm lại', dvcs.note.includes('kiểm lại'));
ok('script nói ra luật đang áp dụng',
  built.notes.some((n) => n.includes('Voucher') && n.includes('stt_rec')));

// Cột gốc KHÔNG thuộc bộ sáu thì phải với sang bảng master — proc nối nó bằng
// `left join <xtable> m on a.stt_rec = m.stt_rec` cho dòng không có fieldkey.
const other = buildFilterDeclarations(ARTRAN, { fields: FIELDS, columns: ['ma_dvcs', 'ngay_ct', 't_tt_nt'] });
eq('cột gốc ngoài bộ sáu: xtable là bảng master',
  other.rows.find((r) => r.field === 't_tt_nt')?.xtable, 'm21$%Partition');

// Khai tay vẫn thắng — màn hình có bảng gốc khác chuẩn thì tự nói ra được.
const withInquiry = buildFilterDeclarations(ARTRAN, { fields: FIELDS, inquiryColumns: ['ngay_ct'] });
const inq = new Map(withInquiry.rows.map((r) => [r.field, r]));
eq('khai tay: cột trong danh sách để trống', inq.get('ngay_ct').xtable, null);
eq('khai tay: cột ngoài danh sách lấy bảng master', inq.get('ma_dvcs').xtable, 'm21$%Partition');
ok('khai tay rồi thì không nhắc tới bộ mặc định',
  !withInquiry.notes.some((n) => n.includes('lưới Voucher:')));

// Lưới KHÔNG phải Voucher thì không có bộ nào để mặc định — nói thẳng thay vì đoán.
const detail = buildFilterDeclarations(ARTRAN.replace('type="Voucher"', 'type="Detail"'), { fields: FIELDS });
ok('lưới Detail: nói rõ là không có bộ cột gốc chuẩn',
  detail.notes.some((n) => n.includes('không phải type="Voucher"')));

// Cột lấy qua join: mọi cột nguồn đọc thẳng từ file, không suy.
const ten = byField.get('ten_kh%l');
eq('cột join: mức tin cậy joined', ten.confidence, 'joined');
eq('cột join: xtable là bảng tham chiếu', ten.xtable, 'dmkh');
eq('cột join: reftable là bảng master của lưới', ten.reftable, 'm21$%Partition');
/*
 * `fieldkey` là khoá trên `xtable` (vế `b.`), `reffieldkey` là khoá trên `reftable` (vế `a.`).
 * Ca này hai bên trùng tên nên đổi chỗ vẫn ra cùng chữ — xem test dưới cho ca chúng khác nhau.
 */
eq('cột join: khoá', [ten.fieldkey, ten.reffieldkey], ['ma_kh', 'ma_kh']);
// `joinclause` viết theo cặp alias `a`/`b` mà runtime trông đợi, không theo alias của file.
eq('cột join: joinclause quy về a/b', ten.joinclause, 'a.ma_kh=b.ma_kh');
ok('cột join: không còn ghi chú phải xem lại', ten.note === null);

/*
 * `%l` là hậu tố NGÔN NGỮ. `sysfilterdeclares.name` lưu `%2`, và runtime join bằng
 * `replace(b.name, '%2', '%l')`. Lưu thẳng `%l` là dòng nằm đó mà không bao giờ khớp `#filter`.
 */
eq('tên lưu dạng %2, không phải %l', ten.name, 'ten_kh%2');
eq('cột không có hậu tố thì giữ nguyên', dvcs.name, 'ma_dvcs');

/*
 * `left join` cho ra NULL khi không khớp, và `NULL like N'%x%'` không bao giờ đúng — nên cột
 * chữ lấy qua join phải bọc `isnull(…, '')`. Cột NGÀY thì không: bọc vào là ép kiểu và mọi
 * phép so sánh `>=` / `<=` đổi nghĩa.
 *
 * Bên trong phải có mốc `ÿ` (char 255). `FilterInitialize` thay `ÿ<field>` hai lần: lần đầu
 * bằng chính `conditionalreplace`, lần sau bằng `%[a].<cột>`. Lần thứ hai chỉ có chỗ bám nếu
 * `conditionalreplace` trả lại một cái `ÿ<field>` — viết `isnull(ten_kh%2, '')` trơn là cột
 * mất tiền tố alias.
 */
eq('cột chữ qua join: bọc isnull quanh mốc ÿ', ten.conditionalreplace, "isnull(ÿten_kh%2, '')");
eq('cột ngày: KHÔNG bọc', byField.get('ngay_ct').conditionalreplace, null);

// `id` là nhãn, không phải khoá — runtime không đọc `b.id`. Dựng từ nhãn TIẾNG ANH vì cột là
// `varchar`: nhãn tiếng Việt bỏ vào varchar dưới collation khác là mất dấu.
// Bản chuẩn viết `SVTran.CustomerName`, `SVTran.PaymentDay(s)` — không có dấu cách nào.
eq('id dựng từ nhãn tiếng Anh, bỏ khoảng trắng', ten.id, 'ARTran.CustomerName');

section('lọc nhanh — alias lạ và câu Finding không đọc được đều phải nói ra');
const strange = buildFilterDeclarations(ARTRAN, { fields: FIELDS, columns: ['dien_giai'] });
eq('vẫn dựng dòng cho cột được chỉ đích danh', strange.rows.length, 1);
eq('nhưng mức tin cậy là unknown', strange.rows[0].confidence, 'unknown');
ok('nói rõ alias không có trong câu Finding', strange.rows[0].note.includes('không có trong'));

const blind = buildFilterDeclarations(
  ARTRAN.replace(/'a left join dmkh b on a\.ma_kh = b\.ma_kh'/, "'<Encrypted>x</Encrypted>'"),
  { fields: FIELDS },
);
ok('câu Finding hỏng thì mọi dòng là unknown',
  blind.rows.every((r) => r.confidence === 'unknown'));
ok('và lý do nằm ở notes của cả bộ', blind.notes.some((n) => n.includes('join')));

section('lọc nhanh — script SQL');
const sql = renderFilterDeclareSql(built.rows, { sysDatabase: 'FSDSYS', sourceFile: 'Grid\\ARTran.xml' });
ok('xoá bản cũ của đúng controller và tên cột', sql.includes("delete from FSDSYS..sysfilterdeclares where controller = 'ARTran' and name in ('ma_dvcs', 'ngay_ct', 't_tt_nt', 'ten_kh%2');"));
ok('xoá và nạp nằm trong cùng transaction', sql.includes('begin transaction;') && sql.includes('commit transaction;'));
ok('ghi đủ 11 cột', sql.includes('(controller, id, name, exname, xtable, fieldkey, exfieldkey, reftable, reffieldkey, joinclause, conditionalreplace)'));
ok('cột không có giá trị ghi null, không ghi chuỗi rỗng', sql.includes("'ma_dvcs', null, null, null"));
ok('dòng cần xem lại được đánh dấu ngay đầu script', sql.includes('XEM LẠI  ma_dvcs'));
ok('dòng chắc chắn thì không', /chắc\s+ten_kh%l/.test(sql));
// Nháy đơn trong dữ liệu phải nhân đôi, nếu không script vỡ cú pháp ngay dòng đầu.
const quoted = renderFilterDeclareSql(
  [{ ...ten, joinclause: "a.ma_kh = b.ma_kh and b.status = 'A'" }],
  { sysDatabase: 'FSDSYS' },
);
ok('nháy đơn được nhân đôi', quoted.includes("b.status = ''A''"));

section('lọc nhanh — vá XML: ba chỗ, và chỗ nào có rồi thì bỏ qua');
const BARE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE grid [',
  '  <!ENTITY TransferID "SOTran">',
  ']>',
  '<grid table="m64$000000" type="Voucher" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_dvcs" width="100"><header v="Đơn vị" e="Unit"/></field>',
  '    <field name="so_ct" width="100"/>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_dvcs"/><field name="so_ct"/></view></views>',
  '</grid>',
].join('\n');

const plan = planEnableFilter(BARE, ['ma_dvcs', 'so_ct'], { fields: scanFields(BARE) });
ok('lập được kế hoạch', plan.ok);
// Splice sắp GIẢM DẦN theo start: áp từ cuối file lên thì offset của splice chưa áp không đổi.
ok('splice sắp giảm dần theo vị trí',
  plan.splices.every((s, i) => i === 0 || plan.splices[i - 1].start >= s.start));

const patched = applySplices(BARE, plan.splices);
ok('DOCTYPE kéo Filter.Voucher.ent vào', patched.includes('%Control.Filter;'));
ok('field thường nhận allowFilter', patched.includes('<field name="ma_dvcs" width="100" allowFilter="&GridVoucherAllowFilter;">'));
ok('và nhận <query> khai lọc', patched.includes('<query>&InsertCommandFilter;</query>'));
eq('mỗi field một <query>, không nhân đôi',
  (patched.match(/<query>&InsertCommandFilter;<\/query>/g) ?? []).length, 2);
// `<field …/>` tự đóng phải mở ra thành cặp thẻ, không thể nhét con vào thẻ tự đóng.
ok('field tự đóng được mở thành cặp thẻ', patched.includes('<field name="so_ct" width="100" allowFilter="&GridVoucherAllowFilter;">'));
ok('và có thẻ đóng đi kèm', /<query>&InsertCommandFilter;<\/query>\s*<\/field>/.test(patched));
ok('thêm <queries> tạo bảng tạm #filter', patched.includes('<query event="Declare">')
  && patched.includes('&DeclareCommandFilter;'));
// Phần không đụng tới phải giữ nguyên từng byte — đó là luật của cả tầng ghi ngược.
ok('khai báo cũ giữ nguyên', patched.includes('<!ENTITY TransferID "SOTran">'));
ok('view không bị đụng tới', patched.includes('<view id="Grid"><field name="ma_dvcs"/><field name="so_ct"/></view>'));

section('lọc nhanh — chạy lại lần hai không thêm gì nữa');
const again = planEnableFilter(patched, ['ma_dvcs', 'so_ct'], { fields: scanFields(patched) });
ok('vẫn ok', again.ok);
eq('không còn splice nào', again.splices.length, 0);
eq('và nói rõ vì sao bỏ qua', again.skipped.length, 4);

section('lọc nhanh — không chắc thì TỪ CHỐI');
const missing = planEnableFilter(BARE, ['khong_co'], { fields: scanFields(BARE) });
ok('field không tồn tại → từ chối', !missing.ok);
ok('nói rõ lý do', missing.reason.includes('khong_co'));
const noDoctype = planEnableFilter(
  '<grid xmlns="urn:schemas-fast-com:data-grid"><fields><field name="a"/></fields></grid>',
  ['a'],
  { fields: scanFields('<grid><fields><field name="a"/></fields></grid>') },
);
ok('không có DOCTYPE → từ chối', !noDoctype.ok);
ok('nói rõ lý do', noDoctype.reason.includes('DOCTYPE'));

/* ══════════════════════════════════════════════════════════════════════════
 * `aliasName` mang HAI nghĩa — cả hai đều có thật trong `Grid/ARTran.xml`:
 *
 *   aliasName="b"                    alias trần → cột lấy từ bảng alias ấy trỏ tới
 *   aliasName="rtrim(e1.so_ct_hddt)" BIỂU THỨC SQL → chính nó là `exname`
 *
 * Đọc nhầm vế thứ hai thành alias là mất luôn biểu thức, và dòng sinh ra trỏ về một cột
 * `ten_tt_hddt` không hề tồn tại trong bảng nào.
 * ══════════════════════════════════════════════════════════════════════════ */

section('lọc nhanh — aliasName là biểu thức thì nó chính là exname');
const EXPR = ARTRAN.replace(
  '<field name="dien_giai" width="200" aliasName="z"><header v="Diễn giải" e="Description"/></field>',
  '<field name="ten_tt_hddt" width="150" aliasName="rtrim(e2.statusname%l)" allowFilter="true">'
  + '<header v="Tình trạng" e="Authentication Status"/>'
  + '<query>insert into #filter select @@fieldName, @@type, @@conditional</query></field>',
);
const expr = buildFilterDeclarations(EXPR, { fields: scanFields(EXPR) });
const tt = expr.rows.find((r) => r.field === 'ten_tt_hddt');
eq('mức tin cậy riêng cho biểu thức', tt.confidence, 'expression');
/*
 * `þ` là `char(254)` — cờ «exname ĐÃ có alias của riêng nó». `FilterInitialize` kiểm
 * `charindex(char(254), exname) > 0` rồi bỏ tiền tố `%[a].`. Thiếu cờ này thì biểu thức bị ghép
 * thành `%[a].rtrim(e2.statusname)`, tức SQL vỡ ngay.
 */
eq('exname là biểu thức, kèm cờ char(254)', tt.exname, 'þrtrim(e2.statusname%2)');
eq('và %l trong biểu thức cũng đổi thành %2', tt.exname.includes('%2'), true);
ok('nói rõ bảng nguồn vẫn phải điền tay', tt.note.includes('điền tay'));
// Alias trần thì KHÔNG sinh exname: runtime tự dùng tên field.
eq('alias trần không sinh exname', expr.rows.find((r) => r.field === 'ten_kh%l').exname, null);

section('lọc nhanh — mốc ÿ/þ ghép bằng char(255)/char(254), không viết thẳng vào script');
/*
 * Viết thẳng hai byte ấy vào script là phó mặc cho collation của database khách. Cả tầng lọc
 * nhận ra chúng bằng đúng giá trị byte, nên lệch một collation là lọc thôi chạy — mà script
 * vẫn nạp thành công, nên không ai biết.
 */
const exprSql = renderFilterDeclareSql(expr.rows, { sysDatabase: 'FSDSYS' });
ok('cờ char(254) ghép bằng hàm', exprSql.includes("char(254) + 'rtrim(e2.statusname%2)'"));
ok('mốc char(255) cũng vậy', exprSql.includes("'isnull(' + char(255) + 'ten_kh%2, '''')'"));
ok('không có ký tự mốc nào lọt vào script', !exprSql.includes('ÿ') && !exprSql.includes('þ'));

/* ══════════════════════════════════════════════════════════════════════════
 * Vòng khép kín: vá XML xong thì PREVIEW phải vẽ ra dải lọc.
 *
 * Hai nửa của tính năng nằm ở hai file (`filter-declare.mjs` vá XML, `grid.mjs` vẽ) và đọc
 * cùng một bộ khai báo. Không có test nào nối chúng lại thì hai nửa trôi khỏi nhau: vá xong mà
 * preview vẫn trống, hoặc preview vẽ ô lọc cho cột chưa khai. Test này là chỗ nối.
 * ══════════════════════════════════════════════════════════════════════════ */

section('lọc nhanh — vá xong thì preview vẽ ra dải lọc');
const { renderControllerHtml } = await import('../src/render.mjs');
const { expandEntities } = await import('../src/entities.mjs');

const before = renderControllerHtml(BARE);
ok('trước khi vá: không có dải lọc nào', !before.html.includes('FilterPanel'));

/*
 * Phải BUNG ENTITY trước khi vẽ. Bản vá chèn `allowFilter="&GridVoucherAllowFilter;"` và
 * `<query>&InsertCommandFilter;</query>` — hai entity chỉ có nghĩa sau khi `%Control.Filter;`
 * kéo `Filter.Voucher.ent` vào. Vẽ trên văn bản chưa bung là đọc chuỗi `&GridVoucher…;` như
 * một giá trị thường, tức `allowFilter` khác `"true"` và dải lọc không mở.
 */
const ENT = {
  'Filter.Voucher.ent': [
    '<!ENTITY GridVoucherAllowFilter "true">',
    '<!ENTITY InsertCommandFilter "insert into #filter select @@fieldName, @@type, @@conditional">',
    '<!ENTITY DeclareCommandFilter "create table #filter(id int identity, field varchar(128), type bit, conditional nvarchar(4000))">',
  ].join('\n'),
};
const readFake = (abs) => ENT[abs.split(/[\/]/).pop()] ?? null;

const expandedPatched = expandEntities(patched, { filePath: 'C:/P/App_Data/Controllers/Grid/SOTran.f', readFile: readFake });
ok('bản vá bung được entity, không lỗi',
  expandedPatched.diagnostics.filter((d) => d.severity === 'error').length === 0);

const after = renderControllerHtml(expandedPatched.clearText);
ok('sau khi vá: hàng tiêu đề mở dải lọc', after.html.includes('<tr class="GridHeader" style="height:60px;">'));
eq('cả hai cột có ô nhập', (after.html.match(/class="FilterPanelText"/g) ?? []).length, 2);
eq('và cả hai mang dấu data-fbo-filter', (after.html.match(/data-fbo-filter="1"/g) ?? []).length, 2);
// Lưới `Voucher` chỉ hiện ô khi CÓ `<query>`; bản vá đã thêm đúng thứ đó, nên đây cũng là bằng
// chứng hai nửa đọc cùng một luật.
eq('model coi cả hai cột là lọc được',
  after.model.filterColumns.map((c) => c.name), ['ma_dvcs', 'so_ct']);

section('lọc nhanh — cột khai trong Include thì BỎ QUA, không vá file dùng chung');
/*
 * Có thật trong `Grid/ARTran.xml`: `&EIGridFields;` kéo thêm `so_ct_hddt`, `so_seri_hddt`,
 * `ten_tt_hddt` vào. Chúng có mặt trong bản ĐÃ BUNG nhưng không có dòng nào trong chính file.
 * Vá chúng là sửa `Include\…`, tức đổi cho MỌI controller include file ấy.
 */
const HOST = BARE.replace('  </fields>', '    &EIGridFields;\n  </fields>');
// Bản đã bung: field của Include đã nằm trong danh sách, nhưng văn bản GỐC thì không có nó.
const EXPANDED_FIELDS = scanFields(
  HOST.replace('&EIGridFields;', '<field name="so_ct_hddt" width="120"><header v="Số xác thực" e="Reference"/></field>'),
);
const mixed = planEnableFilter(HOST, ['ma_dvcs', 'so_ct_hddt'], { fields: EXPANDED_FIELDS });
ok('không từ chối cả lượt', mixed.ok);
ok('cột của Include bị bỏ qua, có nêu tên',
  mixed.skipped.some((s) => s.startsWith('so_ct_hddt') && s.includes('Include')));
const mixedOut = applySplices(HOST, mixed.splices);
ok('cột của chính file vẫn được vá', mixedOut.includes('name="ma_dvcs" width="100" allowFilter='));
ok('dòng &EIGridFields; giữ nguyên từng byte', mixedOut.includes('    &EIGridFields;'));

section('lọc nhanh — không chọn cột nào thì KHÔNG đụng vào file');
/*
 * Không có chốt này thì `%Control.Filter;` và `<query event="Declare">` vẫn được thêm cho một
 * tập cột rỗng: file đổi mà màn hình không đổi gì.
 */
const none = planEnableFilter(BARE, [], { fields: scanFields(BARE) });
ok('vẫn ok', none.ok);
eq('nhưng không splice nào', none.splices.length, 0);
eq('và không hứa hẹn gì trong notes', none.notes.length, 0);

section('lọc nhanh — hai đầu khoá join KHÁC TÊN nhau, ca làm lộ ra phép ghép ngược');
/*
 * Đối chiếu với bản chuẩn của Fast: `sysfilterdeclares` của `SVTran` (SEAVNFBO, 38 dòng) có
 *
 *   id=SVTran.CreatedBy  name=u1  exname=u_name  xtable=vsysuser  fieldkey=u_id
 *   reftable=%inquiryTable  reffieldkey=user_id0  joinclause=a.user_id0=b.u_id
 *
 * tức `a.<reffieldkey>=b.<fieldkey>`: `fieldkey` là khoá trên bảng ĐƯỢC JOIN TỚI, `reffieldkey`
 * là khoá trên bảng XUẤT PHÁT. Bản trước ghép ngược đúng hai cột ấy.
 *
 * Ca `a.ma_kh=b.ma_kh` ở fixture trên không bắt được lỗi này — hai khoá trùng tên nên đổi chỗ
 * vẫn ra cùng một chữ. Phải có một ca hai bên khác tên mới lộ, và đó chính là lý do nó sống sót
 * qua cả bộ test cũ.
 */
const CROSS = [
  '<!DOCTYPE grid [<!ENTITY TransferID "SVTran">]>',
  '<grid table="m81$000000" type="Voucher" id="HDA">',
  '  <partition table="c81$000000" prime="m81$" inquiry="i81$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="u1" width="100" aliasName="e1" allowFilter="true">',
  '      <header v="Người tạo" e="Created By"></header>',
  '    </field>',
  '    <field name="han_tt" type="Decimal" width="80" aliasName="e2" allowFilter="true">',
  '      <header v="Hạn thanh toán" e="Payment Day(s)"></header>',
  '    </field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="u1"/><field name="han_tt"/></view></views>',
  '  <queries><query event="Finding"><text><![CDATA[exec FastBusiness$App$Voucher$Finding',
  "'a left join vsysuser e1 on a.user_id0 = e1.u_id left join dmtt e2 on a.ma_tt = e2.ma_tt']]>",
  '  </text></query></queries>',
  '</grid>',
].join('\n');

const cross = buildFilterDeclarations(CROSS, {
  fields: scanFields(CROSS),
  // `user_id0` nằm trên bảng inquiry (đo được trên `i81$000000` của SEAVNFBO); `ma_tt` thì không.
  inquiryColumns: ['ma_dvcs', 'ngay_ct', 'so_ct', 'status', 'user_id0'],
});
const cr = new Map(cross.rows.map((r) => [r.field, r]));

const u1 = cr.get('u1');
eq('fieldkey là khoá trên bảng ĐƯỢC join tới', u1.fieldkey, 'u_id');
eq('reffieldkey là khoá trên bảng XUẤT PHÁT', u1.reffieldkey, 'user_id0');
eq('xtable là bảng được join tới', u1.xtable, 'vsysuser');
// Join xuất phát từ một cột NẰM TRÊN bảng inquiry → reftable là chỗ giữ `%inquiryTable`,
// không phải bảng master. Ghi bảng master ở đây là join từ một bảng không có cột ấy.
eq('reftable là bảng inquiry', u1.reftable, '%inquiryTable');
eq('joinclause quy về a/b, viết sát như bản chuẩn', u1.joinclause, 'a.user_id0=b.u_id');
eq('id bỏ khoảng trắng của nhãn', u1.id, 'SVTran.CreatedBy');

const han = cr.get('han_tt');
// Cùng lưới, nhưng join này xuất phát từ `ma_tt` — cột KHÔNG có trên inquiry → bảng master.
eq('join từ cột không có trên inquiry: reftable là bảng master', han.reftable, 'm81$%Partition');
eq('joinclause của nó cũng quy về a/b', han.joinclause, 'a.ma_tt=b.ma_tt');
/*
 * Cột SỐ lấy qua join cũng phải bọc, chỉ khác giá trị thay — bản chuẩn ghi
 * `isnull(ÿhan_tt, 0)` cho đúng cột này. Không bọc thì `left join` trả NULL và mọi phép so
 * sánh đều sai, y hệt ca cột chữ.
 */
eq('cột số qua join: bọc isnull với 0', han.conditionalreplace, 'isnull(ÿhan_tt, 0)');

section('lọc nhanh — bảng CHIA KỲ join vào: khai một ô xtable, và tên luôn mang %Partition');
/*
 * Phần mở rộng hoá đơn điện tử của `SVTran` nối thêm hai bảng, và chúng ra HAI hình dạng khai
 * báo khác hẳn nhau — bản trước sinh sai cả hai:
 *
 *   left join hddt00$ e1 on a.stt_rec = e1.stt_rec      cột nằm TRÊN bảng chia kỳ
 *   left join dmtthddt e2 on e1.tinh_trang_hddt = e2.status   join BẮC CẦU từ bảng chia kỳ ấy
 *
 * Vế một (`SVTran.AuthenticationReferenceNumber`, cột `so_ct_hddt`): bản chuẩn khai ĐÚNG MỘT ô
 * `xtable = hddt00$%Partition`, mọi cột khoá để trống. `GetDynamicFilter` tự dựng lấy phép join
 * cho dòng thiếu `fieldkey` — `left join <datasource> <alias> on a.stt_rec = <alias>.stt_rec` —
 * nên khoá và mệnh đề join là thừa, mà khai vào thì dòng ấy rơi sang nhánh khác của proc.
 *
 * Vế hai (`SVTran.AuthenticationStatus`, cột `ten_tt_hddt`): join xuất phát TỪ bảng chia kỳ, nên
 * `reftable` là `hddt00$%Partition` chứ không phải bảng master.
 *
 * Và cả hai vế: tên bảng chia kỳ LUÔN mang `%Partition`. Câu Finding viết tên trần (`hddt00$`)
 * vì nó đã ở trong ngữ cảnh một kỳ cụ thể; chép thẳng sang là khai một bảng không tồn tại ở tầng
 * lọc. Đo trên toàn bộ `sysfilterdeclares` của SEAVNFBO: 0 dòng có `xtable`/`reftable` kết thúc
 * bằng `$` mà thiếu hậu tố, và 1176/1176 dòng `xtable` chia kỳ đều bỏ trống mọi cột khoá.
 */
const EI = [
  '<!DOCTYPE grid [<!ENTITY TransferID "SVTran">]>',
  '<grid table="m81$000000" type="Voucher" id="HDA">',
  '  <partition table="c81$000000" prime="m81$" inquiry="i81$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="so_ct_hddt" aliasName="e1" allowFilter="true"><header v="Số hđđt" e="Authentication Reference Number"/></field>',
  '    <field name="ten_tt_hddt" aliasName="e2" allowFilter="true"><header v="Tình trạng" e="Authentication Status"/></field>',
  '    <field name="ma_kh" aliasName="a" allowFilter="true"><header v="Mã khách" e="Customer ID"/></field>',
  '    <field name="ma_dvcs" aliasName="a" allowFilter="true"><header v="Đơn vị" e="Unit Code"/></field>',
  '  </fields>',
  '  <views><view id="Grid"></view></views>',
  '  <queries><query event="Finding"><text><![CDATA[exec F',
  "'a left join hddt00$ e1 on a.stt_rec = e1.stt_rec left join dmtthddt e2 on e1.tinh_trang_hddt = e2.status']]>",
  '  </text></query></queries>',
  '</grid>',
].join('\n');

const ei = new Map(buildFilterDeclarations(EI, { fields: scanFields(EI) }).rows.map((r) => [r.field, r]));

const hddt = ei.get('so_ct_hddt');
eq('cột trên bảng chia kỳ: xtable mang %Partition', hddt.xtable, 'hddt00$%Partition');
eq('và KHÔNG khai fieldkey — proc tự nối bằng stt_rec', hddt.fieldkey, null);
eq('không khai reftable', hddt.reftable, null);
eq('không khai reffieldkey', hddt.reffieldkey, null);
eq('không khai joinclause', hddt.joinclause, null);
// Vẫn bọc `isnull`: cột đến qua `left join` thì vẫn NULL được, y hệt ca thường.
eq('vẫn bọc conditionalreplace', hddt.conditionalreplace, "isnull(ÿso_ct_hddt, '')");

const eiStatus = ei.get('ten_tt_hddt');
eq('join bắc cầu: xtable là bảng đích', eiStatus.xtable, 'dmtthddt');
eq('reftable là bảng CHIA KỲ nó xuất phát từ, có %Partition', eiStatus.reftable, 'hddt00$%Partition');
eq('fieldkey là khoá bên bảng đích', eiStatus.fieldkey, 'status');
eq('reffieldkey là khoá bên bảng chia kỳ', eiStatus.reffieldkey, 'tinh_trang_hddt');
eq('joinclause quy về a/b', eiStatus.joinclause, 'a.tinh_trang_hddt=b.status');

// Hai ca gốc không đổi: cột của bộ sáu để trống, cột gốc khác lấy bảng master.
eq('ma_dvcs vẫn để trống', ei.get('ma_dvcs').xtable, null);
eq('ma_kh vẫn lấy bảng master', ei.get('ma_kh').xtable, 'm81$%Partition');

// Tên bảng đã cắm kỳ sẵn (`m81$000000`) cũng quy về chỗ giữ, không để nguyên số kỳ.
const CONCRETE = EI.replace('left join hddt00$ e1', 'left join hddt00$000000 e1');
eq('tên đã cắm kỳ cũng quy về %Partition',
  new Map(buildFilterDeclarations(CONCRETE, { fields: scanFields(CONCRETE) }).rows.map((r) => [r.field, r]))
    .get('so_ct_hddt').xtable,
  'hddt00$%Partition');

section('lọc nhanh — mệnh đề join của phần mở rộng đi ở THAM SỐ RIÊNG của lời gọi Finding');
/*
 * Nguyên văn `Include\XML\EIGridFields.txt` + `&EIGridQuery;` của HOATP. Ba chỗ cùng nhau tạo
 * ra cái bẫy, và bản trước sập cả ba:
 *
 *   1. Lời gọi Finding có HAI mệnh đề join ở hai tham số khác nhau — cái chính, và cái của phần
 *      hoá đơn điện tử tận cuối lời gọi. Chỉ đọc chuỗi đầu thì `e1`/`e2` không tra ra bảng nào.
 *   2. `aliasName` của chúng là BIỂU THỨC bọc một cột: `rtrim(e1.so_ct_hddt)`. Giữ nguyên khối
 *      là ra hình dạng `char(254)` + biểu thức — hình dạng dành cho alias KHÔNG tra được.
 *   3. Bảng `hddt00$` là bảng CHIA KỲ, nên khai theo lối riêng: chỉ `xtable` mang `%Partition`.
 *
 * Bản chuẩn của Fast cho đúng ba dòng dưới đây; đây là bài kiểm tra đối chiếu trực tiếp với nó.
 */
const EIQ = [
  '<!DOCTYPE grid [<!ENTITY TransferID "SVTran">]>',
  '<grid table="m81$000000" code="stt_rec" type="Voucher" id="HDA">',
  '  <partition table="c81$000000" prime="m81$" inquiry="i81$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="so_ct_hddt" width="80" external="true" aliasName="rtrim(e1.so_ct_hddt)" allowFilter="true">',
  '      <header v="Số xác thực" e="Reference Number"></header></field>',
  '    <field name="ten_tt_hddt" width="120" external="true" aliasName="rtrim(e2.statusname%l)" allowFilter="true">',
  '      <header v="Tình trạng" e="Authentication Status"></header></field>',
  '    <field name="ten_kh%l" width="300" external="true" aliasName="b" allowFilter="true">',
  '      <header v="Tên khách" e="Customer Name"></header></field>',
  '  </fields>',
  '  <views><view id="Grid"></view></views>',
  '  <queries><query event="Finding"><text><![CDATA[exec FastBusiness$App$Voucher$Finding',
  "'a left join dmkh b on a.ma_kh = b.ma_kh', 'ngay_ct, so_ct',",
  "'stt_rec, so_seri_hddt, so_ct_hddt, tinh_trang_hddt, xac_thuc', 'hddt00$',",
  "' left join hddt00$ e1 on a.stt_rec = e1.stt_rec left join dmtthddt e2 on e1.tinh_trang_hddt = e2.status']]>",
  '  </text></query></queries>',
  '</grid>',
].join('\n');

const eiFinding = scanFindingJoin(EIQ);
ok('đọc được cả hai mệnh đề', eiFinding.ok);
eq('gom đủ ba join từ hai tham số', eiFinding.joins.map((j) => j.alias), ['b', 'e1', 'e2']);
// Alias gốc chỉ khai ở mệnh đề CHÍNH; mệnh đề EI mở đầu thẳng bằng `left join`, đọc alias gốc
// từ nó là ra chữ `left`.
eq('alias gốc vẫn là a, không phải "left"', eiFinding.base, 'a');

const eiq = new Map(buildFilterDeclarations(EIQ, { fields: scanFields(EIQ) }).rows.map((r) => [r.field, r]));

// Cột trên bảng chia kỳ, aliasName là biểu thức bọc CHÍNH cột ấy → exname TRỐNG.
const ref = eiq.get('so_ct_hddt');
eq('so_ct_hddt: exname trống vì cột trùng tên field', ref.exname, null);
eq('so_ct_hddt: xtable là bảng chia kỳ', ref.xtable, 'hddt00$%Partition');
eq('so_ct_hddt: không khoá nào', [ref.fieldkey, ref.reftable, ref.reffieldkey, ref.joinclause], [null, null, null, null]);
eq('so_ct_hddt: vẫn bọc isnull', ref.conditionalreplace, "isnull(ÿso_ct_hddt, '')");
eq('so_ct_hddt: đọc được nguồn nên không phải xem lại', ref.confidence, 'joined');

// Cột lấy từ bảng khác qua join bắc cầu, tên cột nguồn KHÁC tên field → exname là cột đó,
// viết trần: không `rtrim`, không cờ char(254). `%l` quy về `%2`.
const st = eiq.get('ten_tt_hddt');
eq('ten_tt_hddt: exname là cột nguồn, trần', st.exname, 'statusname%2');
ok('ten_tt_hddt: KHÔNG mang cờ char(254)', !st.exname.includes('þ'));
eq('ten_tt_hddt: xtable', st.xtable, 'dmtthddt');
eq('ten_tt_hddt: khoá', [st.fieldkey, st.reffieldkey], ['status', 'tinh_trang_hddt']);
eq('ten_tt_hddt: reftable là bảng chia kỳ nó xuất phát từ', st.reftable, 'hddt00$%Partition');
eq('ten_tt_hddt: joinclause quy về a/b', st.joinclause, 'a.tinh_trang_hddt=b.status');

// Mệnh đề chính vẫn nguyên vẹn — thêm mệnh đề thứ hai không được làm hỏng cái thứ nhất.
eq('cột của mệnh đề chính không đổi', eiq.get('ten_kh%l').xtable, 'dmkh');
eq('và reftable của nó vẫn là bảng master', eiq.get('ten_kh%l').reftable, 'm81$%Partition');

// Biểu thức KHÔNG bóc được thành `alias.cot` thì vẫn đi lối char(254), và khi ấy KHÔNG khai
// bảng nguồn — trộn hai hình dạng là proc join dưới alias `m3` còn biểu thức gọi `e2.`.
const FREE = EIQ.replace('aliasName="rtrim(e2.statusname%l)"', 'aliasName="case when e2.statusname is null then 1 else 2 end"');
const free = new Map(buildFilterDeclarations(FREE, { fields: scanFields(FREE) }).rows.map((r) => [r.field, r]));
ok('biểu thức tự do: giữ nguyên văn kèm cờ char(254)',
  free.get('ten_tt_hddt').exname.startsWith('þ'));
eq('biểu thức tự do: không khai bảng nguồn', free.get('ten_tt_hddt').xtable, null);

/* ══════════════════════════════════════════════════════════════════════════
 * Bảng ĐƯỢC JOIN TỚI là bảng TẠM CỤC BỘ — đọc đủ bảng, đủ khoá, nhưng KHÔNG được khai `xtable`
 * vào đó, vì nó không sống qua nổi một lời gọi `GetDynamicFilter` riêng với câu đã tạo ra nó.
 *
 * Ca thật, nguyên văn từ `Grid\SVTran.xml` của HOATP:
 *
 *   <field name="ten_loai_hd%l" aliasName="c" external="true" allowFilter="…">
 *
 *   <query event="Finding"><text><![CDATA[
 *   create table #invoiceTypeTmp (loai_hd char(2), ten_loai_hd nvarchar(256), …)
 *   insert into #invoiceTypeTmp values('01', N'Hóa đơn bán lẻ', …), …
 *     exec FastBusiness$App$Voucher$Finding
 *   …, 'a left join dmkh b on a.ma_kh = b.ma_kh left join #invoiceTypeTmp c on a.loai_hd =
 *   c.loai_hd', …]]></text></query>
 *
 * Bản trước coi bảng nào tra được từ câu Finding cũng là `xtable` hợp lệ như nhau — không phân
 * biệt bảng tạm. Kết quả: `sysfilterdeclares` khai `xtable = "#invoiceTypeTmp"` với mức tin cậy
 * `joined`, tức máy nói "chắc, không cần xem lại". Nhưng `#invoiceTypeTmp` chỉ được tạo NGAY
 * TRONG chính khối CDATA của `<query event="Finding">`/`<query event="Loading">`, tự tạo lại mỗi
 * lần chạy — "Lọc nhanh" không chạy lại hai câu ấy, nó gọi thẳng `GetDynamicFilter` ở một lời gọi
 * hoàn toàn riêng. Chạy script sinh ra là `Invalid object name '#invoiceTypeTmp'` ngay khi người
 * dùng gõ vào ô lọc — SAI mà trông như đúng, đúng kiểu hỏng tệ nhất mà file này luôn cảnh giác.
 * ══════════════════════════════════════════════════════════════════════════ */

section('lọc nhanh — bảng tạm cục bộ CÓ bí danh riêng vẫn không được khai xtable');
const HOATP_SVTRAN = [
  '<!DOCTYPE grid [<!ENTITY TransferID "SVTran">]>',
  '<grid table="m81$000000" type="Voucher" id="HDA">',
  '  <partition table="c81$000000" prime="m81$" inquiry="i81$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="loai_hd" hidden="true" aliasName="a"><header v="" e=""/></field>',
  '    <field name="ten_loai_hd%l" width="200" aliasName="c" external="true" allowFilter="true">',
  '      <header v="Loại hóa đơn" e="Invoice Type"></header></field>',
  '  </fields>',
  '  <views><view id="Grid"></view></views>',
  '  <queries><query event="Finding"><text><![CDATA[',
  "create table #invoiceTypeTmp (loai_hd char(2), ten_loai_hd nvarchar(256))",
  "insert into #invoiceTypeTmp values('01', N'Hóa đơn bán lẻ')",
  '    exec FastBusiness$App$Voucher$Finding',
  "@@id, 'stt_rec', @@textList, @@textExternal,",
  "'a left join dmkh b on a.ma_kh = b.ma_kh left join #invoiceTypeTmp c on a.loai_hd = c.loai_hd', @@textOrderBy]]>",
  '  </text></query></queries>',
  '</grid>',
].join('\n');

const hoatpFinding = scanFindingJoin(HOATP_SVTRAN);
ok('đọc được cả hai join', hoatpFinding.ok);
eq('bảng tạm vẫn tra ra được, kèm bí danh thật trong file', hoatpFinding.joins[1].table, '#invoiceTypeTmp');
eq('bí danh đọc nguyên văn, không suy', hoatpFinding.joins[1].alias, 'c');

const hoatpBuilt = buildFilterDeclarations(HOATP_SVTRAN, { fields: scanFields(HOATP_SVTRAN) });
const loaiHd = hoatpBuilt.rows.find((r) => r.field === 'ten_loai_hd%l');
eq('mức tin cậy riêng cho bảng tạm, không phải "joined"', loaiHd.confidence, 'temp-table');
eq('KHÔNG khai xtable dù bảng tra được', loaiHd.xtable, null);
eq('không khai khoá nào', [loaiHd.fieldkey, loaiHd.reftable, loaiHd.reffieldkey, loaiHd.joinclause],
  [null, null, null, null]);
eq('không khai exname', loaiHd.exname, null);
eq('không bọc conditionalreplace', loaiHd.conditionalreplace, null);
ok('ghi chú nói rõ tên bảng tạm', loaiHd.note.includes('#invoiceTypeTmp'));
ok('ghi chú nói rõ vì sao: GetDynamicFilter chạy ở lời gọi riêng', loaiHd.note.includes('GetDynamicFilter'));

// Script SQL phải đánh dấu riêng dòng này — không lẫn vào «XEM LẠI» (thiếu tin, điền tay được)
// vì đây là dòng máy BIẾT CHẮC không khai được, điền tay cũng vô ích.
const tempSql = renderFilterDeclareSql(hoatpBuilt.rows, { sysDatabase: 'FSDSYS' });
ok('đánh dấu riêng BẢNG TẠM ở đầu script', tempSql.includes('BẢNG TẠM'));
ok('không lẫn vào nhóm XEM LẠI', !tempSql.includes(`XEM LẠI  ${loaiHd.field}`));
ok('có đoạn giải thích riêng cho nhóm BẢNG TẠM', tempSql.includes('không sống'));

// Bảng tạm TOÀN CỤC (`##…`) không dính luật này — nó sống qua mọi phiên tới khi server khởi động
// lại hoặc bị xoá tay, nên (dù hiếm gặp và vẫn nên cảnh giác ở tầng khác) không phải ca đang xử.
const GLOBAL_TEMP = HOATP_SVTRAN.replace(/#invoiceTypeTmp/g, '##invoiceTypeTmp');
const globalTemp = buildFilterDeclarations(GLOBAL_TEMP, { fields: scanFields(GLOBAL_TEMP) })
  .rows.find((r) => r.field === 'ten_loai_hd%l');
eq('bảng tạm TOÀN CỤC (##) vẫn đi đường "joined" bình thường', globalTemp.confidence, 'joined');
eq('và vẫn khai xtable', globalTemp.xtable, '##invoiceTypeTmp');

section('lọc nhanh — tên database sys đọc từ Web.config');
const WEB_CONFIG = [
  '<?xml version="1.0"?>',
  '<configuration>',
  '  <connectionStrings>',
  '    <add name="appConnectionString" connectionString="Data Source=srv;Initial Catalog=FBI81;User ID=sa;Password=x;"/>',
  '    <add name="sysConnectionString" connectionString="Data Source=srv;Initial Catalog=FSDSYS;User ID=sa;Password=x;"/>',
  '  </connectionStrings>',
  '</configuration>',
].join('\n');
eq('lấy đúng database của sysConnectionString, không lấy nhầm appConnectionString',
  scanSysDatabaseName(WEB_CONFIG), 'FSDSYS');
eq('không khai connectionString ấy thì null', scanSysDatabaseName('<configuration/>'), null);
eq('từ khoá "Database=" tương đương "Initial Catalog="',
  scanSysDatabaseName('<add name="sysConnectionString" connectionString="Server=s;Database=FSDSYS2;"/>'),
  'FSDSYS2');
// Thứ tự attribute không cố định — `connectionString` đứng trước `name` vẫn phải đọc được.
eq('đảo thứ tự connectionString/name vẫn đọc được',
  scanSysDatabaseName('<add connectionString="Initial Catalog=FSDSYS3;" name="sysConnectionString"/>'),
  'FSDSYS3');
eq('scanConnectionString trả CẢ chuỗi, không chỉ tên database (cho sql-host.js)',
  scanConnectionString(WEB_CONFIG, 'appConnectionString'),
  'Data Source=srv;Initial Catalog=FBI81;User ID=sa;Password=x;');
eq('scanConnectionString: không khai thì null', scanConnectionString('<configuration/>'), null);

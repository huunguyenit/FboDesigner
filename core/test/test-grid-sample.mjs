// test-grid-sample.mjs — câu lệnh lấy dữ liệu thật cho lưới.
//
// Đây là phần đáng viết test nhất của cả tính năng, và không phải vì nó khó: vì nó là thứ DUY
// NHẤT trong core sinh ra một câu lệnh sẽ chạy trên DATABASE CỦA KHÁCH. Sai ở đây không dừng
// lại ở một màn hình vẽ xấu.
//
// Bản này khẳng định BỐN NHÁNH, theo đúng thứ tự quan trọng:
//
//   1. AN TOÀN — nhánh DANH MỤC vẫn dựng câu hoàn toàn từ định danh, và không lối nào làm hàm
//      này NÉM ra tầng vỏ. (Ba nhánh kia chạy query của file — đó là hợp đồng mới, xem đầu
//      `grid-sample.mjs` — nên cái đáng kiểm ở chúng là THAY ĐÚNG BIẾN, không phải chặn SQL.)
//   2. TỪ CHỐI — mỗi ca không dựng được phải nói ra lý do đọc được, không im lặng trả về một
//      câu thiếu cột.
//   3. THAY BIẾN — `@@…` ra đúng giá trị, `$partition$current` ra đúng kỳ, `%l` ra đúng bản.
//   4. NGUỒN CỦA MỘT CỘT — `aliasName` thắng `defaultValue`; `defaultValue` chỉ vào cuộc ở lưới
//      `Detail`, và chỉ khi field khai `external` mà không khai alias.
//   5. THAM SỐ SCRIPT — hỏi đúng những gì câu query cần, không hỏi thứ nó tự khai.

import { ok, eq, section } from './harness.mjs';
import {
  buildSampleSelect,
  buildSampleProbe,
  maskSampleValue,
  maskSampleRows,
  sampleKindOf,
  scanScriptParams,
  substituteParams,
  partitionPeriod,
  scriptParamFields,
  scriptParamLiteral,
  SAMPLE_SENTINEL,
  SAMPLE_TOP_DEFAULT,
  SAMPLE_TOP_MAX,
} from '../src/grid-sample.mjs';
import { scanFields } from '../src/spans.mjs';

const NL = '\r\n';
const NOW = new Date(2026, 8, 7); // 2026-09 — kỳ 202609

/** Lưới mẫu; mọi phần đều thay được để dựng từng ca. */
function grid({
  attrs = 'table="dmkh" code="ma_kh" order="ma_kh"',
  fields = [
    '<field name="ma_kh" isPrimaryKey="true" width="100"><header v="KH" e="C"/></field>',
    '<field name="ten_kh%l" width="100"><header v="Ten" e="N"/></field>',
    '<field name="ngay_ct" type="DateTime" width="100"><header v="Ngay" e="Date"/></field>',
  ],
  columns = ['ma_kh', 'ten_kh%l', 'ngay_ct'],
  partition = null,
  queries = [],
} = {}) {
  return [
    `<grid ${attrs} xmlns="urn:schemas-fast-com:data-grid">`,
    ...(partition ? [`  ${partition}`] : []),
    '  <fields>',
    ...fields.map((f) => `    ${f}`),
    '  </fields>',
    ...(queries.length === 0 ? [] : ['  <queries>', ...queries.map((q) => `    ${q}`), '  </queries>']),
    '  <views><view id="Grid">',
    ...columns.map((c) => `    <field name="${c}"/>`),
    '  </view></views>',
    '</grid>',
  ].join(NL);
}

const codes = (r) => (r.skipped ?? []).map((s) => s.code);

/*
 * Vỏ hex của một cột CHỮ — cùng hình dạng với `selectItem` khi `hexText` bật.
 *
 * Viết một lần ở đây thay vì chép chuỗi `convert(…)` vào mười lăm phép kiểm: vỏ ấy là chi tiết
 * cài đặt (đã đổi một lần khi phải ép `nvarchar` để bỏ phép đoán ở tầng vỏ), còn thứ từng phép
 * kiểm muốn khẳng định là CỘT NÀO đi hex và tên `as` của nó.
 */
const hex = (expr, as) => `convert(varchar(8000), convert(varbinary(8000), convert(nvarchar(4000), ${expr})), 2) as ${as}`;
const build = (text, opts = {}) => buildSampleSelect(text, { now: NOW, ...opts });

/* ═════════════════════════════════════════════════════════════════════════
 * 1. AN TOÀN
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — nhánh DANH MỤC không để một mẩu SQL nào của file lọt vào');

/*
 * Lưới danh mục đọc từ MỘT bảng, nên `aliasName` chỉ có thể nói một trong hai điều: cột lấy từ
 * alias khác, hoặc cột là một biểu thức. Cả hai đều tham chiếu thứ không có trong câu `from
 * <bảng>` ta dựng — bỏ CỘT (giữ mấy cột lành) chứ không chép nguyên vào.
 */
const EVIL = 'x; DROP TABLE dmkh --';
const evil = build(grid({
  fields: [
    '<field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    `<field name="doc" width="100" aliasName="${EVIL}"><header v="D" e="D"/></field>`,
    '<field name="lang" width="100" aliasName="b"><header v="L" e="L"/></field>',
  ],
  columns: ['ma_kh', 'doc', 'lang'],
}));
ok('vẫn dựng được câu lệnh từ cột lành', evil.ok);
eq('chỉ cột lành vào câu lệnh', evil.columns.map((c) => c.name), ['ma_kh']);
eq('hai cột bị bỏ, mỗi cột một mã', codes(evil).sort(), ['sample.skip_expression', 'sample.skip_foreign_alias']);
ok('KHÔNG có "DROP" trong câu lệnh', !/drop/i.test(evil.sql));
ok('KHÔNG có dấu chấm phẩy giữa câu (chỉ mốc + dấu kết thúc)', evil.sql.split(';').length <= 6);

section('grid-sample — không lối nào ném ra tầng vỏ');

// Tên bảng không phải định danh: phải là một lời TỪ CHỐI đọc được, không phải một ngoại lệ.
const badTable = build(grid({ attrs: 'table="dm kh; drop table x"' }));
ok('không ném', badTable !== undefined);
eq('trả về từ chối có mã', badTable.ok, false);
eq('mã đúng', badTable.code, 'sample.bad_identifier');
ok('lý do nêu đúng chỗ hỏng', badTable.reason.includes('tên bảng'));

for (const junk of ['', '<dir table="x"/>', 'không phải xml']) {
  const r = build(junk);
  ok(`văn bản lạ (${JSON.stringify(junk).slice(0, 18)}…) không ném`, r && r.ok === false && typeof r.reason === 'string');
}

/* ═════════════════════════════════════════════════════════════════════════
 * 2. TỪ CHỐI
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — kiểu lưới quyết định nhánh');

eq('type trống = danh mục', sampleKindOf(''), 'catalog');
eq('type không khai = danh mục', sampleKindOf(undefined), 'catalog');
eq('Voucher', sampleKindOf('Voucher'), 'voucher');
eq('Detail', sampleKindOf('detail'), 'detail');
eq('Report', sampleKindOf('Report'), 'report');
eq('Inquiry không tự lấy dữ liệu', sampleKindOf('Inquiry'), 'unsupported');

const inquiry = build(grid({ attrs: 'table="x" type="Inquiry"' }));
eq('lưới Inquiry bị từ chối, có mã', inquiry.code, 'sample.unsupported_type');
ok('và nói ra type nào', inquiry.reason.includes('Inquiry'));

section('grid-sample — bốn ca TỪ CHỐI cả câu');

eq('không có tên bảng', build(grid({ attrs: 'code="ma_kh"' })).code, 'sample.no_table');

/*
 * `m64$` là TIỀN TỐ chia kỳ, chưa phải bảng. `assertIdent` không bắt được (`$` hợp lệ trong
 * định danh SQL Server), nên phải hỏi riêng — `select from m64$` là chắc chắn "Invalid object
 * name".
 */
eq('tiền tố chia kỳ chưa có kỳ', build(grid({ attrs: 'table="m64$"' })).code, 'sample.partition_no_period');
ok('bảng có kỳ rồi thì dựng bình thường', build(grid({ attrs: 'table="m64$000000"' })).ok);

// Không cột nào khai `<field>` → không còn gì để select.
const nothing = build(grid({ fields: [], columns: ['chi_mot'] }));
eq('không cột nào lấy được', nothing.code, 'sample.no_columns');
eq('nhưng vẫn nói ra vì sao', codes(nothing), ['sample.skip_no_field']);

// Lưới chứng từ / chi tiết KHÔNG có câu Loading thì không đoán, và cũng không im.
eq('Voucher thiếu query', build(grid({ attrs: 'table="m81$000000" type="Voucher"' })).code, 'sample.no_query');
eq('Detail thiếu query', build(grid({ attrs: 'table="d31$000000" type="Detail"' })).code, 'sample.no_query');

// Câu Loading mã hoá: nói thẳng là mã hoá, đừng để người ta đoán tại sao không chạy.
const enc = build(grid({
  attrs: 'table="m81$000000" type="Voucher"',
  queries: ['<query event="Loading"><![CDATA[<Encrypted>zzz</Encrypted>]]></query>'],
}));
eq('câu Loading mã hoá', enc.code, 'sample.query_encrypted');

// Lưới báo cáo mà không đọc được file Filter.
eq('báo cáo không có Filter', build(grid({ attrs: 'type="Report"' })).code, 'sample.no_filter_file');

/* ═════════════════════════════════════════════════════════════════════════
 * 3. DỰNG ĐÚNG — DANH MỤC
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — danh mục: bảng, cột, thứ tự');

const cat = build(grid());
ok('không khoá dòng của ai đang làm việc thật', cat.sql.includes('READ UNCOMMITTED'));
ok('SET NOCOUNT ON như mọi bản sinh SQL khác', cat.sql.includes('SET NOCOUNT ON'));
ok('có mốc chia dữ liệu với các bộ kết quả phụ', cat.sql.includes(SAMPLE_SENTINEL));
ok('from đúng bảng, KHÔNG alias (một bảng thì alias là tiếng ồn)', cat.sql.includes('from dmkh'));
ok('order by lấy từ grid@order', cat.sql.includes('order by ma_kh'));
eq('kiểu lưới nói ra', cat.kind, 'catalog');

/*
 * `rtrim()` chỉ bọc cột CHỮ. Bọc là việc đáng làm: cột `char(16)` trả về đủ 16 ký tự đệm khoảng
 * trắng, và thống kê «cột này dài nhất bao nhiêu ký tự» — thứ cả tính năng sinh ra để trả lời —
 * sẽ đọc ra 16 cho mọi mã. Cột ngày thì KHÔNG bọc được: `rtrim(<datetime>)` là lỗi cứng của
 * SQL Server, không phải một giá trị xấu.
 */
ok('cột chữ bọc rtrim (trong hex)', cat.sql.includes('rtrim(ma_kh)'));
ok('cột ngày KHÔNG bọc rtrim', /,\s*ngay_ct\b/.test(cat.sql) && !cat.sql.includes('rtrim(ngay_ct)'));

/*
 * `%l` là hậu tố NGÔN NGỮ, không thuộc tên cột database. `@@language` là công tắc — một công
 * tắc cho cả câu lệnh, cùng chỗ với mọi biến `@@…` khác.
 */
ok('bản tiếng Việt: ten_kh dạng hex (tránh sqlcmd phá dấu)', cat.sql.includes(hex('rtrim(ten_kh)', 'ten_kh')));
ok('cờ textAsHex bật cho danh mục', cat.textAsHex === true);
const catEn = build(grid(), { params: { '@@language': '2' } });
ok('bản tiếng Anh: ten_kh2 dạng hex', catEn.sql.includes(hex('rtrim(ten_kh2)', 'ten_kh2')));

/*
 * Nhãn trả về giữ NGUYÊN VĂN tên khai trong file, kể cả khi câu SQL dùng tên đã phân giải: tầng
 * vỏ ghép cột-theo-VỊ-TRÍ rồi khoá dòng dữ liệu theo nhãn ấy, mà `renderGridHtml` tra ô theo
 * đúng `field@name`. Đổi nhãn sang tên đã phân giải là cả cột im lặng rỗng.
 */
eq('nhãn giữ nguyên văn tên khai', cat.columns.map((c) => c.label), ['ma_kh', 'ten_kh%l', 'ngay_ct']);
eq('nhãn tiếng Anh cũng giữ nguyên văn', catEn.columns.map((c) => c.label), ['ma_kh', 'ten_kh%l', 'ngay_ct']);

// `order` không phải danh sách cột trần thì BỎ mệnh đề ấy, không chép nguyên — và nói ra.
const weird = build(grid({ attrs: "table=\"dmkh\" order=\"newid(); drop table x\"" }));
ok('order lạ: vẫn dựng được', weird.ok);
ok('order lạ: không lọt vào câu lệnh', !weird.sql.includes('newid'));
ok('order lạ: và nói ra đã bỏ', weird.notes.some((n) => n.includes('order by')));
ok('order có desc thì giữ', build(grid({ attrs: 'table="dmkh" order="ngay_ct desc, ma_kh"' })).sql.includes('order by ngay_ct desc, ma_kh'));

section('grid-sample — top có trần, có sàn, có mặc định');
eq('mặc định', build(grid()).top, SAMPLE_TOP_DEFAULT);
eq('nhận số hợp lệ', build(grid(), { top: 25 }).top, 25);
eq('vượt trần thì kẹp lại', build(grid(), { top: 100000 }).top, SAMPLE_TOP_MAX);
ok('top nằm trong câu lệnh danh mục', build(grid(), { top: 25 }).sql.includes('select top 25 '));

/* ═════════════════════════════════════════════════════════════════════════
 * 4. DỰNG ĐÚNG — CHỨNG TỪ và LƯỚI CHI TIẾT
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — thay biến @@…');

eq('khoá dài khớp trước: @@prime000000 là @@prime + 000000',
  substituteParams('from @@prime000000', { '@@prime': 'm81$' }).text, 'from m81$000000');
eq('biến không có giá trị thì GIỮ NGUYÊN, không thành chuỗi rỗng',
  substituteParams('x @@laDau y', {}).text, 'x @@laDau y');
eq('và được kể tên', substituteParams('x @@laDau y', {}).unknown, ['@@laDau']);
eq('$partition$current ra kỳ',
  substituteParams('from d31$$partition$current', { }, { period: '202609' }).text, 'from d31$202609');
eq('kỳ tính từ ngày hiện tại', partitionPeriod(new Date(2026, 0, 31)), '202601');

const VOUCHER = grid({
  attrs: 'table="m81$000000" code="stt_rec" order="ngay_ct, so_ct" type="Voucher" id="HDA"',
  partition: '<partition table="c81$000000" prime="m81$" inquiry="i81$" field="ngay_ct"'
    + ' expression="convert(char(6), {0}, 112)" increase="dateadd(month, 1, {0})" default="000000"/>',
  fields: [
    '<field name="stt_rec" isPrimaryKey="true" width="0" aliasName="a"><header v="" e=""/></field>',
    '<field name="ngay_ct" type="DateTime" width="100" aliasName="a"><header v="Ngay" e="Date"/></field>',
    '<field name="ma_kh" width="100" aliasName="a"><header v="KH" e="C"/></field>',
    '<field name="ten_kh%l" width="300" external="true" aliasName="b"><header v="Ten" e="N"/></field>',
  ],
  columns: ['stt_rec', 'ngay_ct', 'ma_kh', 'ten_kh%l'],
  queries: ['<query event="Loading"><text><![CDATA[exec FastBusiness$App$Voucher$Loading'
    + NL + "@@id, @@master, @@prime, @@partition, @@expression, @@extension, @@pageCount, 'stt_rec',"
    + " @@textList, @@textExternal, 'a left join dmkh b on a.ma_kh = b.ma_kh', @@textOrderBy,"
    + ' @@admin, @@userID, @@viewAccessMode, 0, @@queryString]]></text></query>'],
});

const vou = build(VOUCHER, { top: 10 });
ok('chứng từ: dựng được', vou.ok, vou.reason);
eq('kiểu lưới', vou.kind, 'voucher');
ok('@@id ← grid@id', vou.sql.includes("'HDA', "));
ok('@@master ← partition@table', vou.sql.includes("'c81$000000'"));
ok('@@prime ← partition@prime', vou.sql.includes("'m81$'"));
ok('@@partition ← partition@field', vou.sql.includes("'ngay_ct'"));
ok('@@expression ← partition@expression', vou.sql.includes("'convert(char(6), {0}, 112)'"));
ok('@@extension ← partition@default', vou.sql.includes("'000000'"));
ok('@@pageCount ← top', vou.sql.includes(', 10, '));
ok('@@textOrderBy ← grid@order', vou.sql.includes("'ngay_ct, so_ct'"));
ok('@@userID/@@admin lấy từ bản khai mặc định', vou.sql.includes(', 1, 1, 1, 0, '));
ok('mệnh đề join của file giữ NGUYÊN VĂN', vou.sql.includes("'a left join dmkh b on a.ma_kh = b.ma_kh'"));
ok('và nói ra rằng đang chạy query của file', vou.notes.some((n) => n.includes('query của file')));

/*
 * Hai danh sách cột, khác nhau ở đúng một điều: `@@textList` là cột của bảng gốc, `@@textExternal`
 * thêm cột `external="true"` (cột đến từ bảng join) và ghép `alias.` vào trước mọi cột.
 */
ok('@@textList KHÔNG có cột external',
  vou.sql.includes("'rtrim(stt_rec) as stt_rec,ngay_ct,rtrim(ma_kh) as ma_kh'"));
ok('@@textExternal CÓ cột external, và ghép alias', vou.sql.includes(
  `'${hex('rtrim(a.stt_rec)', 'stt_rec')},a.ngay_ct,${hex('rtrim(a.ma_kh)', 'ma_kh')},`
  + `${hex('rtrim(b.ten_kh)', 'ten_kh')}'`));

/*
 * ═══ CHỈ `@@textExternal` ĐI HEX, `@@textList` PHẢI TRẦN ═══
 *
 * Đọc `FastBusiness$App$Voucher$Loading` (bản HOATP FBISP2421) thì hai danh sách khác vai hẳn:
 *
 *     insert into #t select <@@textList> from m64$<kỳ> where stt_rec in (select c from #r)
 *     select <@@textExternal> from #t a left join dmkh b on a.ma_kh = b.ma_kh …
 *
 * `@@textList` dựng BẢNG TẠM `#t`, rồi `#t` mang alias `a` và được JOIN bằng chính giá trị của
 * nó. Bọc hex ở đó là `a.ma_kh` thành chuỗi hex nên `on a.ma_kh = b.ma_kh` không bao giờ khớp
 * (mọi cột từ bảng join về NULL), và `@@textExternal` còn bọc hex LẦN NỮA lên giá trị đã hex.
 * Đúng lỗi người dùng báo ngày 2026-09-07.
 */
ok('chứng từ cũng bật textAsHex', vou.textAsHex === true);

const DETAIL = grid({
  attrs: 'table="d31$000000" code="stt_rec" order="stt_rec, line_nbr" type="Detail" id="PN1"',
  partition: '<partition table="c31$000000" prime="d31$" inquiry="i31$" field="ngay_ct" default="000000"/>',
  fields: [
    '<field name="tk_vt" width="100" aliasName="a"><header v="TK" e="A"/></field>',
    '<field name="ten_tk%l" width="200" external="true" aliasName="rtrim(b.ten_tk%l)"><header v="Ten" e="N"/></field>',
    '<field name="so_luong" type="Decimal" width="100" aliasName="a"><header v="SL" e="Q"/></field>',
  ],
  columns: ['tk_vt', 'ten_tk%l', 'so_luong'],
  queries: ['<query event="Loading"><text><![CDATA['
    + 'select @@fieldExternal from @@prime$partition$current a left join dmtk b on a.tk_vt = b.tk'
    + ' where @@whereClause order by @@orderByClause]]></text></query>'],
});

const det = build(DETAIL, { top: 5, probe: { period: '202607', key: 'PN1000000000123' } });
ok('lưới chi tiết: dựng được', det.ok, det.reason);
eq('kiểu lưới', det.kind, 'detail');
/*
 * Kỳ KHÔNG còn là tháng hiện tại (`202609`): nó là kỳ của chứng từ mà câu dò bước 1 chọn được
 * (`202607`). Đọc bảng tháng này trong khi chứng từ nằm ở tháng trước là đọc một bảng không có
 * dòng nào của nó — đúng cái mà bước 1 sinh ra để chữa.
 */
ok('$partition$current ra kỳ CỦA CHỨNG TỪ đã dò, không phải tháng hiện tại',
  det.sql.includes('from d31$202607 a'));
ok('và nói ra rằng kỳ không phải tháng hiện tại', det.notes.some((n) => n.includes('202607')));
ok('mệnh đề join của file giữ NGUYÊN VĂN', det.sql.includes('left join dmtk b on a.tk_vt = b.tk'));
/*
 * `@@whereClause` KHÔNG còn là `1 = 1`. `1 = 1` chạy được nhưng trộn dòng của mọi chứng từ trong
 * bảng chi tiết, rồi `SET ROWCOUNT` cắt mười dòng đầu của đống trộn ấy — một bản xem trước để đo
 * bề rộng cột thì đó là dữ liệu nói dối. Nay nó lọc theo ĐÚNG khoá mà câu dò bước 1 đọc về.
 */
ok('@@whereClause lọc theo khoá đã dò được',
  det.sql.includes("where stt_rec = 'PN1000000000123'"));
ok('tên cột khoá KHÔNG mang alias bảng — đúng dạng runtime', !det.sql.includes('where a.stt_rec'));
ok('không còn câu con nào trong mệnh đề where', !det.sql.includes('where stt_rec = (select'));
ok('và nói ra khoá nào đang được dùng', det.notes.some((n) => n.includes('PN1000000000123')));

/* Không truyền `probe` — hay câu dò về tay không — thì quay về hành vi cũ, không hỏng. */
const detNoProbe = build(DETAIL, { top: 5 });
ok('không có probe thì @@whereClause về 1 = 1', detNoProbe.sql.includes('where 1 = 1'));
ok('và kỳ quay về tháng hiện tại', detNoProbe.sql.includes('from d31$202609 a'));
ok('kèm lý do đọc được', detNoProbe.notes.some((n) => n.includes('câu dò')));

/* Kỳ do database trả về đi thẳng vào TÊN BẢNG — thứ không phải định danh thì KHÔNG được ghép. */
const detBadPeriod = build(DETAIL, { top: 5, probe: { period: "202609; drop table x--", key: 'K1' } });
ok('kỳ không phải định danh thì bỏ, lấy tháng hiện tại', detBadPeriod.sql.includes('from d31$202609 a'));
ok('và không mẩu nào của nó lọt vào câu lệnh', !detBadPeriod.sql.includes('drop table'));
/* Khoá thì đi vào một CHUỖI, nên nó được nhân đôi nháy chứ không bị bỏ. */
const detQuote = build(DETAIL, { top: 5, probe: { period: '202607', key: "a'b" } });
ok('nháy trong khoá được nhân đôi', detQuote.sql.includes("where stt_rec = 'a''b'"));
ok('@@orderByClause ← grid@order', det.sql.includes('order by stt_rec, line_nbr'));
/*
 * KHÔNG chặn ở SQL. 42/92 câu Loading của lưới chi tiết là SCRIPT nhiều câu (`declare`,
 * `if … else`, bảng tạm, tới 43 chữ `select`), nên «chèn vào chữ select đầu tiên» chèn vào một
 * phép gán biến và câu thật vẫn kéo về cả bảng — và `SET ROWCOUNT` (bản trước dùng để chặn mà
 * không đụng SQL của file) lại chặn NHẦM cả những câu `insert` bảng tạm ở giữa script, ra một
 * con số không liên quan tới thứ người dùng đang xem. Nay câu lệnh chạy KHÔNG giới hạn — tầng
 * vỏ cắt còn đúng số dòng cấu hình lúc hiện lên lưới.
 */
ok('KHÔNG còn SET ROWCOUNT nào trong câu lệnh', !det.sql.includes('SET ROWCOUNT'));
/*
 * `select top 1` của mệnh đề khoá là câu do CÔNG CỤ dựng, không phải một chữ `top` chèn vào câu
 * của file — nên phép kiểm tra hỏi đúng điều nó vốn muốn hỏi: không có `top <số dòng>` nào.
 */
ok('KHÔNG chèn top <số dòng> vào SQL của file', !/select\s+top\s+5\b/i.test(det.sql));
ok('và nói rõ chỉ hiện đúng số dòng cấu hình khi lên lưới', det.notes.some((n) => n.includes('5 dòng đầu')));
ok('aliasName biểu thức được bóc thành alias.cột, kèm rtrim', det.sql.includes(hex('rtrim(b.ten_tk)', 'ten_tk')));
ok('lưới chi tiết cũng bật textAsHex', det.textAsHex === true);
ok('cột số KHÔNG bọc rtrim', det.sql.includes('a.so_luong') && !det.sql.includes('rtrim(a.so_luong)'));

section('grid-sample — BƯỚC 1: câu dò của lưới chi tiết');

const DETAIL_QUERY = '<query event="Loading"><text><![CDATA['
  + 'select @@fieldExternal from @@prime$partition$current a'
  + ' where @@whereClause order by @@orderByClause]]></text></query>';

const detailGrid = (attrs, partition) => grid({
  attrs,
  partition,
  fields: ['<field name="ma_vt" width="100"><header v="VT" e="I"/></field>'],
  columns: ['ma_vt'],
  queries: [DETAIL_QUERY],
});

/*
 * CÓ `<partition>` — bảng dò là `partition@table` (bảng CHỨNG TỪ `c64$000000`), KHÔNG phải
 * `grid@table` (bảng CHI TIẾT `d64$000000`): khoá chính chỉ duy nhất ở bảng chứng từ, và `status`
 * chỉ có mặt ở đó. Câu dò lấy cả kỳ lẫn khoá trong MỘT lần chạy.
 */
const probeA = buildSampleProbe(detailGrid(
  'table="d64$000000" code="stt_rec" order="stt_rec" type="Detail"',
  '<partition table="c64$000000" prime="d64$" inquiry="i64$" field="ngay_ct" default="000000"/>',
), { now: NOW });
ok('dựng được câu dò', probeA.ok, probeA.reason);
ok('câu dò đúng hình dạng đã chốt',
  probeA.sql.includes("select top 1 convert(char(6), ngay_ct, 112) as partition, stt_rec from c64$000000 where status not in ('*', 'L');"));
eq('bảng dò là partition@table', probeA.table, 'c64$000000');
ok('có cột kỳ', probeA.hasPeriod === true);
eq('hai cột, kỳ trước khoá', probeA.columns.map((c) => c.label).join(','), 'period,key');
ok('có mốc sentinel để tầng vỏ cắt bộ kết quả', probeA.sql.includes(SAMPLE_SENTINEL));

/*
 * KHÔNG `<partition>` — bảng dò là `grid@table`, không cột kỳ, và KHÔNG `status not in ('*', 'L')`: bảng ở
 * đây là một danh mục (`dmkh`), hỏi `status` là "Invalid column name", tức giết cả câu dò.
 */
const probeB = buildSampleProbe(detailGrid('table="dmkh" code="ma_kh" order="ma_kh" type="Detail"', null), { now: NOW });
ok('không partition: dựng được', probeB.ok, probeB.reason);
ok('câu dò gọn đúng một cột', probeB.sql.includes('select top 1 ma_kh from dmkh;'));
ok('KHÔNG hỏi status ở bảng danh mục', !probeB.sql.includes('status'));
ok('không có cột kỳ', probeB.hasPeriod === false);
eq('một cột duy nhất là khoá', probeB.columns.map((c) => c.label).join(','), 'key');

/* `partition@expression` là bản khai của chương trình — nó THẮNG biểu thức mặc định. */
const probeC = buildSampleProbe(detailGrid(
  'table="d64$000000" code="stt_rec" order="stt_rec" type="Detail"',
  '<partition table="c64$000000" prime="d64$" field="ngay_ct" expression="convert(char(4), {0}, 112)"/>',
), { now: NOW });
ok('expression của file thắng biểu thức mặc định',
  probeC.sql.includes('convert(char(4), ngay_ct, 112) as partition'));

/* Tiền tố chia kỳ trần (`c64$`) chưa phải một bảng — ở bước 1 chưa có gì để dò kỳ, nên cắm tháng hiện tại. */
const probeD = buildSampleProbe(detailGrid(
  'table="d64$000000" code="stt_rec" order="stt_rec" type="Detail"',
  '<partition table="c64$" prime="d64$" field="ngay_ct"/>',
), { now: NOW });
eq('tiền tố được cắm tháng hiện tại', probeD.table, 'c64$202609');

/* Lưới không phải `Detail` thì không có bước 1 nào cả — và nó TỪ CHỐI, không dựng bừa một câu. */
const probeE = buildSampleProbe(grid({ attrs: 'table="dmkh" code="ma_kh" order="ma_kh"' }), { now: NOW });
ok('lưới danh mục không cần câu dò', !probeE.ok);
eq('và nói đúng lý do', probeE.code, 'sample.probe_not_detail');

/* `grid@code` không phải một định danh trần → KHÔNG đoán, KHÔNG ném: từ chối có lý do. */
const probeF = buildSampleProbe(detailGrid(
  'table="d64$000000" code="stt_rec, line_nbr" order="stt_rec" type="Detail"',
  '<partition table="c64$000000" prime="d64$" field="ngay_ct"/>',
), { now: NOW });
ok('grid@code không trần thì từ chối', !probeF.ok);
eq('và nói đúng lý do', probeF.code, 'sample.probe_no_key');

/*
 * `fboDesigner.sampleParams` vẫn ÉP được `@@whereClause` — bản khai của người dùng THẮNG mẩu
 * dựng ra, y như mọi biến `@@…` khác.
 */
const FORCED = build(detailGrid(
  'table="d31$000000" code="stt_rec" order="stt_rec" type="Detail"',
  '<partition table="c31$000000" prime="d31$" field="ngay_ct"/>',
), { params: { '@@whereClause': '1 = 1' }, probe: { period: '202607', key: 'K1' } });
ok('bản khai của người dùng thắng mẩu dựng ra', FORCED.sql.includes('where 1 = 1'));

section('grid-sample — defaultValue là nguồn của cột KHÔNG nằm trên bảng nào');

/*
 * `<field name="ten_dvt%l" external="true" defaultValue="''">` — không alias, và không bảng nào
 * có cột `ten_dvt`. Dựng `rtrim(a.ten_dvt)` là "Invalid column name", và nó giết CẢ câu lệnh
 * chứ không chỉ một cột. 1069/1109 field khai `defaultValue` mà không khai `aliasName` là ca này.
 */
const DEFAULTS = grid({
  attrs: 'table="d61$000000" code="stt_rec" order="stt_rec, line_nbr" type="Detail"',
  partition: '<partition table="c61$000000" prime="d61$" field="ngay_ct" default="000000"/>',
  fields: [
    '<field name="ma_vt" width="100" aliasName="a"><header v="VT" e="I"/></field>',
    '<field name="ten_vt%l" width="200" external="true" aliasName="b" defaultValue="\'\'"><header v="Ten" e="N"/></field>',
    '<field name="ten_dvt%l" width="0" external="true" defaultValue="\'\'" hidden="true"><header v="" e=""/></field>',
    '<field name="so_luong" type="Decimal" width="100" defaultValue="0"><header v="SL" e="Q"/></field>',
    '<field name="tt%l" width="100" external="true" defaultValue="rtrim(u0.statusname%l)"><header v="TT" e="S"/></field>',
    '<field name="ok_yn" width="60" external="true" defaultValue="case when q &lt;&gt; 0 then 1 else 0 end"><header v="OK" e="OK"/></field>',
  ],
  columns: ['ma_vt', 'ten_vt%l', 'ten_dvt%l', 'so_luong', 'tt%l', 'ok_yn'],
  queries: ['<query event="Loading"><text><![CDATA['
    + 'select @@fieldExternal from @@prime$partition$current a left join dmvt b on a.ma_vt = b.ma_vt'
    + ' where @@whereClause order by @@orderByClause]]></text></query>'],
});

const dv = build(DEFAULTS);
ok('dựng được', dv.ok, dv.reason);
ok('cột không có bảng nào lấy defaultValue', dv.sql.includes(hex("''", 'ten_dvt')));
/*
 * `aliasName` THẮNG `defaultValue`. 622 field khai cả hai — `ten_vt%l` của `Grid/SQDetail.f` khai
 * `aliasName="b" defaultValue="''"` — và ở đó `aliasName` mới là nguồn thật. Ưu tiên
 * `defaultValue` vô điều kiện là làm rỗng cột «Tên vật tư» của gần như mọi lưới chi tiết.
 */
ok('có aliasName thì aliasName thắng', dv.sql.includes(hex('rtrim(b.ten_vt)', 'ten_vt')));
/*
 * Field KHÔNG `external` thì cột có thật trên bảng, và `defaultValue` của nó chỉ là giá trị mặc
 * định lúc thêm dòng — lấy `0` là cả cột số lượng về 0 trong khi bảng có số thật.
 */
ok('field không external thì bỏ qua defaultValue', dv.sql.includes('a.so_luong') && !dv.sql.includes('0 as so_luong'));

/*
 * CHỈ lưới `Detail`. Ở lưới DANH MỤC, `grid@table` thường là một VIEW đã join sẵn —
 * `Grid/Customer.xml` của HOATP đọc `viewdmkh`, và `ten_nvbh` là cột CÓ THẬT trên view ấy. Field
 * vẫn khai `external="true" defaultValue="''"` (nó nói với runtime rằng cột này không nhập tay
 * được), nhưng nguồn dữ liệu thì là cột thật; lấy `''` ở đó là làm rỗng một cột đang có dữ liệu.
 */
const CATALOG_EXT = grid({
  attrs: 'table="viewdmkh" code="ma_kh" order="ma_kh"',
  fields: [
    '<field name="ma_kh" width="100"><header v="Ma" e="Code"/></field>',
    '<field name="ten_nvbh%l" width="200" external="true" defaultValue="\'\'"><header v="NVBH" e="Sales"/></field>',
  ],
  columns: ['ma_kh', 'ten_nvbh%l'],
});
const catExt = build(CATALOG_EXT);
ok('lưới danh mục KHÔNG lấy defaultValue (đi hex)', catExt.sql.includes(hex('rtrim(ten_nvbh)', 'ten_nvbh')));
ok('và cột ấy không bị bỏ', catExt.columns.map((c) => c.name).includes('ten_nvbh%l'));
eq('không cột nào bị bỏ', catExt.skipped.length, 0);

/*
 * Cột từ `Grid/Config/Initialize` (group 101): `status` có trên bảng, còn `u1` mang
 * `defaultValue="rtrim(u1.u_name)"` — biểu thức cần join. Tầng vỏ truyền `columns`+`fields` đã
 * merge; câu danh mục phải lấy `status` và BỎ `u1`, không SELECT `u1` rồi chết cả câu.
 */
const cfgFields = [
  ...scanFields(CATALOG_EXT),
  {
    name: 'status',
    attrs: { width: '80', readOnly: 'true' },
    header: { v: 'TT', e: 'Status' },
  },
  {
    name: 'u1',
    attrs: { width: '100', external: 'true', defaultValue: 'rtrim(u1.u_name)', readOnly: 'true' },
    header: { v: 'Nguoi tao', e: 'Created By' },
  },
];
const cfg = build(CATALOG_EXT, {
  columns: ['ma_kh', 'ten_nvbh%l', 'status', 'u1'],
  fields: cfgFields,
});
ok('có status trong câu lệnh', cfg.ok && /\bstatus\b/i.test(cfg.sql));
ok('status nằm trong columns trả về', cfg.columns.map((c) => c.name).includes('status'));
ok('u1 bị bỏ (biểu thức)', codes(cfg).includes('sample.skip_expression'));
ok('KHÔNG select u1 trần', !/\bu1\b/.test(cfg.sql.split('from')[0]));

ok('%l trong defaultValue cũng phân giải', dv.sql.includes(hex('rtrim(u0.statusname)', 'tt')));
/*
 * Dấu `<>` của SQL phải viết escape trong XML, và bộ quét trả về NGUYÊN VĂN thuộc tính (nó giữ
 * offset để ghi ngược). Đưa thẳng vào câu lệnh là `&lt;&gt;` chạy vào SQL Server.
 */
ok('escape XML được gỡ trước khi vào câu lệnh', dv.sql.includes(hex('case when q <> 0 then 1 else 0 end', 'ok_yn')));
ok('không còn escape nào sót', !/&(lt|gt|amp|quot|apos);/.test(dv.sql));

section('grid-sample — %l trong THÂN câu query, không chỉ trên <field>');

/*
 * `Grid/CustomerParameterDetail.f` viết thẳng `isnull(a.val_view%l, b.val_view%l)` trong câu
 * Loading. Bỏ sót là câu lệnh mang một tên cột không tồn tại.
 */
const INBODY = grid({
  attrs: 'table="x000000" code="stt_rec" order="stt_rec" type="Detail"',
  fields: ['<field name="gt" width="100"><header v="G" e="G"/></field>'],
  columns: ['gt'],
  queries: ["<query event=\"Loading\"><text><![CDATA[select isnull(a.val_view%l, '') as gt from x000000 a"
    + " where @@whereClause and descript%l like '%lo%' order by @@orderByClause]]></text></query>"],
});
ok('phân giải %l trong thân câu', build(INBODY).sql.includes("isnull(a.val_view, '') as gt"));
ok('bản tiếng Anh ra hậu tố 2', build(INBODY, { params: { '@@language': '2' } }).sql.includes('isnull(a.val_view2'));
/*
 * `like '%lo%'` KHÔNG bị đụng tới: phép thay đòi một định danh đứng NGAY TRƯỚC `%l`, mà trong
 * một chuỗi LIKE thì đứng trước là dấu nháy.
 */
ok("chuỗi like '%lo%' giữ nguyên", build(INBODY).sql.includes("like '%lo%'"));

section('grid-sample — lưới chi tiết cũng hỏi tham số khi câu query cần');

/*
 * Không riêng báo cáo: 6 lưới chi tiết của FBISP24 dùng `@ma_vt`/`@stt_rec` — khoá của hàng cha
 * mà runtime bơm vào. Bỏ qua là dựng ra một câu chắc chắn chết ở "Must declare the scalar
 * variable".
 */
const NEEDS = grid({
  attrs: 'table="x000000" code="stt_rec" order="stt_rec" type="Detail"',
  fields: ['<field name="gt" width="100"><header v="Mã vật tư" e="Item"/></field>'],
  columns: ['gt'],
  queries: ['<query event="Loading"><text><![CDATA['
    + 'select @@fieldExternal from x000000 a where a.ma_vt = @ma_vt and @@whereClause'
    + ' order by @@orderByClause]]></text></query>'],
});
const needDetail = build(NEEDS);
eq('lưới chi tiết cũng từ chối, cùng một mã', needDetail.code, 'sample.need_params');
eq('và nói ra phải hỏi gì', needDetail.needsParams, ['ma_vt']);
const filled = build(NEEDS, { scriptParams: { ma_vt: { type: 'nvarchar(1024)', literal: "N'VT01'" } } });
ok('nhập xong thì dựng được', filled.ok, filled.reason);
ok('declare đứng TRƯỚC mốc, để câu query thấy được biến',
  filled.sql.indexOf('declare @ma_vt') < filled.sql.indexOf(SAMPLE_SENTINEL));

section('grid-sample — lấy MỌI field đã khai, xếp theo view, cột ngoài view đứng cuối');

/*
 * ═══ THỨ TỰ LÀ CỦA `<fields>`, KHÔNG PHẢI CỦA `<view>` ═══
 *
 * Đối chiếu với câu runtime thật của `Grid/SOTran.xml` (HOATP FBISP2421): `@@textList` và
 * `@@textExternal` xếp đúng bằng thứ tự `<fields>` đã merge, không bằng thứ tự cột trên màn
 * hình. Hai chi tiết chỉ khớp khi đi đường `<fields>`:
 *
 *   · `t_ck_nt`…`t_tt_nt` đứng SAU `ten_nvbh` trong câu SQL, dù trên lưới chúng đứng TRƯỚC
 *     `ma_nt` — vì `Config/Fields/SOTran.xml` khai `arrangement="…t_ck_nt:%b(ma_nt);…"`.
 *     `arrangement` là phép sắp CHỖ NGỒI TRÊN LƯỚI, không phải thứ tự cột trong câu SQL.
 *   · `ma_ct` nằm GIỮA `dien_giai` và `status`, đúng chỗ nó được khai trong
 *     `Grid/Config/Include/Voucher.Field.Status`; `<view>` của group ấy không hề liệt kê nó.
 *
 * Thứ tự SQL không ảnh hưởng thứ tự trên màn hình: tầng vỏ ghép cột theo VỊ TRÍ rồi khoá dòng
 * theo tên, còn `renderGridHtml` tra ô theo `field@name` của cột nó đang vẽ.
 */
const OUTSIDE = grid({
  fields: [
    '<field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    '<field name="ten_kh%l" width="100"><header v="Ten" e="N"/></field>',
    // Khai ở <fields>, KHÔNG khai ở <view> — đúng hình dạng của `ma_ct`.
    '<field name="ma_ct" width="0" aliasName="a"><header v="" e=""/></field>',
    '<field name="ngay_ct" type="DateTime" width="100"><header v="Ngay" e="Date"/></field>',
  ],
  // View cố ý đảo thứ tự và bỏ bớt cột — không được ảnh hưởng thứ tự trong câu SQL.
  columns: ['ten_kh%l', 'ma_kh'],
});

const outside = build(OUTSIDE);
ok('dựng được', outside.ok, outside.reason);
eq('thứ tự theo <fields>, không theo <view>',
  outside.columns.map((c) => c.name), ['ma_kh', 'ten_kh%l', 'ma_ct', 'ngay_ct']);
ok('cột ngoài view vẫn vào câu lệnh', /rtrim\(ma_ct\)/.test(outside.sql)
  && / as ma_ct\b/.test(outside.sql));
eq('không cột nào bị bỏ', outside.skipped.length, 0);

/*
 * `columns` truyền vào KHÔNG còn quyết định thứ tự — nó chỉ còn là phần BỔ SUNG, để một tên có
 * trong view mà không `<field>` nào khai vẫn được kể tên trong `skipped` thay vì biến mất im
 * lặng.
 */
const passed = build(OUTSIDE, { columns: ['ngay_ct', 'ma_kh', 'khong_khai'], fields: scanFields(OUTSIDE) });
eq('columns không đổi thứ tự, chỉ bổ sung phần thiếu',
  passed.columns.map((c) => c.name), ['ma_kh', 'ten_kh%l', 'ma_ct', 'ngay_ct']);
eq('tên lạ trong view vẫn được kể tên', codes(passed), ['sample.skip_no_field']);

// Trùng tên giữa hai nguồn chỉ được vào MỘT lần — hai lần là hai ô cùng tên trong một câu select.
const dup = build(OUTSIDE, { columns: ['ma_kh', 'ma_kh', 'ten_kh%l'], fields: scanFields(OUTSIDE) });
eq('không lặp cột', dup.columns.map((c) => c.name), ['ma_kh', 'ten_kh%l', 'ma_ct', 'ngay_ct']);

// View rỗng thì `<fields>` là toàn bộ danh sách — trước đây ca này trả về `no_columns`.
const noView = build([
  '<grid table="dmkh" code="ma_kh" order="ma_kh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields><field name="ma_kh" width="100"><header v="KH" e="C"/></field></fields>',
  '  <views><view id="Grid"></view></views>',
  '</grid>',
].join(NL));
ok('view rỗng: vẫn dựng được từ <fields>', noView.ok, noView.reason);
eq('và lấy đúng cột đã khai', noView.columns.map((c) => c.name), ['ma_kh']);

section('grid-sample — Grid/Config vá câu query để nuôi cột nó thêm vào');

/*
 * Cấu hình thêm cột thì cũng phải thêm JOIN nuôi cột ấy, và nó khai điều đó dưới dạng VÁ CHUỖI
 * chứ không phải một câu query mới. Lấy nguyên hình dạng của `Grid/SOTran.xml` (HOATP
 * FBISP2421): hai mảnh cấu hình vá cùng một câu ở hai chỗ neo khác nhau, và kết quả phải là
 * mệnh đề join có đủ `b`, `v0`, `u0`.
 */
const SOTRAN = grid({
  attrs: 'table="m64$000000" code="stt_rec" order="ngay_ct, so_ct" type="Voucher" id="DXA"',
  partition: '<partition table="c64$000000" prime="m64$" inquiry="i64$" field="ngay_ct"'
    + ' expression="convert(char(6), {0}, 112)" default="000000"/>',
  fields: [
    '<field name="ma_kh" width="100" aliasName="a"><header v="KH" e="C"/></field>',
    '<field name="ten_kh%l" width="300" external="true" aliasName="b"><header v="Ten" e="N"/></field>',
    // Cấu hình thêm vào: cột lấy từ alias `v0`, và alias ấy chỉ tồn tại nhờ bản vá.
    '<field name="ten_nvbh%l" width="150" external="true" aliasName="v0"><header v="NVBH" e="Sales"/></field>',
    // Cột `u0` của group Initialize 001: KHÔNG có aliasName, nguồn nằm ở defaultValue.
    '<field name="u0" width="120" external="true" defaultValue="rtrim(u0.statusname%l)"><header v="TT" e="S"/></field>',
  ],
  columns: ['ma_kh', 'ten_kh%l', 'ten_nvbh%l', 'u0'],
  queries: ['<query event="Loading"><text><![CDATA[exec FastBusiness$App$Voucher$Loading'
    + NL + "@@id, @@master, @@prime, @@partition, @@expression, @@extension, @@pageCount, 'stt_rec',"
    + " @@textList, @@textExternal, 'a left join dmkh b on a.ma_kh = b.ma_kh', @@textOrderBy,"
    + ' @@admin, @@userID, @@viewAccessMode, 0, @@queryString]]></text></query>'],
});

const REWRITES = [
  // Config/Fields/SOTran.xml — neo vào chính mệnh đề join.
  {
    source: 'a left join dmkh b on a.ma_kh = b.ma_kh',
    destination: 'a left join dmkh b on a.ma_kh = b.ma_kh left join dmnvbh v0 on a.ma_nvbh = v0.ma_nvbh',
  },
  // Initialize group 001 — neo vào DẤU NHÁY ĐÓNG cộng tham số kế tiếp, nên nó chèn vào bên
  // trong chuỗi join mà không đụng gì tới bản vá thứ nhất.
  {
    source: "', @@textOrderBy",
    destination: " left join dmttct u0 on a.ma_ct = u0.ma_ct and a.status = u0.status', @@textOrderBy",
  },
];

const noCfg = build(SOTRAN);
ok('không có bản vá: alias v0/u0 KHÔNG được join — đó chính là lỗi cần chữa',
  noCfg.ok && !noCfg.sql.includes('dmnvbh v0') && !noCfg.sql.includes('dmttct u0'));

const withCfg = build(SOTRAN, { rewrites: REWRITES });
ok('có bản vá: dựng được', withCfg.ok, withCfg.reason);
ok('bản vá 1 thêm join dmnvbh v0', withCfg.sql.includes('left join dmnvbh v0 on a.ma_nvbh = v0.ma_nvbh'));
ok('bản vá 2 thêm join dmttct u0', withCfg.sql.includes('left join dmttct u0 on a.ma_ct = u0.ma_ct and a.status = u0.status'));
/*
 * Cả hai bản vá phải nằm TRONG CÙNG một chuỗi hằng — đó là tham số mệnh đề join của proc. Vá
 * ra ngoài dấu nháy là một lời gọi sai số tham số, và nó chết ở runtime chứ không ở đây.
 */
ok('cả hai join nằm trong CÙNG một chuỗi tham số',
  withCfg.sql.includes("'a left join dmkh b on a.ma_kh = b.ma_kh"
    + ' left join dmnvbh v0 on a.ma_nvbh = v0.ma_nvbh'
    + " left join dmttct u0 on a.ma_ct = u0.ma_ct and a.status = u0.status', 'ngay_ct, so_ct'"));
ok('và nói ra đã vá mấy chỗ', withCfg.notes.some((n) => n.includes('Grid/Config')));

/*
 * Áp bản vá TRƯỚC khi thay `@@…`: bản khai neo vào chính tên biến (`source="', @@textOrderBy"`),
 * nên thay biến trước là không còn gì để tìm.
 */
ok('vá trước, thay biến sau', !withCfg.sql.includes('@@textOrderBy'));

// `source` không có trong câu thì bỏ qua, không ném và không đếm.
const missCfg = build(SOTRAN, { rewrites: [{ source: 'KHONG CO TRONG CAU', destination: 'x' }] });
ok('source không khớp: vẫn dựng được', missCfg.ok);
ok('và không kể là đã vá', !missCfg.notes.some((n) => n.includes('Grid/Config')));

section('grid-sample — lưới chứng từ cũng lấy defaultValue');

/*
 * `<field name="u0" external="true" defaultValue="rtrim(u0.statusname%l)">` của group Initialize
 * 001 — cột «Trạng thái» trên MỌI lưới chứng từ dùng group ấy. Không alias, không cột `u0` trên
 * bảng master, nên `rtrim(a.u0)` là "Invalid column name" và nó giết cả câu.
 *
 * Ranh giới thật là NGUỒN của lưới, không phải `type`: chứng từ và lưới chi tiết đọc bảng
 * master/chi tiết cộng join viết rõ, nên `external` không alias = chắc chắn không có trên hàng
 * gốc. Danh mục thì đọc một nguồn phẳng hay là VIEW đã join sẵn, nên `external` không nói được
 * gì về việc cột có tồn tại hay không.
 */
ok('chứng từ: defaultValue là nguồn, và %l phân giải', withCfg.sql.includes(hex('rtrim(u0.statusname)', 'u0')));
ok('chứng từ: KHÔNG dựng a.u0', !withCfg.sql.includes('a.u0'));
ok('cột external CÓ aliasName thì aliasName vẫn thắng', withCfg.sql.includes(hex('rtrim(v0.ten_nvbh)', 'ten_nvbh')));

/*
 * Cột `external` KHÔNG có mặt ở `@@textList` (danh sách cột của bảng gốc) — đó là toàn bộ khác
 * biệt giữa hai danh sách, và lẫn chúng là truyền cho proc một cột không có trên master.
 */
ok('@@textList chỉ có cột của bảng gốc', withCfg.sql.includes("'rtrim(ma_kh) as ma_kh', '"));
ok('@@textExternal mới mang cả cột external', withCfg.sql.includes(
  `'${hex('rtrim(a.ma_kh)', 'ma_kh')},${hex('rtrim(b.ten_kh)', 'ten_kh')},`
  + `${hex('rtrim(v0.ten_nvbh)', 'ten_nvbh')},${hex('rtrim(u0.statusname)', 'u0')}'`));

/* ═════════════════════════════════════════════════════════════════════════
 * 5. BÁO CÁO
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — tham số của câu Processing');

const PROCESSING = [
  'declare @c varchar(1024)',
  "select @c = case @nh_theo when '1' then 'loai_vt' else '' end",
  'exec rs_rptStockReport @ngay, @ma_kho, @c, @@language, @@userID, @@admin,'
  + " '&Controller;', '@@sysDatabaseName', '#$query'",
].join(NL);

eq('hỏi đúng thứ script KHÔNG tự khai',
  scanScriptParams(PROCESSING), ['nh_theo', 'ngay', 'ma_kho']);
ok('@@x không bị đọc nhầm thành tham số', !scanScriptParams(PROCESSING).includes('language'));

const FILTER = [
  '<dir id="1" type="Report" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ngay" type="DateTime"><header v="Ngày" e="Date"/></field>',
  '    <field name="ma_kho"><header v="Mã kho" e="Site"/></field>',
  '    <field name="nh_theo" clientDefault="1"><header v="Nhóm theo" e="Group"/></field>',
  '  </fields>',
  '  <commands><command event="Processing"><text><![CDATA[', PROCESSING, ']]></text></command></commands>',
  '</dir>',
].join(NL);

const REPORT = grid({
  attrs: 'type="Report"',
  fields: [
    '<field name="ma_vt" width="100"><header v="VT" e="I"/></field>',
    '<field name="so_luong" type="Decimal" width="100"><header v="SL" e="Q"/></field>',
  ],
  columns: ['ma_vt', 'so_luong'],
});

const need = build(REPORT, { filterText: FILTER });
eq('chưa có tham số thì từ chối, có mã', need.code, 'sample.need_params');
eq('và nói ra phải hỏi những gì', need.needsParams, ['nh_theo', 'ngay', 'ma_kho']);

const plan = scriptParamFields(FILTER, need.needsParams, { now: NOW });
eq('nhãn lấy từ <header> của Filter', plan.map((p) => p.label), ['Nhóm theo', 'Ngày', 'Mã kho']);
eq('kiểu SQL suy từ field@type', plan.map((p) => p.sqlType), ['nvarchar(1024)', 'smalldatetime', 'nvarchar(1024)']);
/*
 * `clientDefault` là HẰNG nên dùng được; `defaultValue` là JavaScript chạy trên trình duyệt
 * (`new Date()`) nên không. Field ngày không có hằng thì lấy hôm nay — một báo cáo tính tới
 * ngày rỗng không trả về gì, và ai cũng phải sửa nó.
 */
eq('giá trị mặc định', plan.map((p) => p.value), ['1', '2026-09-07', '']);

/*
 * MẶT NẠ hiện trên hộp thoại — CHỈ cột ngày mới có, còn lại rỗng. Không khai `dataFormatString`
 * thì mặc định `dd/MM/yyyy`, giống mặc định của `formatSampleValue` khi vẽ lưới.
 */
eq('mặt nạ chỉ có ở cột ngày, mặc định dd/MM/yyyy', plan.map((p) => p.mask), ['', 'dd/MM/yyyy', '']);

/* `dataFormatString` của field THẮNG mặc định — kể cả một mặt nạ trỏ qua Options.xml (`@tên`). */
const FILTER_MASKED = FILTER.replace(
  '<field name="ngay" type="DateTime">',
  '<field name="ngay" type="DateTime" dataFormatString="@dt">',
);
const maskedPlan = scriptParamFields(FILTER_MASKED, need.needsParams, { now: NOW, formats: { dt: 'MM/dd/yyyy' } });
eq('mặt nạ trỏ qua Options.xml được phân giải', maskedPlan.map((p) => p.mask), ['', 'MM/dd/yyyy', '']);

eq('chuỗi bọc N và nhân đôi nháy', scriptParamLiteral('nvarchar(1024)', "K'H"), "N'K''H'");
eq('ngày rỗng thành null', scriptParamLiteral('smalldatetime', ''), 'null');
eq('số không đọc được thành 0', scriptParamLiteral('numeric(19,4)', 'abc'), '0');
eq('số đọc được thì giữ', scriptParamLiteral('int', '12'), '12');

const scriptParams = Object.fromEntries(plan.map((p) => [p.name, { type: p.sqlType, literal: scriptParamLiteral(p.sqlType, p.value) }]));
const rep = build(REPORT, {
  filterText: FILTER,
  scriptParams,
  params: { '@@sysDatabaseName': 'fbosys' },
  top: 7,
});
ok('báo cáo: dựng được', rep.ok, rep.reason);
eq('kiểu lưới', rep.kind, 'report');
ok('khai declare cho tham số script cần', rep.sql.includes('declare @ngay smalldatetime;'));
ok('và gán giá trị người dùng nhập', rep.sql.includes("set @ngay = '2026-09-07';"));
ok('KHÔNG khai lại biến script tự declare', !/declare @c nvarchar/i.test(rep.sql));
ok('@@sysDatabaseName ghép THẲNG, không nháy', rep.sql.includes("'fbosys'"));
ok("'#$query' thành bảng tạm TOÀN CỤC", rep.sql.includes("'##fbo$sample'"));
ok('dọn bảng tạm ở cả hai đầu', rep.sql.split('drop table ##fbo$sample').length === 3);
ok('đọc kết quả từ bảng ấy (cột chữ dạng hex)',
  rep.sql.includes(`select top 7 ${hex('rtrim(ma_vt)', 'ma_vt')}, so_luong from ##fbo$sample;`));
ok('báo cáo cũng bật textAsHex', rep.textAsHex === true);
ok('mốc đứng NGAY TRƯỚC câu đọc kết quả, sau mọi bộ kết quả phụ của báo cáo',
  rep.sql.indexOf(SAMPLE_SENTINEL) > rep.sql.indexOf('rs_rptStockReport'));
ok('và cảnh báo rằng nó chạy proc thật', rep.notes.some((n) => n.includes('stored procedure')));

section('grid-sample — báo cáo mà proc KHÔNG nhận bảng đích, tự in kết quả qua exec');

/*
 * `zc_rptPurchaseDiscount` không nhận tham số bảng đích nào — nó CHỈ tự in kết quả khi `exec`
 * chạy. Xác nhận 2026-09-08 (đối chiếu chính proc này của HOATP qua MCP, ba lần đo):
 *   1. SQL Server của khách là 2008 R2 — không có `sys.dm_exec_describe_first_result_set`.
 *   2. Cắm mốc + cắt script để chỉ chạy tới bảng đã chọn — sai với chuẩn tắc "chạy đủ script",
 *      và mốc cho bảng CUỐI "vô dụng" nếu một câu tự sinh nhiều hơn một bảng bên trong nó.
 *   3. `dir@id` là chỉ số vào danh sách bảng THẬT SỰ trả về — chỉ biết được SAU KHI CHẠY. Nên:
 *      chạy đủ, KHÔNG SỬA MỘT KÝ TỰ NÀO, để tầng vỏ (JS) tự đếm bảng sau khi đã nhận về.
 */
const DIRECT_PROCESSING = [
  'select @tu_ngay as tu_ngay, @den_ngay as den_ngay',
  "exec zc_rptPurchaseDiscount @tu_ngay, @den_ngay, @ma_kh, @ma_dvcs, 1, 1, 1, 'HOATP_FBISP2421_S'",
].join(NL);

const DIRECT_FILTER = [
  '<dir id="1" type="Report" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="tu_ngay" type="DateTime"><header v="Từ ngày" e="From"/></field>',
  '    <field name="den_ngay" type="DateTime"><header v="Đến ngày" e="To"/></field>',
  '    <field name="ma_kh"><header v="Khách hàng" e="Customer"/></field>',
  '    <field name="ma_dvcs"><header v="Đơn vị" e="Site"/></field>',
  '  </fields>',
  '  <commands><command event="Processing"><text><![CDATA[', DIRECT_PROCESSING, ']]></text></command></commands>',
  '</dir>',
].join(NL);

const DIRECT_REPORT = grid({
  attrs: 'type="Report"',
  fields: [
    '<field name="stt" type="Decimal" width="60"><header v="STT" e="No"/></field>',
    '<field name="ma_kh" width="100"><header v="KH" e="Customer"/></field>',
  ],
  columns: ['stt', 'ma_kh'],
});

const directNeed = build(DIRECT_REPORT, { filterText: DIRECT_FILTER });
const directPlan = scriptParamFields(DIRECT_FILTER, directNeed.needsParams, { now: NOW });
const directParams = Object.fromEntries(directPlan.map((p) => [p.name, { type: p.sqlType, literal: scriptParamLiteral(p.sqlType, p.value) }]));

const direct = build(DIRECT_REPORT, { filterText: DIRECT_FILTER, scriptParams: directParams, top: 10 });
ok('dựng được — MỘT lần, không cần dò gì trước', direct.ok, direct.reason);
ok('KHÔNG có ##fbo$sample ở đâu cả', !direct.sql.includes('##fbo$sample'));
ok('KHÔNG insert/create table nào', !direct.sql.includes('create table') && !direct.sql.includes('insert into'));
/* KHÔNG một mốc nào bị chèn vào — script chạy NGUYÊN VĂN, không sửa một ký tự nào. */
ok('KHÔNG chèn mốc nào vào script (chạy nguyên văn)', !direct.sql.includes('~fbo-dataset'));
ok('câu debug ĐỨNG NGUYÊN vị trí gốc, không bị cắt hay bọc gì', direct.sql.includes(DIRECT_PROCESSING));
ok('exec của file được giữ NGUYÊN VĂN, không sửa gì', direct.sql.includes(
  "exec zc_rptPurchaseDiscount @tu_ngay, @den_ngay, @ma_kh, @ma_dvcs, 1, 1, 1, 'HOATP_FBISP2421_S'"));
ok('KHÔNG hex-hoá (đường sqlcmd mới đã ra đúng dấu, không cần hex)', direct.textAsHex === false);
ok('headerMapped — tầng vỏ tự đếm bảng và khớp cột theo tên SAU KHI CHẠY', direct.headerMapped === true);
eq('datasetIndex đúng bằng dir@id đọc được (chưa biết có bao nhiêu bảng THẬT — đó là việc của tầng vỏ)',
  direct.datasetIndex, 1);
eq('cột trả về đúng field lưới', direct.columns.map((c) => c.name).join(','), 'stt,ma_kh');
ok('nói rõ đã chạy đủ script, không sửa gì, và dir@id nào', direct.notes.some((n) => n.includes('chạy đủ script') && n.includes('bảng 1')));
ok('và nói rõ chỉ hiện đúng số dòng cấu hình khi lên lưới', direct.notes.some((n) => n.includes('10 dòng đầu')));

/*
 * Không '#$query', không 'exec', NHƯNG vẫn có một `select` sinh resultset thật — nhánh mới CŨNG
 * chạy nguyên văn, không cần chờ một lệnh `exec` nào cả; tầng vỏ tự nhận đây là bảng duy nhất.
 */
const SOLO_SELECT_FILTER = DIRECT_FILTER.replace(
  DIRECT_PROCESSING,
  'select @tu_ngay as tu_ngay, @den_ngay as den_ngay',
);
const solo = build(DIRECT_REPORT, { filterText: SOLO_SELECT_FILTER, scriptParams: directParams, top: 10 });
ok('chỉ một select, không exec: vẫn dựng được', solo.ok, solo.reason);
eq('không có exec trong script — nhãn hiển thị chung chung', solo.table, 'báo cáo');
eq('vẫn nguyên dir@id="1" dù script chỉ có một bảng — tầng vỏ tự rơi về bảng cuối lúc chạy', solo.datasetIndex, 1);

/*
 * KHÔNG một câu nào sinh resultset cả (toàn `select @x = …` gán biến) — không có luật nào đọc
 * được kịch bản này: quay về nhánh bảng tạm cũ (nó sẽ rỗng, nhưng không NÉM), có ghi chú.
 */
const NEITHER_FILTER = DIRECT_FILTER.replace(
  DIRECT_PROCESSING,
  'select @tu_ngay = cast(getdate() as smalldatetime)',
);
const neither = build(DIRECT_REPORT, { filterText: NEITHER_FILTER, scriptParams: directParams, top: 10 });
ok('không có resultset nào: vẫn dựng được (không ném)', neither.ok, neither.reason);
ok('quay về nhánh bảng tạm cũ', neither.sql.includes('##fbo$sample'));
ok('và nói ra vì sao', neither.notes.some((n) => n.includes("'#$query'")));

/* `<dir id="0">` — chọn bảng ĐẦU (câu debug); script vẫn chạy NGUYÊN VĂN không đổi gì. */
const id0 = build(DIRECT_REPORT, {
  filterText: DIRECT_FILTER.replace('id="1"', 'id="0"'),
  scriptParams: directParams,
  top: 10,
});
ok('dir@id=0 dựng được', id0.ok, id0.reason);
eq('datasetIndex đúng bằng dir@id="0"', id0.datasetIndex, 0);
eq('không có exec ở VỊ TRÍ ĐẦU script — nhưng nhãn vẫn tìm exec bất kỳ đâu trong toàn script', id0.table, 'zc_rptPurchaseDiscount');
/* CHẠY ĐỦ SCRIPT — dù dir@id trỏ tới bảng ĐẦU, câu exec đứng sau vẫn phải CHẠY, y hệt runtime. */
ok('exec đứng sau VẪN CHẠY (tác dụng phụ y hệt runtime — script không hề bị cắt)',
  id0.sql.includes('exec zc_rptPurchaseDiscount'));

/* `dir@id` lớn hơn số bảng thật có (5): core KHÔNG BIẾT trước điều đó — cứ truyền nguyên vẹn, tầng vỏ mới là nơi quyết định rơi về bảng cuối. */
const idOut = build(DIRECT_REPORT, {
  filterText: DIRECT_FILTER.replace('id="1"', 'id="5"'),
  scriptParams: directParams,
  top: 10,
});
ok('dir@id="5" vẫn dựng được — core không đoán, không ném', idOut.ok, idOut.reason);
eq('datasetIndex giữ NGUYÊN 5 — việc "vượt quá" chỉ tầng vỏ biết được sau khi đếm bảng thật',
  idOut.datasetIndex, 5);

/* Không khai `dir@id` — core để `null`, tầng vỏ tự quyết định lấy bảng CUỐI lúc chạy. */
const idMissing = build(DIRECT_REPORT, {
  filterText: DIRECT_FILTER.replace(' id="1"', ''),
  scriptParams: directParams,
  top: 10,
});
eq('không khai dir@id: datasetIndex là null (tầng vỏ tự quyết định)', idMissing.datasetIndex, null);
ok('không cảnh báo gì (mặc định hợp lý, không có gì bất thường ở bước dựng câu)',
  !idMissing.notes.some((n) => n.includes('vượt quá')));

/* ═════════════════════════════════════════════════════════════════════════
 * 6. CHE DỮ LIỆU
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — che giữ nguyên độ dài');

eq('chữ hoa/thường/số, giữ dấu ngăn', maskSampleValue('Công ty ABC-01'), 'Xxxx xx XXX-00');
eq('độ dài không đổi', maskSampleValue('Nguyễn Văn A').length, 'Nguyễn Văn A'.length);
eq('null giữ nguyên', maskSampleValue(null), null);
eq('khoá KHÔNG che, chỉ giá trị', maskSampleRows([{ ten_kh: 'Abc', ma_kh: 'KH01' }]), [{ ten_kh: 'Xxx', ma_kh: 'XX00' }]);

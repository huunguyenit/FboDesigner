// test-grid-sample.mjs — câu SELECT lấy dữ liệu thật cho lưới.
//
// Đây là phần đáng viết test nhất của cả tính năng, và không phải vì nó khó: vì nó là thứ DUY
// NHẤT trong core sinh ra một câu lệnh sẽ chạy trên DATABASE CỦA KHÁCH. Sai ở đây không dừng
// lại ở một màn hình vẽ xấu.
//
// Ba nhóm, theo đúng thứ tự quan trọng:
//
//   1. AN TOÀN — không một mẩu SQL nào của file khách đi thẳng vào câu lệnh, và không lối nào
//      làm hàm này NÉM ra tầng vỏ.
//   2. TỪ CHỐI / BỎ CỘT — mỗi ca không dựng được phải nói ra lý do đọc được, không im lặng trả
//      về một câu lệnh thiếu cột.
//   3. Dựng đúng — cột, alias, join, `TOP`.

import { ok, eq, section } from './harness.mjs';
import { buildSampleSelect, maskSampleValue, maskSampleRows, SAMPLE_TOP_DEFAULT, SAMPLE_TOP_MAX } from '../src/grid-sample.mjs';

const NL = '\r\n';

/** Lưới mẫu; mọi phần đều thay được để dựng từng ca. */
function grid({
  table = 'svtran',
  fields = [
    '<field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    '<field name="ten_kh%l" width="100" aliasName="b"><header v="Ten" e="N"/></field>',
  ],
  finding = "exec X 'a left join dmkh b on a.ma_kh = b.ma_kh'",
  columns = ['ma_kh', 'ten_kh%l'],
} = {}) {
  return [
    `<grid table="${table}" xmlns="urn:schemas-fast-com:data-grid">`,
    '  <fields>',
    ...fields.map((f) => `    ${f}`),
    '  </fields>',
    ...(finding === null ? [] : ['  <queries>', `    <query event="Finding">${finding}</query>`, '  </queries>']),
    '  <views><view id="Grid">',
    ...columns.map((c) => `    <field name="${c}"/>`),
    '  </view></views>',
    '</grid>',
  ].join(NL);
}

const codes = (r) => r.skipped.map((s) => s.code);

/* ═════════════════════════════════════════════════════════════════════════
 * 1. AN TOÀN
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — không một mẩu SQL của file khách lọt vào câu lệnh');

/*
 * `aliasName` là một biểu thức có chứa dấu chấm phẩy. `readAliasName` không bóc được nó thành
 * `alias.cot`, nên cột bị BỎ — và điều đáng khẳng định là không mẩu nào của chuỗi ấy có mặt
 * trong `sql`. Chép nguyên biểu thức vào là đúng cái file này tồn tại để ngăn.
 */
const EVIL_ALIAS = 'x; DROP TABLE dmkh --';
const evil = buildSampleSelect(grid({
  fields: [
    '<field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    `<field name="doc" width="100" aliasName="${EVIL_ALIAS}"><header v="D" e="D"/></field>`,
  ],
  columns: ['ma_kh', 'doc'],
}));
ok('vẫn dựng được câu lệnh từ cột lành', evil.ok);
ok('cột mang biểu thức bị bỏ', codes(evil).includes('sample.skip_expression'));
ok('KHÔNG có "DROP" trong câu lệnh', !/drop/i.test(evil.sql));
ok('KHÔNG có dấu chấm phẩy giữa câu (chỉ dấu kết thúc)', evil.sql.split(';').length <= 4);

/*
 * Mệnh đề `ON` của file KHÔNG được chép nguyên. Ở đây `ON` có thêm một điều kiện thứ hai; câu
 * dựng ra chỉ được mang cặp khoá chính, và phải nói ra điều đó trong `notes` chứ không im.
 */
const multi = buildSampleSelect(grid({
  finding: "exec X 'a left join dmkh b on a.ma_kh = b.ma_kh and b.status = ''X'' and 1=1'",
}));
ok('dựng được', multi.ok);
ok('chỉ mang cặp khoá chính', multi.sql.includes('ON a.ma_kh = b.ma_kh'));
ok('KHÔNG chép điều kiện thứ hai của file', !multi.sql.includes('status'));
ok('và nói ra rằng join đã bị rút gọn', multi.notes.some((n) => n.includes('cặp khoá chính')));

section('grid-sample — không lối nào ném ra tầng vỏ');
// Tên bảng không phải định danh: phải là một lời TỪ CHỐI đọc được, không phải một ngoại lệ.
const badTable = buildSampleSelect(grid({ table: 'sv tran; drop table x' }));
ok('không ném', badTable !== undefined);
eq('trả về từ chối có mã', badTable.ok, false);
eq('mã đúng', badTable.code, 'sample.bad_identifier');
ok('lý do nêu đúng chỗ hỏng', badTable.reason.includes('tên bảng'));

// Văn bản rỗng / không phải lưới cũng không được ném.
for (const junk of ['', '<dir table="x"/>', 'không phải xml']) {
  const r = buildSampleSelect(junk);
  ok(`văn bản lạ (${JSON.stringify(junk).slice(0, 18)}…) không ném`, r && r.ok === false && typeof r.reason === 'string');
}

/* ═════════════════════════════════════════════════════════════════════════
 * 2. TỪ CHỐI và BỎ CỘT
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — bốn ca TỪ CHỐI cả câu');

const noTable = buildSampleSelect(grid({ table: '' }));
eq('không có tên bảng', noTable.code, 'sample.no_table');

/*
 * `m64$` là TIỀN TỐ chia kỳ, chưa phải bảng. `assertIdent` không bắt được (`$` hợp lệ trong
 * định danh SQL Server), nên phải hỏi riêng — `select from m64$` là chắc chắn "Invalid object
 * name". Từ chối kèm bảng master để tầng vỏ có cái mà gợi ý.
 */
const part = buildSampleSelect(grid({ table: 'm64$' }));
eq('tiền tố chia kỳ chưa có kỳ', part.code, 'sample.partition_no_period');
eq('gợi ý bảng master', part.masterTable, 'm64$000000');
ok('bảng có kỳ rồi thì dựng bình thường', buildSampleSelect(grid({ table: 'm64$000000' })).ok);

// Mọi cột đều bỏ được → không còn gì để select.
const nothing = buildSampleSelect(grid({
  fields: ['<field name="chi_mot" width="100" aliasName="zz"><header v="Z" e="Z"/></field>'],
  columns: ['chi_mot'],
}));
eq('không cột nào lấy được', nothing.code, 'sample.no_columns');
ok('nhưng vẫn nói ra vì sao từng cột bị bỏ', nothing.skipped.length === 1);
ok('lý do đọc được', nothing.skipped[0].message.includes('zz'));

section('grid-sample — năm ca BỎ RIÊNG cột, giữ phần còn lại');

const FIVE = grid({
  fields: [
    '<field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    '<field name="ten_kh%l" width="100" aliasName="b"><header v="Ten" e="N"/></field>',
    '<field name="tam" width="100" aliasName="c"><header v="T" e="T"/></field>',
    '<field name="la" width="100" aliasName="zz"><header v="L" e="L"/></field>',
    '<field name="bt" width="100" aliasName="case when a.x=1 then 2 else 3 end"><header v="B" e="B"/></field>',
    '<field name="ky" width="100" aliasName="e1"><header v="K" e="K"/></field>',
  ],
  finding: "exec X 'a left join dmkh b on a.ma_kh = b.ma_kh"
    + " left join #tmpLoai c on a.loai = c.loai"
    + " left join hddt00$ e1 on a.stt_rec = e1.stt_rec'",
  columns: ['ma_kh', 'ten_kh%l', 'tam', 'la', 'bt', 'ky', 'khong_khai'],
});
const five = buildSampleSelect(FIVE);
ok('vẫn dựng được từ hai cột lành', five.ok);
eq('hai cột vào câu lệnh', five.columns.map((c) => c.name), ['ma_kh', 'ten_kh%l']);
eq('năm cột bị bỏ, mỗi cột một mã', codes(five).sort(), [
  'sample.skip_alias_unknown',   // zz — không có trong câu Finding
  'sample.skip_expression',      // biểu thức phức tạp
  'sample.skip_join_table',      // hddt00$ — tiền tố chia kỳ
  'sample.skip_local_temp',      // #tmpLoai
  'sample.skip_no_field',        // khong_khai — không có <field>
].sort());
// Bảng tạm cục bộ tuyệt đối không được có mặt: đó là cả lý do bỏ cột ấy.
ok('tên bảng tạm KHÔNG lọt vào câu lệnh', !five.sql.includes('#tmpLoai'));
ok('tiền tố chia kỳ cũng không lọt vào', !five.sql.includes('hddt00$'));

// Bảng tạm TOÀN CỤC (`##`) sống hết phiên kết nối — đi đường bình thường, không bị bỏ.
const globalTmp = buildSampleSelect(grid({
  fields: ['<field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    '<field name="g" width="100" aliasName="c"><header v="G" e="G"/></field>'],
  finding: "exec X 'a left join ##tmpChung c on a.loai = c.loai'",
  columns: ['ma_kh', 'g'],
}));
ok('bảng tạm TOÀN CỤC không bị bỏ', !codes(globalTmp).includes('sample.skip_local_temp'));
ok('và được join vào', globalTmp.sql.includes('##tmpChung'));

section('grid-sample — câu Finding không đọc được thì vẫn lấy cột bảng chính');
/*
 * KHÔNG từ chối cả câu. Cột của bảng chính không cần câu Finding để mà lấy, và với đa số lưới
 * thì đó là phần lớn cột — từ chối hết là bỏ đi phần lớn giá trị vì một phần nhỏ không đọc được.
 */
for (const [nhan, finding] of [
  ['mã hoá', '<Encrypted>xxx</Encrypted>'],
  ['không có câu Finding', null],
]) {
  const r = buildSampleSelect(grid({ finding }));
  ok(`${nhan}: vẫn dựng được`, r.ok);
  eq(`${nhan}: chỉ còn cột bảng chính`, r.columns.map((c) => c.name), ['ma_kh']);
  ok(`${nhan}: cột cần alias bị bỏ`, codes(r).includes('sample.skip_alias_unknown'));
  ok(`${nhan}: và nói ra vì sao`, r.notes.some((n) => n.includes('Finding')));
}

/* ═════════════════════════════════════════════════════════════════════════
 * 3. Dựng đúng
 * ═════════════════════════════════════════════════════════════════════════ */
section('grid-sample — câu lệnh dựng ra');

const good = buildSampleSelect(grid());
ok('không khoá dòng của ai đang làm việc thật', good.sql.includes('READ UNCOMMITTED'));
ok('SET NOCOUNT ON như mọi bản sinh SQL khác', good.sql.includes('SET NOCOUNT ON'));
ok('FROM đúng bảng và alias gốc', good.sql.includes('FROM svtran a'));
ok('join dựng lại từ cặp khoá', good.sql.includes('LEFT JOIN dmkh b ON a.ma_kh = b.ma_kh'));

/*
 * `%l` là hậu tố NGÔN NGỮ, không thuộc tên cột database — nên vế `SELECT` phải phân giải nó.
 * Nhưng NHÃN phải giữ nguyên văn tên FBO: tầng vỏ đối chiếu tên cột trả về với cột trên lưới để
 * đổ đúng chỗ, và phân giải ở nhãn là `ten_kh%l` với `ten_kh` cùng ra một nhãn rồi đổ chồng lên.
 */
ok('cột nguồn đã phân giải hậu tố ngôn ngữ', good.sql.includes('b.ten_kh AS'));
ok('nhãn giữ NGUYÊN VĂN tên FBO', good.sql.includes('AS [ten_kh%l]'));
ok('nhãn bọc ngoặc vuông vì tên FBO không phải định danh trần', good.sql.includes('[ten_kh%l]'));

section('grid-sample — TOP có trần, có sàn, có mặc định');
eq('mặc định', buildSampleSelect(grid()).top, SAMPLE_TOP_DEFAULT);
eq('nhận số hợp lệ', buildSampleSelect(grid(), { top: 25 }).top, 25);
eq('vượt trần thì kẹp lại', buildSampleSelect(grid(), { top: 100000 }).top, SAMPLE_TOP_MAX);
eq('số 0 hoặc âm thì về sàn 1', buildSampleSelect(grid(), { top: -5 }).top, 1);
eq('không phải số thì về mặc định', buildSampleSelect(grid(), { top: 'nhiều' }).top, SAMPLE_TOP_DEFAULT);
ok('TOP thật sự nằm trong câu lệnh', buildSampleSelect(grid(), { top: 3 }).sql.includes('SELECT TOP 3 '));

section('grid-sample — danh sách cột truyền vào thắng view');
// Tầng vỏ truyền cột ĐÃ MERGE với `Grid/Config`; cột do cấu hình ẩn thêm vào cũng là cột người
// dùng nhìn thấy, nên phải lấy được dữ liệu như mọi cột khác.
const picked = buildSampleSelect(grid(), { columns: ['ten_kh%l'] });
eq('chỉ lấy cột được yêu cầu', picked.columns.map((c) => c.name), ['ten_kh%l']);
// Kiểm trên VẾ SELECT thôi: `a.ma_kh` vẫn có mặt hợp lệ trong mệnh đề ON của phép join.
const selectLine = picked.sql.split('\n').find((l) => l.startsWith('SELECT '));
ok('và không kéo theo cột của view', !selectLine.includes('a.ma_kh'));
// Thứ tự truyền vào là thứ tự trong câu lệnh — lưới đổ dữ liệu theo cột, thứ tự lệch là lệch hết.
eq('giữ đúng thứ tự truyền vào',
  buildSampleSelect(grid(), { columns: ['ten_kh%l', 'ma_kh'] }).columns.map((c) => c.name),
  ['ten_kh%l', 'ma_kh']);

section('grid-sample — che dữ liệu, GIỮ NGUYÊN độ dài');
/*
 * Độ dài là thứ duy nhất bắt buộc phải giữ: nó là cái quyết định một cột có bị cắt hay không,
 * tức là cả lý do người ta mở phép xem trước này. Nội dung thì ngược lại — giữ nó là đưa dữ
 * liệu khách vào một ảnh chụp màn hình.
 */
for (const v of [
  'Công ty TNHH Thương mại Dịch vụ Toàn Cầu',
  'KH-0012',
  '12/03/2026',
  '1234.56',
  'a',
  '',
]) {
  eq(`giữ đúng độ dài: ${JSON.stringify(v)}`, maskSampleValue(v).length, v.length);
}

// Dấu phân cách GIỮ NGUYÊN: chúng là phần lớn hình dạng của chuỗi mà không nói gì về danh tính.
eq('ngày tháng giữ nguyên dấu gạch chéo', maskSampleValue('12/03/2026'), '00/00/0000');
eq('mã giữ nguyên gạch nối', maskSampleValue('KH-0012'), 'XX-0000');
eq('số thập phân giữ nguyên dấu chấm', maskSampleValue('1234.56'), '0000.00');
// Chữ có dấu vẫn là chữ — không được rơi ra ngoài phép che chỉ vì nó ngoài bảng ASCII.
eq('chữ tiếng Việt vẫn bị che', maskSampleValue('Cầu'), 'Xxx');
eq('khoảng trắng giữ nguyên', maskSampleValue('a b'), 'x x');

// `null`/`undefined` đi qua nguyên vẹn: chúng là «không có giá trị», không phải một giá trị cần che.
eq('null đi qua nguyên vẹn', maskSampleValue(null), null);
eq('undefined đi qua nguyên vẹn', maskSampleValue(undefined), undefined);

section('grid-sample — che cả bảng, nhưng KHÔNG che tên cột');
const masked = maskSampleRows([
  { ma_kh: 'KH001', 'ten_kh%l': 'Nguyễn Văn A' },
  { ma_kh: 'KH002', 'ten_kh%l': null },
]);
eq('giữ nguyên số dòng', masked.length, 2);
// Tên cột là BẢN KHAI, không phải dữ liệu — che nó là làm hỏng mối nối với `model.columns`.
eq('khoá không bị che', Object.keys(masked[0]).sort(), ['ma_kh', 'ten_kh%l']);
eq('giá trị bị che', masked[0].ma_kh, 'XX000');
eq('giữ đúng độ dài tên có dấu', masked[0]['ten_kh%l'].length, 'Nguyễn Văn A'.length);
eq('null trong bảng vẫn là null', masked[1]['ten_kh%l'], null);
ok('bảng rỗng không làm gì cả', maskSampleRows([]).length === 0 && maskSampleRows(null).length === 0);

section('grid-sample — dữ liệu đã che vẫn cắt cột đúng chỗ');
/*
 * Phép kiểm nối cả tính năng lại: chuỗi đã che phải dài BẰNG chuỗi gốc, nên câu hỏi «cột 60px
 * có cắt tên khách này không» có cùng câu trả lời trên cả hai. Đây là điều biện minh cho việc
 * bật che theo mặc định — nếu không giữ được thì công tắc ấy phải mặc định TẮT.
 */
const dai = 'Công ty TNHH Thương mại Dịch vụ Toàn Cầu';
eq('che rồi vẫn dài y hệt', maskSampleValue(dai).length, dai.length);

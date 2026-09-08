// test-format.mjs — `field@dataFormatString` → giá trị hiện trên lưới.
//
// Đây là bước cuối giữa DỮ LIỆU THẬT và BỀ RỘNG CỘT đo được, nên sai ở đây là đo sai mà không
// có gì báo: `2026-09-07 00:00:00.000` dài 23 ký tự, `07/09/2026` dài 10 — một cột ngày sẽ nhìn
// như đang chật trong khi runtime hiện vừa vặn.
//
// Ba nhóm:
//   1. NGÀY   — cắt phần `.000` của SQL, áp mặt nạ .NET, và không đi qua `new Date()`.
//   2. SỐ     — đọc mặt nạ FBO theo nghĩa đen; quy ước «0 thì để trống» của mặt nạ `View`.
//   3. KHÔNG ĐỊNH DẠNG ĐƯỢC — mọi nhánh đều rơi về giá trị thô, không nhánh nào ném.

import { ok, eq, section } from './harness.mjs';
import {
  scanOptionVars, formatSampleValue, isNumericField, isDateField,
} from '../src/format.mjs';
import { alignOf } from '../src/control.mjs';

/* Nguyên văn `Options/Options.xml` của HOATP FBISP2421 — mấy dòng liên quan. */
const OPTIONS = [
  '<options>',
  '  <var name="upperCaseFormat" type="String" value="X" />',
  '  <var name="datetimeFormat" type="String" value="dd/MM/yyyy" />',
  '  <var name="quantityViewFormat" type="String" value="# ### ### ###.00" />',
  '  <var name="baseCurrencyAmountViewFormat" type="String" value="### ### ### ### ###" />',
  '  <var name="foreignCurrencyAmountInputFormat" type="String" value="# ### ### ### ##0.00" />',
  '  <var name="foreignCurrencyAmountViewFormat" type="String" value="# ### ### ### ###.00" />',
  '  <group name="khac"><item value="1"/></group>',
  '</options>',
].join('\r\n');

const F = scanOptionVars(OPTIONS);
const field = (attrs, items = null) => ({ attrs, items });
const fmt = (value, attrs, items = null) => formatSampleValue(value, field(attrs, items), F);

section('format — đọc mặt nạ từ Options.xml');

eq('nhặt đủ <var>', F.datetimeFormat, 'dd/MM/yyyy');
eq('mặt nạ tiền', F.foreignCurrencyAmountViewFormat, '# ### ### ### ###.00');
ok('không nhặt thẻ khác <var>', F.khac === undefined);
eq('văn bản rỗng thì bản đồ rỗng', Object.keys(scanOptionVars('')).length, 0);

section('format — ngày');

/*
 * `sqlcmd` in `datetime` ra `2026-09-07 14:30:05.000`. Phần `.000` KHÔNG bao giờ hiện trên lưới,
 * và nó dài 4 ký tự — đúng phần làm một cột ngày nhìn như đang chật.
 */
eq('@datetimeFormat', fmt('2026-09-07 00:00:00.000', { type: 'DateTime', dataFormatString: '@datetimeFormat' }), '07/09/2026');
eq('mặt nạ viết thẳng, có giờ',
  fmt('2026-09-07 14:30:05.000', { type: 'DateTime', dataFormatString: 'dd/MM/yyyy HH:mm:ss' }), '07/09/2026 14:30:05');
eq('không khai mặt nạ vẫn cắt phần .000', fmt('2026-09-07 00:00:00.000', { type: 'DateTime' }), '07/09/2026');
eq('smalldatetime không có mili giây', fmt('2026-01-31 08:05:00', { type: 'DateTime', dataFormatString: 'dd/MM/yy' }), '31/01/26');
eq('chỉ có ngày, không có giờ', fmt('2026-12-01', { type: 'DateTime', dataFormatString: 'dd/MM/yyyy HH:mm' }), '01/12/2026 00:00');

/*
 * `mm` (phút) là chuỗi con của `MM` (tháng). Thay lần lượt thì `MM` → `09` rồi `mm` trong `09`
 * không còn gì, nhưng `dd/MM/yyyy mm` sẽ hỏng theo chiều ngược lại. Thay MỘT lượt mới đúng.
 */
eq('tháng và phút không lẫn nhau',
  fmt('2026-09-07 14:30:05.000', { type: 'DateTime', dataFormatString: 'MM-mm' }), '09-30');

/*
 * KHÔNG đi qua `new Date()`: nó diễn giải theo múi giờ của máy, và một ô ngày lệch một ngày vì
 * múi giờ là lỗi không ai ngờ tới ở một công cụ xem trước.
 */
eq('nửa đêm không trôi sang ngày khác',
  fmt('2026-01-01 00:00:00.000', { type: 'DateTime', dataFormatString: 'dd/MM/yyyy' }), '01/01/2026');

eq('văn bản không phải ngày thì trả nguyên', fmt('chưa nhập', { type: 'DateTime' }), 'chưa nhập');

section('format — số');

eq('mặt nạ tiền: ngăn nhóm bằng khoảng trắng, 2 số lẻ',
  fmt('1234567.8900', { type: 'Decimal', dataFormatString: '@foreignCurrencyAmountViewFormat' }), '1 234 567.89');
eq('mặt nạ không có phần lẻ',
  fmt('12000000', { type: 'Decimal', dataFormatString: '@baseCurrencyAmountViewFormat' }), '12 000 000');
eq('số âm giữ dấu trước phần đã ngăn nhóm',
  fmt('-98765.5', { type: 'Decimal', dataFormatString: '@foreignCurrencyAmountViewFormat' }), '-98 765.50');
eq('cột số nhận ra qua <items style="Numeric">',
  fmt('12.5', { dataFormatString: '@quantityViewFormat' }, { style: 'Numeric' }), '12.50');

/*
 * Cặp `Input`/`View` khác nhau đúng một ký tự ở hàng đơn vị, và ký tự ấy có nghĩa:
 *
 *     foreignCurrencyAmountInputFormat   # ### ### ### ##0.00   → 0 hiện ra `0.00`
 *     foreignCurrencyAmountViewFormat    # ### ### ### ###.00   → 0 để TRỐNG ô
 *
 * Đó là quy ước làm lưới FBO nhìn thưa chứ không dày đặc số 0, và bỏ qua nó là bản xem trước
 * đầy `0.00` ở những ô runtime để trắng.
 */
eq('mặt nạ View: số 0 để trống ô',
  fmt('0.0000', { type: 'Decimal', dataFormatString: '@foreignCurrencyAmountViewFormat' }), '');
eq('mặt nạ Input: số 0 vẫn hiện',
  fmt('0.0000', { type: 'Decimal', dataFormatString: '@foreignCurrencyAmountInputFormat' }), '0.00');

section('format — không định dạng được thì trả giá trị thô, không ném');

eq('mặt nạ trỏ tới biến không có trong Options', fmt('5', { type: 'Decimal', dataFormatString: '@khongTonTai' }), '5');
eq('giá trị không phải số', fmt('abc', { type: 'Decimal', dataFormatString: '@quantityViewFormat' }), 'abc');
eq('cột chữ không bị đem đi định dạng số', fmt('Công ty A', {}), 'Công ty A');
/*
 * `X`/`x` là mặt nạ HOA/THƯỜNG (`upperCaseFormat` của Options), không phải mặt nạ số hay ngày —
 * `renderGridControl` đã lo phần hoa bằng `text-transform`.
 */
eq('mặt nạ X không phải mặt nạ số', fmt('kh01', { dataFormatString: 'X' }), 'kh01');
eq('ô rỗng vẫn là ô rỗng', fmt('', { type: 'Decimal', dataFormatString: '@quantityViewFormat' }), '');
eq('null về chuỗi rỗng', fmt(null, { type: 'DateTime' }), '');
for (const bad of [undefined, {}, []]) {
  ok(`field lạ (${JSON.stringify(bad)}) không ném`, formatSampleValue('x', bad, F) === 'x');
}

section('format — canh lề mặc định theo KIỂU cột');

/*
 * Số canh PHẢI, ngày canh GIỮA, còn lại canh TRÁI. `<items style="Numeric">` một mình là chưa
 * đủ: phần lớn cột tiền của lưới chứng từ khai `type="Decimal"` mà KHÔNG khai `<items>`
 * (`t_tt_nt`, `t_ck_nt` của `Grid/Config/Fields/SOTran.xml`), nên trước đây chúng dính lề trái
 * trong khi runtime canh phải.
 */
eq('Decimal → phải', alignOf(field({ type: 'Decimal' })), 'right');
eq('Int → phải', alignOf(field({ type: 'Int' })), 'right');
eq('items Numeric → phải', alignOf(field({}, { style: 'Numeric' })), 'right');
eq('DateTime → giữa', alignOf(field({ type: 'DateTime' })), 'center');
eq('Boolean → giữa', alignOf(field({ type: 'Boolean' })), 'center');
// `null` = không khai inline. `text-align` mặc định của `<input>` đã là trái, nên một khai báo
// thừa chỉ làm HTML dài ra mà không đổi gì trên màn hình.
eq('chữ → không khai (mặc định trái)', alignOf(field({})), null);
eq('align khai tay thắng tất cả', alignOf(field({ type: 'Decimal', align: 'center' })), 'center');

eq('isNumericField theo type', isNumericField(field({ type: 'Money' })), true);
eq('isNumericField theo items', isNumericField(field({}, { style: 'Numeric' })), true);
eq('isDateField', isDateField(field({ type: 'DateTime' })), true);
eq('chữ không phải số cũng không phải ngày',
  [isNumericField(field({})), isDateField(field({}))], [false, false]);

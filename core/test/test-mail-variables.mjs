// test-mail-variables.mjs — biến `{!tên}` và dữ liệu mẫu (Phase 6).
//
// Ba điều phải đúng cùng lúc: nguồn KHÔNG đổi (biến chỉ đổi bản vẽ); token trong thuộc tính không
// bao giờ thành thẻ HTML (chip chỉ ở chữ); và giá trị mẫu do người dùng gõ không mở được thẻ hay
// thuộc tính mới trong bản vẽ.

import { section, eq, ok } from './harness.mjs';
import { mailActionLabels } from '../src/mail-template.mjs';
import { renderMailDesign } from '../src/mail-html.mjs';
import {
  scanMailTokens, mailVariables, parseMailSample, formatSampleScalar, sampleValueOf, sampleSkeleton, MAX_SAMPLE_ROWS,
} from '../src/mail-variables.mjs';
import {
  HOST, SHARED, SOURCE, SHARED_SOURCE, build,
} from './test-mail-html.mjs';

const base = build();
const labels = mailActionLabels(base.expanded.clearText, 'Order');
const marks = (html) => (html.match(/data-fbo-el="e\d+"/g) ?? []).length;

section('mail variables — quét token và ngữ cảnh');
{
  const tokens = scanMailTokens(base.view, base.index);
  eq('đủ token theo thứ tự xuất hiện', tokens.map((t) => t.name), ['ten_kh', 'alink', 'slink', 'order_url', 'h_so_ct', 'so_ct', 'ma_vt', 'ten_vt']);
  eq('ngữ cảnh: chữ / thuộc tính', tokens.map((t) => t.context), ['text', 'attr', 'attr', 'attr', 'text', 'text', 'text', 'text']);
  eq('token trong dòng mẫu thuộc part detail', tokens.at(-1).part, 'detail');

  const vars = mailVariables(base.view, base.index, labels);
  eq('khai trong <fields> = nhãn', vars.find((v) => v.name === 'h_so_ct').kind, 'label');
  eq('không khai = dữ liệu', vars.find((v) => v.name === 'ten_kh').kind, 'data');
  eq('nhãn mang theo chữ của header', vars.find((v) => v.name === 'h_so_ct').label, { v: 'Số phiếu', e: 'Number' });
  eq('biến trong href ghi ngữ cảnh attr', vars.find((v) => v.name === 'alink').contexts, ['attr']);

  const titled = build({ [HOST]: SOURCE.replace('<![CDATA[<html>]]>', '<![CDATA[<html><title>Đơn {!so_ct}</title>]]>'), [SHARED]: SHARED_SOURCE });
  eq('token trong <title> = raw', scanMailTokens(titled.view, titled.index)[0].context, 'raw');
}

section('mail variables — đọc dữ liệu mẫu');
{
  const good = parseMailSample('{"so_ct":"PN0001","t_tien":12500000,"duyet":true,"ghi_chu":null,"detail":[{"ma_vt":"VT01"}]}');
  ok('object phẳng + detail nhận được', good.ok, good.reason);
  eq('chuỗi rỗng = xoá dữ liệu mẫu', parseMailSample('   '), { ok: true, data: {} });
  const cases = [
    ['{ "so_ct": 1 ', 'JSON'],
    ['[1,2]', 'object'],
    ['{"kh":{"ten":"A"}}', 'chuỗi, số'],
    ['{"so-ct":"x"}', 'tên biến'],
    ['{"detail":{"ma_vt":"x"}}', 'mảng'],
    ['{"detail":["x"]}', 'detail[0]'],
    ['{"detail":[{"ma_vt":[1]}]}', 'detail[0].ma_vt'],
    [JSON.stringify({ detail: Array.from({ length: MAX_SAMPLE_ROWS + 1 }, () => ({})) }), 'tối đa'],
  ];
  for (const [text, hint] of cases) {
    const r = parseMailSample(text);
    ok(`từ chối kèm lý do: ${text.slice(0, 30)}`, !r.ok && r.reason.includes(hint), r.reason);
  }

  eq('số có phân nhóm nghìn', formatSampleScalar(12500000), '12,500,000');
  eq('số lẻ', formatSampleScalar(1234.5), '1,234.5');
  eq('null → rỗng', formatSampleScalar(null), '');
  eq('true → chữ', formatSampleScalar(true), 'true');

  const sample = { ma_vt: 'NGOAI', detail: [{ ma_vt: 'VT01' }] };
  eq('token trong detail đọc dòng đầu của detail', sampleValueOf(sample, 'ma_vt', 'detail'), 'VT01');
  eq('token ngoài detail đọc giá trị ngoài cùng', sampleValueOf(sample, 'ma_vt', 'header'), 'NGOAI');
  eq('không có → null', sampleValueOf(sample, 'ten_vt', 'detail'), null);
  eq('"detail" không phải một biến', sampleValueOf(sample, 'detail', 'header'), null);

  eq('khung dữ liệu mẫu: biến dữ liệu, biến chỉ ở detail vào detail[0], bỏ nhãn',
    sampleSkeleton(mailVariables(base.view, base.index, labels)),
    { ten_kh: '', alink: '', slink: '', order_url: '', so_ct: '', detail: [{ ma_vt: '', ten_vt: '' }] });
}

section('mail variables — bản vẽ theo chế độ');
{
  const render = (opts, b = base) => renderMailDesign(b.view, b.index, { labels, ...opts });
  const expected = base.index.elements.length - 1; // <script> bị gỡ

  const label = render({ mode: 'label' });
  ok('nhãn: {!h_so_ct} thành chữ "Số phiếu", không chip', label.includes('Số phiếu') && !label.includes('data-fbo-var="h_so_ct"'));
  ok('nhãn: biến dữ liệu thành chip', label.includes('data-fbo-var="ten_kh"') && label.includes('>{!ten_kh}</span>'));
  ok('token trong href giữ nguyên, không chip', label.includes('href="{!alink}&n=1"') && !/href="<span/.test(label));
  eq('chip không mang data-fbo-el → số dấu phần tử không đổi', marks(label), expected);

  const token = render({ mode: 'token' });
  // "Số phiếu" vẫn nằm trong `title` của chip (gợi ý khi rê chuột) — cái phải vắng là CHỮ HIỆN RA.
  ok('token: cả nhãn cũng thành chip', token.includes('data-fbo-var="h_so_ct"') && !/>Số phiếu</.test(token));
  eq('token: số dấu phần tử không đổi', marks(token), expected);

  const sample = render({
    mode: 'sample',
    sample: {
      ten_kh: 'Nguyễn <b>A</b>', alink: 'https://fast.com.vn/duyet?id=1', so_ct: 'PN0001', t_tien: 1, detail: [{ ma_vt: 'VT01' }],
    },
  });
  ok('mẫu: giá trị thay vào chữ, đã escape', sample.includes('Xin chào Nguyễn &lt;b&gt;A&lt;/b&gt;'));
  ok('mẫu: giá trị thay vào href, phần sau token giữ nguyên', sample.includes('href="https://fast.com.vn/duyet?id=1&n=1"'));
  ok('mẫu: dòng detail đọc detail[0]', sample.includes('>VT01</td>'));
  ok('mẫu: biến thiếu vẫn là chip, ghi rõ chưa có', sample.includes('data-fbo-var="ten_vt"') && sample.includes('chưa có trong dữ liệu mẫu'));
  ok('mẫu: nhãn vẫn là nhãn', sample.includes('Số phiếu'));
  eq('mẫu: số dấu phần tử không đổi', marks(sample), expected);

  const attack = render({ mode: 'sample', sample: { alink: '" onmouseover="alert(1)' } });
  ok('giá trị mẫu không thoát được khỏi thuộc tính', !attack.includes('" onmouseover') && attack.includes('&quot; onmouseover=&quot;alert(1)'));

  const titled = build({ [HOST]: SOURCE.replace('<![CDATA[<html>]]>', '<![CDATA[<html><title>Đơn {!so_ct}</title>]]>'), [SHARED]: SHARED_SOURCE });
  // Thẻ mở `<title>` cũng mang `data-fbo-el` như mọi phần tử — so theo nội dung, không theo nguyên văn thẻ mở.
  ok('raw: giá trị an toàn thay vào <title>', /<title[^>]*>Đơn PN01<\/title>/.test(render({ mode: 'sample', sample: { so_ct: 'PN01' } }, titled)));
  ok('raw: giá trị mang < thì giữ token', /<title[^>]*>Đơn \{!so_ct\}<\/title>/.test(render({ mode: 'sample', sample: { so_ct: '</title><b>' } }, titled)));

  const evil = build({ [HOST]: SOURCE.replace('onclick="steal()"', 'onclick="{!so_ct}"'), [SHARED]: SHARED_SOURCE });
  const evilHtml = render({ mode: 'sample', sample: { so_ct: 'x' } }, evil);
  ok('token nằm trong thuộc tính bị gỡ không làm vỡ patch', !/onclick/i.test(evilHtml) && marks(evilHtml) === evil.index.elements.length - 1);

  ok('nguồn vẫn giữ nguyên {!tên}', base.expanded.clearText.includes('Xin chào {!ten_kh}') && base.expanded.clearText.includes('href="{!alink}&n=1"'));
}

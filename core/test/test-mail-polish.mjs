// test-mail-polish.mjs — Phase 8: kiểm HTML theo luật mail client, bản xem trước đầy đủ.
//
// Luật kiểm phải trỏ ĐÚNG phần tử (designer chọn tới đó) và xếp lỗi trước cảnh báo. Bản xem trước
// phải nhân dòng mẫu theo dữ liệu mà KHÔNG làm gì khác bản vẽ: vẫn làm sạch, header/footer một lần,
// không dấu phần tử.

import { section, eq, ok } from './harness.mjs';
import { mailActionLabels } from '../src/mail-template.mjs';
import { renderMailDesign, renderMailFullPreview } from '../src/mail-html.mjs';
import { lintMailHtml, GMAIL_CLIP_BYTES } from '../src/mail-lint.mjs';
import { sampleValueOf } from '../src/mail-variables.mjs';
import {
  HOST, SHARED, SOURCE, SHARED_SOURCE, build, nth,
} from './test-mail-html.mjs';

const RANK = { error: 0, warning: 1, info: 2 };
const variant = (from, to) => build({ [HOST]: SOURCE.replace(from, to), [SHARED]: SHARED_SOURCE });

section('mail lint — luật mail client trên fixture');
{
  const b = build();
  const issues = lintMailHtml(b.view, b.index);
  const byCode = (code) => issues.filter((i) => i.code === code);

  eq('<script> → lỗi, trỏ đúng phần tử', byCode('mail.blocked-tag').map((i) => [i.severity, i.elementId]), [['error', nth(b.index, 'script').id]]);
  eq('onclick → lỗi trên <a>', byCode('mail.event-attr').map((i) => i.elementId), [nth(b.index, 'a', 0).id]);
  eq('ảnh thiếu alt → cảnh báo', byCode('mail.img-alt').map((i) => [i.severity, i.elementId]), [['warning', nth(b.index, 'img', 0).id]]);
  eq('ảnh thiếu width → gợi ý (Outlook)', byCode('mail.img-width').map((i) => [i.severity, i.elementId]), [['info', nth(b.index, 'img', 0).id]]);
  eq('ảnh có đủ alt + width không bị báo', issues.filter((i) => i.elementId === nth(b.index, 'img', 1).id), []);
  eq('href mang {!token} không phải liên kết rỗng', byCode('mail.link-empty'), []);
  eq('không vấn đề cấu trúc / kích thước', [byCode('mail.html-structure').length, byCode('mail.size').length], [0, 0]);
  ok('lỗi → cảnh báo → gợi ý', issues.every((x, k) => k === 0 || RANK[issues[k - 1].severity] <= RANK[x.severity]));
  ok('mỗi vấn đề có lời giải thích', issues.every((i) => typeof i.message === 'string' && i.message.length > 10));
}
{
  const css = variant('<p></p>', '<p style="display:flex;position:absolute;float:left;background-image:url(x.png)"></p>');
  const cssIssues = lintMailHtml(css.view, css.index).filter((i) => i.code === 'mail.css-support');
  eq('bốn khai báo CSS mail không hỗ trợ, cùng trỏ vào <p>', [cssIssues.length, new Set(cssIssues.map((i) => i.elementId)).size], [4, 1]);
  ok('lời giải thích nêu client', cssIssues.some((i) => i.message.includes('Outlook')));

  const link = variant('<a href="https://fast.com.vn">', '<a href="#">');
  eq('href="#" → liên kết rỗng', lintMailHtml(link.view, link.index).filter((i) => i.code === 'mail.link-empty').map((i) => i.elementId), [nth(link.index, 'a', 1).id]);

  const src = variant('<img src="logo.png"', '<img src=""');
  ok('src rỗng → cảnh báo', lintMailHtml(src.view, src.index).some((i) => i.code === 'mail.img-src'));

  const broken = variant('<p></p>', '<p></b></p>');
  const structure = lintMailHtml(broken.view, broken.index).filter((i) => i.code === 'mail.html-structure');
  ok('thẻ đóng lạc → lỗi cấu trúc', structure.length === 1 && structure[0].severity === 'error' && structure[0].message.includes('</b>'));

  const big = variant('<p></p>', `<p></p><!--${'x'.repeat(GMAIL_CLIP_BYTES)}-->`);
  ok('HTML > 102 KB → cảnh báo Gmail cắt thư', lintMailHtml(big.view, big.index).some((i) => i.code === 'mail.size' && i.message.includes('Gmail')));
}

section('mail preview — bản xem trước đầy đủ');
{
  const b = build();
  const labels = mailActionLabels(b.expanded.clearText, 'Order');
  const sample = { ten_kh: 'An', detail: [{ ma_vt: 'VT01' }, { ma_vt: 'VT02' }, { ma_vt: 'VT03' }] };
  const full = renderMailFullPreview(b.view, b.index, { labels, sample });

  ok('không dấu phần tử — chỉ đọc', !full.includes('data-fbo-el'));
  eq('dòng mẫu nhân theo từng dòng dữ liệu, đúng thứ tự', [...full.matchAll(/>(VT0\d)<\/td>/g)].map((m) => m[1]), ['VT01', 'VT02', 'VT03']);
  eq('header chỉ một lần', (full.match(/<h2/g) ?? []).length, 1);
  ok('footer chỉ một lần', (full.match(/<\/table>/g) ?? []).length === 1 && full.trimEnd().endsWith('</html>'));
  ok('vẫn làm sạch như bản vẽ', !/<script/i.test(full) && !/onclick/i.test(full));
  ok('biến ngoài detail vẫn thay', full.includes('Xin chào An'));
  eq('biến thiếu vẫn là chip, ở mỗi dòng', (full.match(/data-fbo-var="ten_vt"/g) ?? []).length, 3);

  const single = renderMailFullPreview(b.view, b.index, { labels });
  eq('không có dữ liệu mẫu → một dòng', (single.match(/data-fbo-var="ma_vt"/g) ?? []).length, 1);

  const design = renderMailDesign(b.view, b.index, { labels, mode: 'sample', sample });
  ok('bản vẽ designer vẫn MỘT dòng, đọc detail[0]', design.includes('>VT01</span></td>') && !design.includes('VT02'));
  ok('bản vẽ mang dấu token, bản xem trước thì không', design.includes('data-fbo-tok=') && !full.includes('data-fbo-tok='));
  eq('sampleValueOf đọc đúng dòng được chỉ', sampleValueOf(sample, 'ma_vt', 'detail', 2), 'VT03');
  eq('dòng không có → null', sampleValueOf(sample, 'ma_vt', 'detail', 9), null);
}

// test-css-scope.mjs — nâng đặc hiệu base pack lên trên CSS của program.
//
// Ca thật, dự án HOATP: `FastBusiness.NotifyExtender.NotifyExtender.css` khai
// `div.ToolbarBackgroundImage` (0-1-1) và đè `.ToolbarBackgroundImage` (0-1-0) của base pack.
// Đảo thứ tự `<link>` KHÔNG cứu được — đặc hiệu cao thắng bất kể ai nạp trước.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, eq, section } from './harness.mjs';
import { scopeCss, FORM_SCOPE } from '../src/css-scope.mjs';

section('css-scope — gắn tiền tố vào MỌI selector');
eq('rule đơn', scopeCss('.A { color: red; }', '#s'), '#s .A { color: red; }');
eq('danh sách selector: từng cái một, không phải cả cụm',
  scopeCss('.A, .B { color: red; }', '#s'), '#s .A, #s .B { color: red; }');
eq('selector tổ hợp giữ nguyên phần sau',
  scopeCss('td:hover > .M { display: block; }', '#s'), '#s td:hover > .M { display: block; }');
// Xuống dòng giữa hai rule GIỮ nguyên — mất nó là cả file dồn một dòng, không soi được trong
// devtools. Khoảng trắng quanh chính selector thì chuẩn hoá về một dấu cách.
eq('nhiều rule, giữ xuống dòng', scopeCss('.A{a:1}\n.B{b:2}', '#s'), '#s .A {a:1}\n#s .B {b:2}');
eq('CSS rỗng thì không đụng', scopeCss('', '#s'), '');
eq('không có scope thì trả nguyên văn', scopeCss('.A{a:1}', ''), '.A{a:1}');

section('css-scope — comment bị bỏ, không bị đọc nhầm thành rule');
/*
 * Comment trong base pack chứa cả `{`, `}` và `,` (mấy bảng đối chiếu runtime). Không bỏ trước
 * khi tách khối thì phép tách selector đọc chúng thành rule và sinh ra CSS vỡ.
 */
const withComment = scopeCss('/* .Fake { x: 1 }, .Other */\n.Real { y: 2 }', '#s');
ok('rule thật được gắn scope', withComment.includes('#s .Real'));
ok('không sinh selector từ comment', !withComment.includes('.Fake'));

section('css-scope — data URI đi qua nguyên vẹn');
/*
 * Bảng chữ base64 là `A–Z a–z 0–9 + / =` — KHÔNG có `{` hay `}`. Đó chính là điều kiện để phép
 * tách theo `}` dùng được ở đây, và cũng là giới hạn phải nói rõ: một giá trị CHỨA `{`/`}` sẽ
 * cắt nhầm. Base pack không có giá trị nào như vậy (15 icon lọc đều là data URI base64), nên
 * ràng buộc ấy đủ — nhưng nó là ràng buộc, không phải sự an toàn tự nhiên.
 */
const dataUri = ".I { background-image: url('data:image/gif;base64,R0lGODlhAQ+/ABAA=='); }";
const scopedUri = scopeCss(dataUri, '#s');
ok('mọi ký tự base64 giữ nguyên', scopedUri.includes('base64,R0lGODlhAQ+/ABAA=='));
ok('và selector vẫn được gắn scope', scopedUri.startsWith('#s .I {'));

section('css-scope — chạy trên CHÍNH base pack, không phải fixture');
/*
 * Đây mới là phép kiểm có nghĩa: một fixture tự nghĩ ra không nói gì về file thật. Base pack là
 * thứ sẽ được gắn scope lúc chạy, nên nó phải là thứ được kiểm.
 */
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension', 'media', 'base', 'css');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
ok('có file base pack để kiểm', files.length > 0);

let rules = 0;
let unscoped = 0;
let atRules = 0;
for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  // At-rule có khối lồng; `scopeCss` KHÔNG đi vào trong. Base pack hôm nay không có cái nào —
  // test này là chốt chặn cho ngày ai đó thêm vào mà quên dạy `scopeCss` đọc khối lồng.
  atRules += (raw.replace(/\/\*[\s\S]*?\*\//g, '').match(/@(media|supports|keyframes|font-face|import)\b/g) ?? []).length;

  const out = scopeCss(raw, FORM_SCOPE);
  for (const chunk of out.split('}')) {
    if (!chunk.includes('{')) continue;
    rules++;
    for (const sel of chunk.slice(0, chunk.lastIndexOf('{')).split(',')) {
      if (sel.trim() !== '' && !sel.trim().startsWith(FORM_SCOPE)) unscoped++;
    }
  }
}
eq('base pack KHÔNG có at-rule — điều kiện để scopeCss dùng được ở đây', atRules, 0);
ok(`gắn scope cho toàn bộ ${rules} rule của base pack`, rules > 100);
eq('không sót selector nào', unscoped, 0);

section('css-scope — đặc hiệu thật sự thắng CSS của program');
/*
 * Không đếm chữ mà tính đặc hiệu theo đúng luật CSS: (id, class/attr/pseudo-class, phần tử).
 * `#fbo-form .ToolbarBackgroundImage` = (1,1,0) phải thắng `div.ToolbarBackgroundImage` = (0,1,1).
 * So theo thứ tự từ điển, id là vế đầu nên (1,…) thắng mọi (0,…).
 */
const spec = (sel) => [
  (sel.match(/#[\w-]+/g) ?? []).length,
  (sel.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length,
  (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length,
];
const beats = (a, b) => {
  const [x, y] = [spec(a), spec(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
const ours = scopeCss('.ToolbarBackgroundImage { background-position: -308px 0; }', FORM_SCOPE)
  .split('{')[0].trim();
eq('selector sau khi gắn scope', ours, '#fbo-form .ToolbarBackgroundImage');
ok('thắng div.ToolbarBackgroundImage của HOATP', beats(ours, 'div.ToolbarBackgroundImage'));
ok('thắng cả .A.B của program', beats(ours, '.Notify.ToolbarBackgroundImage') === false || beats(ours, '.Notify') === true);
ok('vẫn thua một selector có id của program', !beats(ours, '#panel div.ToolbarBackgroundImage'));
